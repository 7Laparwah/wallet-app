/* ============================================================
   TAGDA BILL SCANNER — DayToDay (Enhanced with Arithmetic Reconciliation)
   Kisi bhi bill / receipt / invoice (restaurant, GST, shopping, fuel, UPI)
   se amount, party, date, payment mode aur item list nikaal kar entry karta hai.

   Reconciliation Engine:
   - ₹ sign OCR misreads (e.g. ₹707.70 -> 2707.70) auto-corrects by verifying:
     Subtotal + Taxes (CGST + SGST) = Grand Total
   - Cleans restaurant / business names and skips slogans / taglines.
   - Form buttons & UI with instant single-click touch response.
   ============================================================ */
(function () {
  'use strict';

  var S = { img: null, thumb: null, busy: false, saving: false, data: null };

  /* ---------- Tiny DOM & String Helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function todayStr() {
    try {
      if (typeof getLocalDateStr === 'function') return getLocalDateStr();
    } catch (e) { }
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function toast(msg, type) {
    try {
      if (typeof showNotification === 'function') showNotification(msg, type || 'success');
      else console.log(msg);
    } catch (e) {
      console.log(msg);
    }
  }

  /* ---------- Date & Number Helpers ---------- */
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function pad(n) { return String(n).padStart(2, '0'); }

  function validYMD(y, m, d) {
    if (y < 100) y += 2000;
    if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function parseDate(v) {
    if (!v) return null;
    var s = String(v).trim(), m;
    if ((m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return validYMD(+m[1], +m[2], +m[3]);
    if ((m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3})[a-z]*[\s,.-]+(\d{2,4})/i)) && MON[m[2].toLowerCase()]) return validYMD(+m[3], MON[m[2].toLowerCase()], +m[1]);
    if ((m = s.match(/([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i)) && MON[m[1].toLowerCase()]) return validYMD(+m[3], MON[m[1].toLowerCase()], +m[2]);
    if ((m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) return validYMD(+m[3], +m[2], +m[1]); // India: DD/MM/YYYY
    return null;
  }

  function parseAmount(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v).replace(/[₹\?\$|]|\brs\.?|\binr|\/\-|[a-z]/gi, ' ').trim();
    var m = s.match(/-?\d[\d,\s]*(?:\.\d+)?/);
    if (!m) return 0;
    var n = parseFloat(m[0].replace(/[,\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function titleCase(s) {
    return String(s || '').toLowerCase().replace(/(^|[\s.&-])([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }

  function normMethod(v) {
    var s = String(v || '').toLowerCase();
    if (/upi|gpay|google|phonepe|paytm|bhim|qr|scan/.test(s)) return 'UPI';
    if (/card|visa|master|rupay|debit|credit|pos/.test(s)) return 'Card';
    if (/bank|neft|imps|rtgs|transfer|net ?bank/.test(s)) return 'Bank';
    if (/cash|nakad|cod/.test(s)) return 'Cash';
    return '';
  }

  function cleanMerchant(v) {
    var s = String(v || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/^(?:welcome\s+to\s+|m\/s\.?\s*|messrs\.?\s*)/i, '')
      .replace(/[^\w\s&.'\-\u0900-\u097F]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (s.length > 50) s = s.slice(0, 50).trim();
    if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) s = titleCase(s);
    return s;
  }

  function matchKnownParty(name) {
    var list = [];
    try {
      if (typeof getOfficialPartyNames === 'function') list = getOfficialPartyNames() || [];
    } catch (e) { }
    var n = String(name || '').toLowerCase().trim();
    if (!n || /^(self|income|khud|personal|null|undefined)$/i.test(n)) return '';
    // 1. Exact match first
    for (var i = 0; i < list.length; i++) {
      var p = String(list[i]).toLowerCase().trim();
      if (p && p !== 'self' && p === n) return list[i];
    }
    // 2. Whole word boundary match (only if length >= 3)
    if (n.length >= 3) {
      for (var i = 0; i < list.length; i++) {
        var p = String(list[i]).toLowerCase().trim();
        if (p && p !== 'self' && p.length >= 3) {
          if (new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(n)) {
            return list[i];
          }
        }
      }
    }
    return '';
  }

  function guessCategory(merchant, items) {
    var text = (merchant + ' ' + (items || '')).toLowerCase();
    if (/restaurant|cafe|hotel|dhaba|bakes|bakery|dosa|pizza|burger|tea|chai|coffee|food|dining|sweets|kitchen|biryani|roll|menu|bar|pub/.test(text)) {
      return 'Food & Dining';
    }
    if (/grocery|supermarket|mart|store|kirana|provisions|retail|fresh|vegetable|fruit|milk|dairy/.test(text)) {
      return 'Grocery';
    }
    if (/pharmacy|medical|chemist|hospital|clinic|health|pharma|apollo|medplus|doctor|lab|diagnostic/.test(text)) {
      return 'Medical';
    }
    if (/petrol|fuel|diesel|cng|indian ?oil|bharat ?petrol|hp|shell|uber|ola|auto|cab|flight|train|metro|travel|toll|fastag/.test(text)) {
      return 'Travel / Fuel';
    }
    if (/electric|electricity|bescom|water|gas|broadband|wifi|airtel|jio|vi\b|bill|recharge|dth/.test(text)) {
      return 'Bills & Utilities';
    }
    if (/mall|fashion|clothing|zara|h&m|trends|shopping|amazon|flipkart|myntra|apparel|footwear|shoes/.test(text)) {
      return 'Shopping';
    }
    return 'Other';
  }

  /* ---------- Advanced Bill Parser with Arithmetic Reconciliation ---------- */
  function parseBillTextAdvanced(text) {
    var rawLines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

    // 1. DATE EXTRACTION
    var date = '';
    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i];
      var isDateLine = /(?:date|dt|dated|time|bill\s*dt|inv\s*dt|receipt\s*dt)/i.test(line);
      // Regex 1: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
      var m = line.match(/\b(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})\b/);
      if (m) {
        var p = validYMD(+m[3], +m[2], +m[1]);
        if (p) { date = p; if (isDateLine) break; }
      }
      // Regex 2: YYYY-MM-DD
      var mYmd = line.match(/\b(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})\b/);
      if (mYmd) {
        var pYmd = validYMD(+mYmd[1], +mYmd[2], +mYmd[3]);
        if (pYmd) { date = pYmd; if (isDateLine) break; }
      }
      // Regex 3: DD-MMM-YYYY or DD MMM YYYY (e.g. 24-Nov-2026)
      var mMmm = line.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,.-]+(\d{2,4})\b/i);
      if (mMmm && MON[mMmm[2].toLowerCase().slice(0, 3)]) {
        var pMmm = validYMD(+mMmm[3], MON[mMmm[2].toLowerCase().slice(0, 3)], +mMmm[1]);
        if (pMmm) { date = pMmm; if (isDateLine) break; }
      }
      // Regex 4: MMM DD, YYYY
      var mMmm2 = line.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
      if (mMmm2 && MON[mMmm2[1].toLowerCase().slice(0, 3)]) {
        var pMmm2 = validYMD(+mMmm2[3], MON[mMmm2[1].toLowerCase().slice(0, 3)], +mMmm2[2]);
        if (pMmm2) { date = pMmm2; if (isDateLine) break; }
      }
    }

    // 2. INVOICE / BILL NO
    var invoiceNo = '';
    for (var i = 0; i < rawLines.length; i++) {
      var im = rawLines[i].match(/(?:bill\s*no|inv(?:oice)?\s*no|receipt\s*no|token\s*no|order\s*#)\s*[:\-]?\s*([A-Za-z0-9\-\/]+)/i);
      if (im) { invoiceNo = im[1].trim(); break; }
    }

    // 3. PAYMENT METHOD
    var method = '';
    for (var i = 0; i < rawLines.length; i++) {
      var pm = rawLines[i].match(/payment\s*(?:mode|method|type|status)?\s*[:\-]?\s*([a-z\s]+)/i);
      if (pm) {
        var s = pm[1].toLowerCase();
        if (/upi|gpay|google|phonepe|paytm|bhim|qr/.test(s)) { method = 'UPI'; break; }
        if (/card|visa|master|rupay|debit|credit|pos/.test(s)) { method = 'Card'; break; }
        if (/bank|neft|imps|rtgs|transfer/.test(s)) { method = 'Bank'; break; }
        if (/cash|nakad|cod/.test(s)) { method = 'Cash'; break; }
      }
    }
    if (!method) {
      var full = String(text).toLowerCase();
      if (/\bupi\b|gpay|phonepe|paytm|bhim|scan\s*&\s*pay/.test(full)) method = 'UPI';
      else if (/credit\s*card|debit\s*card|\bvisa\b|\bmastercard\b|\brupay\b|\bcard\b/.test(full)) method = 'Card';
      else if (/net\s*banking|\bbank\s*transfer\b/.test(full)) method = 'Bank';
      else if (/\bcash\b/.test(full)) method = 'Cash';
    }

    // 4. MERCHANT / SHOP NAME
    var merchant = '';
    var noiseHeaders = /^(tax invoice|retail invoice|cash memo|bill of supply|tax memo|original for recipient|duplicate for supplier|estimate|proforma|welcome|thank you|thanks for visit|customer copy|guest check|order receipt)$/i;
    for (var i = 0; i < Math.min(rawLines.length, 12); i++) {
      var l = rawLines[i].trim();
      if (!l || l.length < 3) continue;
      if (noiseHeaders.test(l)) continue;
      var cleanedL = l.replace(/^(?:welcome\s+to\s+|m\/s\.?\s*|messrs\.?\s*)/i, '').trim();
      if (/^(?:gstin|gst|fssai|cin|tin|pan|phone|tel|mob|mobile|contact|call|email|website|www|http|inv|bill\s*no|date|dt)\b/i.test(cleanedL)) continue;
      if (/\b(?:pincode|pin\s*\d{6}|\d{6}|road|street|nagar|marg|cross|lane|floor)\b/i.test(cleanedL)) continue;
      if (cleanedL.replace(/[^0-9]/g, '').length > 4) continue;
      if (/[A-Za-z\u0900-\u097F]{3,}/.test(cleanedL)) {
        merchant = cleanedL;
        break;
      }
    }
    if (merchant && merchant === merchant.toUpperCase()) merchant = titleCase(merchant);

    // 5. LINE ITEMS, SUBTOTAL, TAXES & RECONCILIATION
    var subtotal = 0;
    var taxes = 0;
    var rawTotals = [];
    var items = [];

    rawLines.forEach(function (l) {
      // Check for subtotal
      if (/sub\s*total/i.test(l) && !/grand|net/i.test(l)) {
        var nums = l.match(/\d+(?:\.\d{1,2})?/g);
        if (nums) subtotal = parseFloat(nums[nums.length - 1]);
      }
      // Check for tax (CGST, SGST, GST, VAT)
      else if (/(?:cgst|sgst|igst|vat|service\s*tax|gst)\b/i.test(l) && !/number|no|tin|cin|reg|gstin/i.test(l)) {
        var nums = l.match(/\d+(?:\.\d{1,2})?/g);
        if (nums) {
          var tVal = parseFloat(nums[nums.length - 1]);
          if (tVal > 0 && tVal < 5000) taxes += tVal;
        }
      }
      // Check for grand total line
      else if (/(?:grand\s*total|net\s*(?:amount|payable|amt)|total\s*(?:amount|payable|due|bill)?|amount\s*paid|bill\s*amount|\u0915\u0941\u0932)/i.test(l)) {
        var nums = l.match(/\d+(?:\.\d{1,2})?/g);
        if (nums && nums.length > 0) {
          var val = parseFloat(nums[nums.length - 1]);
          if (val > 0) rawTotals.push(val);
        }
      }
      // Check for item line
      if (!/^(sub\s*total|total|grand|net|cgst|sgst|igst|tax|vat|discount|round|balance|amount|cash|upi|card|bill|inv|date|tel|phone|thank)/i.test(l)) {
        var itemMatch = l.match(/^(?:\d+[\.\)]\s*)?([A-Za-z0-9\s&'\/\(\)\.\-\u0900-\u097F]{2,45}?)\s+(?:(?:x\s*)?\d+(?:\.\d+)?\s+)?(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d{1,2})?)$/i);
        if (itemMatch) {
          var itemName = itemMatch[1].trim().replace(/\s{2,}/g, ' ');
          var itemAmt = parseFloat(itemMatch[2]);
          if (itemName.length >= 2 && /[A-Za-z\u0900-\u097F]/.test(itemName) && itemAmt > 0 && itemAmt < 100000) {
            items.push({ name: itemName, amount: itemAmt });
          }
        }
      }
    });

    taxes = Math.round(taxes * 100) / 100;

    var calculatedTarget = 0;
    if (subtotal > 0) {
      calculatedTarget = Math.round((subtotal + taxes) * 100) / 100;
    } else if (items.length > 0) {
      var itemsSum = items.reduce(function (a, b) { return a + b.amount; }, 0);
      calculatedTarget = Math.round((itemsSum + taxes) * 100) / 100;
    }

    var finalAmount = 0;
    var reconciled = false;
    var reconciliationNote = '';

    for (var i = 0; i < rawTotals.length; i++) {
      var r = rawTotals[i];
      if (calculatedTarget > 0 && Math.abs(r - calculatedTarget) < 0.05) {
        finalAmount = r;
        reconciled = true;
        reconciliationNote = 'Subtotal (₹' + subtotal + ') + Tax (₹' + taxes + ') = ₹' + finalAmount;
        break;
      }
      var strVal = String(r);
      if (strVal.startsWith('2') && strVal.length >= 4) {
        var stripped = parseFloat(strVal.slice(1));
        if (calculatedTarget > 0 && Math.abs(stripped - calculatedTarget) < 0.05) {
          finalAmount = stripped;
          reconciled = true;
          reconciliationNote = 'Verified & Reconciled: Subtotal (₹' + subtotal + ') + Tax (₹' + taxes + ') = ₹' + finalAmount;
          break;
        }
      }
    }

    if (!finalAmount) {
      if (rawTotals.length > 0) {
        finalAmount = rawTotals[rawTotals.length - 1];
      } else if (calculatedTarget > 0) {
        finalAmount = calculatedTarget;
        reconciled = true;
        reconciliationNote = 'Calculated from items + taxes (₹' + finalAmount + ')';
      }
    }

    var itemsSummary = items.map(function (it) { return it.name + ' (₹' + it.amount + ')'; }).join(', ');
    var notes = itemsSummary;
    if (invoiceNo) notes = (notes ? notes + ' | ' : '') + 'Inv: ' + invoiceNo;

    var category = guessCategory(merchant, itemsSummary);

    return {
      amount: finalAmount,
      reconciled: reconciled,
      reconciliationNote: reconciliationNote,
      subtotal: subtotal,
      taxes: taxes,
      party: cleanMerchant(merchant),
      date: date || todayStr(),
      method: method || 'Cash',
      category: category,
      notes: notes,
      invoiceNo: invoiceNo,
      items: items.map(function (it) { return it.name + ' (₹' + it.amount + ')'; })
    };
  }

  // AI ya OCR ka raw object -> safe, validated entry fields
  function normalize(raw) {
    raw = raw || {};
    var rawAmt = raw.amount != null ? raw.amount :
                 (raw.total != null ? raw.total :
                 (raw.grand_total != null ? raw.grand_total :
                 (raw.grandTotal != null ? raw.grandTotal :
                 (raw.net_amount != null ? raw.net_amount :
                 (raw.netAmount != null ? raw.netAmount :
                 (raw.total_amount != null ? raw.total_amount :
                 (raw.totalAmount != null ? raw.totalAmount :
                 (raw.amount_paid != null ? raw.amount_paid : raw.amountPaid))))))));
    var amount = parseAmount(rawAmt);
    if (amount < 0) amount = Math.abs(amount);
    amount = Math.round(amount * 100) / 100;
    if (amount > 99999999) amount = 0;

    var rawDate = raw.date || raw.bill_date || raw.billDate || raw.invoice_date || raw.invoiceDate || raw.txn_date || raw.txnDate || raw.receiptDate;
    var date = parseDate(rawDate) || todayStr();

    var rawMerchant = raw.merchant || raw.party || raw.store || raw.vendor || raw.shop || raw.shopName || raw.storeName || raw.biller || raw.business || raw.name || '';
    var merchant = cleanMerchant(rawMerchant);
    var party = matchKnownParty(merchant) || merchant || '';

    var method = normMethod(raw.method || raw.payment_method || raw.paymentMode) || 'Cash';
    var category = raw.category || guessCategory(party, raw.itemsSummary || raw.notes || '');

    var itemsList = [];
    if (Array.isArray(raw.items)) {
      raw.items.forEach(function (it) {
        if (!it) return;
        if (typeof it === 'string' && it.trim()) {
          itemsList.push(it.trim());
        } else if (typeof it === 'object') {
          var name = it.name || it.item || it.description || it.title || '';
          var qty = it.qty || it.quantity || it.count || '';
          var price = it.price != null ? it.price : (it.amount != null ? it.amount : (it.total != null ? it.total : ''));
          if (name) {
            var itemStr = name;
            if (qty && Number(qty) > 1) itemStr += ' x' + qty;
            if (price && Number(price) > 0) itemStr += ' (₹' + price + ')';
            itemsList.push(itemStr);
          }
        }
      });
    }

    var itemsSummary = '';
    if (typeof raw.itemsSummary === 'string' && raw.itemsSummary.trim()) {
      itemsSummary = raw.itemsSummary.trim();
    } else if (itemsList.length > 0) {
      itemsSummary = itemsList.join(', ');
    } else if (typeof raw.items === 'string' && raw.items.trim()) {
      itemsSummary = raw.items.trim();
    }

    var notes = itemsSummary || (typeof raw.notes === 'string' ? raw.notes.trim() : '');
    if (raw.invoiceNo && !notes.includes(String(raw.invoiceNo))) {
      notes = (notes ? notes + ' | ' : '') + 'Inv: ' + raw.invoiceNo;
    }

    return {
      amount: amount,
      party: party,
      date: date,
      method: method,
      category: category,
      type: /refund|credit|income|salary|received/i.test(String(raw.type || '')) ? 'income' : 'expense',
      notes: notes,
      items: itemsList,
      reconciled: !!raw.reconciled,
      reconciliationNote: raw.reconciliationNote || '',
      missing: { amount: !(amount > 0), party: !party }
    };
  }

  /* ---------- Image: Load + Compress ---------- */
  function fileToImage(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); res(im); };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Image khul nahi payi. JPG/PNG photo try karein.')); };
      im.src = url;
    });
  }

  function draw(im, max, q) {
    var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }

  /* ---------- Gemini Vision Extraction ---------- */
  var PROMPT = 'You are an intelligent bill, receipt & invoice scanner for an Indian expense manager app.\n' +
    'The receipt may be a restaurant bill, GST tax invoice, retail receipt, fuel slip, hospital/medical bill, or payment slip.\n' +
    'Extract details and return ONLY a single JSON object (no markdown, no extra text):\n' +
    '{"merchant":"Store/Restaurant/Biller Name","amount":0.0,"subtotal":0.0,"taxes":0.0,"date":"YYYY-MM-DD","method":"UPI|Cash|Card|Bank","category":"Food & Dining|Grocery|Shopping|Travel / Fuel|Bills & Utilities|Medical|Other","type":"expense","invoiceNo":"","items":[{"name":"Item name","qty":1,"price":0.0}],"itemsSummary":"comma-separated items with prices"}\n' +
    'CRITICAL RULES:\n' +
    '1. merchant: The store, restaurant, hospital, vendor or business name from top header or logo (e.g. "Haldiram", "Domino\'s Pizza", "Apollo Pharmacy"). NEVER slogans (e.g. "Good Food"), addresses, or customer name.\n' +
    '2. amount: Final payable GRAND TOTAL / NET PAYABLE amount after taxes (number only).\n' +
    '3. date: Bill date converted to strict YYYY-MM-DD format (e.g. "2026-11-24"). Today is ' + todayStr() + '.\n' +
    '4. items: Array of line items with item name, quantity and price.\n' +
    '5. method: Payment mode (UPI, Cash, Card, Bank).';

  async function geminiExtract(dataUrl) {
    var b64 = dataUrl.split(',')[1] || '';
    if (b64.length < 100) throw new Error('Image data invalid. Dobara photo lein.');
    var base = { contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: b64 } }] }] };
    var last = null, cfgs = [
      { temperature: 0.1, maxOutputTokens: 1500, responseMimeType: 'application/json' },
      { temperature: 0.1, maxOutputTokens: 1500 }
    ];
    for (var i = 0; i < cfgs.length; i++) {
      try {
        var body = Object.assign({}, base, { generationConfig: cfgs[i] });
        if (typeof _geminiRawFetch !== 'function') throw new Error('Gemini fetch helper not available');
        var out = await _geminiRawFetch(body);
        if (typeof _parseGeminiJson === 'function') {
          var j = _parseGeminiJson(out);
          if (j && typeof j === 'object') return j;
        }
        if (out && typeof out === 'string') {
          var cleaned = out.replace(/```json/gi, '').replace(/```/g, '').trim();
          var m = cleaned.match(/\{[\s\S]*\}/);
          if (m) {
            try { return JSON.parse(m[0]); } catch (e2) {}
          }
        }
        last = new Error('AI ka jawab samajh nahi aaya.');
      } catch (e) {
        last = e;
        if (/INVALID_KEY|API Key set nahi/i.test(String(e && e.message))) throw e;
      }
    }
    throw last || new Error('AI scan fail.');
  }

  /* ---------- Tesseract OCR Fallback ---------- */
  function loadTesseract() {
    return new Promise(function (res, rej) {
      if (window.Tesseract) return res(window.Tesseract);
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = function () { window.Tesseract ? res(window.Tesseract) : rej(new Error('OCR load fail')); };
      s.onerror = function () { rej(new Error('OCR engine load nahi hua (internet check karein).')); };
      document.head.appendChild(s);
    });
  }

  async function ocrExtract(dataUrl, onStatus) {
    onStatus('OCR engine load ho raha hai…');
    var T = await loadTesseract();
    onStatus('Bill padha ja raha hai (OCR & Reconciliation)…');
    var r = await T.recognize(dataUrl, 'eng');
    var txt = r && r.data && r.data.text;
    return parseBillTextAdvanced(txt);
  }

  /* ---------- Modern Review Modal UI & Styles ---------- */
  var CSS = `
    #bsModal {
      position: fixed; inset: 0; z-index: 99990;
      display: none; align-items: flex-end; justify-content: center;
      background: rgba(10, 12, 18, 0.65);
      backdrop-filter: blur(6px);
      -webkit-tap-highlight-color: transparent;
    }
    #bsModal.on { display: flex; }
    #bsSheet {
      width: 100%; max-width: 480px; max-height: 92vh;
      overflow-y: auto; -webkit-overflow-scrolling: touch;
      background: #ffffff; color: #0f172a;
      border-radius: 24px 24px 0 0;
      padding: 16px 16px calc(20px + env(safe-area-inset-bottom, 0px));
      font-family: inherit;
      box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.3);
      animation: bsSlideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }
    body:not(.light-theme) #bsSheet {
      background: #151822; color: #f1f5f9;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    @keyframes bsSlideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }
    .bs-h {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px; padding-bottom: 8px;
      border-bottom: 1px solid rgba(0,0,0,0.06);
    }
    body:not(.light-theme) .bs-h { border-bottom-color: rgba(255,255,255,0.08); }
    .bs-h-title { font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .bs-x {
      border: 0; background: rgba(127, 127, 127, 0.12); color: inherit;
      width: 32px; height: 32px; border-radius: 50%; font-size: 18px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; touch-action: manipulation;
    }
    .bs-x:active { background: rgba(127, 127, 127, 0.25); }
    .bs-pick { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .bs-btn {
      border: 0; border-radius: 14px; padding: 12px 14px;
      font-weight: 700; font-size: 14px; cursor: pointer;
      background: #10b981; color: #fff;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      touch-action: manipulation; -webkit-tap-highlight-color: transparent;
    }
    .bs-btn.alt {
      background: rgba(127, 127, 127, 0.12); color: inherit;
    }
    body.light-theme .bs-btn.alt { background: #f1f5f9; color: #334155; }
    .bs-btn:active { filter: brightness(0.92); }
    .bs-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    #bsPrev {
      width: 100%; max-height: 180px; object-fit: contain;
      border-radius: 14px; background: rgba(127, 127, 127, 0.08);
      margin: 10px 0; display: none;
    }
    #bsStatus {
      font-size: 12.5px; line-height: 1.4; margin: 8px 0;
      padding: 8px 12px; border-radius: 12px;
      background: rgba(59, 130, 246, 0.08); color: #2563eb;
    }
    body:not(.light-theme) #bsStatus {
      background: rgba(59, 130, 246, 0.15); color: #60a5fa;
    }
    #bsStatus.ok {
      background: rgba(16, 185, 129, 0.12); color: #059669;
    }
    body:not(.light-theme) #bsStatus.ok {
      background: rgba(16, 185, 129, 0.2); color: #34d399;
    }
    #bsStatus.err {
      background: rgba(239, 68, 68, 0.1); color: #dc2626;
    }
    body:not(.light-theme) #bsStatus.err {
      background: rgba(239, 68, 68, 0.2); color: #f87171;
    }
    .bs-f label {
      display: block; font-size: 11.5px; font-weight: 700;
      margin: 10px 0 4px; text-transform: uppercase; letter-spacing: 0.3px;
      color: #64748b;
    }
    body:not(.light-theme) .bs-f label { color: #94a3b8; }
    .bs-f input, .bs-f select, .bs-f textarea {
      width: 100%; box-sizing: border-box; padding: 10px 12px;
      border-radius: 12px; border: 1px solid rgba(127, 127, 127, 0.28);
      background: transparent; color: inherit; font-size: 14.5px;
      font-family: inherit; outline: none; resize: vertical;
    }
    .bs-f input:focus, .bs-f select:focus, .bs-f textarea:focus {
      border-color: #10b981;
    }
    .bs-amt-wrap {
      position: relative; display: flex; align-items: center;
    }
    .bs-amt-wrap span {
      position: absolute; left: 12px; font-weight: 700; font-size: 17px; color: #10b981;
    }
    .bs-amt-wrap input {
      padding-left: 30px; font-size: 19px; font-weight: 700; color: #10b981;
    }
    .bs-f input.warn {
      border-color: #f59e0b; background: rgba(245, 158, 11, 0.08);
    }
    .bs-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    }
    #bsForm { display: none; }
    .bs-items-box {
      margin: 10px 0; padding: 10px 12px; border-radius: 14px;
      background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.22);
    }
    body:not(.light-theme) .bs-items-box {
      background: rgba(16, 185, 129, 0.12); border-color: rgba(16, 185, 129, 0.28);
    }
    .bs-items-head {
      font-size: 11.5px; font-weight: 700; color: #10b981;
      margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.3px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .bs-items-chips {
      display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px;
      overflow-y: auto; -webkit-overflow-scrolling: touch;
    }
    .bs-item-chip {
      display: inline-flex; align-items: center; gap: 4px;
      background: #ffffff; color: #0f172a;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 4px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 600;
    }
    body:not(.light-theme) .bs-item-chip {
      background: rgba(255, 255, 255, 0.09); color: #f1f5f9;
      border-color: rgba(255, 255, 255, 0.14);
    }
    .bs-spin {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid #10b981; border-right-color: transparent;
      border-radius: 50%; animation: bsr 0.7s linear infinite;
      vertical-align: -2px; margin-right: 6px;
    }
    @keyframes bsr { to { transform: rotate(360deg); } }
  `;

  function build() {
    if ($('bsModal')) return;
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var m = document.createElement('div');
    m.id = 'bsModal';
    m.innerHTML = `
      <div id="bsSheet" role="dialog" aria-label="Scan Bill">
        <div class="bs-h">
          <div class="bs-h-title">🧾 Scan Bill &amp; Receipt</div>
          <button class="bs-x" type="button" id="bsClose" aria-label="Close">&times;</button>
        </div>

        <div class="bs-pick" id="bsPickRow">
          <button class="bs-btn" type="button" id="bsCam">📷 Camera</button>
          <button class="bs-btn alt" type="button" id="bsGal">🖼️ Gallery</button>
        </div>

        <input type="file" id="bsFileCam" accept="image/*" capture="environment" style="display:none">
        <input type="file" id="bsFileGal" accept="image/*" style="display:none">

        <img id="bsPrev" alt="Bill preview">
        <div id="bsStatus">Kisi bhi bill ki photo lein — amounts aur items auto-reconcile ho jayenge.</div>

        <div id="bsForm" class="bs-f">
          <label>Amount (₹) *</label>
          <div class="bs-amt-wrap">
            <span>₹</span>
            <input id="bsAmt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00">
          </div>

          <label>Party / Shop *</label>
          <input id="bsParty" type="text" list="bsPartyList" maxlength="60" placeholder="e.g. Restaurant, Supermarket">
          <datalist id="bsPartyList"></datalist>

          <label>Category</label>
          <select id="bsCategory">
            <option value="Food &amp; Dining">🍔 Food &amp; Dining</option>
            <option value="Grocery">🛒 Grocery &amp; Provisions</option>
            <option value="Shopping">🛍️ Shopping &amp; Retail</option>
            <option value="Travel / Fuel">🚗 Travel &amp; Fuel</option>
            <option value="Bills &amp; Utilities">⚡ Bills &amp; Utilities</option>
            <option value="Medical">💊 Medical &amp; Healthcare</option>
            <option value="Other">✨ Other</option>
          </select>

          <div class="bs-row">
            <div>
              <label>Date *</label>
              <input id="bsDate" type="date">
            </div>
            <div>
              <label>Payment Mode</label>
              <select id="bsMethod">
                <option value="UPI">UPI / GPay / QR</option>
                <option value="Cash">Cash</option>
                <option value="Card">Debit / Credit Card</option>
                <option value="Bank">Bank Transfer</option>
              </select>
            </div>
          </div>

          <div class="bs-row">
            <div>
              <label>Entry Type</label>
              <select id="bsType">
                <option value="expense">Expense (Kharch)</option>
                <option value="income">Income / Refund</option>
              </select>
            </div>
            <div>
              <label>Bill Photo</label>
              <select id="bsAttach">
                <option value="1">Attach photo</option>
                <option value="0">Don't attach</option>
              </select>
            </div>
          </div>

          <div id="bsItemsBox" class="bs-items-box" style="display:none;">
            <div class="bs-items-head">
              <span>🛍️ Scanned Items</span>
              <span id="bsItemCount">0 items</span>
            </div>
            <div id="bsItemsChips" class="bs-items-chips"></div>
          </div>

          <label>Notes / Items Summary</label>
          <textarea id="bsNotes" rows="2" maxlength="400" placeholder="Items breakdown or bill reference"></textarea>

          <div class="bs-pick" style="margin-top:16px;">
            <button class="bs-btn alt" type="button" id="bsRetry">📷 Dobara scan</button>
            <button class="bs-btn" type="button" id="bsSave">💾 Save Entry</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(m);

    // Event listeners
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    $('bsClose').onclick = close;
    $('bsCam').onclick = function () { $('bsFileCam').click(); };
    $('bsGal').onclick = function () { $('bsFileGal').click(); };
    $('bsFileCam').onchange = onFile;
    $('bsFileGal').onchange = onFile;

    // Dobara scan: triggers choosing a new photo from Camera/Gallery
    $('bsRetry').onclick = function () {
      $('bsFileGal').click();
    };

    $('bsSave').onclick = save;
  }

  function status(t, type, spin) {
    var el = $('bsStatus');
    if (!el) return;
    el.className = type === 'ok' ? 'ok' : (type === 'err' ? 'err' : '');
    el.innerHTML = (spin ? '<span class="bs-spin"></span>' : '') + esc(t);
  }

  function open() {
    build();
    S = { img: null, thumb: null, busy: false, saving: false, data: null };
    $('bsForm').style.display = 'none';
    $('bsPrev').style.display = 'none';
    status('Kisi bhi bill ki clear photo lo — total amount dikhna chahiye.');
    $('bsModal').classList.add('on');
  }

  function close() {
    var m = $('bsModal');
    if (m) m.classList.remove('on');
  }

  async function onFile(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f || S.busy) return;
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) {
      return status('Sirf image file (JPG/PNG/WEBP) chunein.', 'err');
    }
    window.__isPickingFile = false;
    try {
      status('Photo taiyaar ho rahi hai…', null, true);
      var im = await fileToImage(f);
      S.img = draw(im, 1600, 0.85);
      S.thumb = draw(im, 480, 0.6);
      $('bsPrev').src = S.img;
      $('bsPrev').style.display = 'block';
      await run();
    } catch (err) {
      status(err.message || 'Photo read nahi ho payi.', 'err');
    }
  }

  async function run() {
    if (S.busy) return;
    S.busy = true;
    $('bsCam').disabled = $('bsGal').disabled = true;
    var raw = null, aiErr = null;

    try {
      var hasKey = false;
      try {
        if (typeof getGeminiKey === 'function') hasKey = (getGeminiKey() || '').length >= 20;
      } catch (e) { }

      // 1. Try Gemini Vision if key exists
      if (hasKey) {
        status('AI bill ko analyze kar raha hai…', null, true);
        try {
          raw = await geminiExtract(S.img);
        } catch (e) {
          aiErr = e;
          console.warn('Gemini bill fail, falling back to OCR:', e);
        }
      }

      // 2. Fallback to Tesseract OCR with Arithmetic Reconciliation
      var initialNorm = raw ? normalize(raw) : null;
      if (!initialNorm || !(initialNorm.amount > 0)) {
        try {
          var o = await ocrExtract(S.img, function (t) { status(t, null, true); });
          if (o && o.amount > 0) {
            raw = Object.assign({}, o, raw || {});
            if (!raw.amount || raw.amount <= 0) raw.amount = o.amount;
            if (!raw.merchant && o.party) raw.merchant = o.party;
            if (!raw.date && o.date) raw.date = o.date;
            if ((!raw.items || raw.items.length === 0) && o.items) raw.items = o.items;
          }
        } catch (e) {
          aiErr = aiErr || e;
        }
      }

      var d = normalize(raw || {});
      S.data = d;
      fill(d);

      if (d.reconciled) {
        status('✓ ' + (d.reconciliationNote || 'Details verified & reconciled!'), 'ok');
      } else if (d.amount > 0 && d.party) {
        status('✓ ' + d.party + ' (₹' + d.amount + ') details mil gayi — check karke Save dabayein.', 'ok');
      } else if (d.missing.amount) {
        status('Amount auto-detect nahi hua — neeche daal dein, baaki details check kar lein.', 'err');
      } else if (d.missing.party) {
        status('Amount mil gaya ✓ (₹' + d.amount + ') — party/shop ka naam daal dein.', 'ok');
      } else {
        status('Details mil gayi ✓ — check karke Save dabayein.', 'ok');
      }
    } catch (e) {
      console.error('Bill scan error', e);
      fill(normalize({}));
      status('Scan me dikkat aayi — details manually bhar dein.', 'err');
    } finally {
      S.busy = false;
      $('bsCam').disabled = $('bsGal').disabled = false;
    }
  }

  function fill(d) {
    // Populate payment methods
    var opts = ['UPI', 'Cash', 'Card', 'Bank'];
    try {
      var sel = $('paymentSel');
      if (sel) {
        Array.prototype.forEach.call(sel.options, function (o) {
          var v = (o.value || '').trim();
          if (v && opts.indexOf(v) < 0) opts.push(v);
        });
      }
    } catch (e) { }
    if (opts.indexOf(d.method) < 0) opts.push(d.method);
    $('bsMethod').innerHTML = opts.map(function (o) {
      return '<option value="' + esc(o) + '"' + (o === d.method ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');

    // Known parties list
    var names = [];
    try {
      if (typeof getOfficialPartyNames === 'function') names = getOfficialPartyNames() || [];
    } catch (e) { }
    $('bsPartyList').innerHTML = names.map(function (n) {
      return '<option value="' + esc(n) + '">';
    }).join('');

    // Populate fields
    $('bsAmt').value = d.amount > 0 ? d.amount : '';
    $('bsParty').value = d.party;
    $('bsDate').value = d.date;
    $('bsType').value = d.type;
    $('bsNotes').value = d.notes;
    $('bsAttach').value = '1';

    // Populate detected items chips
    if ($('bsItemsBox') && $('bsItemsChips')) {
      if (Array.isArray(d.items) && d.items.length > 0) {
        if ($('bsItemCount')) $('bsItemCount').textContent = d.items.length + (d.items.length === 1 ? ' item' : ' items');
        $('bsItemsChips').innerHTML = d.items.map(function (it) {
          return '<span class="bs-item-chip">' + esc(it) + '</span>';
        }).join('');
        $('bsItemsBox').style.display = 'block';
      } else {
        $('bsItemsBox').style.display = 'none';
      }
    }

    // Set category
    if ($('bsCategory')) {
      var catFound = false;
      Array.prototype.forEach.call($('bsCategory').options, function (opt) {
        if (opt.value === d.category || opt.text.indexOf(d.category) > -1) {
          opt.selected = true;
          catFound = true;
        }
      });
      if (!catFound) $('bsCategory').value = 'Other';
    }

    $('bsAmt').className = d.missing.amount ? 'warn' : '';
    $('bsParty').className = d.missing.party ? 'warn' : '';
    $('bsForm').style.display = 'block';
  }

  /* ---------- Safe Save Entry ---------- */
  async function save() {
    if (S.saving) return;
    var amt = parseAmount($('bsAmt').value);
    var party = $('bsParty').value.trim();
    var date = $('bsDate').value || todayStr();

    if (!(amt > 0)) {
      $('bsAmt').className = 'warn';
      $('bsAmt').focus();
      return status('Valid amount daalna zaroori hai.', 'err');
    }
    if (!party) {
      $('bsParty').className = 'warn';
      $('bsParty').focus();
      return status('Party / shop ka naam daalna zaroori hai.', 'err');
    }

    var dupe = false;
    try {
      if (typeof entries !== 'undefined' && Array.isArray(entries)) {
        dupe = entries.some(function (e) {
          return Number(e.amount) === amt && String(e.party).toLowerCase() === party.toLowerCase() && e.date === date;
        });
      }
    } catch (e) { }

    if (dupe && !confirm('Same amount, party aur date ki entry pehle se hai. Fir bhi save karein?')) {
      return;
    }

    S.saving = true;
    $('bsSave').disabled = true;
    $('bsSave').textContent = 'Saving…';

    try {
      var nowIso = new Date().toISOString();
      var entryId = (typeof generateEntryId === 'function') ? generateEntryId() : ('e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9));
      var selectedCat = ($('bsCategory') && $('bsCategory').value) || 'Other';
      var userId = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null;

      var entry = {
        id: entryId,
        party: party,
        category: selectedCat,
        method: $('bsMethod').value || 'Cash',
        amount: Math.round(amt * 100) / 100,
        type: (typeof normalizeType === 'function') ? normalizeType($('bsType').value) : $('bsType').value,
        date: date,
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        notes: $('bsNotes').value.trim(),
        timestamp: nowIso,
        updatedAt: nowIso,
        syncedWithCloud: false,
        image: $('bsAttach').value === '1' ? (S.thumb || null) : null,
        userId: userId
      };

      if (typeof entries !== 'undefined' && Array.isArray(entries)) {
        entries.unshift(entry);
      }

      if (typeof persistAllEntries === 'function') {
        persistAllEntries('billScan');
      } else {
        localStorage.setItem('entries', JSON.stringify(entries));
      }

      // Save to Firebase user collection if available
      try {
        if (typeof saveEntryToFirebase === 'function') {
          saveEntryToFirebase(entry);
        } else if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof db !== 'undefined' && db) {
          db.collection('entries').doc(entry.id).set(entry).catch(function () { });
        }
      } catch (e) { }

      // Sync offline queue
      try {
        if (typeof queueOfflineSync === 'function') queueOfflineSync('set', entry);
      } catch (e) { }

      // Sync goals and UI
      [
        function () { if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries(); },
        function () { if (typeof renderWallet === 'function') renderWallet(); },
        function () { if (typeof renderEntries === 'function') renderEntries(); },
        function () { if (typeof renderAnalytics === 'function') renderAnalytics(); },
        function () { if (typeof renderList === 'function') renderList(); },
        function () { if (typeof showMiniSaveToast === 'function') showMiniSaveToast('synced'); }
      ].forEach(function (fn) { try { fn(); } catch (e) { } });

      toast('Bill entry saved ✓ ₹' + entry.amount.toLocaleString('en-IN') + ' (' + party + ')', 'success');
      close();

      try {
        if (typeof goTo === 'function') goTo('entries');
        if (typeof setEntryFilter === 'function') setEntryFilter('all');
      } catch (e) { }
    } catch (e) {
      console.error('Bill save error', e);
      status('Save fail: ' + (e.message || e) + ' — dobara try karein.', 'err');
    } finally {
      S.saving = false;
      $('bsSave').disabled = false;
      $('bsSave').textContent = '💾 Save Entry';
    }
  }

  // Export globally
  window.openBillScanner = open;
  window.__billScanner = {
    parseAmount: parseAmount,
    parseDate: parseDate,
    normalize: normalize,
    parseBillTextAdvanced: parseBillTextAdvanced
  };
})();

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
      .replace(/[^\w\s&.'\-\u0900-\u097F]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (s.length > 40) s = s.slice(0, 40).trim();
    if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) s = titleCase(s);
    return s;
  }

  function matchKnownParty(name) {
    var list = [];
    try {
      if (typeof getOfficialPartyNames === 'function') list = getOfficialPartyNames() || [];
    } catch (e) { }
    var n = String(name || '').toLowerCase().trim();
    if (!n) return '';
    for (var i = 0; i < list.length; i++) {
      var p = String(list[i]).toLowerCase().trim();
      if (p && p !== 'self' && (p === n || n.indexOf(p) > -1 || p.indexOf(n) > -1)) return list[i];
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
    // Look for explicit date label first (e.g. "Date : 17 Jun 2026")
    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i];
      var dm = line.match(/(?:date|dt|dated)\s*[:\-]?\s*([A-Za-z0-9\s,\-\/\.]{6,25})/i);
      if (dm) {
        var parsed = parseDate(dm[1]);
        if (parsed) { date = parsed; break; }
      }
    }
    // Fallback: search date patterns while strictly skipping invoice numbers / phone numbers
    if (!date) {
      for (var i = 0; i < rawLines.length; i++) {
        var line = rawLines[i];
        if (/bill\s*no|inv|token|table|order|tel|phone|ph|gstin|fssai/i.test(line)) continue;
        var dm = line.match(/\b\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}[\s,.-]+\d{2,4}\b|\b\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/);
        if (dm) {
          var parsed = parseDate(dm[0]);
          if (parsed) { date = parsed; break; }
        }
      }
    }

    // 2. INVOICE / BILL NO
    var invoiceNo = '';
    for (var i = 0; i < rawLines.length; i++) {
      var im = rawLines[i].match(/(?:bill\s*no|inv(?:oice)?\s*no|receipt\s*no)\s*[:\-]?\s*([A-Za-z0-9\-\/]+)/i);
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
    var skipMerchantRe = /invoice|bill|receipt|gst|tax|tel|phone|mob|date|cash memo|www|@|thank|visit|guest|order|table|token|welcome|good food|great memories|memories|tagline|taste/i;
    for (var i = 0; i < Math.min(rawLines.length, 6); i++) {
      var l = rawLines[i];
      if (l.length < 3 || skipMerchantRe.test(l)) continue;
      // Skip addresses and phone numbers
      if (/\b(bengaluru|bangalore|mumbai|delhi|road|street|nagar|floor|pin|pincode|\d{6})\b/i.test(l)) continue;
      if (l.replace(/[^0-9]/g, '').length > 3) continue;
      if (/[A-Za-z]{3,}/.test(l)) {
        merchant = l;
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
      else if (/(?:cgst|sgst|igst|vat|service\s*tax|gst)\b/i.test(l) && !/number|no|tin|cin|reg/i.test(l)) {
        var nums = l.match(/\d+(?:\.\d{1,2})?/g);
        if (nums) {
          var tVal = parseFloat(nums[nums.length - 1]);
          if (tVal > 0 && tVal < 5000) taxes += tVal;
        }
      }
      // Check for grand total line
      else if (/(?:grand\s*total|net\s*(?:amount|payable)|total\s*(?:amount|payable|due)?|amount\s*paid|bill\s*amount|\u0915\u0941\u0932)/i.test(l)) {
        var nums = l.match(/\d+(?:\.\d{1,2})?/g);
        if (nums) {
          nums.forEach(function (n) {
            var val = parseFloat(n);
            if (val > 0) rawTotals.push(val);
          });
        }
      }
      // Check for table item line, e.g. "1. Masala Dosa 1 ₹149.00 ₹149.00"
      var itemMatch = l.match(/^(?:\d+[\.\)]\s*)?([A-Za-z\s&'-]{3,30})\s+\d*\s*(?:₹|Rs\.?)?\s*[\d\.]*\s*(?:₹|Rs\.?)?\s*(\d+(?:\.\d{1,2})?)$/);
      if (itemMatch && !/subtotal|total|cgst|sgst|tax|discount|amount|qty|rate|item/i.test(itemMatch[1])) {
        items.push({ name: itemMatch[1].trim(), amount: parseFloat(itemMatch[2]) });
      }
    });

    taxes = Math.round(taxes * 100) / 100;

    // Calculate arithmetic target: Subtotal + Taxes
    var calculatedTarget = 0;
    if (subtotal > 0) {
      calculatedTarget = Math.round((subtotal + taxes) * 100) / 100;
    } else if (items.length > 0) {
      var itemsSum = items.reduce(function (a, b) { return a + b.amount; }, 0);
      calculatedTarget = Math.round((itemsSum + taxes) * 100) / 100;
    }

    // RECONCILE: Match rawTotals against calculatedTarget or clean OCR rupee symbol
    var finalAmount = 0;
    var reconciled = false;
    var reconciliationNote = '';

    for (var i = 0; i < rawTotals.length; i++) {
      var r = rawTotals[i];
      // Exact match with subtotal + tax
      if (calculatedTarget > 0 && Math.abs(r - calculatedTarget) < 0.05) {
        finalAmount = r;
        reconciled = true;
        reconciliationNote = 'Subtotal (₹' + subtotal + ') + Tax (₹' + taxes + ') = ₹' + finalAmount;
        break;
      }
      // Check if leading '2' is an OCR'd Rupee sign ₹ (e.g. 2707.70 -> 707.70)
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
      if (calculatedTarget > 0) {
        finalAmount = calculatedTarget;
        reconciled = true;
        reconciliationNote = 'Calculated from Subtotal (₹' + subtotal + ') + Taxes (₹' + taxes + ')';
      } else if (rawTotals.length > 0) {
        finalAmount = rawTotals[0];
        // If leading 2 looks like misread rupee sign compared to items
        var strVal = String(finalAmount);
        if (strVal.startsWith('2') && items.length > 0) {
          var itemsMax = Math.max.apply(null, items.map(function (it) { return it.amount; }));
          var stripped = parseFloat(strVal.slice(1));
          if (stripped > itemsMax && finalAmount > itemsMax * 8) {
            finalAmount = stripped;
          }
        }
      }
    }

    // Format Notes with extracted items
    var itemsSummary = items.map(function (it) { return it.name; }).join(', ');
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
      items: items
    };
  }

  // AI ya OCR ka raw object -> safe, validated entry fields
  function normalize(raw) {
    raw = raw || {};
    var amount = parseAmount(raw.amount != null ? raw.amount : raw.total);
    if (amount < 0) amount = Math.abs(amount);
    amount = Math.round(amount * 100) / 100;
    if (amount > 99999999) amount = 0;

    var date = parseDate(raw.date) || todayStr();
    var merchant = cleanMerchant(raw.merchant || raw.party || raw.store || '');
    var party = matchKnownParty(merchant) || merchant || '';
    var method = normMethod(raw.method) || 'Cash';
    var category = raw.category || guessCategory(party, raw.notes || raw.items || '');
    var notes = String(raw.notes || raw.items || '').replace(/\s+/g, ' ').trim();

    return {
      amount: amount,
      party: party,
      date: date,
      method: method,
      category: category,
      type: /refund|credit|income|salary|received/i.test(String(raw.type || '')) ? 'income' : 'expense',
      notes: notes.slice(0, 160),
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
  var PROMPT = 'You are an intelligent bill & invoice scanner for an Indian expense manager app.\n' +
    'The receipt may be a restaurant bill, GST tax invoice, retail receipt, fuel slip, or payment slip.\n' +
    'Extract details and return ONLY a single JSON object:\n' +
    '{"merchant":"Store/Restaurant/Biller Name","amount":0.0,"subtotal":0.0,"taxes":0.0,"date":"YYYY-MM-DD","method":"UPI|Cash|Card|Bank","category":"Food & Dining|Grocery|Shopping|Travel / Fuel|Bills & Utilities|Medical|Other","type":"expense","invoiceNo":"","items":"comma-separated items"}\n' +
    'CRITICAL RULES:\n' +
    '1. amount: Final payable GRAND TOTAL after taxes. VERIFY ARITHMETIC: amount must equal subtotal + taxes (CGST+SGST) minus discounts.\n' +
    '   If currency symbol ₹ or Rs looks like a 2 (e.g. ₹707.70 misread as 2707.70), strip the leading 2 and verify against item totals!\n' +
    '2. merchant: The business name from the top header/logo (e.g. "YOUR RESTAURANT"), NEVER slogans (e.g. "GOOD FOOD"), addresses, or customer name.\n' +
    '3. date: Bill date in YYYY-MM-DD (e.g. "17 Jun 2026" -> 2026-06-17). Never use invoice numbers as dates. Today is ' + todayStr() + '.\n' +
    '4. method: Exact payment mode (UPI, Cash, Card, Bank).\n' +
    '5. items: Comma-separated list of items ordered (e.g. "Masala Dosa, Paneer Roll, Tea, Gulab Jamun").';

  async function geminiExtract(dataUrl) {
    var b64 = dataUrl.split(',')[1] || '';
    if (b64.length < 100) throw new Error('Image data invalid. Dobara photo lein.');
    var base = { contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: b64 } }] }] };
    var last = null, cfgs = [{ temperature: 0, maxOutputTokens: 700, responseMimeType: 'application/json' }, { temperature: 0, maxOutputTokens: 700 }];
    for (var i = 0; i < cfgs.length; i++) {
      try {
        var body = Object.assign({}, base, { generationConfig: cfgs[i] });
        if (typeof _geminiRawFetch !== 'function') throw new Error('Gemini fetch helper not available');
        var out = await _geminiRawFetch(body);
        if (typeof _parseGeminiJson === 'function') {
          var j = _parseGeminiJson(out);
          if (j && typeof j === 'object') return j;
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
    .bs-f input, .bs-f select {
      width: 100%; box-sizing: border-box; padding: 10px 12px;
      border-radius: 12px; border: 1px solid rgba(127, 127, 127, 0.28);
      background: transparent; color: inherit; font-size: 14.5px;
      font-family: inherit; outline: none;
    }
    .bs-f input:focus, .bs-f select:focus {
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

          <label>Notes / Items</label>
          <input id="bsNotes" type="text" maxlength="160" placeholder="Items breakdown or bill reference">

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
      if (!raw || !(parseAmount(raw.amount) > 0)) {
        try {
          var o = await ocrExtract(S.img, function (t) { status(t, null, true); });
          if (o && o.amount > 0) {
            raw = Object.assign({}, raw || {}, o);
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

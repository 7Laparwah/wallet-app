/* ============================================================
   TAGDA BILL SCANNER — DayToDay
   Kisi bhi bill / receipt / invoice (kisi bhi design, Hindi/English)
   ki photo se details nikaal kar expense entry save karta hai.

   Flow : photo -> compress -> Gemini Vision (JSON) -> [fail/no key => OCR fallback]
          -> normalize + validate -> review form -> safe save
   Entry : saveEntry() jaisi hi shape (id, party, method, amount, type, date...)
   ============================================================ */
(function () {
  'use strict';

  var S = { img: null, thumb: null, busy: false, saving: false, data: null };

  /* ---------- tiny helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function todayStr() { try { return getLocalDateStr(); } catch (e) { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); } }
  function toast(msg, type) { try { showNotification(msg, type || 'success'); } catch (e) { console.log(msg); } }

  /* ---------- pure parsing / normalising (unit-testable) ---------- */
  function parseAmount(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v).replace(/[₹]|rs\.?|inr|\/-|[a-z]/gi, ' ').trim();
    var m = s.match(/-?\d[\d,\s]*(?:\.\d+)?/);
    if (!m) return 0;
    var n = parseFloat(m[0].replace(/[,\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

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
    if ((m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) return validYMD(+m[3], +m[2], +m[1]); // India: DD/MM/YYYY
    if ((m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3})[a-z]*[\s,.-]+(\d{2,4})/i)) && MON[m[2].toLowerCase()]) return validYMD(+m[3], MON[m[2].toLowerCase()], +m[1]);
    if ((m = s.match(/([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i)) && MON[m[1].toLowerCase()]) return validYMD(+m[3], MON[m[1].toLowerCase()], +m[2]);
    return null;
  }

  function normMethod(v) {
    var s = String(v || '').toLowerCase();
    if (/upi|gpay|google ?pay|phonepe|paytm|bhim|qr/.test(s)) return 'UPI';
    if (/card|visa|master|rupay|credit|debit|pos/.test(s)) return 'Card';
    if (/bank|neft|imps|rtgs|net ?bank|cheque|transfer/.test(s)) return 'Bank';
    if (/cash|nakad|cod/.test(s)) return 'Cash';
    return '';
  }

  function titleCase(s) { return String(s).toLowerCase().replace(/(^|[\s.&-])([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); }); }
  function cleanMerchant(v) {
    var s = String(v || '').replace(/[\r\n\t]+/g, ' ').replace(/[^\w\s&.'\-\u0900-\u097F]/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (s.length > 40) s = s.slice(0, 40).trim();
    if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) s = titleCase(s);
    return s;
  }

  function matchKnownParty(name) {
    var list = [];
    try { list = getOfficialPartyNames() || []; } catch (e) { }
    var n = String(name || '').toLowerCase();
    if (!n) return '';
    for (var i = 0; i < list.length; i++) { var p = String(list[i]).toLowerCase(); if (p && p !== 'self' && (p === n || n.indexOf(p) > -1 || p.indexOf(n) > -1)) return list[i]; }
    return '';
  }

  // AI ya OCR ka raw object -> safe, validated entry fields
  function normalize(raw) {
    raw = raw || {};
    var amount = parseAmount(raw.amount != null ? raw.amount : raw.total);
    if (amount < 0) amount = Math.abs(amount);
    amount = Math.round(amount * 100) / 100;
    if (amount > 99999999) amount = 0;
    var date = parseDate(raw.date) || todayStr();
    if (date > todayStr()) { var t = new Date(); t.setDate(t.getDate() + 1); var lim = t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); if (date > lim) date = todayStr(); }
    var merchant = cleanMerchant(raw.merchant || raw.party || raw.store);
    var party = matchKnownParty(merchant) || merchant || '';
    var notes = String(raw.notes || raw.items || '').replace(/\s+/g, ' ').trim();
    if (raw.invoiceNo && notes.indexOf(raw.invoiceNo) < 0) notes = (notes ? notes + ' | ' : '') + 'Inv ' + String(raw.invoiceNo).slice(0, 24);
    if (merchant && notes.toLowerCase().indexOf(merchant.toLowerCase()) < 0) notes = merchant + (notes ? ' - ' + notes : '');
    return {
      amount: amount, party: party, date: date, method: normMethod(raw.method) || 'Cash',
      type: /refund|credit|income|salary|received/i.test(String(raw.type || '')) ? 'income' : 'expense',
      notes: notes.slice(0, 160), missing: { amount: !(amount > 0), party: !party }
    };
  }

  // OCR text -> raw fields (kisi bhi layout ke liye heuristics)
  function parseBillText(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var best = 0, fallback = 0, totalRe = /(grand\s*total|net\s*(amount|payable)|total\s*(amount|payable|due)?|amount\s*(paid|payable|due)|balance\s*due|bill\s*amount|payable|to\s*pay|\u0915\u0941\u0932)/i;
    lines.forEach(function (l) {
      var nums = (l.replace(/(\d)[,\s](?=\d{2,3}\b)/g, '$1').match(/\d+(?:\.\d{1,2})?/g) || []).map(parseFloat).filter(function (n) { return n > 0 && n < 1e8; });
      if (!nums.length) return;
      var mx = Math.max.apply(null, nums);
      if (/sub\s*total|tax|gst|cgst|sgst|discount|change|tender|qty|mrp/i.test(l) && !/grand|net|payable/i.test(l)) return;
      if (totalRe.test(l)) best = Math.max(best, mx);
      else if (/\.\d{2}\b/.test(l)) fallback = Math.max(fallback, mx);
    });
    var merchant = '';
    for (var i = 0; i < Math.min(lines.length, 8); i++) {
      if (/[A-Za-z\u0900-\u097F]{3,}/.test(lines[i]) && !/invoice|bill|receipt|gst|tax|tel|phone|mob|date|cash memo|www|@/i.test(lines[i])) { merchant = lines[i]; break; }
    }
    var dm = String(text).match(/\b\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}[\s,.-]+\d{2,4}\b/);
    return { amount: best || fallback, merchant: merchant, date: dm ? dm[0] : '', method: normMethod(text), notes: '' };
  }

  /* ---------- image: load (EXIF safe) + compress ---------- */
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
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }

  /* ---------- extraction: Gemini Vision ---------- */
  var PROMPT = 'You are a bill/receipt/invoice reader for an Indian expense app. The image can be ANY bill design: thermal receipt, GST tax invoice, restaurant bill, fuel slip, medical bill, utility bill, handwritten, UPI/payment screenshot, in English/Hindi/mixed.\n' +
    'Return ONLY one JSON object (no markdown):\n' +
    '{"merchant":"shop/biller/recipient name","amount":0,"date":"YYYY-MM-DD or empty","method":"Cash|UPI|Card|Bank or empty","type":"expense","invoiceNo":"","items":"short item summary max 80 chars","confidence":0.0}\n' +
    'Rules: amount = FINAL payable GRAND TOTAL as a plain number (after tax/discount, never subtotal, never a single item price, no commas/currency). ' +
    'merchant = the seller/recipient who receives the money (header/logo/biller name), not the customer. date = bill date, Indian DD/MM/YYYY order. ' +
    'If a field is unreadable use "" (amount 0). Today is ' + todayStr() + '.';

  async function geminiExtract(dataUrl) {
    var b64 = dataUrl.split(',')[1] || '';
    if (b64.length < 100) throw new Error('Image data invalid. Dobara photo lein.');
    var base = { contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: b64 } }] }] };
    var last = null, cfgs = [{ temperature: 0, maxOutputTokens: 700, responseMimeType: 'application/json' }, { temperature: 0, maxOutputTokens: 700 }];
    for (var i = 0; i < cfgs.length; i++) {
      try {
        var body = Object.assign({}, base, { generationConfig: cfgs[i] });
        var out = await _geminiRawFetch(body);
        var j = _parseGeminiJson(out);
        if (j && typeof j === 'object') return j;
        last = new Error('AI ka jawab samajh nahi aaya.');
      } catch (e) {
        last = e;
        if (/INVALID_KEY|API Key set nahi/i.test(String(e && e.message))) throw e;
      }
    }
    throw last || new Error('AI scan fail.');
  }

  /* ---------- extraction: OCR fallback (offline-ish, no API key) ---------- */
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
    onStatus('Bill padha ja raha hai (OCR)…');
    var r = await T.recognize(dataUrl, 'eng');
    return parseBillText(r && r.data && r.data.text);
  }

  /* ---------- UI ---------- */
  var CSS = '#bsModal{position:fixed;inset:0;z-index:99990;display:none;align-items:flex-end;justify-content:center;background:rgba(10,12,18,.55);backdrop-filter:blur(4px)}' +
    '#bsModal.on{display:flex}#bsSheet{width:100%;max-width:480px;max-height:92vh;overflow:auto;background:#fff;color:#0f172a;border-radius:24px 24px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));font-family:Inter,system-ui,sans-serif;box-shadow:0 -10px 40px rgba(0,0,0,.25)}' +
    'body:not(.light-theme) #bsSheet{background:#161a23;color:#f1f5f9}' +
    '.bs-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.bs-h b{font-size:16px}.bs-x{border:0;background:rgba(127,127,127,.15);color:inherit;width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer}' +
    '.bs-pick{display:grid;grid-template-columns:1fr 1fr;gap:10px}.bs-btn{border:0;border-radius:14px;padding:14px 10px;font-weight:700;font-size:14px;cursor:pointer;background:#10b981;color:#fff}.bs-btn.alt{background:rgba(127,127,127,.15);color:inherit}.bs-btn:disabled{opacity:.5}' +
    '#bsPrev{width:100%;max-height:200px;object-fit:contain;border-radius:14px;background:rgba(127,127,127,.1);margin:12px 0;display:none}' +
    '#bsStatus{font-size:13px;margin:8px 0;min-height:18px;color:#64748b}#bsStatus.err{color:#ef4444}' +
    '.bs-f label{display:block;font-size:11.5px;font-weight:700;margin:10px 0 4px;color:#64748b}.bs-f input,.bs-f select{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:12px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:15px}' +
    '.bs-f input.warn{border-color:#f59e0b;background:rgba(245,158,11,.08)}.bs-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}#bsForm{display:none}' +
    '.bs-spin{display:inline-block;width:12px;height:12px;border:2px solid #10b981;border-right-color:transparent;border-radius:50%;animation:bsr .7s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes bsr{to{transform:rotate(360deg)}}';

  function build() {
    if ($('bsModal')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var m = document.createElement('div'); m.id = 'bsModal';
    m.innerHTML = '<div id="bsSheet" role="dialog" aria-label="Scan Bill"><div class="bs-h"><b>🧾 Scan Bill</b><button class="bs-x" type="button" id="bsClose" aria-label="Close">&times;</button></div>' +
      '<div class="bs-pick"><button class="bs-btn" type="button" id="bsCam">📷 Camera</button><button class="bs-btn alt" type="button" id="bsGal">🖼️ Gallery</button></div>' +
      '<input type="file" id="bsFileCam" accept="image/*" capture="environment" style="display:none"><input type="file" id="bsFileGal" accept="image/*" style="display:none">' +
      '<img id="bsPrev" alt="Bill preview"><div id="bsStatus">Kisi bhi bill ki clear photo lo — total amount dikhna chahiye.</div>' +
      '<div id="bsForm" class="bs-f"><label>Amount (₹)</label><input id="bsAmt" type="number" inputmode="decimal" step="0.01" min="0">' +
      '<label>Party / Shop</label><input id="bsParty" type="text" list="bsPartyList" maxlength="60"><datalist id="bsPartyList"></datalist>' +
      '<div class="bs-row"><div><label>Date</label><input id="bsDate" type="date"></div><div><label>Payment</label><select id="bsMethod"></select></div></div>' +
      '<div class="bs-row"><div><label>Type</label><select id="bsType"><option value="expense">Expense</option><option value="income">Income / Refund</option></select></div><div><label>Bill photo</label><select id="bsAttach"><option value="1">Attach</option><option value="0">Don\'t attach</option></select></div></div>' +
      '<label>Notes</label><input id="bsNotes" type="text" maxlength="160">' +
      '<div class="bs-pick" style="margin-top:14px"><button class="bs-btn alt" type="button" id="bsRetry">Dobara scan</button><button class="bs-btn" type="button" id="bsSave">Save Entry</button></div></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    $('bsClose').onclick = close;
    $('bsCam').onclick = function () { $('bsFileCam').click(); };
    $('bsGal').onclick = function () { $('bsFileGal').click(); };
    $('bsFileCam').onchange = onFile; $('bsFileGal').onchange = onFile;
    $('bsRetry').onclick = function () { if (S.img) run(); };
    $('bsSave').onclick = save;
  }

  function status(t, err, spin) { var el = $('bsStatus'); if (!el) return; el.className = err ? 'err' : ''; el.innerHTML = (spin ? '<span class="bs-spin"></span>' : '') + esc(t); }

  function open() {
    build(); S = { img: null, thumb: null, busy: false, saving: false, data: null };
    $('bsForm').style.display = 'none'; $('bsPrev').style.display = 'none';
    status('Kisi bhi bill ki clear photo lo — total amount dikhna chahiye.');
    $('bsModal').classList.add('on');
  }
  function close() { var m = $('bsModal'); if (m) m.classList.remove('on'); }

  async function onFile(e) {
    var f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f || S.busy) return;
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) return status('Sirf image file (JPG/PNG/WEBP) chunein.', true);
    window.__isPickingFile = false;
    try {
      status('Photo taiyaar ho rahi hai…', false, true);
      var im = await fileToImage(f);
      S.img = draw(im, 1600, 0.85); S.thumb = draw(im, 480, 0.6);
      $('bsPrev').src = S.img; $('bsPrev').style.display = 'block';
      await run();
    } catch (err) { status(err.message || 'Photo read nahi ho payi.', true); }
  }

  async function run() {
    if (S.busy) return; S.busy = true; $('bsCam').disabled = $('bsGal').disabled = true;
    var raw = null, aiErr = null;
    try {
      var hasKey = false; try { hasKey = (getGeminiKey() || '').length >= 20; } catch (e) { }
      if (hasKey) {
        status('AI bill padh raha hai…', false, true);
        try { raw = await geminiExtract(S.img); } catch (e) { aiErr = e; console.warn('Gemini bill fail', e); }
      }
      if (!raw || !(parseAmount(raw.amount) > 0)) {
        try { var o = await ocrExtract(S.img, function (t) { status(t, false, true); }); if (o && o.amount > 0) raw = Object.assign({}, raw || {}, o, { merchant: (raw && raw.merchant) || o.merchant }); }
        catch (e) { aiErr = aiErr || e; }
      }
      var d = normalize(raw || {});
      S.data = d; fill(d);
      if (d.missing.amount) status('Amount auto-detect nahi hua — neeche daal dein, baaki details check kar lein.', true);
      else if (d.missing.party) status('Amount mil gaya ✓ — party/shop ka naam daal dein.');
      else status('Details mil gayi ✓ — check karke Save dabayein.');
      if (aiErr && /INVALID_KEY/.test(String(aiErr.message)) && d.missing.amount) status('Gemini key invalid hai (AI Settings) — amount manually daal dein.', true);
    } catch (e) {
      console.error('Bill scan error', e); fill(normalize({})); status('Scan me dikkat aayi — details manually bhar dein.', true);
    } finally { S.busy = false; $('bsCam').disabled = $('bsGal').disabled = false; }
  }

  function fill(d) {
    var opts = ['Cash', 'UPI', 'Card', 'Bank'];
    try { var sel = $('paymentSel'); if (sel) Array.prototype.forEach.call(sel.options, function (o) { var v = (o.value || '').trim(); if (v && opts.indexOf(v) < 0) opts.push(v); }); } catch (e) { }
    if (opts.indexOf(d.method) < 0) opts.push(d.method);
    $('bsMethod').innerHTML = opts.map(function (o) { return '<option' + (o === d.method ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
    var names = []; try { names = getOfficialPartyNames() || []; } catch (e) { }
    $('bsPartyList').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
    $('bsAmt').value = d.amount > 0 ? d.amount : ''; $('bsParty').value = d.party; $('bsDate').value = d.date;
    $('bsType').value = d.type; $('bsNotes').value = d.notes; $('bsAttach').value = '1';
    $('bsAmt').className = d.missing.amount ? 'warn' : ''; $('bsParty').className = d.missing.party ? 'warn' : '';
    $('bsForm').style.display = 'block';
  }

  /* ---------- save (mirrors saveEntry, no-error guarded) ---------- */
  async function save() {
    if (S.saving) return;
    var amt = parseAmount($('bsAmt').value), party = $('bsParty').value.trim(), date = $('bsDate').value || todayStr();
    if (!(amt > 0)) { $('bsAmt').className = 'warn'; return status('Amount daalna zaroori hai.', true); }
    if (!party) { $('bsParty').className = 'warn'; $('bsParty').focus(); return status('Party / shop ka naam daalna zaroori hai.', true); }
    var dupe = false;
    try { dupe = (entries || []).some(function (e) { return Number(e.amount) === amt && String(e.party).toLowerCase() === party.toLowerCase() && e.date === date; }); } catch (e) { }
    if (dupe && !confirm('Same amount, party aur date ki entry pehle se hai. Fir bhi save karein?')) return;
    S.saving = true; $('bsSave').disabled = true; $('bsSave').textContent = 'Saving…';
    try {
      var nowIso = new Date().toISOString();
      var entry = {
        id: generateEntryId(), party: party, method: $('bsMethod').value || 'Cash', amount: Math.round(amt * 100) / 100,
        type: normalizeType($('bsType').value), date: date,
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        notes: $('bsNotes').value.trim(), timestamp: nowIso, updatedAt: nowIso, syncedWithCloud: false,
        image: $('bsAttach').value === '1' ? (S.thumb || null) : null,
        userId: (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null
      };
      entries.unshift(entry);
      persistAllEntries('billScan');
      [function () { syncGoalsWithEntries(); }, function () { renderWallet(); }, function () { renderEntries(); }, function () { renderAnalytics(); },
        function () { renderList(); }, function () { showMiniSaveToast('synced'); }].forEach(function (fn) { try { fn(); } catch (e) { } });
      try { queueOfflineSync('set', entry); } catch (e) { }
      try { if (firebaseReady && db) db.collection('entries').doc(entry.id).set(entry).catch(function (err) { console.warn('Firebase save failed (kept locally):', err); }); } catch (e) { }
      toast('Bill entry saved ✓ ₹' + entry.amount.toLocaleString('en-IN'), 'success');
      close(); try { goTo('entries'); setEntryFilter('all'); } catch (e) { }
    } catch (e) {
      console.error('Bill save error', e); status('Save fail: ' + (e.message || e) + ' — dobara try karein.', true);
    } finally { S.saving = false; $('bsSave').disabled = false; $('bsSave').textContent = 'Save Entry'; }
  }

  window.openBillScanner = open;
  window.__billScanner = { parseAmount: parseAmount, parseDate: parseDate, normalize: normalize, parseBillText: parseBillText };
})();

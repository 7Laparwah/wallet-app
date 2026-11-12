// App Logger configuration
(function() {
  if (window.APP_CONFIG && window.APP_CONFIG.debug === false) {
    console.log = function() {};
    console.info = function() {};
  }
})();



function pinShakeDots(){
 const dots = document.getElementById('pinDots');
 if(!dots) return;
 dots.classList.remove('pin-shake');
 void dots.offsetWidth;
 dots.classList.add('pin-shake');
 if(navigator.vibrate) navigator.vibrate([80, 50, 80]);
}

/* ===== Inline script block 2 (originally at char offset 3077136) ===== */
// ===== ENTRY IDENTIFIERS & TOMBSTONE TRACKING (OFFLINE-FIRST ENGINE) =====
function generateEntryId() {
  return 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function getDeletedEntryIds() {
  try {
    return JSON.parse(localStorage.getItem('deletedEntryIds') || '{}');
  } catch(e) {
    return {};
  }
}

function getDeletedEntryIdsSet() {
  const idsObj = getDeletedEntryIds();
  return new Set(Object.keys(idsObj));
}

function trackDeletedEntryId(id) {
  if (!id) return;
  try {
    const ids = getDeletedEntryIds();
    const now = Date.now();
    ids[String(id)] = now;
    // Keep tombstones up to 60 days to prevent resurrection
    const cutoff = now - (60 * 24 * 60 * 60 * 1000);
    const cleaned = {};
    for (const [k, v] of Object.entries(ids)) {
      if (typeof v === 'number' && v >= cutoff) {
        cleaned[k] = v;
      }
    }
    cleaned[String(id)] = now;
    localStorage.setItem('deletedEntryIds', JSON.stringify(cleaned));
  } catch(e) {}
}

function untrackDeletedEntryId(id) {
  if (!id) return;
  try {
    const ids = getDeletedEntryIds();
    delete ids[String(id)];
    localStorage.setItem('deletedEntryIds', JSON.stringify(ids));
  } catch(e) {}
}

// ===== PAY NOW & UPI / QR SYSTEM =====
let pendingUpiPayment = null;
let qrCameraStream = null;
let qrScanAnimFrame = null;
let qrCurrentFacingMode = 'environment';
let jsQrLoaded = false;
let jsQrLoading = false;

// 1. UPI ID Validation
function isValidUpiId(id) {
 if (!id || typeof id !== 'string') return false;
 return /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z0-9.\-_]{2,}$/.test(id.trim());
}

// 2. UPI Params Builder (Clean NPCI spec without tr/tid to prevent security declines)
function buildUpiParams(upiId, payeeName, amount, note){
 const cleanId = (upiId || '').trim();
 const cleanName = (payeeName || '').trim().replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 50) || 'Payee';
 const cleanNote = (note || 'Payment').trim().replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 50) || 'Payment';
 const cleanAm = (amount && Number(amount) > 0) ? Number(amount).toFixed(2) : '';
 
 let p = `pa=${encodeURIComponent(cleanId)}&pn=${encodeURIComponent(cleanName)}&cu=INR`;
 if (cleanAm) {
  p += `&am=${cleanAm}`;
 }
 if (cleanNote) {
  p += `&tn=${encodeURIComponent(cleanNote)}`;
 }
 // IMPORTANT: DO NOT include &tr= or &tid= for P2P payments!
 // Passing tr/tid to personal VPAs causes GPay, PhonePe, Paytm, and BHIM to decline with "Security / Merchant Reference" errors.
 return p;
}

// 3. Open / Close Pay Now Modal
function openPayNowModal(){
 document.getElementById('payNowUpiId').value = '';
 document.getElementById('payNowName').value = '';
 document.getElementById('payNowAmount').value = '';
 document.getElementById('payNowNote').value = '';
 document.getElementById('payNowError').style.display = 'none';
 document.getElementById('payQrStatus').style.display = 'none';
 document.getElementById('payNowModal').classList.add('active');
 preloadJsQr();
}
function closePayNowModal(){
 document.getElementById('payNowModal').classList.remove('active');
}

// 4. Preload jsQR library in background
function preloadJsQr(cb, onFail){
 if (jsQrLoaded && window.jsQR) { if (cb) cb(); return; }
 if (jsQrLoading) {
  const check = setInterval(() => {
   if (jsQrLoaded && window.jsQR) { clearInterval(check); if (cb) cb(); }
  }, 150);
  setTimeout(() => clearInterval(check), 6000);
  return;
 }
 jsQrLoading = true;
 const s = document.createElement('script');
 s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsqr/1.4.0/jsQR.js';
 s.onload = () => { jsQrLoaded = true; jsQrLoading = false; if (cb) cb(); };
 s.onerror = () => {
  jsQrLoading = false;
  if (onFail) onFail();
 };
 document.head.appendChild(s);
}

// 5. Parse UPI QR string (handles upi://pay, merchant QRs, BharatPe, Paytm, PhonePe, and plain UPI IDs)
function parseUpiQrString(raw){
 if (!raw || typeof raw !== 'string') return null;
 raw = raw.trim();
 
 // Direct UPI format: upi://pay?... or containing pa=
 if (/^upi:\/\/pay/i.test(raw) || raw.toLowerCase().indexOf('pa=') !== -1) {
  let queryString = raw;
  const qIdx = raw.indexOf('?');
  if (qIdx !== -1) queryString = raw.substring(qIdx + 1);
  
  let pa = '', pn = '', am = '', tn = '';
  const pairs = queryString.split(/[&;]/);
  for (let i = 0; i < pairs.length; i++) {
   const pair = pairs[i];
   if (!pair) continue;
   const eqIdx = pair.indexOf('=');
   if (eqIdx !== -1) {
    const key = pair.substring(0, eqIdx).toLowerCase().trim();
    const rawVal = pair.substring(eqIdx + 1).trim();
    try {
     const val = decodeURIComponent(rawVal.replace(/\+/g, ' '));
     if (key === 'pa') pa = val;
     else if (key === 'pn') pn = val;
     else if (key === 'am') am = val;
     else if (key === 'tn') tn = val;
    } catch(e) {
     if (key === 'pa') pa = rawVal;
    }
   }
  }
  if (pa) {
   return { upiId: pa, payeeName: pn, amount: am, note: tn };
  }
 }
 
 // Try generic URL with query params
 try {
  const url = new URL(raw);
  const pa = url.searchParams ? url.searchParams.get('pa') : null;
  if (pa) {
   return {
    upiId: pa,
    payeeName: (url.searchParams && url.searchParams.get('pn')) || '',
    amount: (url.searchParams && url.searchParams.get('am')) || '',
    note: (url.searchParams && url.searchParams.get('tn')) || ''
   };
  }
 } catch(e) {}
 
 // Plain UPI ID
 if (isValidUpiId(raw)) {
  return { upiId: raw, payeeName: '', amount: '', note: '' };
 }
 
 return null;
}

// 6. Handle Scanned QR Data
function handleQrResult(rawQrData){
 const parsed = parseUpiQrString(rawQrData);
 if (parsed && parsed.upiId) {
  document.getElementById('payNowUpiId').value = parsed.upiId;
  if (parsed.payeeName) document.getElementById('payNowName').value = parsed.payeeName;
  if (parsed.amount && !isNaN(parsed.amount) && Number(parsed.amount) > 0) {
   document.getElementById('payNowAmount').value = Number(parsed.amount);
  }
  if (parsed.note) document.getElementById('payNowNote').value = parsed.note;
  
  const st = document.getElementById('payQrStatus');
  if (st) {
   st.textContent = `QR Scanned: ${parsed.payeeName || parsed.upiId} ✓`;
   st.style.color = '#3ddc84';
   st.style.display = 'block';
  }
  
  if (navigator.vibrate) navigator.vibrate(100);
  closeQrScannerModal();
  if (typeof showNotification === 'function') showNotification('UPI QR read successfully ✓', 'success');
  return true;
 }
 return false;
}

// 7. Live Camera Scanner Modal Management
async function openQrScannerModal(){
 const modal = document.getElementById('qrScannerModal');
 if (modal) modal.classList.add('active');
 const st = document.getElementById('qrCameraStatus');
 if (st) st.textContent = 'Starting camera...';
 
 preloadJsQr();
 await startQrCamera(qrCurrentFacingMode);
}

function closeQrScannerModal(){
 stopQrCamera();
 const modal = document.getElementById('qrScannerModal');
 if (modal) modal.classList.remove('active');
}

async function startQrCamera(facingMode){
 stopQrCamera();
 const video = document.getElementById('qrVideoFeed');
 const st = document.getElementById('qrCameraStatus');
 if (!video) return;
 
 try {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
   throw new Error('Camera not supported');
  }
  // Unified permission popup (same style as notifications / save)
  if (!window.__camPermissionOk) {
   const allowed = await requestAppPermission('camera');
   if (!allowed) {
    if (st) st.textContent = 'Camera permission denied — use Upload Image';
    return;
   }
   window.__camPermissionOk = true;
  }
  
  const stream = await navigator.mediaDevices.getUserMedia({
   video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }
  });
  
  qrCameraStream = stream;
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play();
  
  if (st) st.textContent = 'Align QR code inside the frame';
  startQrFrameLoop();
 } catch(err) {
  console.warn('Camera stream failed:', err);
  if (st) st.textContent = 'Camera access denied — use "Upload Image"';
 }
}

function stopQrCamera(){
 if (qrScanAnimFrame) {
  cancelAnimationFrame(qrScanAnimFrame);
  qrScanAnimFrame = null;
 }
 if (qrCameraStream) {
  qrCameraStream.getTracks().forEach(t => t.stop());
  qrCameraStream = null;
 }
 const video = document.getElementById('qrVideoFeed');
 if (video) video.srcObject = null;
}

async function switchQrCamera(){
 qrCurrentFacingMode = (qrCurrentFacingMode === 'environment') ? 'user' : 'environment';
 await startQrCamera(qrCurrentFacingMode);
}

// 8. Scanning Loop (Native BarcodeDetector -> jsQR Canvas fallback)
let qrDetectorInstance = null;
if ('BarcodeDetector' in window) {
 try {
  qrDetectorInstance = new BarcodeDetector({ formats: ['qr_code'] });
 } catch(e) { qrDetectorInstance = null; }
}

function startQrFrameLoop(){
 const video = document.getElementById('qrVideoFeed');
 const canvas = document.getElementById('qrScanCanvas');
 const ctx = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;
 
 async function scanFrame(){
  if (!qrCameraStream || !video || video.readyState < 2) {
   qrScanAnimFrame = requestAnimationFrame(scanFrame);
   return;
  }
  
  let found = false;
  
  // Method A: Native BarcodeDetector (instant & offline)
  if (qrDetectorInstance) {
   try {
    const barcodes = await qrDetectorInstance.detect(video);
    if (barcodes && barcodes.length > 0) {
     const raw = barcodes[0].rawValue;
     if (handleQrResult(raw)) {
      return; // done
     }
    }
   } catch(e) {}
  }
  
  // Method B: jsQR via Canvas frame
  if (!found && window.jsQR && canvas && ctx) {
   const w = 360;
   const h = Math.round(w * (video.videoHeight / (video.videoWidth || 1))) || 360;
   if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
   }
   ctx.drawImage(video, 0, 0, w, h);
   const imgData = ctx.getImageData(0, 0, w, h);
   const code = window.jsQR(imgData.data, w, h, { inversionAttempts: 'attemptBoth' });
   if (code && code.data) {
    if (handleQrResult(code.data)) {
     return; // done
    }
   }
  }
  
  qrScanAnimFrame = requestAnimationFrame(scanFrame);
 }
 
 qrScanAnimFrame = requestAnimationFrame(scanFrame);
}

// 9. Handle Uploaded / Gallery QR Image File
function handleQrFileScan(evt){
 const file = evt.target.files && evt.target.files[0];
 if (!file) return;
 const st = document.getElementById('payQrStatus');
 if (st) {
  st.style.display = 'block';
  st.style.color = '#5b8cff';
  st.textContent = 'Image scan ho rahi hai...';
 }
 
 const reader = new FileReader();
 reader.onload = function(e) {
  const img = new Image();
  img.onload = async function() {
   let detected = false;
   
   // Try Native BarcodeDetector first
   if (qrDetectorInstance) {
    try {
     const barcodes = await qrDetectorInstance.detect(img);
     if (barcodes && barcodes.length > 0) {
      if (handleQrResult(barcodes[0].rawValue)) {
       detected = true;
      }
     }
    } catch(err) {}
   }
   
   if (!detected) {
    preloadJsQr(() => {
     const maxDims = [1000, 600, img.width];
     for (let maxDim of maxDims) {
      if (detected) break;
      let width = img.width;
      let height = img.height;
      if (width > maxDim || height > maxDim) {
       const scale = maxDim / Math.max(width, height);
       width = Math.round(width * scale);
       height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);
      const imgData = ctx.getImageData(0, 0, width, height);
      const code = window.jsQR(imgData.data, width, height, { inversionAttempts: 'attemptBoth' });
      if (code && code.data && handleQrResult(code.data)) {
       detected = true;
       break;
      }
     }
     if (!detected && st) {
      st.style.color = '#f06464';
      st.textContent = 'QR code not detected. Please upload a clear image or enter UPI ID manually.';
     }
    }, () => {
     if (st) {
      st.style.color = '#f06464';
      st.textContent = 'QR reader failed to load. Please enter UPI ID manually.';
     }
    });
   }
  };
  img.src = e.target.result;
 };
 reader.readAsDataURL(file);
 evt.target.value = ''; // Reset file input
}

// 10. Trigger UPI Payment Flow
function triggerUpiPayment(){
 const upiId = document.getElementById('payNowUpiId').value.trim();
 const payeeName = document.getElementById('payNowName').value.trim() || 'Payee';
 const amount = parseFloat(document.getElementById('payNowAmount').value);
 const note = document.getElementById('payNowNote').value.trim() || 'DayToDay';
 const errEl = document.getElementById('payNowError');

 if (!isValidUpiId(upiId)) {
  errEl.textContent = 'Valid UPI ID daaliye (jaise name@oksbi ya 9876543210@paytm)';
  errEl.style.display = 'block';
  return;
 }
 if (!amount || amount <= 0 || isNaN(amount)) {
  errEl.textContent = 'Valid amount daaliye';
  errEl.style.display = 'block';
  return;
 }
 errEl.style.display = 'none';

 pendingUpiPayment = {
  id: generateEntryId(),
  party: payeeName,
  method: 'UPI',
  amount: amount,
  type: 'expense',
  date: (typeof getLocalDateStr === 'function') ? getLocalDateStr() : new Date().toISOString().slice(0,10),
  time: new Date().toLocaleTimeString("en-IN", {hour:'2-digit', minute:'2-digit'}),
  notes: note,
  timestamp: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  syncedWithCloud: false,
  image: null,
  userId: (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null,
  upiId: upiId
 };

 closePayNowModal();
 openUpiAppChooser(upiId, payeeName, amount, note);
}

// 11. UPI App Chooser
function openUpiAppChooser(upiId, payeeName, amount, note){
 const params = buildUpiParams(upiId, payeeName, amount, note);
 document.getElementById('upiChooserSummary').textContent =
  `₹${amount.toLocaleString('en-IN')} to ${payeeName} (${upiId})`;
 document.getElementById('upiChooserModal').dataset.params = params;
 document.getElementById('upiChooserModal').classList.add('active');
}
function closeUpiAppChooser(){
 document.getElementById('upiChooserModal').classList.remove('active');
}

// 12. Launch UPI App (Optimized for Android Intents + iOS + Universal upi://)
function launchUpiApp(scheme){
 const params = document.getElementById('upiChooserModal').dataset.params;
 closeUpiAppChooser();
 
 const isAndroid = /Android/i.test(navigator.userAgent);
 
 if (isAndroid) {
  if (scheme === 'gpay') {
   window.location.href = `intent://pay?${params}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end`;
   return;
  }
  if (scheme === 'phonepe') {
   window.location.href = `intent://pay?${params}#Intent;scheme=upi;package=com.phonepe.app;end`;
   return;
  }
  if (scheme === 'paytm') {
   window.location.href = `intent://pay?${params}#Intent;scheme=upi;package=net.one97.paytm;end`;
   return;
  }
 } else {
  if (scheme === 'phonepe') {
   window.location.href = 'phonepe://pay?' + params;
   return;
  }
  if (scheme === 'paytm') {
   window.location.href = 'paytmmp://pay?' + params;
   return;
  }
 }
 
 // Generic standard fallback for all apps
 window.location.href = 'upi://pay?' + params;
}

// ----- Manual copy-paste fallback -----
async function copyUpiDetails(){
 if (!pendingUpiPayment) return;
 const p = pendingUpiPayment;
 const text = `UPI ID: ${p.upiId}\nAmount: ₹${p.amount}\nNote: ${p.notes}`;
 try {
  await navigator.clipboard.writeText(text);
  if (typeof showNotification === 'function') showNotification('Copied ✓ Apne UPI app me paste karo', 'success');
 } catch(e) {
  showNotification('Copy failed', 'warning', 'Please copy manually: ' + text);
 }
 closeUpiAppChooser();
 document.getElementById('payConfirmSummary').textContent =
  `₹${p.amount.toLocaleString('en-IN')} to ${p.party} (${p.upiId}) — apne UPI app me pay karke wapas aao`;
 document.getElementById('payConfirmModal').classList.add('active');
}

// App background hone ke baad wapas foreground me aane par (UPI app se
// return), agar koi pending (abhi-tak-unsaved) payment tha to confirm-prompt
// dikhao.
document.addEventListener('visibilitychange', () => {
 if (document.visibilityState === 'visible' && pendingUpiPayment) {
  document.getElementById('payConfirmSummary').textContent =
   `₹${pendingUpiPayment.amount.toLocaleString('en-IN')} to ${pendingUpiPayment.party} (${pendingUpiPayment.upiId})`;
  document.getElementById('payConfirmModal').classList.add('active');
 }
});

function resolvePendingPayment(success){
 if (!pendingUpiPayment) {
  document.getElementById('payConfirmModal').classList.remove('active');
  return;
 }
 if (success) {
  const entryData = {
   ...pendingUpiPayment,
   updatedAt: pendingUpiPayment.updatedAt || new Date().toISOString(),
   syncedWithCloud: false
  };
  entries.unshift(entryData);
  persistAllEntries('createEntryFromAi');
  if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
  if (typeof queueOfflineSync === 'function') queueOfflineSync('set', entryData);
  if (typeof saveEntryToFirebase === 'function') saveEntryToFirebase(entryData);
  if (typeof renderWallet === 'function') renderWallet();
  if (typeof renderEntries === 'function') renderEntries();
  if (typeof renderAnalytics === 'function') renderAnalytics();
  if (typeof showMiniSaveToast === 'function') showMiniSaveToast('synced');
 } else {
  // Fail/Cancelled — kuch save nahi hota, data discard.
  if (typeof showNotification === 'function') showNotification('Payment cancelled — entry save nahi hui', 'error');
 }
 pendingUpiPayment = null;
 document.getElementById('payConfirmModal').classList.remove('active');
}

/* ===== FIREBASE CONFIGURATION (SECURE PRIVACY PATTERN) =====
 * Private keys are loaded securely from:
 * 1. config.js (window.APP_CONFIG.firebaseConfig or window.firebaseConfig)
 * 2. Profile > Firebase Cloud Settings (stored in local browser storage)
 * 3. Default fallback config for seamless offline/local development
 */
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBneDVwogH0WiEmAAvLHu_Tq862DmDOwmI",
  authDomain: "daytoday-e6646.firebaseapp.com",
  databaseURL: "https://daytoday-e6646-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "daytoday-e6646",
  storageBucket: "daytoday-e6646.firebasestorage.app",
  messagingSenderId: "125507121584",
  appId: "1:125507121584:web:87dec9292e70d7a919e675",
  measurementId: "G-SK7GX8RVEH"
};

function getActiveFirebaseConfig() {
  // 1. window.APP_CONFIG (from private config.js)
  if (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.firebaseConfig && typeof window.APP_CONFIG.firebaseConfig.apiKey === 'string' && !window.APP_CONFIG.firebaseConfig.apiKey.includes('PASTE_YOUR') && window.APP_CONFIG.firebaseConfig.apiKey.trim()) {
    return window.APP_CONFIG.firebaseConfig;
  }

  // 2. Direct window.firebaseConfig (if pasted directly from Firebase console)
  if (typeof window !== 'undefined' && window.firebaseConfig && typeof window.firebaseConfig.apiKey === 'string' && !window.firebaseConfig.apiKey.includes('PASTE_YOUR') && window.firebaseConfig.apiKey.trim()) {
    return window.firebaseConfig;
  }

  // 3. In-app custom configured Firebase (saved privately in localStorage)
  try {
    const saved = localStorage.getItem('app_firebase_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.apiKey === 'string' && parsed.apiKey.trim() && !parsed.apiKey.includes('PASTE_YOUR')) {
        return parsed;
      }
    }
  } catch(e){}

  // 4. Default fallback config
  return DEFAULT_FIREBASE_CONFIG;
}

var firebaseConfig = getActiveFirebaseConfig();

let firebaseReady = false;

// ── Activity tracking for Bell icon & Manage Accounts panel ──
let firebaseEventLog = [];   // {time, message, type}
let entrySyncLog = [];       // {time, message, type, entryLabel}

function logFirebaseEvent(message, type = 'info') {
 firebaseEventLog.unshift({ time: new Date(), message, type });
 if (firebaseEventLog.length > 30) firebaseEventLog.pop();
 if (typeof updateFirebaseStatus === 'function') updateFirebaseStatus(firebaseReady);
}

function logEntrySync(message, type = 'info', entryLabel = '') {
 entrySyncLog.unshift({ time: new Date(), message, type, entryLabel });
 if (entrySyncLog.length > 30) entrySyncLog.pop();
}

function formatLogTime(d) {
 return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderEventLogList() {
 const liveStatus = document.getElementById('eventLogLiveStatus');
 if (liveStatus) {
  const isConnected = !!(window.firebase && firebaseReady);
  const realAuthUser = (window.firebase && firebase.auth) ? firebase.auth().currentUser : null;
  const statusColor = isConnected && realAuthUser ? '#3ddc84' : (isConnected ? '#f6b042' : '#f06464');
  const statusText = isConnected && realAuthUser ? 'Connected'
   : isConnected ? 'Connected (session not verified)'
   : 'Not connected';
  liveStatus.innerHTML = `
   <div style="display:flex;align-items:center;gap:8px;">
    <span style="width:9px;height:9px;border-radius:50%;background:${statusColor};display:inline-block;"></span>
    <span style="color:#e8eaf0;font-weight:600;font-size:13.5px;">Firebase: ${statusText}</span>
   </div>
   ${realAuthUser ? `<div style="color:#8b9099;font-size:12px;margin-top:4px;">Signed in as ${realAuthUser.email}</div>` : ''}
  `;
 }

 const list = document.getElementById('eventLogList');
 if (!list) return;
 if (firebaseEventLog.length === 0) {
  list.innerHTML = '<div style="color:#8b9099;font-size:13px;text-align:center;padding:30px 0;">No activity yet</div>';
  return;
 }
 list.innerHTML = firebaseEventLog.map(item => {
  const color = item.type === 'error' ? '#f06464' : (item.type === 'warning' ? '#f6b042' : '#3ddc84');
  const icon  = item.type === 'error' ? 'ti-alert-circle' : (item.type === 'warning' ? 'ti-alert-triangle' : 'ti-circle-check');
  return `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #1c212b;">
   <i class="ti ${icon}" style="color:${color};font-size:18px;margin-top:2px;"></i>
   <div>
    <div style="color:#e8eaf0;font-size:13.5px;">${item.message}</div>
    <div style="color:#6b7280;font-size:11px;margin-top:2px;">${formatLogTime(item.time)}</div>
   </div>
  </div>`;
 }).join('');
}

function toggleEventLogPanel() {
 const overlay = document.getElementById('eventLogOverlay');
 const panel = document.getElementById('eventLogPanel');
 const isOpen = panel.style.display === 'block';
 overlay.style.display = isOpen ? 'none' : 'block';
 panel.style.display = isOpen ? 'none' : 'block';
 if (!isOpen) {
  renderEventLogList();
  const dot = document.getElementById('bellUnreadDot');
  if (dot) dot.style.display = 'none';
 }
}

function renderSyncStatusList() {
 const list = document.getElementById('syncStatusList');
 const summary = document.getElementById('syncStatusSummary');
 const accountInfo = document.getElementById('syncAccountInfo');
 if (!list || !summary) return;

 if (accountInfo) {
  const projectId = (typeof firebaseConfig !== 'undefined' && firebaseConfig.projectId) || 'Unknown';
  const realAuthUser = (window.firebase && firebase.auth) ? firebase.auth().currentUser : null;
  const isConnected = !!(window.firebase && firebaseReady);
  const userEmail = (realAuthUser && realAuthUser.email) || (currentUser && currentUser.email) || 'Not signed in';
  const hasUser = !!(realAuthUser || currentUser);
  const statusColor = isConnected && hasUser ? '#3ddc84' : (!isConnected ? '#f06464' : '#f6b042');
  const statusText = isConnected && hasUser ? 'Active' : (!isConnected ? 'Disconnected' : 'Connecting...');

  accountInfo.innerHTML = `
   <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
    <span style="color:#8b9099;font-size:12.5px;">Firebase Project</span>
    <span style="color:#e8eaf0;font-size:12.5px;font-weight:600;">${projectId}</span>
   </div>
   <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
    <span style="color:#8b9099;font-size:12.5px;">Signed in as</span>
    <span style="color:#e8eaf0;font-size:12.5px;font-weight:600;">${userEmail}</span>
   </div>
   <div style="display:flex;justify-content:space-between;">
    <span style="color:#8b9099;font-size:12.5px;">Session Status</span>
    <span style="color:${statusColor};font-size:12.5px;font-weight:600;">${statusText}</span>
   </div>
   <button type="button" onclick="openFirebaseSetupModal()" style="width:100%;margin-top:12px;background:${isConnected ? 'rgba(59,130,246,0.15)' : '#3b82f6'};color:${isConnected ? '#60a5fa' : '#ffffff'};border:${isConnected ? '1px solid rgba(59,130,246,0.35)' : 'none'};padding:8px 12px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
     <i class="ti ${isConnected ? 'ti-settings' : 'ti-plug'}"></i> ${isConnected ? 'Manage Firebase Settings' : 'Setup / Connect Firebase'}
   </button>
  `;
 }

 const successCount = entrySyncLog.filter(i => i.type === 'success').length;
 const errorCount   = entrySyncLog.filter(i => i.type === 'error').length;
 const warningCount = entrySyncLog.filter(i => i.type === 'warning').length;

 summary.innerHTML = `
  <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
   <span>✅ Synced</span><span style="color:#3ddc84;font-weight:600;">${successCount}</span>
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
   <span>⚠️ Local only</span><span style="color:#f6b042;font-weight:600;">${warningCount}</span>
  </div>
  <div style="display:flex;justify-content:space-between;">
   <span>❌ Failed</span><span style="color:#f06464;font-weight:600;">${errorCount}</span>
  </div>
 `;

 if (entrySyncLog.length === 0) {
  list.innerHTML = '<div style="color:#8b9099;font-size:13px;text-align:center;padding:30px 0;">No entries saved yet</div>';
  return;
 }
 list.innerHTML = entrySyncLog.map(item => {
  const color = item.type === 'error' ? '#f06464' : (item.type === 'warning' ? '#f6b042' : '#3ddc84');
  const icon  = item.type === 'error' ? 'ti-alert-circle' : (item.type === 'warning' ? 'ti-cloud-off' : 'ti-cloud-check');
  return `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #1c212b;">
   <i class="ti ${icon}" style="color:${color};font-size:18px;margin-top:2px;"></i>
   <div>
    <div style="color:#e8eaf0;font-size:13.5px;">${item.message}${item.entryLabel ? ' — <span style="color:#8b9099;">' + item.entryLabel + '</span>' : ''}</div>
    <div style="color:#6b7280;font-size:11px;margin-top:2px;">${formatLogTime(item.time)}</div>
   </div>
  </div>`;
 }).join('');
}

function toggleSyncStatusPanel() {
 const overlay = document.getElementById('syncStatusOverlay');
 const panel = document.getElementById('syncStatusPanel');
 const isOpen = panel.style.display === 'block';
 overlay.style.display = isOpen ? 'none' : 'block';
 panel.style.display = isOpen ? 'none' : 'block';
 if (!isOpen) renderSyncStatusList();
}

// ═══════════════════════════════════════════════════════════════════════
// PAYMENT DUE REMINDERS
// ═══════════════════════════════════════════════════════════════════════
let paymentReminders = [];
let reminderDirection = 'outgoing'; // 'outgoing' (Payment) or 'incoming' (Receive)
let editingReminderId = null;

// Auto-delete reminders after their date has passed (dueDate < today)
function cleanupExpiredReminders() {
 try {
  const today = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : new Date().toISOString().slice(0, 10);
  const prevLen = paymentReminders.length;
  paymentReminders = paymentReminders.filter(r => {
   if (!r || !r.dueDate) return true;
   return r.dueDate >= today;
  });
  if (paymentReminders.length !== prevLen) {
   saveRemindersToLocalStorage();
   if (typeof updateReminderUnreadDot === 'function') updateReminderUnreadDot();
  }
 } catch(e) {
  console.warn('cleanupExpiredReminders error:', e);
 }
}

function loadRemindersFromLocalStorage() {
 try {
  const saved = localStorage.getItem('paymentReminders');
  paymentReminders = saved ? JSON.parse(saved) : [];
 } catch (err) {
  console.warn('Failed to load reminders:', err);
  paymentReminders = [];
 }
 cleanupExpiredReminders();
}

function saveRemindersToLocalStorage() {
 localStorage.setItem('paymentReminders', JSON.stringify(paymentReminders));
}

function openRemindersPanel() {
 cleanupExpiredReminders();
 const overlay = document.getElementById('remindersOverlay');
 const panel = document.getElementById('remindersPanel');
 if (overlay) overlay.style.display = 'block';
 if (panel) panel.style.display = 'block';
 renderRemindersList();
}

function toggleRemindersPanel() {
 const overlay = document.getElementById('remindersOverlay');
 const panel = document.getElementById('remindersPanel');
 if (!panel || !overlay) return;
 const isOpen = panel.style.display === 'block';
 overlay.style.display = isOpen ? 'none' : 'block';
 panel.style.display = isOpen ? 'none' : 'block';
 if (!isOpen) {
  cleanupExpiredReminders();
  renderRemindersList();
 } else {
  closeAddReminderForm();
 }
}

// 🧠 Smart Assistant Reminder Parser (Supports Hindi/Hinglish/English natural phrasing)
function parseReminderInstruction(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();
  const lower = text.toLowerCase();

  const reminderKeywords = /\b(reminder|remind|alert|yaad\s*dilana|yaad\s*rakhna|yaad\s*dilao|yaad\s*karana)\b/i;
  const isExplicitReminder = reminderKeywords.test(lower);

  // If user just asks to make/set a reminder with no details
  if (isExplicitReminder && !/\d|(kal|parso|today|tomorrow|aaj)/i.test(lower)) {
    const words = lower.replace(reminderKeywords, '').replace(/\b(make|set|karo|banao|lagao|add|create|a|an|the|ek|hai|he|ko)\b/g, '').trim();
    if (!words || words.length < 3) {
      return {
        isReminder: true,
        needsClarification: true,
        askText: "Kiska reminder aur kis date ko set karna hai? (Jaise: '10 Oct ko Auto se paise lena hai' ya '15 Oct Electricity bill ₹1200 pay karna hai')"
      };
    }
  }

  if (!isExplicitReminder) {
    return null;
  }

  // Parse Date
  const now = new Date();
  const curYear = now.getFullYear();
  let dueDate = null;
  let dateDayNumber = null;

  // Relative dates
  if (/\b(aaj|today)\b/i.test(lower)) {
    dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (/\b(kal|tomorrow)\b/i.test(lower)) {
    dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (/\b(parso|parson|day\s+after\s+tomorrow)\b/i.test(lower)) {
    dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  }

  // Month names map
  const monthMap = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
  };

  if (!dueDate) {
    // Pattern: "10 oct", "10th october", "10-oct-2026"
    const m1 = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/i) ||
               lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?\b/i);
    
    if (m1) {
      let day, monName, year;
      if (isNaN(m1[1])) {
        monName = m1[1]; day = parseInt(m1[2], 10); year = m1[3] ? parseInt(m1[3], 10) : curYear;
      } else {
        day = parseInt(m1[1], 10); monName = m1[2]; year = m1[3] ? parseInt(m1[3], 10) : curYear;
      }
      dateDayNumber = day;
      const monKey = monName.slice(0, 3).toLowerCase();
      const mIdx = monthMap[monKey] !== undefined ? monthMap[monKey] : monthMap[monName.toLowerCase()];
      if (mIdx !== undefined) {
        dueDate = new Date(year, mIdx, day);
        if (!m1[3] && dueDate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
          dueDate = new Date(year + 1, mIdx, day);
        }
      }
    }
  }

  // Pattern: "15 tarikh", "15 taarikh", "15 ko"
  if (!dueDate) {
    const m2 = lower.match(/\b(\d{1,2})\s*(?:tarikh|taarikh|date|ko)\b/i);
    if (m2) {
      const day = parseInt(m2[1], 10);
      if (day >= 1 && day <= 31) {
        dateDayNumber = day;
        let mIdx = now.getMonth();
        let yr = now.getFullYear();
        if (day < now.getDate()) {
          mIdx++;
          if (mIdx > 11) { mIdx = 0; yr++; }
        }
        dueDate = new Date(yr, mIdx, day);
      }
    }
  }

  // Format dueDate to YYYY-MM-DD
  let dueDateStr = '';
  if (dueDate) {
    const y = dueDate.getFullYear();
    const m = String(dueDate.getMonth() + 1).padStart(2, '0');
    const d = String(dueDate.getDate()).padStart(2, '0');
    dueDateStr = `${y}-${m}-${d}`;
  } else {
    // Default to tomorrow if not specified
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
    dueDateStr = `${y}-${m}-${d}`;
  }

  // Direction: Incoming vs Outgoing
  const isIncoming = /\b(lena|lene|receive|received|collect|le\s*lena|milna|milne|aane|aana|credit)\b/i.test(lower);
  const direction = isIncoming ? 'incoming' : 'outgoing';

  // Amount extraction
  let amount = 0;
  const numMatches = [...text.matchAll(/(?:₹|rs\.?|inr|rupaye?|rupees?)?\s*(\d+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|inr|rupaye?|rupees?)?/gi)];
  for (const m of numMatches) {
    const val = parseFloat(m[1]);
    if (!val || val <= 0) continue;
    if (/(?:₹|rs|inr|rupaye|rupees)/i.test(m[0])) {
      amount = val;
      break;
    }
    if (dateDayNumber !== null && val === dateDayNumber) {
      continue;
    }
    amount = val;
    break;
  }

  // Party / Title extraction
  let cleanText = text
    .replace(/\b(set\s+a\s+reminder|make\s+a\s+reminder|set\s+reminder|make\s+reminder|reminder\s+set\s+karo|reminder\s+lagao|reminder\s+banao|set\s+a\s+alert|set\s+alert)\b/gi, '')
    .replace(/\b(reminder|remind|alert)\b/gi, '')
    .replace(/\b(paise|rupaye|rupees|rs\.?|inr|cash)\b/gi, '')
    .replace(/\b(lena\s+he|lena\s+hai|lene\s+hai|lene\s+he|dena\s+he|dena\s+hai|dene\s+hai|dene\s+he|pay\s+karna\s+hai|bharna\s+hai)\b/gi, '')
    .replace(/\b(lena|lene|dena|dene|bharna|bharne|pay|receive)\b/gi, '')
    .replace(/\b(aaj|kal|parso|today|tomorrow)\b/gi, '')
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{4})?\b/gi, '')
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+\d{4})?\b/gi, '')
    .replace(/\b\d{1,2}\s*(?:tarikh|taarikh|date)\b/gi, '')
    .replace(/\b(ko|se|ka|ki|ke|liye|me|par|pe|karna|karne|hai|he|tha|thi|please|kripya)\b/gi, '')
    .trim();

  if (amount > 0) {
    cleanText = cleanText.replace(new RegExp('\\b' + amount + '\\b', 'g'), '').trim();
  }
  cleanText = cleanText.replace(/[^\w\s\u0900-\u097F]/g, ' ').replace(/\s+/g, ' ').trim();

  let title = cleanText;
  if (!title || title.length < 2) {
    title = isIncoming ? 'Paise lena hai' : 'Payment Reminder';
  } else {
    title = title.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  return {
    isReminder: true,
    needsClarification: false,
    title: title,
    amount: amount,
    dueDate: dueDateStr,
    direction: direction,
    notes: direction === 'incoming' ? 'Paise lena hai' : 'Payment karni hai'
  };
}

function setReminderDirection(dir) {
 reminderDirection = dir;
 const outBtn = document.getElementById('reminderTypeOutBtn');
 const inBtn = document.getElementById('reminderTypeInBtn');
 const mutedText = isLightMode() ? '#6b7280' : '#8b9099';
 const mutedBorder = isLightMode() ? '#e2e8f2' : '#232838';
 if (dir === 'outgoing') {
  outBtn.style.background = 'rgba(240,100,100,.12)'; outBtn.style.color = '#f06464'; outBtn.style.borderColor = '#f06464';
  inBtn.style.background = 'transparent'; inBtn.style.color = mutedText; inBtn.style.borderColor = mutedBorder;
 } else {
  inBtn.style.background = 'rgba(61,220,132,.12)'; inBtn.style.color = '#3ddc84'; inBtn.style.borderColor = '#3ddc84';
  outBtn.style.background = 'transparent'; outBtn.style.color = mutedText; outBtn.style.borderColor = mutedBorder;
 }
}

function openAddReminderForm(reminderId) {
 editingReminderId = reminderId || null;
 const box = document.getElementById('reminderFormBox');
 box.style.display = 'block';

 if (editingReminderId) {
  const r = paymentReminders.find(x => String(x.id) === String(editingReminderId));
  if (r) {
   document.getElementById('reminderTitleInput').value = r.title;
   document.getElementById('reminderAmountInput').value = r.amount;
   document.getElementById('reminderDueDateInput').value = r.dueDate;
   document.getElementById('reminderNotesInput').value = r.notes || '';
   setReminderDirection(r.direction);
   return;
  }
 }

 // Fresh form defaults
 document.getElementById('reminderTitleInput').value = '';
 document.getElementById('reminderAmountInput').value = '';
 document.getElementById('reminderDueDateInput').value = getLocalDateStr();
 document.getElementById('reminderNotesInput').value = '';
 setReminderDirection('outgoing');
}

function closeAddReminderForm() {
 document.getElementById('reminderFormBox').style.display = 'none';
 editingReminderId = null;
}

function saveReminder() {
 const title = document.getElementById('reminderTitleInput').value.trim();
 const amount = parseFloat(document.getElementById('reminderAmountInput').value || 0);
 const dueDate = document.getElementById('reminderDueDateInput').value;
 const notes = document.getElementById('reminderNotesInput').value.trim();

 if (!title) { showNotification('Enter a party / title', 'error'); return; }
 if (!amount) { showNotification('Enter an amount', 'error'); return; }
 if (!dueDate) { showNotification('Pick a due date', 'error'); return; }

 if (editingReminderId) {
  const r = paymentReminders.find(x => String(x.id) === String(editingReminderId));
  if (r) {
   r.title = title; r.amount = amount; r.dueDate = dueDate; r.notes = notes; r.direction = reminderDirection;
  }
 } else {
  paymentReminders.unshift({
   id: 'r_' + Date.now(),
   title, amount, dueDate, notes,
   direction: reminderDirection,
   paid: false,
   createdAt: new Date().toISOString()
  });
 }

 saveRemindersToLocalStorage();
 closeAddReminderForm();
 renderRemindersList();
 showNotification(editingReminderId ? 'Reminder updated ✓' : 'Reminder added ✓', 'success');
}

function markReminderPaid(reminderId) {
 const r = paymentReminders.find(x => String(x.id) === String(reminderId));
 if (!r) return;
 r.paid = true;
 r.paidAt = new Date().toISOString();
 saveRemindersToLocalStorage();
 renderRemindersList();
 showNotification('Marked as paid ✓', 'success');
}

function markReminderUnpaid(reminderId) {
 const r = paymentReminders.find(x => String(x.id) === String(reminderId));
 if (!r) return;
 r.paid = false;
 saveRemindersToLocalStorage();
 renderRemindersList();
}

async function deleteReminder(reminderId) {
 if (!(await confirmAppAction('Delete reminder?', 'This reminder will be permanently deleted.', { danger: true, confirmText: 'Delete', icon: 'ti-trash' }))) return;
 paymentReminders = paymentReminders.filter(x => String(x.id) !== String(reminderId));
 saveRemindersToLocalStorage();
 renderRemindersList();
 showNotification('Reminder deleted', 'success');
}

function updateReminderUnreadDot() {
 const dot = document.getElementById('reminderUnreadDot');
 if (!dot) return;
 const today = getLocalDateStr();
 const hasDueOrOverdue = paymentReminders.some(r => !r.paid && r.dueDate <= today);
 dot.style.display = hasDueOrOverdue ? '' : 'none';
}

// Shows a popup automatically (once per day) if any reminder is due today or overdue
function checkAndShowReminderPopup() {
 cleanupExpiredReminders();
 const today = getLocalDateStr();
 const lastShown = localStorage.getItem('reminderPopupLastShown');
 if (lastShown === today) return; // only once per day

 const dueOrOverdue = paymentReminders.filter(r => !r.paid && r.dueDate <= today);
 if (dueOrOverdue.length === 0) return;

 dueOrOverdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

 // Har due/overdue reminder ke liye asli phone-jaisa notification bhi bhejo
 dueOrOverdue.forEach(r => {
  const isOverdue = r.dueDate < today;
  sendAppNotification(
   isOverdue ? 'Overdue Payment ⚠️' : 'Payment Reminder 💳',
   `${r.title} — ₹${Number(r.amount).toLocaleString('en-IN')} ${isOverdue ? 'ka payment miss ho gaya hai' : 'aaj due hai'}`,
   'reminder-' + r.id
  );
 });

 const title = dueOrOverdue.length === 1
  ? '1 payment needs attention'
  : `${dueOrOverdue.length} payments need attention`;
 document.getElementById('reminderPopupTitle').textContent = title;

 document.getElementById('reminderPopupList').innerHTML = dueOrOverdue.map(r => {
  const isOverdue = r.dueDate < today;
  const color = isOverdue ? '#e24b4a' : '#ef9f27';
  const statusText = isOverdue
   ? `Overdue — was due ${new Date(r.dueDate + 'T00:00:00').toLocaleDateString('en-IN', {day:'numeric', month:'short'})}`
   : 'Due today';
  return `<div style="background:#0d1117;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
   <div style="display:flex;justify-content:space-between;">
    <div style="color:#e8eaf0;font-size:12.5px;font-weight:500;">${r.title}</div>
    <div style="color:${color};font-size:12.5px;font-weight:500;">₹${Number(r.amount).toLocaleString('en-IN')}</div>
   </div>
   <div style="color:${color};font-size:10.5px;margin-top:2px;">${statusText}</div>
  </div>`;
 }).join('');

 document.getElementById('reminderPopupOverlay').style.display = 'flex';
 localStorage.setItem('reminderPopupLastShown', today);
}

function dismissReminderPopup() {
 document.getElementById('reminderPopupOverlay').style.display = 'none';
}

function renderRemindersList() {
 cleanupExpiredReminders();
 updateReminderUnreadDot();
 const list = document.getElementById('remindersList');
 if (!list) return;

 const today = getLocalDateStr();
 const showPaid = document.getElementById('reminderShowPaidToggle')?.checked;

 let visible = paymentReminders.filter(r => showPaid || !r.paid);
 visible.sort((a, b) => {
  if (a.paid !== b.paid) return a.paid ? 1 : -1;
  return a.dueDate.localeCompare(b.dueDate);
 });

 if (visible.length === 0) {
  list.innerHTML = `
   <div style="text-align:center;padding:45px 16px 30px;">
    <div style="width:60px;height:60px;border-radius:20px;background:rgba(232,182,76,0.12);color:#e8b64c;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 14px;border:1px solid rgba(232,182,76,0.25);">
     <i class="ti ti-bell-off"></i>
    </div>
    <div style="color:#ffffff;font-size:15px;font-weight:700;margin-bottom:4px;">No reminders yet</div>
    <div style="color:#94a3b8;font-size:12px;max-width:220px;margin:0 auto 16px;">Add bill payment due dates or upcoming money alerts above.</div>
    <button type="button" onclick="openAddReminderForm()" style="padding:8px 16px;border-radius:10px;border:none;background:linear-gradient(135deg,#f5b301,#e8b64c);color:#11151c;font-weight:700;font-size:12.5px;cursor:pointer;">+ Add Reminder</button>
   </div>`;
  return;
 }

 list.innerHTML = visible.map(r => {
  const isOverdue = !r.paid && r.dueDate < today;
  const isDueToday = !r.paid && r.dueDate === today;
  const isIncoming = r.direction === 'incoming';
  const dirColor = isIncoming ? '#10b981' : '#f43f5e';
  const icon = isIncoming ? 'ti-arrow-down-left' : 'ti-arrow-up-right';
  const dueLabel = new Date(r.dueDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  let badgeBg = 'rgba(59,130,246,0.14)';
  let badgeColor = '#3b82f6';
  let badgeText = 'Upcoming';

  if (r.paid) {
   badgeBg = 'rgba(16,185,129,0.15)';
   badgeColor = '#10b981';
   badgeText = '✓ Paid';
  } else if (isOverdue) {
   badgeBg = 'rgba(244,63,94,0.18)';
   badgeColor = '#f43f5e';
   badgeText = '🔴 Overdue';
  } else if (isDueToday) {
   badgeBg = 'rgba(245,179,1,0.18)';
   badgeColor = '#f5b301';
   badgeText = '⚡ Due Today';
  }

  const borderStyle = isOverdue ? 'border:1px solid rgba(244,63,94,0.3);background:rgba(244,63,94,0.06);' : (r.paid ? 'border:1px solid rgba(255,255,255,0.05);background:rgba(255,255,255,0.02);opacity:0.75;' : 'border:1px solid rgba(255,255,255,0.08);background:#131824;');

  return `<div style="padding:14px;border-radius:14px;margin-bottom:10px;${borderStyle}box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:all 0.2s ease;">
   <div style="display:flex;align-items:flex-start;gap:12px;">
    <div style="width:38px;height:38px;border-radius:12px;background:${dirColor}20;color:${dirColor};border:1px solid ${dirColor}40;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px;">
     <i class="ti ${icon}"></i>
    </div>
    <div style="flex:1;min-width:0;">
     <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
      <div style="color:#ffffff;font-size:14px;font-weight:700;line-height:1.3;word-break:break-word;">${r.title}</div>
      <div style="color:${dirColor};font-size:15px;font-weight:800;white-space:nowrap;">₹${Number(r.amount).toLocaleString('en-IN')}</div>
     </div>
     
     <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
      <div style="color:#94a3b8;font-size:11.5px;font-weight:500;">Due: <b style="color:#cbd5e1;">${dueLabel}</b></div>
      <span style="background:${badgeBg};color:${badgeColor};font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:6px;letter-spacing:0.2px;">${badgeText}</span>
     </div>

     ${r.notes ? `<div style="color:#64748b;font-size:11.5px;margin-top:6px;padding:5px 8px;background:rgba(0,0,0,0.2);border-radius:6px;font-style:italic;">${r.notes}</div>` : ''}

     <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
      <div>
       ${r.paid
        ? `<button type="button" onclick="markReminderUnpaid('${r.id}')" style="background:rgba(255,255,255,0.06);color:#94a3b8;border:none;border-radius:6px;padding:4px 10px;font-size:11.5px;font-weight:600;cursor:pointer;">↩ Undo Paid</button>`
        : `<button type="button" onclick="markReminderPaid('${r.id}')" style="background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);border-radius:6px;padding:4px 10px;font-size:11.5px;font-weight:700;cursor:pointer;">✓ Mark Paid</button>`}
      </div>
      <div style="display:flex;gap:12px;">
       <span style="color:#94a3b8;font-size:12px;font-weight:600;cursor:pointer;" onclick="openAddReminderForm('${r.id}')"><i class="ti ti-edit"></i> Edit</span>
       <span style="color:#f43f5e;font-size:12px;font-weight:600;cursor:pointer;" onclick="deleteReminder('${r.id}')"><i class="ti ti-trash"></i> Delete</span>
      </div>
     </div>
    </div>
   </div>
  </div>`;
 }).join('');
}

// ═══════════════════════════════════════════════════════════════════════
// (Old "Savings & Expense Goals" quick-target system removed — it never had
// any Settings/UI to actually turn it on, and has been fully superseded by
// the category-wise BUDGET TAB module further below, which is what real
// entries/spending now feed into. isSavingsParty() below is still used
// elsewhere in the app, so it's kept.)
// ═══════════════════════════════════════════════════════════════════════

// ===== BUDGET category month-stats + custom-goal notification cleanup =====
// (getGoalCategoryStats/checkCustomGoalCompletions/customGoals — the old
// "Goals tab" data layer — removed; replaced by getCategoryMonthStats() +
// checkBudgetAlerts() + categoryBudgets in the BUDGET TAB module below.)

// ============ REAL PHONE-STYLE NOTIFICATIONS ============
// Browser ka Notification API use karke asli phone jaisa system notification
// dikhata hai (payment reminders aur goals complete/hit hone par). Agar
// permission nahi mili to app normally hi chalega, sirf ye extra alert nahi aayega —
// in-app toast (showNotification) hamesha alag se dikhta rahega, kuch break nahi hoga.

function requestNotificationPermission() {
 if (!('Notification' in window)) return;
 if (Notification.permission === 'default') {
  // Soft ask later via unified dialog when user toggles — avoid silent browser prompt on load
  return;
 }
 updateNotifStatusLabel();
}

// Profile > single ON/OFF pill switch par tap karne se ye chalta hai.
// ON karte waqt — agar browser permission abhi tak nahi maangi gayi, to
// yehi ek click (real user gesture) permission bhi maang leta hai, taaki
// mobile browsers automatic request ko chup-chaap ignore na karein.
// OFF karte waqt — app khud (sendAppNotification se) koi bhi notification
// bhejna band kar deta hai, chahe browser permission "granted" hi kyu na ho.
function toggleAppNotifications() {
 const userDisabled = localStorage.getItem('notificationsUserDisabled') === '1';

 if (userDisabled) {
  // ---- Turning ON ----
  localStorage.removeItem('notificationsUserDisabled');
  renderNotifToggleSwitch();
  if (!('Notification' in window)) {
   showNotification('Ye browser notifications support nahi karta', 'error');
   return;
  }
  if (Notification.permission === 'granted') {
   showNotification('Notifications enabled ✓', 'success');
   sendAppNotification('Test Notification 🔔', 'Payment reminders and goal alerts will appear here.', 'test-notif');
  } else if (Notification.permission === 'denied') {
   showNotification('Notifications ON — please also allow notifications in browser settings if prompted', 'warning');
  } else {
   requestAppPermission('notifications').then(granted => {
    if (granted) {
     showNotification('Notifications ON ho gaye ✓', 'success');
     sendAppNotification('Test Notification 🔔', 'Ab se payment reminders aur goals ke notifications yahan aayenge.', 'test-notif');
    } else {
     showNotification('Notifications permission denied', 'warning');
    }
   });
  }
 } else {
  // ---- Turning OFF ----
  localStorage.setItem('notificationsUserDisabled', '1');
  renderNotifToggleSwitch();
  showNotification('Notifications OFF kar diye ✓', 'success');
 }
}

// Switch ke visual state (thumb + ON/OFF colors) ko localStorage ke
// hisaab se sync rakhta hai — app open hote hi aur toggle karte hi.
function renderNotifToggleSwitch() {
 const userDisabled = localStorage.getItem('notificationsUserDisabled') === '1';
 ['notifToggleSwitch', 'settingsNotifToggleSwitch'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('is-off', userDisabled);
 });
}

// Backward-compat alias — purane code (jaise DOMContentLoaded init) me
// updateNotifStatusLabel() ko call kiya gaya tha, ab wahi switch update karta hai.
function updateNotifStatusLabel() {
 renderNotifToggleSwitch();
}

function getAppNotificationIconUrl() {
 // Absolute URL + cache-bust so old blue "S" icon is not reused.
 try {
  const base = (typeof location !== 'undefined' && location.href)
   ? location.href
   : ((typeof location !== 'undefined' && location.origin) ? location.origin + '/' : '');
  return new URL('icon-192.png?v=25', base).href;
 } catch (e) {
  try { return (location.origin || '') + '/icon-192.png?v=25'; } catch (e2) { return 'icon-192.png'; }
 }
}

function sendAppNotification(title, body, tag) {
 try {
  if (localStorage.getItem('notificationsUserDisabled') === '1') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const iconUrl = getAppNotificationIconUrl();
  // Only ONE icon. Setting badge/image separately can show 2 logos (S + ₹) on Android.
  const options = {
   body: body,
   icon: iconUrl,
   tag: tag || undefined,
   renotify: false
  };
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
   navigator.serviceWorker.ready.then(reg => {
    if (reg && reg.showNotification) {
     reg.showNotification(title, options);
    } else {
     new Notification(title, options);
    }
   }).catch(() => {
    try { new Notification(title, options); } catch (e) {}
   });
  } else {
   new Notification(title, options);
  }
 } catch (err) {
  console.warn('⚠ Notification bhejne mein error:', err);
 }
}


// Har custom goal (Manage Goals list wale) ke complete/limit-cross hone par
// notification bhejta hai — har goal ko mahine mein sirf ek baar hi notify karta hai
// (REMOVED — old Goals-tab-only notification, see checkBudgetAlerts() in the
// BUDGET TAB module below for the Budget-tab equivalent.)

let db = null;

// ===== GOOGLE SIGN-IN CONFIGURATION =====
const GOOGLE_CLIENT_ID = (window.APP_CONFIG && window.APP_CONFIG.googleClientId) || "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
let currentUser = null;

// Initialize Google Sign-In
function initGoogleSignIn() {
  if (window.google && window.google.accounts) {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleSignInResponse
    });
    if (!window.__sessionCheckDone) {
      checkUserSession();
    }
  } else {
    console.warn('Google Sign-In script not loaded yet');
  }
}

// Handle Google Sign-In Response
function handleGoogleSignInResponse(response) {
  try {
    const base64Url = response.credential.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    const payload = JSON.parse(jsonPayload);
    
    currentUser = {
      uid: payload.sub, // 🔒 Firebase uses 'uid' as unique identifier
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      credential: response.credential
    };
    
    // Save to localStorage (including uid for Firebase)
    localStorage.setItem('googleUser', JSON.stringify(currentUser));
    localStorage.setItem('currentUserUid', currentUser.uid); // Separate storage for quick access
    
    console.log('✅ Google Sign-In successful:', currentUser.email, 'uid:', currentUser.uid);
    showNotification('Signed in with Google successfully', 'success');
    updateLoginPageUserInfo();
    // Link with Firebase Auth if available
    if (window.firebase && firebase.auth && response.credential) {
      try {
        const googleCred = firebase.auth.GoogleAuthProvider.credential(response.credential);
        firebase.auth().signInWithCredential(googleCred).then((cred) => {
          if (cred && cred.user) {
            currentUser.uid = cred.user.uid;
            localStorage.setItem('currentUserUid', cred.user.uid);
            localStorage.setItem('googleUser', JSON.stringify(currentUser));
            console.log('✅ Firebase Auth synced, UID:', cred.user.uid);
          }
        }).catch(err => {
          console.warn('Firebase Auth Google linking optional:', err);
        });
      } catch(e){}
    }

    // Auto-proceed after brief delay to show user card
    setTimeout(() => hideGoogleLoginPage(), 1200);
    
  } catch(err) {
    console.error('Sign-in error:', err);
    showNotification('Login failed, please try again', 'error');
  }
}

// ⚠️ TESTING SWITCH — Login page aur PIN screen ko temporarily skip karne
// ke liye ye "true" kar do. Wapas normal (real login+PIN) chahiye ho to
// "false" kar dena — bas itna hi karna hai, aur kahin kuch chhedne ki
// zaroorat nahi.
const DEV_SKIP_LOGIN_AND_PIN = false;  // Login + PIN + Logout screens ON

// Check if user already logged in (Google OR email)
function checkUserSession() {
  // Always restore saved user first so local + Firebase sync keep working
  const savedGoogle = localStorage.getItem('googleUser');
  const savedEmail  = localStorage.getItem('currentUser');
  const raw = savedGoogle || savedEmail;
  if (raw) {
    try {
      currentUser = JSON.parse(raw);
      if (currentUser && currentUser.uid) {
        try { localStorage.setItem('currentUserUid', currentUser.uid); } catch(e){}
      }
      console.log('✅ User session restored:', (currentUser && currentUser.email) || (currentUser && currentUser.uid));
      try { if (typeof updateLoginPageUserInfo === 'function') updateLoginPageUserInfo(); } catch(e){}
    } catch(err) {
      console.warn('Failed to restore session:', err);
      currentUser = null;
    }
  }

  if (DEV_SKIP_LOGIN_AND_PIN) {
    // Login + PIN skip — app opens directly (session already restored above)
    hideLoadingPage();
    const loginPage = document.getElementById('googleLoginPage');
    if (loginPage) { loginPage.classList.add('hidden'); loginPage.style.display = 'none'; }
    const pinScreen = document.getElementById('pinLockScreen');
    if (pinScreen) pinScreen.style.display = 'none';
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.style.display = 'block';
    document.body.classList.add('dev-skip-auth');
    return;
  }

  if (currentUser) {
    hideGoogleLoginPage();
  } else {
    showGoogleLoginPage();
  }
}

// Manual Google Sign-In button handler
function handleGoogleSignIn() {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    // Render the real Google button into a hidden container, then
    // programmatically click it so the account picker opens immediately
    // on the user's first click (no blank One Tap screen in between).
    let hiddenContainer = document.getElementById('googleHiddenBtnContainer');
    if (!hiddenContainer) {
      hiddenContainer = document.createElement('div');
      hiddenContainer.id = 'googleHiddenBtnContainer';
      hiddenContainer.style.position = 'fixed';
      hiddenContainer.style.top = '-9999px';
      hiddenContainer.style.left = '-9999px';
      document.body.appendChild(hiddenContainer);
    }
    hiddenContainer.innerHTML = '';
    window.google.accounts.id.renderButton(
      hiddenContainer,
      {
        type: 'standard',
        size: 'large',
        text: 'signin_with',
        theme: 'dark'
      }
    );
    const realBtn = hiddenContainer.querySelector('div[role="button"]');
    if (realBtn) {
      realBtn.click();
    }
  }
}

// Sign Out Function (handles both Google and email sessions)
function handleGoogleSignOut() {
  if (window.google && window.google.accounts) {
    try { window.google.accounts.id.disableAutoSelect(); } catch(e){}
  }
  if (window.firebase && firebase.auth) {
    try { firebase.auth().signOut().catch(() => {}); } catch(e){}
  }

  // 🛡️ DATA SECURITY: Back up all entries before ending session so data is NEVER lost!
  const leavingUid = (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || 'prev_session';
  if (Array.isArray(entries) && entries.length > 0) {
    try {
      localStorage.setItem('wallet_protected_vault', JSON.stringify(entries));
      localStorage.setItem('entries_backup_' + leavingUid, JSON.stringify(entries));
      console.log('🛡️ Data securely saved to vault before signout:', entries.length, 'entries');
    } catch(e) {}
  }

  // Clear auth session keys only — DO NOT destroy user backups, recycle bin, or offline sync queue
  currentUser = null;
  localStorage.removeItem('googleUser');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('currentUserUid');
  localStorage.removeItem('appPin');
  localStorage.removeItem('biometricCredId');
  localStorage.removeItem('biometricEnabled');

  // Reset in-memory states
  entries = [];
  paymentReminders = [];
  if (typeof customParties !== 'undefined') customParties = [];

  // Update UI to clean state
  try { if (typeof renderWallet === 'function') renderWallet(); } catch(e){}
  try { if (typeof renderEntries === 'function') renderEntries(); } catch(e){}
  try { if (typeof renderAnalytics === 'function') renderAnalytics(); } catch(e){}

  // Restore email/password fields visibility for next login
  const loginFields = document.querySelectorAll('#loginPanel .auth-field');
  loginFields.forEach(f => f.style.display = '');
  const forgotRow = document.querySelector('#loginPanel [style*="justify-content:space-between"]');
  if (forgotRow) forgotRow.style.display = '';

  // Hide everything, show login
  const pinScr = document.getElementById('pinLockScreen');
  if (pinScr) pinScr.style.display = 'none';
  const appContainer = document.getElementById('app');
  if (appContainer) appContainer.style.display = 'none';

  console.log('👋 User logged out and local data cleared');
  showNotification('Logged out. See you again soon!', 'success');
  showGoogleLoginPage();
}

// Show Google Login Page
function showGoogleLoginPage() {
  if (typeof DEV_SKIP_LOGIN_AND_PIN !== 'undefined' && DEV_SKIP_LOGIN_AND_PIN) {
    const lp = document.getElementById('googleLoginPage');
    if (lp) lp.classList.add('hidden');
    const pinScreen = document.getElementById('pinLockScreen');
    if (pinScreen) pinScreen.style.display = 'none';
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.style.display = 'block';
    hideLoadingPage();
    return;
  }
  const loginPage = document.getElementById('googleLoginPage');
  const userInfo = document.getElementById('userInfoContainer');
  const signInBtn = document.getElementById('googleSignInBtn');
  if (loginPage) {
    loginPage.classList.remove('hidden');
    loginPage.style.display = 'flex';
    if (userInfo) userInfo.style.display = 'none';
    if (signInBtn) signInBtn.style.display = 'flex';
  }
  // Restore email/password fields if hidden
  const loginFields = document.querySelectorAll('#loginPanel .auth-field');
  loginFields.forEach(f => f.style.display = '');
  const forgotRow = document.querySelector('#loginPanel [style*="justify-content:space-between"]');
  if (forgotRow) forgotRow.style.display = '';

  // Hide other auth screens
  ['forgotPasswordPage','forgotPinPage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('hidden');
      el.style.display = 'none';
    }
  });
  const appContainer = document.getElementById('app');
  if (appContainer) appContainer.style.display = 'none';
  // Ensure loading splash is gone so login is visible
  if (typeof hideLoadingPage === 'function') hideLoadingPage(true);
  const pinScr = document.getElementById('pinLockScreen');
  if (pinScr) pinScr.style.display = 'none';
}

// Hide Google Login Page — show PIN lock next (correct order: Login → PIN → App)
function hideGoogleLoginPage() {
  const loginPage = document.getElementById('googleLoginPage');
  if (loginPage) {
    loginPage.classList.add('hidden');
    loginPage.style.display = 'none';
  }

  // TEMP testing: skip PIN and show app directly
  if (typeof DEV_SKIP_LOGIN_AND_PIN !== 'undefined' && DEV_SKIP_LOGIN_AND_PIN) {
    const pinScreen = document.getElementById('pinLockScreen');
    if (pinScreen) pinScreen.style.display = 'none';
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.style.display = 'block';
    hideLoadingPage();
    return;
  }

  // Now show PIN screen (after login, not before)
  const pinScreen = document.getElementById('pinLockScreen');
  const appContainer = document.getElementById('app');

  if (pinScreen && appContainer) {
    // Only re-initialize if PIN screen is not already actively displayed
    if (pinScreen.style.display !== 'flex') {
      pinEntered = "";
      pinFirstEntry = "";
      pinMode = localStorage.getItem('appPin') ? 'verify' : 'create';

      if (pinMode === 'create') {
        document.getElementById('pinTitleText').textContent = "Set a PIN";
        document.getElementById('pinSubText').textContent  = "Create a new 4-digit PIN";
        const fpinLink1 = document.getElementById('forgotPinLink');
        if (fpinLink1) fpinLink1.style.display = 'none';
      } else {
        document.getElementById("pinTitleText").textContent = "Hello Again!";
        document.getElementById("pinSubText").textContent = "Enter 4 digit PIN";
        const fpinLink2 = document.getElementById('forgotPinLink');
        if (fpinLink2) fpinLink2.style.display = '';
      }
      pinUpdateDots();
      document.getElementById('pinErrorText').textContent = "";

      if (typeof closeAiChatModal === 'function') closeAiChatModal();
      if (typeof closeQuickAdd === 'function') closeQuickAdd();
      appContainer.style.display = 'none';  // keep app hidden

      // PIN screen loading ke NEECHE ready hoti hai; loading page last me ek hi frame me hatta hai
      pinScreen.style.display = 'flex';
      setTimeout(focusPinHiddenInput, 150);
      if (localStorage.getItem('biometricEnabled') === '1') {
        setTimeout(() => {
          if (pinScreen && pinScreen.style.display === 'flex') handleBiometricAuth();
        }, 250);
      }
    }
    hideLoadingPage();
  } else {
    // fallback: go straight to app
    if (appContainer) appContainer.style.display = 'block';
    hideLoadingPage();
  }
}

// Loading Page Functions — loading page hamesha sabse upar rehta hai jab tak
// agli screen (login / PIN / app) paint na ho jaye. Fir EK hi frame me swap
// hota hai (no fade overlap) => loading + PIN + app ka mix/blink nahi hota.
let _appLaunchTime = Date.now();
let _loadingPageDismissed = false;

function showLoadingPage() {
  const loadingPage = document.getElementById('loadingPage');
  document.documentElement.classList.add('app-booting');
  if (loadingPage) {
    _loadingPageDismissed = false;
    loadingPage.style.display = 'flex';
    loadingPage.classList.remove('hidden','fading');
  }
}

function hideLoadingPage(immediate) {
  if (_loadingPageDismissed) return;
  _loadingPageDismissed = true;
  const loadingPage = document.getElementById('loadingPage');
  const root = document.documentElement;
  let done = false;
  const reveal = () => {
    if (done) return; done = true;
    root.classList.remove('app-booting');          // login / PIN / app ek saath visible
    if (loadingPage) {                             // aur loading usi frame me gayab
      loadingPage.classList.add('hidden');
      loadingPage.style.display = 'none';
    }
  };
  const elapsed = Date.now() - _appLaunchTime;
  const delay = immediate ? 0 : Math.max(0, 300 - elapsed);  // brief, crisp splash
  setTimeout(() => {
    // 2 frames wait: target screen pehle paint ho, tab loading hate
    requestAnimationFrame(() => requestAnimationFrame(reveal));
    setTimeout(reveal, 150); // background tab me rAF nahi chalta — safety
  }, delay);
}

// Agar koi bhi screen ready nahi hai (init fail hua), to ek screen decide karo
function ensureBootView() {
  const shown = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
  if (shown('googleLoginPage') || shown('pinLockScreen') || shown('app')) return;
  try {
    if (currentUser) hideGoogleLoginPage(); else showGoogleLoginPage();
  } catch(e) { try { showGoogleLoginPage(); } catch(e2){} }
}

// ===== PWA: Service Worker (offline support) =====
if ('serviceWorker' in navigator) {
 navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
 }


// ===== GOOGLE DRIVE BACKUP =====
const GOOGLE_DRIVE_CLIENT_ID = (window.APP_CONFIG && window.APP_CONFIG.googleDriveClientId) || "YOUR_GOOGLE_DRIVE_CLIENT_ID.apps.googleusercontent.com";
const GOOGLE_DRIVE_FOLDER_ID = (window.APP_CONFIG && window.APP_CONFIG.googleDriveFolderId) || "";
let gDriveTokenClient = null;
let gDriveAccessToken = null;

function initGoogleDrive(){
 if (typeof location !== 'undefined' && location.protocol === 'file:') {
  showNotification('Google Drive OAuth requires a Web Server', 'warning', 'Google blocks login from local file:/// paths. Use "Backup Data" above to save your backup directly with 1 click, or run the app on http://localhost.', { force: true, persist: true });
  return;
 }
 if(!window.google || !window.google.accounts) {
  showNotification('Google script failed to load, please try again', 'error');
  return;
 }
 gDriveTokenClient = google.accounts.oauth2.initTokenClient({
 client_id: GOOGLE_DRIVE_CLIENT_ID,
 scope: 'https://www.googleapis.com/auth/drive.file',
 callback: (tokenResponse) => {
 if(tokenResponse.error) {
 showNotification('Google auth fail: ' + (tokenResponse.error_description || tokenResponse.error), 'error');
 return;
 }
 if(!tokenResponse.access_token) {
 showNotification('Token not received, please try again', 'error');
 return;
 }
 gDriveAccessToken = tokenResponse.access_token;
 uploadBackupToDrive();
 }
 });
 gDriveTokenClient.requestAccessToken();
}

function backupToGoogleDrive(){
 if(gDriveAccessToken){
 uploadBackupToDrive();
 } else {
 initGoogleDrive();
 }
}

async function uploadBackupToDrive(){
 try {
 if(!navigator.onLine) {
 showNotification('No internet connection', 'error');
 return;
 }
 
 if(!gDriveAccessToken) {
 showNotification('Access token not received, please try again', 'error');
 return;
 }
 
 if(!GOOGLE_DRIVE_FOLDER_ID) {
 showNotification('Drive folder ID not configured', 'error');
 return;
 }
 
 const data = { entries: entries, exportDate: new Date().toISOString() };
 const fileContent = JSON.stringify(data, null, 2);
 const fileName = `ExpenseBackup_${Date.now()}.json`;

 const metadata = {
 name: fileName,
 parents: [GOOGLE_DRIVE_FOLDER_ID],
 mimeType: 'application/json'
 };

 const boundary = '-------wallet_backup_boundary';
 const body =
 `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
 `--${boundary}\r\nContent-Type: application/json\r\n\r\n${fileContent}\r\n` +
 `--${boundary}--`;

 const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
 method: 'POST',
 headers: {
 'Authorization': 'Bearer ' + gDriveAccessToken,
 'Content-Type': `multipart/related; boundary=${boundary}`
 },
 body: body
 });

 if(!res.ok) {
 if(res.status === 401) {
 gDriveAccessToken = null;
 showNotification('Session expired, please log in again', 'error');
 } else if(res.status === 404) {
 showNotification('Drive folder not found, please check the folder ID', 'error');
 } else {
 showNotification('Upload failed: ' + res.status + ' ' + res.statusText, 'error');
 }
 return;
 }
 showNotification('Backed up to Google Drive ✓', 'success');
 localStorage.setItem('lastBackupDate', new Date().toISOString());
 if (typeof recordBackupMetadata === 'function') recordBackupMetadata('Google Drive');
 if (typeof hideBackupReminder === 'function') hideBackupReminder();
 } catch(err) {
 console.error('Drive backup error:', err);
 showNotification('Drive backup failed, please try again', 'error');
 }
}

// ===== VARIABLES =====
const PDF_BG_IMAGE = `data:image/jpeg;base64,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`;

let entries = [];
let currentFilter = "all";
let entryType = "expense";
let editEntryType = "expense";
let analyticsType = "expense";
let donutChartObj, trendChartObj;
let editingEntryId = null;

// ===== CATEGORIES AND DATA =====
const categories = [
 "Entertainment", "Subscription", "Food & Drink", "Shopping", 
 "Transport", "Salary", "Freelance", "Other"
];

const paymentMethods = ["Cash", "Online",];

// ===== ANALYTICS DATA =====
// ===== REAL ANALYTICS CALCULATION (from actual entries, current month) =====
let selectedAnalyticsYear = new Date().getFullYear();
let selectedAnalyticsMonth = new Date().getMonth();

function calculateAnalytics(type){
 const curMonth = selectedAnalyticsMonth, curYear = selectedAnalyticsYear;
 const monthEntries = entries.filter(e=>{
 const d = new Date(e.date);
 return d.getFullYear()===curYear && d.getMonth()===curMonth && e.type===type;
 });

 const total = monthEntries.reduce((s,e)=>s+Number(e.amount||0),0);

 // group by PARTY (fixes "undefined" — was grouping by non-existent e.name)
 const byCat = {};
 monthEntries.forEach(e=>{
 const key = e.party || 'Unknown';
 byCat[key] = (byCat[key]||0) + Number(e.amount||0);
 });

 const catArr = Object.keys(byCat).map(name=>{
 const meta = { color: getPartyColor(name), icon: getPartyIcon(name) };
 return { name, amt: byCat[name], pct: total>0 ? Math.round((byCat[name]/total)*100) : 0, color: meta.color, icon: meta.icon };
 }).sort((a,b)=> b.amt - a.amt);

 // weekly trend (last 5 weeks of current month, by week-start label)
 const weekTotals = {};
 monthEntries.forEach(e=>{
 const d = new Date(e.date);
 const weekNum = Math.ceil(d.getDate()/7);
 const label = `W${weekNum}`;
 weekTotals[label] = (weekTotals[label]||0) + Number(e.amount||0);
 });
 const weekLabels = ["W1","W2","W3","W4","W5"].filter(w=>weekTotals[w]!==undefined);
 const trendLabels = weekLabels.length ? weekLabels : ["No data"];
 const trendData = weekLabels.length ? weekLabels.map(w=>weekTotals[w]) : [0];

 // group by METHOD (dynamically supports all payment methods)
 const methodTotals = {};
 const knownMethods = typeof getAllPaymentMethods === 'function' ? getAllPaymentMethods() : ["Cash", "UPI", "SBI 8974", "PNB 1907"];
 knownMethods.forEach(m => { methodTotals[m] = 0; });
 monthEntries.forEach(e=>{
  const m = (e.method || 'Cash').trim();
  methodTotals[m] = (methodTotals[m] || 0) + Number(e.amount||0);
 });

 return { total, catArr, trendLabels, trendData, methodTotals };
}

// ===== FUNCTIONS =====


// ===== HARDENED ENTRY PERSISTENCE (local first, cloud later) =====
let __mirrorTimer = null, __mirrorPayload = null;
function __flushEntryMirrors() {
  if (__mirrorTimer) { clearTimeout(__mirrorTimer); __mirrorTimer = null; }
  const payload = __mirrorPayload; __mirrorPayload = null;
  if (!payload) return;
  try { localStorage.setItem('wallet_protected_vault', payload); } catch (e) {}
  try {
    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null;
    if (uid) {
      try { localStorage.setItem('entries_user_' + uid, payload); } catch (e) {}
      try { localStorage.setItem('entries_backup_' + uid, payload); } catch (e) {}
    }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.hidden) __flushEntryMirrors(); });
window.addEventListener('pagehide', __flushEntryMirrors);

function persistAllEntries(reason) {
  try {
    if (!Array.isArray(entries)) entries = [];
    const payload = JSON.stringify(entries);
    localStorage.setItem('entries', payload);        // primary — turant (data safety)
    __mirrorPayload = payload;                       // mirrors: 4 bade sync writes ki jagah ek deferred flush
    if (__mirrorTimer) clearTimeout(__mirrorTimer);
    __mirrorTimer = setTimeout(__flushEntryMirrors, 1500);
    try { localStorage.setItem('entries_last_local_save', new Date().toISOString()); } catch (e) {}
    return true;
  } catch (e) {
    console.error('persistAllEntries failed:', e);
    if (typeof showNotification === 'function') showNotification('Data save failed. Storage may be full. Tap to retry.', 'error');
    setTimeout(() => {
      try { if (Array.isArray(entries)) localStorage.setItem('entries', JSON.stringify(entries)); }
      catch (err2) {
        console.error('Retry also failed:', err2);
        if (typeof showNotification === 'function') showNotification('Could not save data. Please free some storage space.', 'error');
      }
    }, 800);
    return false;
  }
}

function recoverEntriesIfEmpty() {
  try {
    if (Array.isArray(entries) && entries.length > 0) return false;
    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid)
      || localStorage.getItem('currentUserUid') || null;
    const keys = [];
    if (uid) {
      keys.push('entries_user_' + uid);
      keys.push('entries_backup_' + uid);
    }
    keys.push('wallet_protected_vault', 'entries', 'wallet_weekly_backup');
    for (const k of keys) {
      let raw = localStorage.getItem(k);
      if (!raw || raw === '[]' || raw === 'null') continue;
      try {
        let list = JSON.parse(raw);
        if (list && list.entries && Array.isArray(list.entries)) list = list.entries; // weekly package
        if (Array.isArray(list) && list.length > 0) {
          entries = list;
          persistAllEntries('recovered_from_' + k);
          console.log('🛡️ Recovered', list.length, 'entries from', k);
          return true;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return false;
}

// Load from localStorage and normalize data
async function dedupeEntries(){
 if (!Array.isArray(entries) || entries.length === 0) return;
 const seenIds = new Set();
 const uniqueEntries = [];

 entries.forEach(e => {
  if (!e) return;
  const id = String(e.id || generateEntryId());
  if (!seenIds.has(id)) {
   seenIds.add(id);
   uniqueEntries.push({
    ...e,
    id: id,
    type: normalizeType(e.type)
   });
  }
 });

 // 🛡️ DATA SECURITY: Never overwrite entries with empty list
 if (uniqueEntries.length > 0) {
  entries = uniqueEntries;
  persistAllEntries('dedupe');
 }
}

function loadFromLocalStorage() {
 try {
  const curUid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || localStorage.getItem('currentUserUid');
  // 🛡️ USER ISOLATION: Check account-specific entries first
  let saved = null;
  if (curUid) {
   saved = localStorage.getItem('entries_user_' + curUid);
  }
  if (!saved || saved === '[]' || saved === 'null') {
   saved = localStorage.getItem('entries');
  }

  // 🛡️ DATA SECURITY: If entries is missing or empty, auto-recover from vault or user backup
  if (!saved || saved === '[]' || saved === 'null') {
   const userBackup = curUid ? localStorage.getItem('entries_backup_' + curUid) : null;
   const vault = localStorage.getItem('wallet_protected_vault');
   if (userBackup && userBackup !== '[]' && userBackup !== 'null') {
    saved = userBackup;
    localStorage.setItem('entries', saved);
    if (curUid) localStorage.setItem('entries_user_' + curUid, saved);
    console.log('🛡️ Auto-recovered entries from user backup');
   } else if (vault && vault !== '[]' && vault !== 'null') {
    saved = vault;
    localStorage.setItem('entries', saved);
    if (curUid) localStorage.setItem('entries_user_' + curUid, saved);
    console.log('🛡️ Auto-recovered entries from protected vault');
   }
  }

  if(saved) {
   const rawList = JSON.parse(saved);
   const deletedBin = JSON.parse(localStorage.getItem('deletedEntries') || '[]');
   const deletedBinSet = new Set((Array.isArray(deletedBin) ? deletedBin : []).map(d => String(d.id)));
   const deletedIds = (typeof getDeletedEntryIdsSet === 'function') ? getDeletedEntryIdsSet() : new Set();
   
   // Normalize all entries safely without flipping types and preserve all fields
   entries = (Array.isArray(rawList) ? rawList : []).map(e => {
    if (!e) return null;
    const validId = (e.id && String(e.id).trim() && String(e.id) !== 'undefined' && String(e.id) !== 'null')
      ? String(e.id)
      : generateEntryId();
    // Only exclude if it exists in the user's explicit Recycle Bin
    if (deletedBinSet.has(validId)) return null;
    // Clean up tombstone if it was falsely marked
    if (deletedIds.has(validId)) {
     if (typeof untrackDeletedEntryId === 'function') untrackDeletedEntryId(validId);
    }
    return {
      ...e,
      id: validId,
      party: e.party || 'Unknown',
      method: e.method || e.cat || 'Cash',
      amount: parseFloat(e.amount) || 0,
      type: normalizeType(e.type),
      date: normalizeDate(e.date),
      time: e.time || new Date().toLocaleTimeString("en-IN"),
      notes: e.notes || '',
      timestamp: e.timestamp || new Date().toISOString(),
      updatedAt: e.updatedAt || e.timestamp || new Date().toISOString(),
      userId: e.userId || (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null,
      image: e.image || null,
      syncedWithCloud: e.syncedWithCloud === true
    };
   }).filter(Boolean);
   
   // If entries were successfully loaded, update the protected vault
   if (entries.length > 0) {
    try { localStorage.setItem('wallet_protected_vault', JSON.stringify(entries)); } catch(e){}
   }

   console.log('✓ Loaded from localStorage:', entries.length, 'entries');
   setTimeout(function(){
     try {
       if (typeof runAutomaticWeeklyBackup === 'function') runAutomaticWeeklyBackup(false);
       var last = localStorage.getItem('lastAutoBackupDate') || localStorage.getItem('lastBackupDate');
       if (last && typeof updateAutoBackupDisplay === 'function') updateAutoBackupDisplay(last);
     } catch(e){}
   }, 2500);
  } else {
   entries = [];
   recoverEntriesIfEmpty();
  }
  if (!entries.length) recoverEntriesIfEmpty();
 } catch(err) {
  console.error('Error loading from localStorage:', err);
  recoverEntriesIfEmpty();
  if (!Array.isArray(entries)) entries = [];
 }
}

// Type helper functions
function isIncomeType(type) {
  if(!type) return false;
  const t = String(type).toLowerCase().trim();
  return t === 'income' || t === 'received' || t === 'receive' || t === 'recd' || t === 'credit' || t === 'cr' || t === 'rec' || t === 'rece';
}

function isExpenseType(type) {
  if(!type) return true;
  const t = String(type).toLowerCase().trim();
  if (t === 'transfer') return false;
  if (isIncomeType(t)) return false;
  return t === 'expense' || t === 'payment' || t === 'pay' || t === 'paid' || t === 'debit' || t === 'dr' || t === 'spent';
}

// Normalize type: "Payment"→"expense", "Received"→"income"
function normalizeType(type) {
  if (isIncomeType(type)) return 'income';
  if (isExpenseType(type)) return 'expense';
  if (String(type).toLowerCase().trim() === 'transfer') return 'transfer';
  return 'expense';
}

// Get today's date (or any Date object) as a LOCAL YYYY-MM-DD string.
// IMPORTANT: do NOT use toISOString().split('T')[0] for this — toISOString()
// converts to UTC first, so for any local time before ~5:30 AM IST it silently
// rolls the date back to the PREVIOUS day (and on the 1st of a month, to the
// previous month). That bug was causing entries saved early in the morning to
// be mis-dated, which then made monthly totals look wrong right when the month changed.
function getLocalDateStr(d) {
 const dt = d ? new Date(d) : new Date();
 const y = dt.getFullYear();
 const m = String(dt.getMonth() + 1).padStart(2, '0');
 const day = String(dt.getDate()).padStart(2, '0');
 return `${y}-${m}-${day}`;
}

// Normalize date: DD/MM/YYYY → YYYY-MM-DD
function normalizeDate(date) {
 if(!date) return getLocalDateStr();
 if(typeof date !== 'string') {
  try {
   const dt = new Date(date);
   if(!isNaN(dt.getTime())) return getLocalDateStr(dt);
  } catch(e) {}
  return getLocalDateStr();
 }
 const trimmed = date.trim();
 if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
  const parts = trimmed.split('-');
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
 }
 if(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.test(trimmed)) {
  const m = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
 }
 if(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.test(trimmed)) {
  const m = trimmed.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
 }
 try {
  const dt = new Date(trimmed);
  if(!isNaN(dt.getTime())) return getLocalDateStr(dt);
 } catch(e) {}
 return getLocalDateStr();
}

// ═══════════════════════════════════════════════════════════════════════
// 🛡️ USER-ISOLATED DATABASE ARCHITECTURE
// Each user account gets a dedicated Firestore collection path:
//   /users/{userId}/entries/{entryId}
// This guarantees that:
// 1. Any new user or test email gets their own separate database.
// 2. The main authentic user's data can NEVER be accessed or merged with others.
// 3. A 0-entry state on another user can NEVER delete the main user's data.
// ═══════════════════════════════════════════════════════════════════════
function getUserEntriesCollection(targetUid) {
 if (!db) return null;
 const uid = targetUid || (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid');
 if (!uid) return db.collection('entries');
 return db.collection('users').doc(String(uid)).collection('entries');
}

async function saveEntryToFirebase(entryData) {
 if (!entryData) return;
 const idStr = String(editingEntryId || entryData.id);

 if (!firebaseReady || !currentUser) {
  if (typeof showMiniSaveToast === 'function') showMiniSaveToast('local');
  logEntrySync('Saved locally (Firebase not ready)', 'warning', entryData.title || entryData.party || '');
  return;
 }

 try {
  const userId = currentUser.uid || localStorage.getItem('currentUserUid');
  const nowIso = new Date().toISOString();
  const entryWithUserId = {
   ...entryData,
   id: idStr,
   userId: userId,
   savedAt: entryData.savedAt || nowIso,
   updatedAt: entryData.updatedAt || nowIso
  };

  // 1. Save to isolated user collection: /users/{userId}/entries/{id}
  const userCol = getUserEntriesCollection(userId);
  if (userCol) {
   await userCol.doc(idStr).set(entryWithUserId, { merge: true });
  }
  // 2. Mirror to legacy collection for safety backup
  db.collection('entries').doc(idStr).set(entryWithUserId, { merge: true }).catch(() => {});

  entryData.syncedWithCloud = true;
  const curIdx = entries.findIndex(e => String(e.id) === idStr);
  if (curIdx > -1) {
   entries[curIdx].syncedWithCloud = true;
   localStorage.setItem('entries', JSON.stringify(entries));
   if (userId) {
    try { localStorage.setItem('entries_user_' + userId, JSON.stringify(entries)); } catch(e){}
   }
  }
  console.log('✓ Entry saved to isolated database for user:', userId);
  logEntrySync(editingEntryId ? 'Entry updated in Firestore' : 'Entry saved to Firestore', 'success', entryData.title || entryData.party || '');
  if (typeof showMiniSaveToast === 'function') showMiniSaveToast('synced');
 } catch (error) {
  console.error('❌ Error saving entry to Firebase:', error);
  const reason = error.code === 'permission-denied' ? 'Permission denied — check Firestore rules' : (error.message || 'unknown error');
  logEntrySync('Save failed — ' + reason, 'error', entryData.title || entryData.party || '');
  showNotification('Firebase save error — saved locally instead', 'error');
 }
}

async function deleteEntryFromFirebase(entryId) {
 const idStr = String(entryId);
 trackDeletedEntryId(idStr);
 entries = entries.filter(e => String(e.id) !== idStr);
 if (typeof persistAllEntries === 'function') persistAllEntries('deleteEntry');
 else localStorage.setItem('entries', JSON.stringify(entries));
 const curUid = (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid');
 if (curUid) {
  try { localStorage.setItem('entries_user_' + curUid, JSON.stringify(entries)); } catch(e){}
 }
 if (typeof queueOfflineSync === 'function') queueOfflineSync('delete', idStr);
 if (!firebaseReady || !db) {
  showNotification('Entry deleted (local)', 'success');
  return;
 }
 try {
  const userCol = getUserEntriesCollection(curUid);
  if (userCol) await userCol.doc(idStr).delete().catch(() => {});
  await db.collection('entries').doc(idStr).delete().catch(() => {});
  console.log('Entry deleted from user isolated database');
  showNotification('Entry deleted', 'success');
 } catch (error) {
  console.error('Error deleting entry:', error);
  showNotification('Error deleting entry', 'error');
 }
}

async function loadEntriesFromFirebase() {
 if (!firebaseReady || !db || !currentUser) return;
 if (!navigator.onLine) { throw new Error('Offline — skipping Firebase fetch'); }

 const userId = currentUser.uid || localStorage.getItem('currentUserUid');
 if (!userId) return;

 try {
  // 1. Flush any pending offline queue operations first
  if (typeof processOfflineSyncQueue === 'function') {
   try { await processOfflineSyncQueue(); } catch(qErr) { console.warn('Sync queue pre-flush warning:', qErr); }
  }

  const deletedIds = (typeof getDeletedEntryIdsSet === 'function') ? getDeletedEntryIdsSet() : new Set();

  // 2. Fetch user's isolated sub-collection first: /users/{userId}/entries
  const userCol = getUserEntriesCollection(userId);
  let snapshot = null;
  try {
   snapshot = await userCol.get();
  } catch(colErr) {
   console.warn('Isolated collection query notice:', colErr);
  }

  // 🔄 BACKWARD COMPATIBILITY: If isolated collection is empty, check legacy root collection for this userId
  if (!snapshot || snapshot.empty) {
   try {
    const legacySnapshot = await db.collection('entries')
     .where('userId', '==', userId)
     .get();
    if (legacySnapshot && !legacySnapshot.empty) {
     console.log('🔄 Found', legacySnapshot.size, 'legacy entries. Auto-migrating to isolated collection...');
     snapshot = legacySnapshot;
     // Copy them into the isolated sub-collection
     const batch = db.batch();
     legacySnapshot.forEach(doc => {
      const data = doc.data();
      if (data) {
       batch.set(userCol.doc(String(doc.id)), { ...data, userId: userId }, { merge: true });
      }
     });
     batch.commit().catch(err => console.warn('Batch migration notice:', err));
    }
   } catch(legacyErr) {
    console.warn('Legacy entries check skipped:', legacyErr);
   }
  }

  const cloudEntries = [];
  const cloudIds = new Set();

  if (snapshot) {
   snapshot.forEach(doc => {
    const data = doc.data();
    if (!data) return;
    const docId = String(doc.id);

    cloudIds.add(docId);
    cloudEntries.push({
     id: docId,
     party: data.party || 'Unknown',
     method: data.method || data.cat || 'Cash',
     amount: parseFloat(data.amount) || 0,
     type: normalizeType(data.type),
     date: normalizeDate(data.date),
     time: data.time || '',
     notes: data.notes || '',
     image: data.image || null,
     timestamp: data.timestamp || new Date().toISOString(),
     updatedAt: data.updatedAt || data.savedAt || data.timestamp || new Date().toISOString(),
     savedAt: data.savedAt || new Date().toISOString(),
     userId: data.userId || userId,
     syncedWithCloud: true
    });
   });
  }

  // 3. Two-way non-destructive merge with Last-Write-Wins (LWW)
  const localMap = new Map();
  if (Array.isArray(entries)) {
   entries.forEach(e => {
    if (e && e.id) {
     localMap.set(String(e.id), e);
    }
   });
  }

  const toUploadToCloud = [];

  // Merge cloud entries: compare local vs cloud timestamps
  cloudEntries.forEach(ce => {
   const idStr = String(ce.id);
   if (localMap.has(idStr)) {
    const le = localMap.get(idStr);
    const localTime = new Date(le.updatedAt || le.timestamp || 0).getTime();
    const cloudTime = new Date(ce.updatedAt || ce.timestamp || ce.savedAt || 0).getTime();

    if (localTime > cloudTime) {
     toUploadToCloud.push(le);
    } else {
     localMap.set(idStr, { ...le, ...ce, syncedWithCloud: true });
    }
   } else {
    localMap.set(idStr, ce);
   }
  });

  // 🛡️ SECURITY GUARD: Never wipe / auto-delete local entries when cloud is empty,
  // partial, or sync fails. Only explicit user Delete removes an entry.
  // Local entries always win for presence; cloud only updates fields when newer.
  const finalMerged = [];
  localMap.forEach((e, idStr) => {
   // Skip only if user explicitly deleted (tombstone)
   if (deletedIds.has(idStr)) return;
   finalMerged.push(e);
   if (!cloudIds.has(idStr)) {
    toUploadToCloud.push(e);
   }
  });

  finalMerged.sort((a, b) => new Date(b.date || b.timestamp || 0) - new Date(a.date || a.timestamp || 0));

  // Never replace a non-empty local list with a shorter/empty merge result
  const prevCount = Array.isArray(entries) ? entries.length : 0;
  if (finalMerged.length > 0) {
   // Extra safety: if merge somehow has fewer items than before and none were
   // in deletedIds, keep the larger local set and only upload missing.
   if (finalMerged.length < prevCount) {
    console.warn('🛡️ Merge would shrink local entries (' + prevCount + ' → ' + finalMerged.length + '). Keeping all local + adding cloud-only.');
    const keepMap = new Map();
    (entries || []).forEach(e => { if (e && e.id && !deletedIds.has(String(e.id))) keepMap.set(String(e.id), e); });
    finalMerged.forEach(e => {
     if (e && e.id) keepMap.set(String(e.id), e);
    });
    const safeList = Array.from(keepMap.values());
    safeList.sort((a, b) => new Date(b.date || b.timestamp || 0) - new Date(a.date || a.timestamp || 0));
    entries = safeList;
   } else {
    entries = finalMerged;
   }
   persistAllEntries('firebase_merge');
  } else {
   // Cloud empty / merge empty → keep local, never wipe
   recoverEntriesIfEmpty();
   if (entries.length) persistAllEntries('firebase_empty_keep_local');
  }
  console.log('✓ Reconciled isolated entries with Firebase:', entries.length, 'entries for user:', userId);


  // 4. Background sync-up: upload any local updates / new entries to isolated collection
  if (firebaseReady && db && userId && toUploadToCloud.length > 0) {
   toUploadToCloud.forEach(e => {
    const toUpload = {
     ...e,
     userId: userId,
     savedAt: e.savedAt || new Date().toISOString(),
     updatedAt: e.updatedAt || new Date().toISOString()
    };
    if (userCol) {
     userCol.doc(String(e.id)).set(toUpload, { merge: true })
      .then(() => {
       const idx = entries.findIndex(x => String(x.id) === String(e.id));
       if (idx > -1) {
        entries[idx].syncedWithCloud = true;
        localStorage.setItem('entries', JSON.stringify(entries));
       }
      })
      .catch(err => console.warn('Isolated sync up error (will retry):', err));
    }
    db.collection('entries').doc(String(e.id)).set(toUpload, { merge: true }).catch(() => {});
   });
  }
 } catch (error) {
  console.error('❌ Error loading entries from Firebase:', error);
  throw error;
 }
}

// ===== UI FUNCTIONS =====

// ===== CATEGORY META (icon + color per category) =====
const categoryMeta = {
 "Entertainment": {icon:"ti-device-tv", color:"#f06464"},
 "Subscription": {icon:"ti-refresh", color:"#3ddc84"},
 "Food & Drink": {icon:"ti-coffee", color:"#caa472"},
 "Shopping": {icon:"ti-shopping-cart", color:"#e8b64c"},
 "Transport": {icon:"ti-car", color:"#5b8cff"},
 "Salary": {icon:"ti-wallet", color:"#3ddc84"},
 "Freelance": {icon:"ti-briefcase", color:"#5b8cff"},
 "Other": {icon:"ti-dots", color:"#9aa0aa"}
};
function getCatMeta(name){ return categoryMeta[name] || {icon:"ti-tag", color:"#9aa0aa"}; }

const partyColorPalette = ["#e8b64c","#60a5fa","#3ddc84","#f06464","#a78bfa","#fb923c","#22d3ee","#f472b6","#84cc16","#eab308"];
function getPartyColor(name){
 let hash = 0;
 for(let i=0;i<name.length;i++){ hash = (hash*31 + name.charCodeAt(i)) % 1000000; }
 return partyColorPalette[Math.abs(hash) % partyColorPalette.length];
}

function fmtAmt(e){
 return (isExpenseType(e.type) ? "- ₹" : "+ ₹") + Number(e.amount).toLocaleString("en-IN");
}

function fmtDateLabel(d){
 const normD = normalizeDate(d);
 const today = getLocalDateStr();
 const yest = getLocalDateStr(Date.now() - 24 * 60 * 60 * 1000);
 if(normD === today) return "Today, " + new Date().toLocaleDateString("en-IN", {weekday: 'short', month: 'short', day: 'numeric'});
 if(normD === yest) return "Yesterday, " + new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString("en-IN", {weekday: 'short', month: 'short', day: 'numeric'});
 const parts = normD.split('-').map(Number);
 const dt = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
 return dt.toLocaleDateString("en-IN", {day:'numeric', month:'short', year:'numeric'});
}

function updateDateLabel(dateStr) {
 const today = new Date();
 today.setHours(0,0,0,0);
 const entryDate = new Date(dateStr);
 entryDate.setHours(0,0,0,0);
 
 const lbl = document.getElementById('dateFieldLabel');
 if (entryDate.getTime() === today.getTime()) {
 lbl.textContent = 'Date (Today)';
 } else if (entryDate.getTime() === today.getTime() - (24 * 60 * 60 * 1000)) {
 lbl.textContent = 'Date (Yesterday)';
 } else {
 lbl.textContent = 'Date';
 }
}

// ===== NAVIGATION =====

let currentAppScreen = 'wallet';
// ============================================================
// GOALS TAB — replaces the old category-wise Budget module. A goal is a
// savings/spending target (name, target amount, target date). Its "saved"
// amount is computed live (see syncGoalsWithEntries() below) as the sum of:
//   1) manual contributions logged via "Add Money" in Goal Details, plus
//   2) every EXPENSE entry whose Party Name matches the goal's name
//      (case-insensitive) — e.g. a "Food" goal auto-tracks every expense
//      entry saved with Party Name "Food", regardless of which was
//      created first.
// ============================================================

// ---- Icon + colour library (glossy 3D emoji badges) ----
const ICON_META = {
  laptop:   {emoji:'💻', color:'blue'},
  piggy:    {emoji:'🐷', color:'pink'},
  plane:    {emoji:'✈️', color:'orange'},
  home:     {emoji:'🏠', color:'teal'},
  cap:      {emoji:'🎓', color:'purple'},
  phone:    {emoji:'📱', color:'blue'},
  food:     {emoji:'🍔', color:'orange'},
  auto:     {emoji:'🚕', color:'purple'},
  fuel:     {emoji:'⛽', color:'green'},
  travel:   {emoji:'🧳', color:'teal'},
  medicine: {emoji:'💊', color:'pink'}
};
const ICON_KEYS = Object.keys(ICON_META);

const GOAL_COLORS = {
  blue:   {ic:'#5b9bf5', c1:'#EAF1FF', c2:'#B9CBFA', shadow:'rgba(91,155,245,.35)'},
  green:  {ic:'#3ee08a', c1:'#E9FBF0', c2:'#A7E9C0', shadow:'rgba(62,224,138,.35)'},
  purple: {ic:'#8B5CF6', c1:'#F0EAFF', c2:'#CBB9FA', shadow:'rgba(139,92,246,.35)'},
  orange: {ic:'#EA9A16', c1:'#FFF3E3', c2:'#FBD79A', shadow:'rgba(234,154,22,.35)'},
  pink:   {ic:'#EC4899', c1:'#FFEAF4', c2:'#F6B9D8', shadow:'rgba(236,72,153,.35)'},
  teal:   {ic:'#0E9488', c1:'#E3FBF7', c2:'#9AE6DA', shadow:'rgba(14,148,136,.35)'}
};
const GOAL_COLOR_KEYS = Object.keys(GOAL_COLORS);

// Real background photos, reused from the earlier per-category artwork —
// used as full-bleed backgrounds on the home-screen carousel card for the
// few icons that have one (Food/Medicine/Auto); everything else falls back
// to the goal's own glossy gradient. Also still powers the "latest entry"
// carousel card via the "entry" key.
// (RT_CARD_BACKGROUNDS itself is defined further below, near renderRtCarousel.)
function iconEmoji(key){ return (ICON_META[key] || ICON_META.laptop).emoji; }
function glossVars(colorKey){
  const c = GOAL_COLORS[colorKey] || GOAL_COLORS.blue;
  return `--c1:${c.c1};--c2:${c.c2};--gshadow:${c.shadow};`;
}
function iconBadge(iconKey){ return `<span>${iconEmoji(iconKey)}</span>`; }

// ---- Data layer ----
const GOALS_STORAGE_KEY = "userGoals";
let goals = [];
let editingGoalId = null;
let currentGoalId = null;
let lastCompletedGoalId = null;

function loadGoals(){
  try{
    const raw = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY) || "[]");
    goals = Array.isArray(raw) ? raw : [];
  } catch(err){ goals = []; }
}
function saveGoalsToStorage(){
  try{ localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals)); }
  catch(err){ console.warn("Failed to save goals:", err); }
}
function uidGoal(){ return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function getGoal(id){ return goals.find(g => g.id === id); }
function pctOfGoal(g){ return g.target > 0 ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0; }
function goalProgressColor(g){ return g.status === 'completed' ? GOAL_COLORS.green.ic : GOAL_COLORS[g.color].ic; }
function fmtGoalMoney(n){ return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
function fmtGoalDate(iso){
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getGoalTodayStr(){
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---- Total-balance ring (canvas) ----
function drawGoalsRing(pct){
  const canvas = document.getElementById('ringGoalsTotal');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = (Math.min(w, h) / 2) - 6;
  const isDark = !document.body.classList.contains('light-theme');
  ctx.lineWidth = 8;
  ctx.strokeStyle = isDark ? '#1f2430' : '#e2e8f2';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = pct >= 100 ? '#3ee08a' : '#5b9bf5';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * Math.min(1, pct / 100)));
  ctx.stroke();
}
function setGoalText(id, text){ const el = document.getElementById(id); if (el) el.textContent = text; }

// ---- Goal Sub-Tabs & Month-Wise History ----
let currentGoalTab = 'active';

function switchGoalTab(tab){
  currentGoalTab = tab;
  const activeBtn = document.getElementById('goalTabActiveBtn');
  const historyBtn = document.getElementById('goalTabHistoryBtn');
  if (activeBtn) activeBtn.classList.toggle('active', tab === 'active');
  if (historyBtn) historyBtn.classList.toggle('active', tab === 'history');
  renderGoalsList();
}

function getGoalMonthYear(g){
  const dStr = g.closedDate || g.targetDate || g.startDate;
  if (!dStr) return 'Other Goals';
  const d = new Date(dStr + 'T00:00:00');
  if (isNaN(d.getTime())) return 'Other Goals';
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return months[d.getMonth()] + ' ' + d.getFullYear();
}

function renderGoalCardHTML(g, isHistory){
  const pct = pctOfGoal(g);
  const isCompleted = g.status === 'completed';
  const isEnded = g.status === 'ended';
  const barColor = isCompleted ? GOAL_COLORS.green.ic : (isEnded ? GOAL_COLORS.orange.ic : GOAL_COLORS[g.color]?.ic || '#5b9bf5');
  const safeId = g.id;

  let badgeHTML = `<span class="goal-badge active">Active</span>`;
  if (isCompleted) {
    badgeHTML = `<span class="goal-badge completed">Completed 🎉</span>`;
  } else if (isEnded) {
    badgeHTML = `<span class="goal-badge ended">Ended 🏁</span>`;
  }

  const dateSub = isHistory 
    ? `Target: ${fmtGoalDate(g.targetDate)} · Closed`
    : `Target: ${fmtGoalDate(g.targetDate)}`;

  return `
  <div class="goal-card" onclick="openGoalDetailsFromCard(event,'${safeId}')">
    <div class="goal-top">
      <div class="goal-icon glossy" style="${glossVars(g.color)}">${iconBadge(g.icon)}</div>
      <div class="goal-info">
        <div style="min-width:0;flex:1;overflow:hidden;">
          <div class="goal-name">${escapeGoalHtml(g.name)} ${badgeHTML}</div>
          <div class="goal-sub">${fmtGoalMoney(g.saved)} / ${fmtGoalMoney(g.target)} · ${dateSub}</div>
        </div>
      </div>
      <span class="goal-pct-badge" style="color:${barColor};">${pct}%</span>
      <div style="position:relative;">
        <button class="goal-kebab" onclick="toggleGoalCardMenu(event,'${safeId}')">&#8942;</button>
        <div class="goal-menu-pop" id="goalCardMenu-${safeId}" style="display:none;">
          <button onclick="event.stopPropagation();closeAllGoalMenus();openGoalDetailsModal('${safeId}')"><i class="ti ti-eye"></i>View Details</button>
          <button onclick="event.stopPropagation();editGoalOpen('${safeId}')"><i class="ti ti-pencil"></i>Edit</button>
          <button class="danger" onclick="event.stopPropagation();askDeleteGoal('${safeId}')"><i class="ti ti-trash"></i>Delete</button>
        </div>
      </div>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${barColor};"></div></div>
  </div>`;
}

// ---- Goals list render ----
function renderGoalsList(){
  const listEl = document.getElementById('goalsList');
  if (!listEl) return;

  if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();

  const activeGoals = goals.filter(g => g.status === 'active');
  const historyGoals = goals.filter(g => g.status !== 'active');

  const targetGoals = (currentGoalTab === 'active') ? activeGoals : historyGoals;
  const totalSaved = targetGoals.reduce((s,g) => s + (Number(g.saved) || 0), 0);
  const totalTarget = targetGoals.reduce((s,g) => s + (Number(g.target) || 0), 0);
  const totalPct = totalTarget > 0 ? Math.min(100, Math.round((totalSaved / totalTarget) * 100)) : 0;

  const totalLabelEl = document.getElementById('goalsTotalBalanceLabel');
  if (totalLabelEl) {
    totalLabelEl.textContent = currentGoalTab === 'active' ? 'Active Goals Balance' : 'History Goals Balance';
  }

  setGoalText('goalsTotalSavedText', fmtGoalMoney(totalSaved));
  setGoalText('goalsTotalTargetText', fmtGoalMoney(totalTarget));
  setGoalText('ringGoalsTotalPct', totalPct + '%');
  setGoalText('goalsActiveCountText', activeGoals.length);
  setGoalText('goalsCompletedCountText', goals.filter(g => g.status === 'completed').length);
  setGoalText('goalActiveCountBadge', activeGoals.length);
  setGoalText('goalHistoryCountBadge', historyGoals.length);
  drawGoalsRing(totalPct);

  // Sync sub-tab button active classes
  const activeBtn = document.getElementById('goalTabActiveBtn');
  const historyBtn = document.getElementById('goalTabHistoryBtn');
  if (activeBtn) activeBtn.classList.toggle('active', currentGoalTab === 'active');
  if (historyBtn) historyBtn.classList.toggle('active', currentGoalTab === 'history');

  if (currentGoalTab === 'active') {
    if (activeGoals.length === 0) {
      if (historyGoals.length > 0) {
        // Next month prompt when previous goal ended/closed
        listEl.innerHTML = `
          <div class="new-goal-prompt-card">
            <div class="prompt-icon">🎯</div>
            <div class="prompt-title">Naya Mahina, Naya Goal!</div>
            <div class="prompt-desc">Your previous goal reached its target date and was archived in <b>Goal History</b>.<br>Create a new goal for this month to continue saving!</div>
            <button class="prompt-btn" onclick="openGoalFormModal()"><i class="ti ti-plus"></i> Create New Goal</button>
            <div style="margin-top:14px;">
              <button class="link-btn" onclick="switchGoalTab('history')" style="color:var(--blue);font-weight:600;cursor:pointer;"><i class="ti ti-history" style="margin-right:4px;"></i>Pichle Goals History me dekhein &rarr;</button>
            </div>
          </div>`;
      } else {
        listEl.innerHTML = `
          <div class="empty-goals">
            <i class="ti ti-target"></i>
            <p>Abhi koi active goal nahi hai.<br>Apna pehla savings goal banayein!</p>
            <button class="prompt-btn" onclick="openGoalFormModal()" style="margin-top:10px;"><i class="ti ti-plus"></i> Create New Goal</button>
          </div>`;
      }
    } else {
      listEl.innerHTML = activeGoals.map(g => renderGoalCardHTML(g, false)).join('');
    }
  } else {
    // History Tab View (Month-wise)
    if (historyGoals.length === 0) {
      listEl.innerHTML = `
        <div class="empty-goals">
          <i class="ti ti-history"></i>
          <p>Abhi tak koi past/ended goal nahi hai.<br>Active goals target date poori hone par yahan month-wise save honge.</p>
        </div>`;
    } else {
      // Group history goals by month-year
      const monthGroups = {};
      historyGoals.forEach(g => {
        const my = getGoalMonthYear(g);
        (monthGroups[my] = monthGroups[my] || []).push(g);
      });

      let html = '';
      const months = Object.keys(monthGroups);
      // Sort months descending if possible by date
      months.sort((a, b) => {
        const da = new Date(monthGroups[a][0].closedDate || monthGroups[a][0].targetDate || 0);
        const db = new Date(monthGroups[b][0].closedDate || monthGroups[b][0].targetDate || 0);
        return db - da;
      });

      months.forEach(m => {
        html += `
        <div class="goal-month-group">
          <div class="goal-month-header"><i class="ti ti-calendar-month"></i> ${m} (${monthGroups[m].length})</div>
          ${monthGroups[m].map(g => renderGoalCardHTML(g, true)).join('')}
        </div>`;
      });
      listEl.innerHTML = html;
    }
  }

  checkGoalAlerts();
  if (typeof renderRtCarousel === 'function') renderRtCarousel();
}

function escapeGoalHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function toggleGoalCardMenu(e, id){
  e.stopPropagation();
  const pop = document.getElementById('goalCardMenu-' + id);
  const wasOpen = pop.style.display === 'block';
  closeAllGoalMenus();
  pop.style.display = wasOpen ? 'none' : 'block';
}
function closeAllGoalMenus(){
  document.querySelectorAll('.goal-menu-pop').forEach(p => p.style.display = 'none');
}
document.addEventListener('click', closeAllGoalMenus);

function openGoalDetailsFromCard(e, id){
  if (e.target.closest('.goal-kebab') || e.target.closest('.goal-menu-pop')) return;
  openGoalDetailsModal(id);
}

// ---- Create / Edit modal ----
let goalFormIcon = 'laptop';
let goalFormColor = 'blue';

function renderGoalIconChoiceRow(){
  const el = document.getElementById('goalIconChoiceRow');
  if (!el) return;
  el.innerHTML = ICON_KEYS.map(k => `
    <div class="icon-choice glossy ${k===goalFormIcon?'selected':''}" style="${glossVars(ICON_META[k].color)}" onclick="pickGoalIcon('${k}')">${iconBadge(k)}</div>
  `).join('');
}
function renderGoalColorChoiceRow(){
  const el = document.getElementById('goalColorChoiceRow');
  if (!el) return;
  el.innerHTML = GOAL_COLOR_KEYS.map(k => `
    <div class="color-dot ${k===goalFormColor?'selected':''}" onclick="pickGoalColor('${k}')">
      <div class="ring" style="background:${GOAL_COLORS[k].ic};"></div>
    </div>
  `).join('');
}
function pickGoalIcon(k){ goalFormIcon = k; renderGoalIconChoiceRow(); updateGoalAvatarPreview(); }
function pickGoalColor(k){ goalFormColor = k; renderGoalColorChoiceRow(); updateGoalAvatarPreview(); }
function updateGoalAvatarPreview(){
  const el = document.getElementById('goalAvatarPreview');
  if (!el) return;
  el.setAttribute('style', glossVars(goalFormColor));
  el.innerHTML = iconBadge(goalFormIcon);
}

function openGoalFormModal(){
  editingGoalId = null;
  const titleEl = document.getElementById('goalFormTitle');
  if (titleEl) titleEl.textContent = 'Create New Goal';
  document.getElementById('goalFormName').value = '';
  document.getElementById('goalFormAmount').value = '';
  document.getElementById('goalFormDate').value = '';
  document.getElementById('goalFormDesc').value = '';
  goalFormIcon = 'laptop'; goalFormColor = 'blue';
  renderGoalIconChoiceRow(); renderGoalColorChoiceRow(); updateGoalAvatarPreview();
  document.getElementById('goalFormModal').classList.add('active');
}
function closeGoalFormModal(){
  document.getElementById('goalFormModal').classList.remove('active');
  editingGoalId = null;
}
function editGoalOpen(id){
  closeAllGoalMenus();
  const g = getGoal(id);
  if (!g) return;
  editingGoalId = id;
  const titleEl = document.getElementById('goalFormTitle');
  if (titleEl) titleEl.textContent = 'Edit Goal';
  document.getElementById('goalFormName').value = g.name;
  document.getElementById('goalFormAmount').value = g.target;
  document.getElementById('goalFormDate').value = g.targetDate;
  document.getElementById('goalFormDesc').value = g.description || '';
  goalFormIcon = g.icon; goalFormColor = g.color;
  renderGoalIconChoiceRow(); renderGoalColorChoiceRow(); updateGoalAvatarPreview();
  closeGoalDetailsModal();
  document.getElementById('goalFormModal').classList.add('active');
}

function saveGoalForm(){
  const name = document.getElementById('goalFormName').value.trim();
  const amount = parseFloat(document.getElementById('goalFormAmount').value);
  const date = document.getElementById('goalFormDate').value;
  const desc = document.getElementById('goalFormDesc').value.trim();

  if (!name){ if (typeof showNotification === 'function') showNotification('Goal ka naam daalein', 'warning'); return; }
  if (!amount || amount <= 0){ if (typeof showNotification === 'function') showNotification('Valid target amount daalein', 'warning'); return; }
  if (!date){ if (typeof showNotification === 'function') showNotification('Target date chunein', 'warning'); return; }

  const todayStr = getGoalTodayStr();
  const isPast = date < todayStr;

  if (editingGoalId){
    const g = getGoal(editingGoalId);
    if (g){
      g.name = name; g.target = amount; g.targetDate = date; g.description = desc;
      g.icon = goalFormIcon; g.color = goalFormColor;
      // Recompute saved from matching entries immediately
      if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
      if ((Number(g.saved) || 0) >= g.target) {
        g.status = 'completed';
        if (!g.closedDate) g.closedDate = date;
      } else if (isPast) {
        g.status = 'ended';
        if (!g.closedDate) g.closedDate = date;
      } else {
        g.status = 'active';
        g.closedDate = null;
      }
      saveGoalsToStorage();
      closeGoalFormModal();
      currentGoalTab = (g.status === 'active') ? 'active' : 'history';
      renderGoalsList();
      openGoalDetailsModal(g.id);
      if (typeof showNotification === 'function') showNotification('Goal updated ✓', 'success');
    }
  } else {
    const status = isPast ? 'ended' : 'active';
    // Count from 1st of the start month so same-month entries with this party name are included
    const monthStartStr = todayStr.slice(0, 7) + '-01';
    const g = {
      id: uidGoal(), name, target: amount, saved: 0,
      startDate: monthStartStr, targetDate: date,
      description: desc, icon: goalFormIcon, color: goalFormColor,
      status: status,
      closedDate: isPast ? date : null,
      contributions: []
    };

    goals.unshift(g);
    // Pick up any existing entries that already use this party name
    if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
    saveGoalsToStorage();
    closeGoalFormModal();
    currentGoalTab = isPast ? 'history' : 'active';
    renderGoalsList();
    openGoalDetailsModal(g.id);
    if (typeof showNotification === 'function') showNotification(isPast ? 'Goal created and archived to History ✓' : 'Goal created ✓', 'success');
  }
}


// ---- Details modal ----
function openGoalDetailsModal(id){
  currentGoalId = id;
  renderGoalDetailsBody();
  document.getElementById('goalDetailsModal').classList.add('active');
}
function closeGoalDetailsModal(){
  document.getElementById('goalDetailsModal').classList.remove('active');
}

function goalMethodIcon(method){
  const m = (method || '').toLowerCase();
  if (m.includes('upi') || m.includes('phone')) return '<i class="ti ti-device-mobile"></i>';
  if (m.includes('bank') || m.includes('transfer')) return '<i class="ti ti-building-bank"></i>';
  return '<i class="ti ti-cash"></i>';
}

function renderGoalDetailsBody(){
  if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
  const g = getGoal(currentGoalId);
  const body = document.getElementById('goalDetailsBody');
  if (!body) return;
  if (!g){ body.innerHTML = ''; return; }

  const pct = pctOfGoal(g);
  const barColor = goalProgressColor(g);
  const remaining = Math.max(0, g.target - g.saved);
  const contribs = [...getAllContribsForGoal(g)].sort((a,b) => new Date(b.date) - new Date(a.date));
  const showAll = body.dataset.showAll === '1';
  const listToShow = showAll ? contribs : contribs.slice(0, 2);

  body.innerHTML = `
    <div class="gl-card">
      <div class="gl-detail-row">
        <div class="goal-icon glossy" style="${glossVars(g.color)}">${iconBadge(g.icon)}</div>
        <div class="gl-detail-info">
          <h3>${escapeGoalHtml(g.name)}<span class="goal-badge ${g.status==='completed'?'completed':(g.status==='ended'?'ended':'active')}">${g.status==='completed'?'Completed 🎉':(g.status==='ended'?'Ended 🏁':'Active')}</span></h3>
          <div class="tg">Target: ${fmtGoalMoney(g.target)}</div>
          <div class="dt"><i class="ti ti-calendar" style="margin-right:4px;"></i>Target Date: ${fmtGoalDate(g.targetDate)}</div>
        </div>
      </div>
    </div>

    <div class="gl-card">
      <div class="gl-progress-head">
        <h4>Progress</h4>
        <div style="display:flex;align-items:center;gap:10px;">
          ${g.status === 'active' ? `<button class="add-money-btn" onclick="openAddMoneyModal()">+ Add Money</button>` : ''}
          <span class="pctnum ${g.status==='completed'?'done':''}">${pct}%</span>
        </div>
      </div>
      <div class="gl-progress-track"><div class="gl-progress-fill" style="width:${pct}%;background:${barColor};"></div></div>
      <div class="gl-meta-row">
        <div class="m"><span>Saved</span><b>${fmtGoalMoney(g.saved)}</b></div>
        <div class="m"><span>Remaining</span><b>${fmtGoalMoney(remaining)}</b></div>
      </div>
    </div>

    <div class="gl-card">
      <h4 style="margin:0 0 10px;font-size:14.5px;font-weight:700;color:#f5f6f8;">Summary</h4>
      <div class="summary-row"><span>Target Amount</span><b>${fmtGoalMoney(g.target)}</b></div>
      <div class="summary-row"><span>Saved Amount</span><b>${fmtGoalMoney(g.saved)}</b></div>
      <div class="summary-row"><span>Remaining Amount</span><b>${fmtGoalMoney(remaining)}</b></div>
      <div class="summary-row"><span>Start Date</span><b>${fmtGoalDate(g.startDate)}</b></div>
      <div class="summary-row"><span>Target Date</span><b>${fmtGoalDate(g.targetDate)}</b></div>
      ${g.closedDate ? `<div class="summary-row"><span>Closed Date</span><b>${fmtGoalDate(g.closedDate)}</b></div>` : ''}
      <div class="summary-row"><span>Status</span><b>${g.status === 'completed' ? 'Completed (Achieved)' : (g.status === 'ended' ? 'Ended (Archived)' : 'Active')}</b></div>
    </div>

    <div class="gl-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <h4 style="margin:0;font-size:14.5px;font-weight:700;color:#f5f6f8;">Recent Contributions</h4>
        ${contribs.length > 2 ? `<button class="link-btn" style="padding:0;font-size:12.5px;" onclick="toggleGoalShowAllContribs()">${showAll ? 'View Less' : 'View All'}</button>` : ''}
      </div>
      ${contribs.length === 0
        ? `<p style="font-size:12.5px;color:#8b9099;margin:6px 0 0;">No contributions yet. Tap "Add Money" to log your first one.</p>`
        : listToShow.map(c => `
          <div class="contrib-row">
            <div class="contrib-ic">${goalMethodIcon(c.method)}</div>
            <div class="contrib-info"><b>${escapeGoalHtml(c.method)}</b><span>${fmtGoalDate(c.date)}</span></div>
            <div class="contrib-amt">+ ${fmtGoalMoney(c.amount)}</div>
          </div>`).join('')}
    </div>

    <div class="gl-btn-row">
      <button class="gl-btn-outline" onclick="editGoalOpen('${g.id}')"><i class="ti ti-pencil" style="margin-right:5px;"></i>Edit Goal</button>
      <button class="gl-btn-outline danger" onclick="askDeleteGoal('${g.id}')"><i class="ti ti-trash" style="margin-right:5px;"></i>Delete Goal</button>
    </div>
  `;
}

function toggleGoalShowAllContribs(){
  const body = document.getElementById('goalDetailsBody');
  body.dataset.showAll = body.dataset.showAll === '1' ? '0' : '1';
  renderGoalDetailsBody();
}

// ---- Add Money (contribution) modal ----
function openAddMoneyModal(){
  document.getElementById('contribAmount').value = '';
  document.getElementById('contribMethod').value = '';
  document.getElementById('addMoneyModal').classList.add('active');
}
function closeAddMoneyModal(){
  document.getElementById('addMoneyModal').classList.remove('active');
}
function confirmAddMoney(){
  const g = getGoal(currentGoalId);
  if (!g) return;
  const amt = parseFloat(document.getElementById('contribAmount').value);
  const method = document.getElementById('contribMethod').value.trim() || 'Cash';
  if (!amt || amt <= 0){ if (typeof showNotification === 'function') showNotification('Valid amount daalein', 'warning'); return; }

  g.contributions = g.contributions || [];
  g.contributions.push({ id: uidGoal(), method, date: new Date().toISOString().slice(0,10), amount: amt });
  g.saved = (Number(g.saved) || 0) + amt;
  const wasCompleted = g.status === 'completed';
  if (g.saved >= g.target) g.status = 'completed';
  saveGoalsToStorage();
  closeAddMoneyModal();

  if (g.status === 'completed' && !wasCompleted){
    lastCompletedGoalId = g.id;
    closeGoalDetailsModal();
    openGoalSuccessModal(g);
    renderGoalsList();
    if (typeof sendAppNotification === 'function') sendAppNotification('Goal Achieved 🎉', `Aapne "${g.name}" goal pura kar liya hai!`, 'goal-' + g.id);
  } else {
    renderGoalDetailsBody();
    renderGoalsList();
    if (typeof showNotification === 'function') showNotification('Contribution added ✓', 'success');
  }
}

// ===== AUTO-LINK: expense entries feed matching Goals by Party Name =====
// A goal's "saved" amount = manual "Add Money" contributions + the LIVE sum
// of every expense entry whose Party Name matches the goal's name
// (case-insensitive). This is computed fresh every time (not stored as a
// running total), so it is completely order-independent: it doesn't matter
// whether the goal was created before or after the matching entry, and
// editing/deleting an entry is automatically reflected — nothing to keep
// in sync by hand, nothing that can drift out of sync.

function goalNameKey(name){
  return (name || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' '); // collapse extra spaces so "Food  " === "food"
}

// Entries whose Party Name matches this goal → auto contributions.
// Counts BOTH Payment (expense) and Receive (income) so saving with the
// goal name always adds to the goal progress.
function getAutoContribsForGoal(g){
  const list = (typeof entries !== 'undefined' && Array.isArray(entries)) ? entries : [];
  const key = goalNameKey(g.name);
  if (!key) return [];

  // Date window: from startDate (or very early) through targetDate (or far future).
  // Normalize so "2026-10-5" and "2026-10-05" compare correctly.
  const norm = (d) => (typeof normalizeDate === 'function' ? normalizeDate(d) : String(d || '').slice(0, 10));
  const gStart = g.startDate ? norm(g.startDate) : '1970-01-01';
  const gTarget = g.targetDate ? norm(g.targetDate) : '2099-12-31';

  return list
    .filter(e => {
      if (!e) return false;
      // Skip pure transfers if any
      const t = String(e.type || '').toLowerCase();
      if (t === 'transfer') return false;
      // Party name must match goal name (case/space insensitive)
      if (goalNameKey(e.party) !== key) return false;
      // Date within goal window (inclusive)
      if (e.date) {
        const ed = norm(e.date);
        if (ed < gStart || ed > gTarget) return false;
      }
      return true;
    })
    .map(e => ({
      id: 'auto_' + e.id,
      method: e.method || 'Entry',
      date: e.date,
      amount: Number(e.amount) || 0,
      fromEntryId: e.id,
      auto: true
    }));
}


// Manual contributions only (logged via "Add Money" in Goal Details).
function getManualContribsForGoal(g){
  return (g.contributions || []).filter(c => !c.auto);
}

// Manual + auto-from-entries, newest concerns handled by the caller.
function getAllContribsForGoal(g){
  return [...getManualContribsForGoal(g), ...getAutoContribsForGoal(g)];
}

function computeGoalSaved(g){
  return getAllContribsForGoal(g).reduce((s,c) => s + (Number(c.amount) || 0), 0);
}

// Recomputes + persists every goal's saved amount and status from scratch.
// Call this before any goal-related render, and any time `entries` changes
// (save/update/delete), so the numbers shown are always current.
function syncGoalsWithEntries(){
  if (!Array.isArray(goals) || goals.length === 0) return;
  let changed = false;
  const todayStr = getGoalTodayStr();

  goals.forEach(g => {
    const newSaved = computeGoalSaved(g);
    if (newSaved !== (Number(g.saved) || 0)){ g.saved = newSaved; changed = true; }
    const wasCompleted = g.status === 'completed';
    const isCompleted = g.target > 0 && newSaved >= g.target;
    const isPastDeadline = Boolean(g.targetDate && g.targetDate < todayStr);

    if (isCompleted && !wasCompleted){
      g.status = 'completed';
      if (!g.closedDate) g.closedDate = g.targetDate || todayStr;
      changed = true;
      lastCompletedGoalId = g.id;
      if (typeof sendAppNotification === 'function') sendAppNotification('Goal Achieved 🎉', `Aapne "${g.name}" goal pura kar liya hai!`, 'goal-' + g.id);
    } else if (!isCompleted && wasCompleted){
      if (isPastDeadline) {
        g.status = 'ended';
        if (!g.closedDate) g.closedDate = g.targetDate || todayStr;
      } else {
        g.status = 'active';
        g.closedDate = null;
      }
      changed = true;
    } else if (g.status === 'active' && isPastDeadline){
      g.status = 'ended';
      if (!g.closedDate) g.closedDate = g.targetDate || todayStr;
      changed = true;
    }
  });
  if (changed) saveGoalsToStorage();
}

// ---- Delete ----
let pendingDeleteGoalId = null;
function askDeleteGoal(id){
  closeAllGoalMenus();
  pendingDeleteGoalId = id;
  document.getElementById('deleteGoalModal').classList.add('active');
}
function closeDeleteGoalModal(){
  document.getElementById('deleteGoalModal').classList.remove('active');
}
function confirmDeleteGoal(){
  goals = goals.filter(g => g.id !== pendingDeleteGoalId);
  saveGoalsToStorage();
  closeDeleteGoalModal();
  closeGoalDetailsModal();
  renderGoalsList();
  if (typeof showNotification === 'function') showNotification('Goal deleted', 'success');
}

// ---- Success celebration ----
function openGoalSuccessModal(g){
  const summaryEl = document.getElementById('goalSuccessSummary');
  if (summaryEl){
    summaryEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
        <div class="goal-icon glossy" style="width:44px;height:44px;font-size:20px;${glossVars(g.color)}">${iconBadge(g.icon)}</div>
        <div><div style="font-weight:700;font-size:14.5px;color:#f5f6f8;">${escapeGoalHtml(g.name)}</div><div style="font-size:12px;color:#8b9099;">Target: ${fmtGoalMoney(g.target)}</div></div>
      </div>
      <div style="font-size:12.5px;font-weight:800;color:#3ee08a;margin-bottom:6px;">100% Completed</div>
      <div class="gl-progress-track" style="margin-bottom:0;"><div class="gl-progress-fill" style="width:100%;background:#3ee08a;"></div></div>
    `;
  }
  spawnGoalConfetti();
  document.getElementById('goalSuccessModal').classList.add('active');
}
function closeGoalSuccessModal(){
  document.getElementById('goalSuccessModal').classList.remove('active');
}
function spawnGoalConfetti(){
  const stage = document.getElementById('goalConfettiStage');
  if (!stage) return;
  stage.querySelectorAll('.success-confetti').forEach(n => n.remove());
  const palette = ['#5b9bf5','#3ee08a','#F5B301','#EC4899','#8B5CF6','#0E9488'];
  for (let i = 0; i < 18; i++){
    const el = document.createElement('div');
    el.className = 'success-confetti';
    const angle = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 40;
    el.style.setProperty('--tx', Math.cos(angle)*dist + 'px');
    el.style.setProperty('--ty', Math.sin(angle)*dist + 'px');
    el.style.setProperty('--rot', (Math.random()*360) + 'deg');
    el.style.background = palette[i % palette.length];
    el.style.left = '71px'; el.style.top = '71px';
    el.style.animationDelay = (Math.random()*0.15) + 's';
    stage.appendChild(el);
  }
}
function viewGoalFromSuccess(){
  closeGoalSuccessModal();
  openGoalDetailsModal(lastCompletedGoalId || currentGoalId);
}

// ---- Alerts: active goal ending soon or ended ----
function checkGoalAlerts(){
  const alertsArea = document.getElementById('goalAlertsArea');
  if (!alertsArea) return;
  let notifiedMap = {};
  try { notifiedMap = JSON.parse(localStorage.getItem('notifiedGoalDeadlines') || '{}'); } catch(e){}

  const today = new Date(); today.setHours(0,0,0,0);
  let bannerHtml = '';
  let changed = false;

  goals.forEach(g => {
    if (g.status === 'completed') return;
    const target = new Date(g.targetDate + 'T00:00:00');
    if (isNaN(target)) return;

    const diffDays = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
    const remaining = Math.max(0, g.target - g.saved);

    // If active and ending soon (0 to 3 days)
    if (g.status === 'active' && diffDays >= 0 && diffDays <= 3){
      const dayText = diffDays === 0 ? 'aaj hai' : `${diffDays} din baaki hain`;
      bannerHtml += `<div class="goal-alert-banner"><span class="baIcon">⏰</span><span>"<b>${escapeGoalHtml(g.name)}</b>" ki target date ${dayText} — ${fmtGoalMoney(remaining)} abhi baaki hai.</span></div>`;
    }

    // One-time notification when goal ends
    if (g.status === 'ended'){
      const key = 'ended-' + g.id + '-' + g.targetDate;
      if (!notifiedMap[key]){
        if (typeof sendAppNotification === 'function') sendAppNotification('Goal Ended 🏁', `"${g.name}" ki target date poori ho gayi hai aur yeh Goal History me save ho gaya hai.`, 'goal-ended-' + g.id);
        notifiedMap[key] = true;
        changed = true;
      }
    }
  });

  alertsArea.innerHTML = bannerHtml;
  if (changed) { try { localStorage.setItem('notifiedGoalDeadlines', JSON.stringify(notifiedMap)); } catch(e){} }
}

// ---------------------------------------------------------------------------
// Init — runs once when index.html loads. The bottom-nav Goals tab (goTo())
// also calls loadGoals() + renderGoalsList() again every time it opens, so
// the list always reflects the latest saved data.
// ---------------------------------------------------------------------------

// Real background photos for the home-screen carousel goal cards,
// reused from the earlier per-category artwork — keyed to match the
// goal ICON_META keys (food/medicine/auto) where a photo exists; other
// icons fall back to the goal's own glossy gradient. "entry" powers the
// latest-transaction carousel card. See rtBuildGoalCards() below.
const RT_CARD_BACKGROUNDS = {
  Food: "data:image/jpeg;base64,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",
  Medicine: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHCAkIBgoJCAkMCwoMDxoRDw4ODx8WGBMaJSEnJiQhJCMpLjsyKSw4LCMkM0Y0OD0/QkNCKDFITUhATTtBQj//2wBDAQsMDA8NDx4RER4/KiQqPz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz//wAARCAF7AeADASIAAhEBAxEB/8QAGwABAAIDAQEAAAAAAAAAAAAAAAMEAQIFBgf/xAA+EAACAgEBBgMECQMDBAIDAAAAAQIDEQQFEiExQVETYXEGIjKBFCNCUpGhscHRM2LhJDRyFUNT8IKSRGPx/8QAGwEBAAIDAQEAAAAAAAAAAAAAAAMEAgUGAQf/xAAyEQACAgIBAgQDCAIDAQEAAAAAAQIDBBExEiEFE0FRImFxBjKBkaGx0fAUwTNCUuHx/9oADAMBAAIRAxEAPwDuY4jA6g2pygwMAADAwAAMAAAxgYMgAxgzgAAxgzgAAYGAABgAAAYAAMYM4AAGAAAMDAAAwMAADAwAAMDAAAwMAADAAAAwAAYM4AAGDGDIAGBgAAYGAABgYAAGBgAAYGAABgAADAwAAMGMGQAMGGjIAAHUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMBgADqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAwB1AAABhvBq5pAG4NFNGyaYBkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMBgA1nLdRsyDcnqdQqa+GeLfZdwepNvSIpWTss3KYSnLtFEq2brZrMnXDylL+D0+zNkRhSuHh1v8A+0/NnS0tNMZWV+DBTrlzazlPk+JDK7XBsK8Na+I8JPZ+urWUoWeUZcfzIoXyjY4WRcZLnGSw0fR5U1SWJVQf/wAUcramwtPraWoe5Yvhfb0/gRu/9CzC7bgzzMJKSNipCNum1Vmm1C3bK3hr9GWyY17TT0wAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMBgCXU6ns1o42ynbNZTeX6LkvxyctnqPZatPZzS577T/9+ZFa9RLeHFStOqV7/qr67/s/BP0fJ/J/qWrIbksEdkI2VyhNZjJYZVTNu1o2BDpZylTuzf1lb3JebXX5rDJgDy/tjpFF6XXwWJb3hWeafGP5p/icmPwo9N7UpS2FNdfFrx67yPMrgi1U9wNRmRSt7eqMgAlKgAAAAAAAAAAGQADVySI5WpAE2TGUVLNTGCzKSS82V/8AqNOcbz/BmLnFcsPSOoCtp9TC34ZJlkyTT4AAAAAAAAAAAAAAAAAAAAAAAAAMN4DeEVb71HqegsOaRjxEcmetWeBota88mZquTMHNI7akmbHJq1sXzeH5l2q9S6mLi1yZJplkGE8mTE9AAAAAfBADJo5pdSC67D3Yptvkl1JK9nau7jY40p9JcX+A7LkyjCU/uoz4q7mymmbPYdzWY6hv1reCrfo9XpE5Sj4kFzlDjj1QTi+GZSpsittFtMFWi9TS4lpPKBGAwGAHzPQey+pULLdO3ze/Hz6P9jz75m9Ns6bo21S3ZxeUzCceqOiamzyrFI+h2w34ZXNcitxTw+ZU2XtinUxUZNQs6wb/AEOo51yXHHzKPeHZm+Uo2rqizmz+q1cZ/Zt9yX/Lp+6/Askd9SuqnBcM8n2fRnN1e2a6KEoJT1LjxinlQfm/2M0nLginOMFuTKvtLqIy8LSxeWn4k/Lt/JwjayydtkrLJOU5PLb6mpchHpjo0t1nmzcgADIiAAAAAAAyHwIbLMAEkppEM7Uupc0mx9frsONfhVP7dvD8FzZ39D7OaLTNTvzqbF1n8K+X8kcrIxLNeNOffWjxN2rhD4pcexRt1s5fAt3zZ6n292aktPtGmCSS8G1JY/4v9V+B4wqWXzfZdivkRlVNwMyblLMm2+7MGTBWb2VTauyVc1ODxJHodHetRp42Lg+TXZnArpttU3VXOe4t6W7HOF3OlsNt13LplNFjGm1Lp9ySG0dUAGwJQYbSRlvCK78S+5U0rMn+CXdgJN9kZsvUepD9Jzy4nc0WxoKDslFT3fiss+FeiO3XsiMViVv/ANY8CN2xRdhhykttnioalN4yTwmpdT1Op2DRfFpuMn/dH90eb2lsq/ZkvEw5UdXz3fn2PY2Rl2I7MWda3yjANKp70TczKwAAAAAAAABpa8QbKK03jS3rW93pFdfU6E1mDRd8CtbE8TcW+1vb3XmS1tJ7ZhJOW0vqciOnpisKqP4GJ6Sia41R+XAmBbKZzb9m4WaJf/GX8lSu2yie7LKxzTOtqbJLdqrf1tnBP7q6s1u0dVlEa0t1wWIy6o8aT7M9UmjbS6hTiuJcTyjgUynptQ4T4NPiduie9BFScOlluEupEoAIzMEV892DJRRV42upg1lZzjvgcHsY9TSOjsXZMpPxJJeK/ik/sLsvM77oq0kYWQinGMsWOSy8Phn5Ms0UqimNa6c33ZtOKnCUZLMZLDRSlNyZva641x0jbkRW01XLFkE/Pqvma6ST8J1zeZ1Pcb79n81gnMeCTk8V7RbG+gP6bplmlv6yKXw+ZTpnvQTPe3Uw1FFlFqzXZFxkvJnz7TVyplZTP4qpyg/k8FqqbktP0NVmVKElKPqWAwCUpB8wGAAWK9dq644r1NkV23iuDxpPk9UnHhk1ur1NyxbfZNdnLgQgHqWuA23yAADwAyk3yN5ae5Vue41FdXF4IpXVwemy5TgZN0eqEO399yMFa6dtLzOPu/eXFCrUKa5kkZRktxeyC2mymXTZFp/MsgwnkyekRrJSlKMIJylJ4SXVnq9l7Ho0UIztjGzUvi5NZUfJfycfYNSs2vXKSzuRlJev/rPWFe2T30o2WHUtdbAAIDYFbaGjhtDZ9+kt+G2Djns+j+TwfI7a50XWU3R3bK5OMl2a4M+yni/ar2ev1O2YarSRjGvUR+tlJ4UZLhn5rH4EU16lDOodkVKK7o8WWtHoNVrp401UpLrLlFfM9LTsPZ2zqvH2hbGeOtj3Y/JdTazbTlHw9mabMVwVlq3YL0jzf5GCi29I16x1HvY9fIk01dHs5sqdts1K2Ty8fbljhFeRydmaeVGkzYsWWPeku3kSeBO7ULUay532r4crEY+iLBdppcX1SFklLSS0kAAWjA0teIM6/s7s7xK/FsXx+9N+XRfucbU/0Jeh7jZlSr0FaiviWeH4L8iK2Wol3DgpTbfoWN2Ph7m6tzGMdMEOlbjGVE3mVTwn3j0f/vYsFbU/VThqFyh7s/OL/jn+JVRtSyaW1wurlXZFShJYafU3AB4HVaR7P2ndpG24xxKDfWL5fx8jJ1/autLW6O1LjKE4P5NNfqzkF2EuqKZo74KFjigADIhAAAAAAD5HS2e46jZ9mnbw1mPyfI5ptTbLT3q2HHpJd0ZLutBPpe3wQzhKucoTWJReGiOyca65Tm8RistnY2hCjUaT6VXJKUV+Pk/M4Ev9RqNznVU8y/ul0Xy5lyE+pbKltfRLXobaaEnvX2rFlnR/Zj0ROAZEZR2pTvVK5L3ocH6E+zpOVKb7G2qx9Euzy3H+hjZtbjpYt82iC7hE9JcABWLALeyMf9Y02eTbX5FQ3psdN9dsfihJSXyPJLa0Z1y6Zpnv/CXhby54yREujvhfRGcHmMllehrZW4vKWUa9PvpnRNJpNFS36rVQt+zZ9XP1+y/2+ZYNLq1bVKuXKSx6GunsdtKcvji92a81zMiMlPDatJ7U1s48pXzf5nsddqo6PSTulzSxFd5dDxXHOW8t8W/MnpXLKGdJaUQACwa0o6jbNVm0r5RoVemlP6tR5pef6lyuyFsFOuSlF9UeZl8T9Tem+yie9VLD6rozSU584PVndH0LP+zlN0erH+GX6P8Ag9KClpNoV6hqEvcsfTo/Qum4rsjZHqi9o4XJxbsWzy7o6YABmVwbQhKc1GKy28JI1OrsimP1l8se7wT7d2V8ixwjpcs2vhmKsi1ymvhj+vsiaqinQ1eJc059+fyRW1G0ZW1yrhBRjJYbby8EGrveovc/srhFdkQmpbO3hUuzlyYlFSTUuTOTfW6Ld6PBZxJfudcp6uClNp/aiS02OueyPNxI5dEq2u/p9TFE95Fg5+jk3FZL65G6Z83L2yNRHTbSqnN4i8xk+2T2CWeB4I7WzNuPTwjXqU5xjwjNcWl59yvbBvui/i3xh8EuD0m7LPJmVXJ8+BTW29C45+kRXk08lLWe0dUU46WDsl958F/LIFGb9DYSupituR3MQrWZPl3OHtza1E9Fbp9Lb9e/gnGKkoPv2OFq9fqtW/r7W4/cXBfgViWNC/7FK3O2nGCK600ZW+LfOd9v37Xl/LsT4MgsRiorSNaAAegAAAxKKlFxfJrB7b2evV2ydPJ/EobsvVcGeKOvsDaC0lzpteK7HlP7siG6PVHsXMO1V2d+GepujieejI2k001lPg0WoyjbHDwaSo4cJfiVFL3N0477oo6VuKlRJ5lU8Lzj0/j5Fgr6n6uUNQvscJ+cXz/Dma6/XVaGjfm1KbXuQT4y/wAGet8ELkorbOH7S2qzX1Vr/tQefWX+Ecg3tsndbO2x5nN5bNC5GPTFI0ds/Mm5AAGRGACbT6a7UPFUJSxzxy/EwnZGC3IsUY1uRLprRCC7ds3UUVOyyC3VzalnBTlHHIihk1yeuC5b4Tk1Q69Jpez2YABYNWRWwk4S3GlLHDJHVUqa1BdOb7ssjBNG1rsyKVSfBCCXdRhRXYk85EfksinV40NyXwP4vNdiZLCwjIIJScnsnjFRWkAAYGQAAB09k7VloX4c8ypbzhc4vyPVaXaGn1ME67Iz9Hx/A8EE8PK4MhnSpdy5TmTqXTyj6DdJSawuXU5Wp12n0WosnKyMt+OXXB5e8v5X6HlXZY1hzm15yZr6GMadcslnnOXCLe0Ndbrrt+z3YR+CC5L/ACVACdJJaRQlJye2AwD0xPLy5v1MG90J1WyhZFxnF8YtYaNDkj7Un2B3tnah36b3nmcHuy8+zOCdTYieb3091fPiXsCbjcorhnP/AGjohZgub5jrX4vR1QAb8+amVyeHh44ECt2hTFxcKr4PnuScG/k+H5k8eaJDWZj+NfQ7L7PxSx5P3f8ApFP/AKhVB41ELdO//wBkOH4rKLVdldsd6qyNi7xeTOCvZodNZLelTFT+9D3X+KKZ0JZKuof10fRGPo2or/oayePu2pTX48yK2b4zm02lxa5ZPV3ekepqCcnwiHR91yyzoR5FPSQ3Youo3x8sk9tsAAHgAAAAAABvVVZdaq6oOc3ySOrV7O3zjm6+Fb7Jbxi5KPJJCqdn3UcfIOpqPZ3V1wctPdC7H2Wt1v8AY4spTqslXbGUJx4OMlhoKSlwJ1Tr+8iYGkZpm+TIjAAAL+j2tqtIlGMlOtfZn09GdNe0vuYnp5Z8pnnQRuuL7tFiGTbBaTOzqPaC6cHGmmFaaxmXvP8Ag5Flk7ZudknKT6tmoMoxUeCOds7PvMAAyIwAdTRbKnNQvvbjGL3lXy3+HXyIbblWvmXsTCnky3xH1f8AfU02ds2WpastzGn85ehe1e0KtJHwNJGLlHh/bH+WVdVteGorlXoZ/VpuEprg8rg0uxzzVzsc3tnZ4uFCqCilpe38lm3Xam6uULLW4y5rCRWAIjYKKj2SK8pbtzg+T4o3INS83xx0x+5NF5SNxjzc602cH4vRGjLkocPT/MyACc1QAAABjKMgAAAAAAAAAAAAAA1lNIA2BA7VnmVr9p11e7WvEn5cl8yOy2Fa3J6LWNiX5U+imO2dnxNmbbXg3x8PUx4bsvdsj6Pqis/ZSG+8auaj5wXAh1Glp1CStgm1yfVfMgehzHcep1Dh912cDWWYU99lv9DrMbx2jo7ycH7a2vwOK4vxHCPvPOFu9TvaHT/RtMoP4296XqZ0+kp0/wDThh93xZYLGLieS+qXJrfGfG/86KpqWofPlgAF85synjiSERvF8CllVOSUl6HReCZkKZOqx6T4+psDGTSdkYeb7I1p2C78GL7Nyt4+J8Ec+z3pKtesje25zn7uJT8uSN6KccXxb5svYtD31yOe8Z8ShCt41T23y/ZexLVHEUSmFwQckjYnHGQaeIjKmmAbAZAAAMrGVnlkBHrNj6KOk0cZNfXWLMn27I6BtGClXlP0NSg31PZ0MYKEUkCntDZul2hXu6iHvJe7ZHhKPzLgC7cBpNaZ4XaWydXsxucvrdP0tiuXquhVhamuZ9CnKEK5ysajXFNycuSXXJ8t1m0qrtp326alVaaU/q4R4cO/z54JP8qMNKbIY+E3ZClKhb16fwdVSTNihRqIzWU8luE0y0mmto084ShJxktNEgCB6YAAAAJZBf2PXGzaEN5ZUU5Y80RXT8uGy5hY6yLlB8cv8C7oNnQoh9J1eE4rKT5R835lbaG0JaluurMafzl6mdsaidmrlTlqut4x3fVlA1EpOT7nd42PGEU9fRexTvrnRc9Vp4uWf61a+2u6/uX5lmqyFtUbK5KUJLKa6m5RsT0Nsr4pvTTebYr7D+8vLuvmYF3kvEdligu7fJGLrVDhHjL9Ck5Ocnh57skrrlY9RK2Tk1YlfmWv6L1Zuszsy/mWY8iOuGESm4rgq4qKPn2XkyyrpWy9QAazeI5MyqYnNRKs9Uk8Z49ixptJPWS35txpz05yOrTo6ao4rgoryX7mlzfGqMWThFdUl+X5m4xPCLciPXJ9K/X8jz71LXNNLzRLXqFLqd50xxzZQ1Oz6bXLdShNfah09UU6ftFXKWrYaXunstW+AzUd1T2/ZrRDGSaNimvE09/hXc+aa5Nd0W4vKOkhONkVOD2mc/OEq5OMlpoyADIxAAABhvBiUsIirhdqblVpq5WWPpFf+4B6k2+wnbgq6i2denV8oS8KUt1SxwbxnGT1ezfZmEGrdoyVs+aqi/dXq+p1tp7Op2hsuzRTioQkvcaXwSXJorW2tJ9HJtMTEi7Iu/7vrrk+V26iy3Kb3Y9kRJEmops02osovju21ScZLs0aLmc/Oc5y3N9z6dj0U0VqNKSXyPUPmADqT44AAAAAAAAAayipLr8mQy00Zc5Sa7NlgHnTHe9EqutUelSevbZHCmEFwRJyBrN4R6RGlliiildq1HqR6zUNPC5mtGgdi39Q2s/ZXMmhX1d2Rzn0kb1vHhk2hrlnjlFmqqqGpnV4cMbqlHh8n+xPPT0zWJVR/Am8qJD5rMUahTxxLSeUcuzSSpe/pm2lzg/2LmjuVtaaZXnDpJ4TUiyACMzPXbC2hHUaWNU5fW1rDT6rozpzh1ieArsnVNTrk4yXJp8j0Ozdv8q9Zw6KxcvmVJ1NPcTbY+XGSUJ8naBInXdBSi00+TRztt6+OyNl26ua3nH3a4/ek+S9CFySW2bCFcpyUY92zzftxtjdgtlaeXvSSlqGui6R+fN/I8UbWW2X3Tuum522ScpyfVs1NPZY7JbO7xMaONUq1+P1NoTlCWYvDOhpdapNRn7svyZzQS0ZM6X249irn+FY+fH41qXuuf8A6ekrmmSnL2fe5wxJ5lHgdOPI6GuasgpL1PmOVjzxbpUz5RkAGZWBJVOUJZhJxknlNPiRmVzIbq/Mg0XvD8lYuQrHxw/oSyk5ScpNuTeW31MEatjvbreGZdkEuMkadpp6Z9CrlGyKlB7TNyvdfupxg+PWXY1uvzHEXiPV9yqlKx8sR7E1VMrX8ipm59WDDcu8vRfz8hl2PEfh6vuWaq8IzXXhEqWDawhGtaicJlZVuVY7LHthLAAMyqDEaXfbGvOIvjJ+RkvbKgpajj1lFfmUfELpUY05w54X49i5g0xuyIwlx/Hc7mj01em0ylOKXDL4cl2OfNxc5OKxFvgux0NpyapjFcpS4nNOCzGotVr0O4pTa6maXWKquU3xxyXd9Ea0VOFfv8Zye9J+Zp/W1X9lL/GX+CyVH2Wiw+y0c3amm39O3Fe/D3ofuvwKWmlvVJ9zt3LMGcPSx3aUuiOw+zt0p1TqfC01+O/4OV8eqipwsXL2n+H/AOk4AOmOdAfBAxLkAT7M2fPaercMuNMONk1+i8z2Gk0lGjp8LTVKEeuOb9X1KPs3Sq9jVyS962Upt/PC/Q6pUsk29G5xqowgn6sAAiLJ43262VmEdqUR4xxC9Lt0l+34HjEfY7KIaiqdNsFOuyLjOL5NPmePnsfZ/s/OU9XYpyTzCVnVdMLqyhkU/F1I6fwzxDVPlTW2uP78ioADfnzYAHoNkbCdiV+shiL4xrfXzf8ABjKSitskqqnbLpicBJvkm/RGD6DHSxhDdhuxS6JYRzdfsyjWVv3VC77NiXXz7ohV6bLk8CUV2fc8gDe6qyi6VV0d2cXho0LBr2mnpgAAAi1DxWyUivWangA52jq8XUTtmsqDxH1OgWPZrTVXKSuipYTlh984Nto0x0+unXBYhwcV5MuQmt9BWnXLp8z02c3U+5ZTd92W7L0lw/XBYNL6/FonX95YXr0MaezxaIWdZLivPqSkJIQwh4eszH4bFnHn1JjMY5nF9iOxfCzOt6kSgApFwAAAuaHaOo0UvqpZh1hLl/gl1ntFG7VOvXUeHpGsQs+KPnvLpxOcYaymmsp9CvdQrF27M2OFnyxZ7kupf3gbR9na7Y+PsyUVlZ8PPuv/AIs81bXOmyVdsJQnHnGSw0ego+kaCTls+S8N8Zaeb9x+n3WX/H2ZtqPgaqHhamPDcse7OPo+qNLdjyg9Na/Y7zC8UhdHcX1L9V9V/fqeNB6p+ylW88auxR84LgeXlBq11w997zit3jvcehWcHHk29d9dm+l8FzZUXKyeOSwdpciroNN9HpxL43xkWzo8WDrpjF8ny/xfJhk5s7IcfwtAAFg1YAABpbWpxw+fcquq1P42XRgxcYvlE1eRbUtQk19GVIUPOZNt+ZYjBI3wDLgjlKUnuT2AADEAAAFrZ9nh6hfJr5FUym1JNcGuRVzKP8miVXv+/oWMW7yLo2ex6zXRjbo/Ei+EfeRxdRY66/c4zk92K8xTqfFr3d5rH2cmlX11zu+xH3Yfuz59l9XmtWR01yd7jOEq+qL2iWitVVRguOOb7slMGHLCKfdslbItVPconLy4HKhHdil2LOqv8WW7H4F+bIDvPBcKWLQ5TWpS/b0OM8Xy45FqjDiP7+oABuzUAAAHp/Z2+M9m+Dn3qZNY8nxX7nWPE6PVWaPUK2p8eTT5Ndj1Gi21o7Y+/NVSfOM+H5lSyDT2jb418ZRUZPTReSb5IkjX1kVrNq6OuOZaiv5Sz+hw9o+0Flua9HmEfvtcfkuhhGEpcIsTuqqW29nc1+09NoYYnLM+kI8WzyO1dY9p6mu22qEXUmq+GWk+fH5FaTcpOUm5SfFtvLZgsQpjHnuay3Msn2i9IPmZjGU5KME5SbwkubN6abNRdGqmDnOT4JHrtlbFq0le/diy6S4y6LyRlZYoIjox5XPtwV9i7DVO7qNWlK3nGPNR/wAnastUfdhzIbNUvGdCzF4yn95dcGCm25vcjdQjCqPTAy5Nvi2YAPRs5HtDpFbo1qIr62rr3XY8wnlZR7Da1sYaTcb4yeceS4s8bV8C9CzS306NXmxSkmvU3ABMUQYayjIAM7Lt+ha5OXCttp+j/hnX2vo5aiEbqVvTgsNLqjjSSa4l7Q7Slp4qq5Oda5Nc0Z921KPKPYuOnCfDOY8p4aw10ZBp/cuvq6KW/H0l/nJ3tpavR6jSNV+9a2se7ho4NicdXVYlwknCX6r9C3CTkttaKdkFCWk9k5vBdTEY55khDbNa0jOqDXdgAFcsAAAAAAAh1Gmp1MUroKWOT6r5kwMZRUlpokrsnVJSg9NexSehW7ufSNRufd8R4JdPpadP/Tgk+74ssAjhRVB7jHuW7vEsu+HRZY2gACYoAB8DRzSANxkglakQvV1p4dkU/U8bS5BdBDVdGa4NP0ZMegAAAAAAAxKSissjc3jO7LHfDAS2SghjanyZIpJgGybTynhk9eqnXFR3YtLl0IAVr8SjJWrYplinKuo/45NFp62WPgX4kFl1lvCT4dkaAhp8OxKJdVcFv8/3Jbc/Juj0zn2/vsAAXykADWUlFAG2TGStO9LqRfSo55o90C/kFSOoT6k0bEzwEoCeQAAAAe62Zs2nQU+7xm1703zZPZY5cFyM3yzhJ8CI13L2zpNKC6Y8Ed1SthjLjJcYyXNPuaUWuTddqUbYfEl1815E5DfS7N2db3bYfDL9n5GSMSYr6rVQ00ePGb5RINRr/CqSUMXNcYv7PqeX120ZWWShTNyk/is/gzjByZDZbGtbZPtTXO2Uob29ZLhJrlFdijFYRHXDCJS3GKitI1FtjsltgAHpEAAAAAAYwhgyD3bPNIAA8PQAWdHpJamfDhFc5diOy2Na2y3iYlmVPpjwuX7FfDfQ0nLcXvcDuuGi0mFNJy8/ef4HM1Mq7L5uuG7B8lgpf5kk+DoI+BUzjpSe/ftr8v8A6U1bF9TdNMq6qh1y3quvHHcae7fS4l2q2Nsdo0Obg2YVnTPh8P3LYMJ5MkhSAAbwADWUkjSdmEaUVajWXeDpapWT7LkvV9BwZKLb0hO3HUp6jWRhwby+yJfaHQ6zZVtNd0ouNsMqcOWeq+XD8ThlWzIS7RMLG630tdyW7UWXPi8R7IiBkpyk5PbIG2zeq2dM1KuWH+p39HqI6mhTXBrhJdmeehCdk1GuMpSfJRWWzobFbjqba3lZjlp9Gn/kmx5tS6fRmcG0dkAGwJQb1VzutjVXHenJ4SNDs+zVSnq7bGsuuGF8zGUulbJKoeZNROnoNkafSxUpwjbd1nJZx6I6PTHQNNcwUm2+7N5GEYLUUcvaWxNJrouUYqi/pZBfqup5PXaLV7Ns3dTD3G/dsjxjL5/sfQDWyuFtcq7YRnCXBxkspkkLHEhtxoWd+GfPYWprmTKWS/t3YVeh09ut0tqhTDjKqb5f8X+xxKb1JLiWYzUuDVWVSrl0yLoNIzybmREAAAGUr5ylNQgsyfJFx8UTbP0Mr9+UMb3Vvt0RFdb5Ud+pf8PxP8q7pfaK7v6HPr0LazPEn5/wSfRGlwUPwLjWG0+gNTKycnts76mimiPTXFJHOs0+78daXmiPcnDjBuS7PmdQpQ/1FlzqilXCW7GWfja5/Lp+JlC+cOGRZGBi5S1OGn7rsxTcpFhPKKU4PLklia5ruWKLN6KNpVarY7Rw/iGBZg29Mu6fD9yYAMlNee8Rk4ey9swcFTrJYmuEZvr6+Z1Xq9MlnxofiUXFp6ZvoWRmtonObr9oKqMoUyWV8U2+ESDaG04+E1CXh1dZPm/JHl9VqbNXLdw41J8I9/NkkK2yK69Vr5m+s1stS3XS2q38Uus/8EVdeEZhXglLKSXBqZzc3thAA9MA3gljo9bZHeq0l0o9909JsnZcNNVG26KlqJLPHjueS8zqEErtPsbCrC2tzZ8/uV2nlu31Tqb5KcWjEbEz311Vd9TquhGyD5xkso8vtT2ctpzds1uyHN0t+8vR9T2NqfZmNuHKPePc5ieTJUha1JxkmpJ4aaw0WIzTJilo3ATAPAAADeqt2WRhHjKTwjsaiyOg0ka6vjfCL/VnC+lz0mohNUWyiuO/CO8l5NczeW06dbdvePDfxjcfutfJmovs6rH8juvDMTy8aHz7v8eP0JG222223zbABXNwRahZpb7PJzV9XqWlyl7yOnd/Rl6HNt/3Ffo/1LeHJqzXuajxypTwnJ8xa/gvVvgbkdXIkNocICKcm5KMU3JvCSWWzebxE9P7P7Njp9NHVWxzqLVlZ+xHokYTmorZNTU7ZaRy9nezl1+LNfJ01/8Ajj8T9ex6bTaajSUqrTVRrgukVz9e5MCrKblybeumFa+E5u3tmR2tsqzTPCtXvVSf2ZLl+PI+VzjKuyULIuM4txlF801zR9mPC+3OyfC1Edp0R+rtajcl0l0fz/UhmvUp59HXHzFyv2PJAvbO2VqtoS+phu19bJcIr+T0tOi2bsKpXaialc+U5LMm/wC2JEayuiU+77Ir+zWzLNIrNbql4cpQxCMuDjHm2+xTonHVbU1uvgsV2zxDzXf8ifW6rU7UXhyi9No2+MM+/Z69l5G0IRhCMIJRjFYSRboqe+pk03HpUI8I2ABdIwdj2bvjVr5Vyf8AVjw9Vx/k45mMpQkpRbUovKa6GMo9S0SVT8ual7H0GxbyTREcvZe3K7VGrVNQs5Z6S/g7MoqazEotOL0zfRnG1dUGRAy04vicH2q2x/0vZrjTL/VXpxr/ALV1l8v1DekYzmq4uUvQ837abY+maz6Bp5Z0+nfvtfbn/C5fiecqunU/dfDsRgh6mntHN22ysm5s62m1cZ8M4fZnQrnlHmU8PKOhodW95QseW+TLlWR1dpHsZ77M7YNK5ZRuWjMHV2NJfWR9GcosaK/wL1J8uvoVcqLcNr0N14PbGFzg/wDsv1FsXC6cXzUmaHT2hpvFitRT73D3kuq7nJushTVKyx4hBZbNW+x2sJdSINXZN7unpeLbftL7Eesv2XmyequFVUa61uwisJEOjrn719yxddxa+5HpH5fq2WTwkIdRXvQ3l8S/NFOt7l+Oklk6Rz7I41cYro3+xaxJNWpe5qfGq42YUm+YtNfnr/ZbXIBcgzanBCSzlGm/qIcIXzS7ZybvmBo9UmuGQuM7Jb1k5TfeTybxhg3ADbfIAAPAWtmQVm09NCSynYs/qVSXTWujVVXLj4clLB4+DKDSkmz3Li0svkzBvVOF1EZQknGSymuxpJOLwygjomvVAAAxObtXZGj18JWXfU2xWfGjwaXn3R4GrUwc5RhPfSbSeMZXfB6L232x4VK2Zp5fWWLeua6R6R+f6ep4ZNp5TPVc4PXoafNtj5nTFccno67U0TJ5ODp9Y4vFnLudSm5SSaeUXIWRmuxVTT4LYMReUZMwSR+FGltNV0cW1wmv7o5N4cYmTRWLU2mfSsWSlRCS9l+xUWghD/b23UeUJ5X4PKH+ur5Sp1C804S/gtgxLOynK+c65RsonU+HxNNP0aK7W9dHyX6ljUTUrMZ92PX9SOiOW5Nc3kuYcNz6vY0f2gvUMZVesn+iLMFhGxhLCMmzOIMNKWE+TfE99hJYXJcEeC6HsNl6yOs0UJZ+sglGa8+5BcuGbDBkk3Eug2UG1lGyq+8yttGz02RpNvgL9HTqdNZRqoKyqxYlF8jOo1VGjqc7ZxjHz6nm9obfuvzDS5qh977T/g9jCU+CO22upfF+RS2prdRpdVZoNFQq3V7runH3Vwyt1dTmQoStd1spXXy52TeX/gmbbbbbbfNsFmFMYd+WaSyxzfyAA5ExGARysSInqF3PTwsgrq9PqSxmmeHpudLZ2179HiMm7Kvut8V6M5oPJRUlpmcLJVvcWe3o2npL9LK7xYxhFZnvvG76nifafZer12us11MnamklS+cIrou/f5mk4RsrlCcVKMlhp8mNNqdXs7CqzqdKv+zJ+9D/AIv9mUraZLvHgtWZKvj0WI8u002mmmuDT6GD2d2l2bt+mVtUty+PBySxOL7SR53W7H1ujk96p2Q6WVrK/wAFUo2Y8od13Rzhlp5XNcSSyq2uMZWVzhGXwuUWsmKq5W2Rrgvem8IL5EGmmej0/GuL7rJKYjFRiorklgybhFgDkAGtnqbT2i9o9fKiO6478eizyOVOX03XNf8AYolmWOUrO3ov19CfJmO7FYUUlnPDga+3FfMPyOpwPGoJdORz7/ySA1Ul3G8u5U8qz/yzerOxWt+YvzRllSteJfO7Hu8o+a7liUsrC5dTUvY1Dg+qXJzXi/icL4+TS9r1fuZADLpzoAAABvVXK2ajBNt8kjpVbL4Zsmk+0Vn8ytZkRg9Luza43hdt8euT6U/f1/A5QJ9VRGF064yyovhJHNunZRN7/GPcV5MJvXDMsrwjIx4eYvij8v4LYIq7VJEpZNQdLZe1rNFiuSc6c8usfQ9VpNXp9bVvVTUu66o8GSUX2UWqymbhJdUQzqUu65LtGXKv4Zd0e8nW1y4o5219o1bL2dZqreLjwhH70nyRBs3b0LcV6vFc+Sl9l/wczbcdH7Sw/wBPqeGnk1FxfBPk8x+RUnuHZl+d0ZVuVb7ng9RfZqdRZffJztsk5Sl3ZGW9fs/U6Czd1EMRfwzXGMvmVSA5ySkn8XJglovlTLMXldURA9TcXtHibR6HTWqyCafBlo5myMun0bR0zawl1RTLG9rZtF4ZvkiNJqec1zcX2xlMq343W+qPJ0Hhvi6xoeVatx9PkWCC63CcYfF1fYik9Q+DcceRqqZN+++HZFeOJY337G3s8dxYR3Dcn7cEaTm8L4f1LUI7qEYKKNzYwgq49KORysqzLtdtj7/sAAZlYE2m1NultVlM3GX5P1IQGtnqbT2j0NHtHiCV1Dz3g+H5muo9pJSg1p6XF95vl8kcAEflQ9iz/l3a1skvvt1Fjsum5y7voRgEnBWbbe2AADwEN9qri22TPkc2yH0rUuMn9VD4vN9jOEep6MZS6Vsryuv1E2qINruaz0uojHfnYkvU6sYxjFRikorkkQ6v/bv1j+qLagkVXNtlCVGrq443kuzyS6bV5e7Lgzo9ytqtIrlvQxG1cn38meSrUj2NjXJbqnvIkOfs+1yjiXBrg12Z0Cm1p6LSewADw9IbKFKxXVTlTfH4bIcH8+6J69s7Q0/u6nSx1GP+5U91v1RgEM6Yz7mUZyj91lTa+t1O16aqIaOVUIT325y5vGP3MaHQx0q3pPetaxnovQuA8hRGD2YyblLqlyAATgAGMoAyDXeRsAAAAAAAAAwAzKWWY6kmluqr1kN+UW4+84ZWfXBDfZ5cG0bDw3G/ychRfC7v8Dr0116DSOyxfWPn69kc67UW3ybnJ46RXJEmu1P0i1bqarjyT/UrGnbO8qr0tvkEGqinWm1nHB+aZOR3/wBGR4Tru9HMpbrudeeCfD0OhB5RzruGqg+8f3L9XI3lcuuCkz5xn0rHyp1x4TJAAZlMEM6Grlfp7JUXr7cOvk11RMDGUVJaYJ6Nq12x+i7XqhW58N/Gap/wyntH2Zabs2dJOL4+FN/ozecIzi4zipRfNNEVL1uh4aHUfVf+G33or07FOeO13j3JnZGa1Yt/P1OXZsfaFVVlk9LNQrW9J5XBdzn8+R6fUbQ2rqdPOh1UVqyLjKUW84fMq6PZ0NPJTse/YuXZEcaZyfBXnCG10Eugoen0sIyWJvjJebLIBsYrpWkZIAA9AAAAAAABmMXKSUVlna2fshyirL/dzxWUUsrNhjLWtyfCX97IuYuHZkvt2XucXDxnD/Aweos0ukjBrxmpJfeOVbp4Wx4rEvvI1C8eUJqN0NJ+qe9G0l4I3Buue381o5gMzi67HCfxIwdFCcZxUovaZoZwlCTjJaaAAMjEAAAPkXdgaSqdNk7YRm89Vni+LKR1NgzW7fX1TUv2PdtQejKtJ2RTOVqoxhq7o1rEFNpIp6v/AG79Y/qjobRrdWvtT5OW8vRnP1f+3frH9UXYvcUUZrU2vmTgdQZEZWjDc2lLHKyKl8+TL5XjDe1O/wDdjj8ywU7PvMu1/dQABGZgAAAAN4ABhtI0lYkVrb0uoPUmyedqXUrW6qMFmTSRQu1jbxDj5lSTc3mTyyhfnQr7Q7v9DpfD/s9fk6nd8Mf1f4en4nQe0ln3YyZY0u0K5yUZPdb78DjjmUF4hcnt6Ohn9msKUOmO0/fZ6kHN2VqZWRlTN5lBZi+6OkbqqxWwU0cHm4k8O+VM+V+oABIVAGAwB1MW6ai9J3Uwm+jceP4mepJH4UUsz7qOj+z+vOn76/2VPoTr/wBvqbqv7XLfj+DM72ur+KFN67xbhL8HlFsGtOw2VPp9ceF9dtD/AL4cPxWUbzuqtobqsjNcPheSwU741xsxXCMZP4mljIMorbKti3tRDyj+5dqWEValv2uXTki6lhG7qj01pM+ceI2q7LsmuN/t2MgAkKIAAAAAABrKSRG7kuoBMCBXLuSRmn1ANwEAAAAAZjFyeF+ZJp6J6ixQri22+x6PSaKjQU+JdhzXzw/5NZmZ8aNwh3l+i+v8GzwsCV7U59o/v9P5I9n7Or00PG1GN7nh9PX+DGq1krm41txh+bKuo1tlmp8Kz3a3/T8/XzCOKysuU21F88v1Z19OPGqKWvogkDJhmvLBztrLFMLVzg8N+TK0XlZLO1ZJ6WUe+F+ZUq+FHdfZ+UpYjT4Tev0OQ8bhGOSmuWu/6m4AN8aQAAAG+mvlpdTG6KyuUl3RoD1PR580d62nTbTojJS5cpLnH1PKazhRJZz7y4//ACRcw0nutrPPD5kGoplZU4xazlc/UnqaimtmF7djT6e5t1GMm24bpJGcrUl2IY1N8iKSRkAqclpAAAAAMAw3ghstwSV1Xaq9U6eDnZLkl+rPRbO9nKKGrda1fbzUPsR/kwlNR5J6qJW8HA2fsrWbTkpVx8OjrbPl8u5v7U+z0dDsyrU6Wc7I1vF+91zyl5LPD5nuVwSS4JckYtrhdVOq2KlXOLjKL6p8ync3bFx4N5gxhiWxs1to+NgvbZ2dPZW07dLPLiverk/tQfJ/t8iiaJpp6Z9FhONkVOPDBNpdPZq9TCilJzm8LLwjWii3UWqqiuVk3yUUeq2VsyvZFM9ZrrIqxR4vpBdl3ZlGLkyK++NUfn6I4VGlv0O246e5JSUW3uvKaa4M7BVqslrdoX7QnFxjZ7tUXzUUWje4MHCrv6s+deP5CvzO3MUk/r6/voAAumhAYDAHU3g+hownxIra/Mj0lzCyniXKxfj9CUGm/wCRHO9rlB/M1cqLIvWjt6fEsS2O1NL69iS2xVwy+fRFCbcm1zlLm+xu/EslnDz3ZJXUo+pZoxnvqmavxLxmtVurGe2+X7fQU17sSYA2ByAAAAAAANZy3UbGlWns1uur0tWczfF9l1YPUnJ6RHRRfrZtVLdgnhzfL/LOvR7O5jmddlj7ylur8D0ei0NOipjCuCyljOOXoWitK5vg21eJCK+Luzylvs/BcPAknjPuT4nM1OzrtPmVLc0ucGsSX8nt172vk/uVJfi/8GdRpq9RHE48eklzR4rZLk9njVyXZHgaLVNE5LtrQy0Wq8VLCk8SxyeeT+f6kMXmKZZTUltGqsg65dLMklFTutUV1Iy/spxhqFOXKMk2UvEL3RjSnHn+XrZZwaVdkRhLj+DuVVU7N0ybxvtYeObfZFG66d896b4LlFckSa62N16cHmMY4RXOByr3KThF9v3+Z3FVaitvk0trjZBwlyf5eZFTZJS8K341yf3l3LDIr61ZHniS4xl2ZUT9GWE/RkuSG21RTw1w5vsRWX7lObJKOF7z6HKuvnqZYS3aui7+pscDw63NnqPaK5f99SlmZleHHcu79Eb32/SLVu/BHk+77m8VhGsIbqNpcEd/j0QxqlVXwjh8i+eRY7J8sxKWCKVyXUhsnOy1V1Rc5y5JF2nYWosSldOS/trjn8ydtLkjhXOz7qK6vXc3jan1LUth1xXvSuj6/wD8ILNk2w403KflJYPOuLJHj2L0Mp5MlRysps3LoOEuzLEJqSPSDWuzNwAAAAAAAAAYckuoUk+QBk1n8JsYmswa7oA9T7PaOOm2dG5r629b0n2XRHVINFJS0OnlHk6o4/AnKMm29m/hFRikgAZjFy5GJmjge1uyXtLZni0xzqdNmUMc5R6x/f5Hktmez9+pUbNU3RU+KWPekv2PqOIVrek1w6s8P7QXWX7QnVo9SoaNrMvC4Sb6rPb0K1mP5ktxWzb43if+LU67JaXv/pGlms0OyYvS6CnxdR1rrfH1lLoc66N+usVm0LFPdeY0w4Qj/L82SU010w3KoqMfLqSlyrDjHvPv+xpMvxqyxtUfCvf1f8fh+ZhLCwjIyaSsSLpoeTcEPjLubRtT6gaJAzCaZkAAAADAAABhvBHKxIAkyjG+iGLsus3KouUvLoXqtmNrN1rz2h/JSys/HxP+WXf29S5j4N+T/wAce3v6ECkmZLL2ZBfBbNPzwyCyqymW7Yl5NcmR4vieNly6a5d/Z9jLI8PyMZdU1290agA2JRHQ7Xsjp1LV6rUSXFbtcf1f7HFPR+yUkoaiHXxFL5NY/Yiu+4y3hpO5bPQ6jG6l5kBPqFwT7EC5opx4N1Pkg0/G7Uz/AL1H8Ev5JyDR8dPv/fnKX5k5kyNHK9pKFdsW+WPeri2v/fVI8pTxqT8j2G3pqGw9W39qG6vV8F+p5GEd2KXYs0/dZrM7XWvoZJtNZ4dyy+EuDIQeZFEciqVUuGV6LZUWKyPKOxkycyGrlVH3k5R8uaJVtHTNf1YJ9m8Hz7J8Nycebi4tr3XdHb4+dRkQ6lJJ+zZdbSXEqarUwqg5TeF0S5tle7aVWMVvxH0UeX4lBqy6zxLXl9F0XoXvD/BrciXVanGP6v6fyV8zxSrHjqt9Uv0QnOzUz3p8Ir4Y9v8AJNCGEZjHBudtVVCmChBaSOPttndNzm9tg0t4QZuS6WMZ6yiMuTsjn8SR9iNLb0d/YOx4aLS+NqIKWpt4yyvgXRHZJ/8A8d+hAUHJze2dCq1VFRRh8Vx4+pVv0FF3FLw5d4/wWyvqJSlKNFbxKfGTX2Y9X+wR4+5wdZooyr3bYqdUm1Ga5ZXbscG+iejuUZPerl8Mu/l6n0B1Vyp8JxXh4xunn9q7P92VEuMZrMJdmT12a7FW+hTW1ycSLyjYr6eT4xlwlF4a8ywWDUAA2hHemo93gxlJRTk/Q9jFyekSUaeVvFvEe5cjpaksbufNlzT6Xe07nvbsYp4XoRLkcBn+JZORLe9RfCXt8zt8PAox48bl6sq26Kqa+BfgczUaeembnFtwXNPnH/B3WQ6iCcctZXKS7oiwvEb8WxNPa9UTZODTkwcWtP0ZyK5pokKu69PqJUyeUuMX3XQsxeUfQ65xsgpx4fc4WyuVc3CXKPQbA2hFVrSXSSaf1bf6HoYQUlls+fl6jautoiowu3orpNbxHOpt7Rcoy1BdM0e03IR4tlLaG19Pok4t79nSEef+DzN22NdbFxdqgn9yOH+JQeW228t9WYxo/wDRJZnLWq0XdftPU61tWS3a/uR5fPuUgCwkktI1spym9yYANbHiJ6YkN1qimWdHsjVavEpqUIvlFLMv8F32b2V9O1EtVcs1VvEF96XV/I9f4fhJQUVFdkQTt09I2OPi9UeuXB5aPs2lHjTKT/us4lbU7DVSzu21PvneR7Egp+s1F9j4pNVr5c/zf5EaskW3RW+2jwlld2lmlcsxbwprkyVPKyep2lsyuyicq4Zi179ffzXmeUUJU2zpk87r4PuujJ4T6jXZFHlva4N3zAMN4JCoZNJTSNJ2YLWz9k6zaTUoLwqOts1wfoup42l3ZnCEpvSRRna28LLb5JFrTbNstalqG4R+6ub/AIPWaHY2j0VUoxhvzksSsnxk/Tt8jnW1SoulXPnF8+67nPeMZ+RRBKnsn6+pv/DvDqpvdvdr09CKqmFUFCqCjHsjcyDi5SlN9UntnTpKK0l2MM0thGytwl1/I3ZZv0ng6SNrk954zF+ZnUrE+uH/AF7mE+mS6ZevY87xTafNcGDNjzbNrrJmD6jBuUU2fO5pRk0gXdk6z6FrVZL+nJbs/Tv8ikD1ra0xCThJSR9FqshdWmmmmunUq3tVwsknlRTf5Hk9n7Uv0SUF9ZV9x9PRnVntnSajSzhvSrnJYxNfjxRT8qUWbmOXXYu/ZnV08dzTVR7QRuUJ7Y2fHLV+95Ri2czXbenZFw0kXWnzm/i+XY9UJN8CV9cFyPaPVxtnDSVvKrlvWNfe6L5HFHXILUY9K0ai2x2zcmAAZEYIZ0xk84JgARRpSJFFIyAAAAAZi3GSkuDTyjAAR77Z+phq9JCyPKazjt3QnFxlhnldi7S+hXeHY34M3x/tfc9c7K7aVJNPKymihOLhL5G/puV1e/VFe2yNVUrJ8or8TTT1yjGU7f6tjzLy7L5Gq+v1Gf8AtVPh/dL/AAWAZgra+lXaSfD3oLeiWTWeFXLLwt15/AcDk8DdHd2pqEuTal+KRuauXi6i25cpy930Swv0Ni8uDQWNOb0DeuSjZGT6NGgMbIKcHF+p5CThJSXoeopW/s3djz3WigjfYup3oOqT49DfVVeFe8fDLij53mUSr+F8x7M77GtjaupcPuQmGsrDEpKKbk0kurK7vna8aeG8vvy4L/Jr0my2k2UNqUPw1bH4qufnEr0TzFHXlVJVZslvv7XDozieG9NqZUvkuMX5dDsfAMzrg8eT7ruvp6nMeOYvTJXx9ez+pbBhPKMnTHNgAAAAAAjv4Vt+RIazWYP0B6j3uxtLHSbOopS+CCT82+L/ADJbZb035cDbRWKzTwnHlKKkvmiOxYskvM13Mns6TSUEkR22KqqdkuUE2zXTVurTVwl8WMy9Xxf5s01K33TT/wCSeZf8Y8X+y+ZYfMyMAeS2/p1RtFOKwpJ49Of7s9aea9pZJ62qK5qvj+JJV98r5WvKezjsje9ZZGuuLlOTxGK5tm0up0fZiEZ7YnKSTcKm4+TykWpPpWzVVQ65qJ09m+z9FCjbrMXXc937Ef5O30MApOTl3Zu4VxgtRRkpbT0/iU+LFe/Xz80XDKK2RRHIqdcvUnqm65KSPN5NoQlZLdhFyfZGboqOqsilhKbSR2aK4V0xUIqOVx8ziqMV2zcW+Dezt6YppclWjRwpXi6iS4ccdEc3a+0Fa/Drfurl5+ZjbN9vv++8RlhLscXLfFvizovDcCGRHq4gnx6tr3+Ro/EM6VHwL7zXPt9DYGAdUcuZBgAGQYMAGwMAAyDAAMgwADIMAAyDAAMgwADIMAAyXtDtK7SRdablU/s9vQoGDxpPkzhOUHuLPX6HaGjtrjCuxQkl8M+DL64rgeCJI3W1r3LZx9JNELp9mXoZj18SPcyaisyaSXNvgcDbe1K7KZaXTS3lLhZNcsdkcSdtln9Syc/+UmyM9jUk9swty5SXTFaNgYBMUTIMAAm01rpvjNPHHiegvm9Zo97TxzNLKb5J9UeaXM9DsWcpaR5ecYZznjFEeqNn/rs/3T/vyOi8HvepV+3df7OfHTKUlO+Tsl0T5L5E6wiXUpR1NiSwt4iOMltNpnUdTkthrKOVtKnNasXxVfnE6pX1KTXFc00yxiXyx742R9GQ5FUb6ZVy9Ucup5iSFfTf0o+hOfTj54zIMAHhkGAAZBgwAeo9m9oLwlpbH78Pgz1j2+R27pRljd5nz6EpQkpRbUlxTXQ9pobJ26KmdjzKUU2+5UtrSfUbjEvc49D9Dav39bbPpXFVr1fF/sTlfRcdO31lOTfn7zJ2RstI1tshVVKyySjCKy2zxmt1MtXq7L5cN58F2XRHR9pLrPpVdG+/C3d7d8zilmqGl1Gry7XKXQuEf//Z",
  Auto: "data:image/jpeg;base64,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",
  entry: "data:image/jpeg;base64,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",
};


// Screen navigation history — jab bhi ek NAYE screen par jaate hain, purana
// screen is stack mein push ho jaata hai. Back button dabane par (goBack ya
// hardware/browser back) hamesha sirf EK step peeche jaata hai — jahan pehle
// the wahi wapas aata hai, seedha Wallet/home pe nahi kudta.
let screenHistoryStack = [];

function updateNavIndicator(name){
 try {
  const nav = document.querySelector('.bottom-nav');
  let indicator = document.getElementById('navIndicator');
  if (!nav) return;
  if (!indicator) {
   indicator = document.createElement('div');
   indicator.className = 'nav-indicator';
   indicator.id = 'navIndicator';
   nav.insertBefore(indicator, nav.firstChild);
  }
  const map = { wallet: "navWallet", entries: "navEntries", analytics: "navAnalytics", goals: "navGoals" };
  const targetId = (name && map[name]) || (document.querySelector('.nav-btn.active') ? document.querySelector('.nav-btn.active').id : 'navWallet');
  const activeBtn = document.getElementById(targetId);
  if (!activeBtn) {
   indicator.style.opacity = '0';
   return;
  }
  const navRect = nav.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  if (btnRect.width === 0 || navRect.width === 0) {
   setTimeout(() => updateNavIndicator(name), 60);
   return;
  }
  const left = btnRect.left - navRect.left;
  const width = btnRect.width;
  indicator.style.left = `${Math.round(left)}px`;
  indicator.style.width = `${Math.round(width)}px`;
  indicator.style.transform = 'none';
  indicator.style.opacity = '1';
 } catch(e) { console.warn(e); }
}

window.addEventListener('resize', () => {
 updateNavIndicator(typeof currentAppScreen !== 'undefined' ? currentAppScreen : 'wallet');
});

function goTo(name, fromPopState){
 if (typeof closeAiChatModal === 'function' && document.getElementById('aiChatModal')) {
   closeAiChatModal();
 }
 if (!fromPopState && typeof currentAppScreen !== 'undefined' && currentAppScreen && currentAppScreen !== name) {
   screenHistoryStack.push(currentAppScreen);
 }
 document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
 const targetScreen = document.getElementById("screen-"+name);
 if (targetScreen) targetScreen.classList.add("active");
 document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
 const map={wallet:"navWallet",analytics:"navAnalytics",entries:"navEntries",goals:"navGoals",add:"navPlusBtn"};
 if(map[name]) {
   const btn = document.getElementById(map[name]);
   if (btn) {
     if (name !== 'add') {
       btn.classList.add("active");
       updateNavIndicator(name);
       const ico = btn.querySelector('i');
       if (ico) {
         ico.classList.remove('nav-ico-bounce');
         void ico.offsetWidth;
         ico.classList.add('nav-ico-bounce');
         setTimeout(() => ico.classList.remove('nav-ico-bounce'), 550);
       }
     }
   }
 }
 if(name==="analytics") { setTimeout(renderAnalytics, 30); }
 if(name==="entries") { window.__entriesLimit = 60; renderEntries(); }
 if(name==="wallet") renderRecent();
 if(name==="goals") {
   if (typeof loadGoals === 'function') loadGoals();
   if (typeof renderGoalsList === 'function') renderGoalsList();
 }
 currentAppScreen = name;
 if (!fromPopState) history.pushState({ screen: name }, '');
 if (typeof syncHomeChatFabVisibility === 'function') syncHomeChatFabVisibility();
}
// Toggles the "show" class on the floating home-screen chat bubble
// (#homeChatFabBtn) so it's only visible while the Wallet/home tab is the
// active top-level screen (it lives outside #screen-wallet at body level
// so position:fixed behaves reliably on mobile — see its CSS comment).
function syncHomeChatFabVisibility(){
 const fabBtn = document.getElementById('homeChatFabBtn');
 const isChatOpen = !!document.getElementById('aiChatModal');
 if (fabBtn) {
  const walletTabActive = !isChatOpen && !!document.getElementById('screen-wallet')?.classList.contains('active');
  fabBtn.classList.toggle('show', walletTabActive);
  if (isChatOpen) fabBtn.style.setProperty('display', 'none', 'important');
  else fabBtn.style.removeProperty('display');
 }
 const goalsFabBtn = document.getElementById('goalsAddFabBtn');
 if (goalsFabBtn) {
  const goalsTabActive = !isChatOpen && !!document.getElementById('screen-goals')?.classList.contains('active');
  goalsFabBtn.classList.toggle('show', goalsTabActive);
  if (isChatOpen) goalsFabBtn.style.setProperty('display', 'none', 'important');
  else goalsFabBtn.style.removeProperty('display');
 }
}

// Ek step peeche — jis screen se aaye the wahi khulta hai.
// Agar koi modal/popup/drawer khula hai to pehle use band karta hai.
function goBack(){
 if (typeof isAiVoiceScreenOpen === 'function' && isAiVoiceScreenOpen()) {
  closeAiVoiceFullscreen();
  return;
 }
 const modals = [
  { id: 'aiChatModal', close: () => typeof closeAiChatModal === 'function' && closeAiChatModal() },
  { id: 'quickAddModal', close: () => typeof closeQuickAdd === 'function' && closeQuickAdd() },
  { id: 'editModal', close: () => typeof closeEditModal === 'function' && closeEditModal() },
  { id: 'filterModal', close: () => typeof closeFilterModal === 'function' && closeFilterModal() },
  { id: 'logoutConfirmModal', close: () => typeof closeLogoutModal === 'function' && closeLogoutModal() },
  { id: 'forgotPinPage', close: () => typeof closeForgotPinPage === 'function' && closeForgotPinPage() },
  { id: 'editMonthlyBudgetModal', close: () => typeof closeEditMonthlyBudgetModal === 'function' && closeEditMonthlyBudgetModal() },
  { id: 'aiSettingsModal', close: () => typeof closeAiSettingsModal === 'function' && closeAiSettingsModal() },
  { id: 'goalFormModal', close: () => typeof closeGoalFormModal === 'function' && closeGoalFormModal() },
  { id: 'goalDetailsModal', close: () => typeof closeGoalDetailsModal === 'function' && closeGoalDetailsModal() },
  { id: 'addMoneyModal', close: () => typeof closeAddMoneyModal === 'function' && closeAddMoneyModal() },
  { id: 'goalSuccessModal', close: () => typeof closeGoalSuccessModal === 'function' && closeGoalSuccessModal() }
 ];
 for (const m of modals) {
  const el = document.getElementById(m.id);
  if (el && (el.style.display === 'flex' || el.style.display === 'block' || el.classList.contains('active') || (el.classList.contains('auth-screen') && !el.classList.contains('hidden')))) {
   try { m.close(); return; } catch(e){}
  }
 }
 history.back();
}

// ===== THEME MANAGEMENT (Dark / Light Mode) =====
function updateThemeToggleIcon(isLight) {
  const profileBtn = document.getElementById('profileThemeToggleBtn');
  if (profileBtn) {
    // CSS switch + Moon (dark) / Sun (light) icons
    profileBtn.innerHTML = `<span class="css-theme-toggle ${isLight ? 'is-light' : 'is-dark'}" aria-hidden="true">
      <i class="ti ti-moon-filled theme-ico-moon"></i>
      <i class="ti ti-sun-filled theme-ico-sun"></i>
    </span>`;
    profileBtn.title = isLight ? 'Light Mode' : 'Dark Mode';
  }
  const settingsIcon = document.getElementById('settingsThemeIcon');
  if (settingsIcon) {
    settingsIcon.className = isLight ? 'ti ti-sun' : 'ti ti-moon';
    settingsIcon.style.color = isLight ? '#f59e0b' : '#c084fc';
  }
}

function isLightMode() {
  return document.body.classList.contains('light-theme');
}

function toggleTheme() {
  const isLight = document.body.classList.contains('light-theme');
  const targetTheme = isLight ? 'dark' : 'light';
  const willBeLight = targetTheme === 'light';
  
  if (willBeLight) {
    document.body.classList.add('light-theme');
    document.documentElement.classList.add('light-theme');
    try { localStorage.setItem('appTheme', 'light'); } catch(e){}
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', '#f6f8fc');
  } else {
    document.body.classList.remove('light-theme');
    document.documentElement.classList.remove('light-theme');
    try { localStorage.setItem('appTheme', 'dark'); } catch(e){}
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', '#07090e');
  }
  updateThemeToggleIcon(willBeLight);

  // Refresh dynamic charts and UI when theme switches
  try {
    if (typeof renderCharts === 'function' && document.getElementById('screen-analytics')?.classList.contains('active')) {
      renderCharts();
    }
    if (typeof drawGoalsRing === 'function') {
      const ringTotal = document.getElementById('ringGoalsTotalPct');
      const pct = ringTotal ? parseInt(ringTotal.textContent) || 0 : 0;
      drawGoalsRing(pct);
    }
    if (typeof renderDashboardTotals === 'function') {
      renderDashboardTotals();
    }
  } catch(e) {
    console.warn('Theme refresh callback notice:', e);
  }

  if (typeof showNotification === 'function') {
    showNotification(targetTheme === 'light' ? 'Light Mode Activated ☀️' : 'Dark Mode Activated 🌙', 'info');
  }
}

// Mini chart is implemented below in renderMiniChart()

// ===== RENDER FUNCTIONS =====

function renderRecent(){
 const sorted = typeof getSortedEntriesDesc === 'function' ? getSortedEntriesDesc() : entries;
 const list = sorted.slice(0,4);
 if(list.length===0){
 document.getElementById("recentTxnList").innerHTML = '<div class="empty-state"><i class="ti ti-receipt-off"></i><br>No entries yet</div>';
 } else {
 const balMap = typeof computeRunningBalances === 'function' ? computeRunningBalances() : null;
 document.getElementById("recentTxnList").innerHTML = list.map(e=>txnRowHTML(e, false, balMap ? balMap.get(String(e.id)) : null)).join("");
 }
 renderDashboardTotals();
 renderMiniChart();
}

// ===== DASHBOARD TOTALS (real calculation from entries) =====
// Parties treated as investments/savings — payments TO these increase Savings,
// money received/withdrawn FROM these decreases Savings. All other parties
// only affect the normal Payment/Received totals, not Savings.
const SAVINGS_PARTIES = ["Mutual Fund", "SIP", "Stocks", "Investment", "Fixed Deposit"]; // Groww removed: Savings me count nahi hota
function isSavingsParty(party) {
 const p = (party || '').trim().toLowerCase();
 if (!p) return false;
 if (p.includes("groww")) return false; // Groww / Groww stock market Savings total me count nahi hoga
  return p.includes("zerodha") || p.includes("mutual fund") || p.includes("investment") || p.includes("sip") || p.includes("stocks") || p.includes("deposit") || p.includes("ppf") || p.includes("nps");
}

// ===== Category vs Real Person / Party Classifier =====
// ===== Category vs Real Person / Party Classifier =====
// Differentiates personal self-expenses (Food, Auto, Fuel, Medicine, Self, etc.)
// from Real People, Clients & Offices (Prince Office, Sagar, Adarsh, etc.) using EXACT matching.

const STRICT_PERSONAL_EXPENSE_NAMES = new Set([
 'food', 'khana', 'nasta', 'snacks', 'tea', 'chai', 'coffee',
 'auto', 'fuel', 'petrol', 'diesel', 'cng',
 'medicine', 'dawa', 'medical', 'doctor', 'hospital', 'clinic',
 'self', 'ghar', 'home', 'family',
 'groceries', 'grocery', 'kirana', 'rashan',
 'shopping', 'clothes', 'clothing',
 'mobile recharge', 'recharge', 'wifi', 'internet', 'broadband',
 'electricity', 'electricity bill', 'bijli bill', 'power bill', 'room rent', 'house rent', 'rent',
 'salon', 'parlour', 'haircut', 'gym',
 'donation', 'charity', 'mandir', 'bank charges', 'bank fee'
]);

const STRICT_INVESTMENT_NAMES = new Set([
 'mutual fund', 'mutual funds', 'groww', 'groww stock market', 'stock', 'stocks',
 'share market', 'trading', 'sip', 'investment', 'investments', 'other investment',
 'apj emi', 'car emi', 'bike emi', 'home loan', 'other goal'
]);

const STRICT_INCOME_NAMES = new Set([
 'salary', 'bank intt', 'bank interest', 'dividend', 'other income', 'cashback', 'bonus'
]);

function isInvestmentCategory(name){
 if (!name) return false;
 const s = String(name).trim().toLowerCase();
 return STRICT_INVESTMENT_NAMES.has(s);
}

function isIncomeCategory(name){
 if (!name) return false;
 const s = String(name).trim().toLowerCase();
 return STRICT_INCOME_NAMES.has(s);
}

function isPersonalCategory(name){
 if (!name) return false;
 const s = String(name).trim().toLowerCase();
 if (isInvestmentCategory(s) || isIncomeCategory(s)) return true;
 return STRICT_PERSONAL_EXPENSE_NAMES.has(s);
}

function buildAllPartyBalances(){
 const map = {};
 entries.forEach(e => {
  const party = (e.party || 'Unknown').trim();
  if (!party) return;
  if (!map[party]) map[party] = { party, paid: 0, received: 0 };
  const amt = Number(e.amount) || 0;
  if (e.type === 'expense') map[party].paid += amt;
  else if (e.type === 'income') map[party].received += amt;
 });
 return Object.values(map).map(p => ({
  party: p.party,
  paid: p.paid,
  received: p.received,
  net: p.paid - p.received, // +ve: paid more, -ve: received more
  isPersonal: isPersonalCategory(p.party),
  isInvestment: isInvestmentCategory(p.party),
  isIncome: isIncomeCategory(p.party)
 })).sort((a,b) => Math.abs(b.net) - Math.abs(a.net));
}

function buildBalanceSummaryText(maxParties){
 const allRows = buildAllPartyBalances();
 if (allRows.length === 0) return "Abhi koi entry hi nahi hai.";

 const realPeople = [];
 const personalExpenses = [];
 const investments = [];
 const incomeSources = [];

 allRows.forEach(r => {
  if (r.isInvestment) investments.push(r);
  else if (r.isIncome) incomeSources.push(r);
  else if (r.isPersonal) personalExpenses.push(r);
  else realPeople.push(r);
 });

 const peopleToTake = realPeople.filter(r => r.net > 0);
 const peopleToGive = realPeople.filter(r => r.net < 0);
 const peopleSettled = realPeople.filter(r => r.net === 0);

 let text = `=== 1. REAL PEOPLE / PARTIES (UDHAR & LENDEN - LENA / DENA) ===\n`;
 text += `[JINSE PAISE LENA HAI (PEOPLE WHO OWE YOU MONEY)]:\n`;
 if (peopleToTake.length > 0) {
  peopleToTake.forEach(r => {
   text += `- ${r.party}: INSE ₹${Math.abs(r.net).toLocaleString('en-IN')} LENA HAI (Diya/Paid: ₹${r.paid.toLocaleString('en-IN')}, Liya/Received: ₹${r.received.toLocaleString('en-IN')})\n`;
  });
 } else {
  text += `- Kisi bhi vyakti se paise lena baaki nahi hai.\n`;
 }

 text += `\n[JINKO PAISE DENA HAI (PEOPLE YOU OWE MONEY TO)]:\n`;
 if (peopleToGive.length > 0) {
  peopleToGive.forEach(r => {
   text += `- ${r.party}: INKO ₹${Math.abs(r.net).toLocaleString('en-IN')} DENA HAI (Liya/Received: ₹${r.received.toLocaleString('en-IN')}, Diya/Paid: ₹${r.paid.toLocaleString('en-IN')})\n`;
  });
 } else {
  text += `- Kisi ko bhi paise dena baaki nahi hai.\n`;
 }

 if (peopleSettled.length > 0) {
  text += `\n[HISAB SETTLED / BARABAR LOG]:\n`;
  peopleSettled.forEach(r => {
   text += `- ${r.party}: Hisab Barabar (₹0 balance)\n`;
  });
 }

 text += `\n=== 2. PERSONAL EXPENSE CATEGORIES (SELF KHARCH - NON-RECOVERABLE) ===\n`;
 text += `(CRITICAL INSTRUCTION FOR AI: Ye user ke khud ke personal kharche hain jaise Food, Auto, Fuel, Medicine, Self, Doctor, Office, Electricity, etc. Ye kisi insaan ka udhar nahi hai aur inse paise wapas LENA NAHI HAI! Agar user poochhe "kisse paise lena hai", to in personal kharcho ko KABHI mat batana!)\n`;
 if (personalExpenses.length > 0) {
  personalExpenses.forEach(r => {
   text += `- ${r.party}: Total kharch ₹${r.paid.toLocaleString('en-IN')} (Personal spending)\n`;
  });
 }

 if (investments.length > 0) {
  text += `\n=== 3. INVESTMENTS & SAVINGS (SELF ASSETS) ===\n`;
  investments.forEach(r => {
   text += `- ${r.party}: Total invested ₹${r.paid.toLocaleString('en-IN')}\n`;
  });
 }

 if (incomeSources.length > 0) {
  text += `\n=== 4. INCOME SOURCES ===\n`;
  incomeSources.forEach(r => {
   text += `- ${r.party}: Total received ₹${r.received.toLocaleString('en-IN')}\n`;
  });
 }

 return text;
}

// ===== Full app context for "Ask Balance" voice/text questions =====
function buildAiContextText(compact){
 const now = new Date();
 const curMonth = now.getMonth(), curYear = now.getFullYear();
 const toINR = n => `₹${(Number(n)||0).toLocaleString('en-IN')}`;

 // ---- 1) Party-wise balance (all-time) ----
 const balanceSection = buildBalanceSummaryText(compact ? 15 : 40);

 // ---- 2) Date-wise totals: aaj / kal / is week / last week / is mahina / last mahina / is saal ----
 function sumRange(fromDate, toDate){
  let exp = 0, inc = 0, count = 0;
  entries.forEach(e => {
   const d = new Date(e.date);
   if (isNaN(d)) return;
   if (d >= fromDate && d <= toDate) {
    count++;
    if (isExpenseType(e.type)) exp += Number(e.amount) || 0; else inc += Number(e.amount) || 0;
   }
  });
  return { exp, inc, count };
 }
 const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
 const endOfDay = d => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
 const today0 = startOfDay(now), today1 = endOfDay(now);
 const yesterday = new Date(now); yesterday.setDate(yesterday.getDate()-1);
 const yest0 = startOfDay(yesterday), yest1 = endOfDay(yesterday);
 const dow = now.getDay(); // 0=Sun
 const weekStart = new Date(now); weekStart.setDate(now.getDate() - dow); weekStart.setHours(0,0,0,0);
 const weekEnd = endOfDay(now);
 const monthStart = new Date(curYear, curMonth, 1);
 const monthEnd = endOfDay(now);

 const todayR = sumRange(today0, today1);
 const yestR = sumRange(yest0, yest1);
 const weekR = sumRange(weekStart, weekEnd);
 const monthR = sumRange(monthStart, monthEnd);
 const monthName = now.toLocaleDateString('en-IN', { month:'short', year:'numeric' });

 const dateWiseSection =
`Aaj (${now.toISOString().slice(0,10)}): payment ${toINR(todayR.exp)}, receive ${toINR(todayR.inc)} (${todayR.count} entries)
Kal (${yesterday.toISOString().slice(0,10)}): payment ${toINR(yestR.exp)}, receive ${toINR(yestR.inc)} (${yestR.count} entries)
Is week: payment ${toINR(weekR.exp)}, receive ${toINR(weekR.inc)}
Is mahina (${monthName}): payment ${toINR(monthR.exp)}, receive ${toINR(monthR.inc)}`;

 // ---- 3) All-time totals ----
 const allExpense = entries.filter(e=>isExpenseType(e.type)).reduce((s,e)=>s+(Number(e.amount)||0),0);
 const allIncome = entries.filter(e=>isIncomeType(e.type)).reduce((s,e)=>s+(Number(e.amount)||0),0);
 const totalsSection = `All-time: total payment ${toINR(allExpense)}, total receive ${toINR(allIncome)}, total entries: ${entries.length}.`;

 // ---- 4) Search-friendly entries list ----
 const searchCap = compact ? 10 : 30;
 const recentSection = entries.slice(0, searchCap).map(e => {
  const typeWord = isIncomeType(e.type) ? 'received' : 'paid';
  return `- ${e.date}: ${toINR(e.amount)} ${typeWord} ${isIncomeType(e.type)?'from':'to'} ${e.party||'Unknown'} (${e.method||'Cash'})${e.notes ? ' — ' + e.notes : ''}`;
 }).join("\n") || "Abhi koi entry hi nahi hai.";

 // ---- 5) Goals (savings targets) ----
 let goalsSection = "";
 if (!compact) {
  try {
   if (typeof loadGoals === 'function') loadGoals();
   if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
   const activeGoals = (typeof goals !== 'undefined' ? goals : []);
   if (activeGoals.length > 0) {
    goalsSection = "\n\nGOALS & SAVINGS TARGETS:\n" + activeGoals.slice(0, 3).map(g => {
     const saved = Number(g.saved) || 0;
     const target = Number(g.target) || 0;
     return `- Goal "${g.name}": Saved ${toINR(saved)} of Target ${toINR(target)}`;
    }).join("\n");
   }
  } catch(err) { /* goals fallback */ }
 }

 return `TODAY'S DATE: ${now.toISOString().slice(0,10)}\n\nBALANCE (party-wise, all-time):\n${balanceSection}\n\nDATE-WISE TOTALS:\n${dateWiseSection}\n\n${totalsSection}\n\nRECENT ENTRIES (latest ${searchCap}):\n${recentSection}${goalsSection}`;
}

// ===== HTML Escaper for Chat & History =====
function escapeHtml(str) {
 if (str === null || str === undefined) return '';
 return String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

const AI_CHAT_STORAGE_KEY = 'daytoday_ai_chat_history_v1';
const AI_CHAT_SESSIONS_KEY = 'daytoday_ai_chat_sessions_v2';
let aiChatRequestToken = 0; // only latest request gets to render
let aiChatMessages = []; // Active session messages: [{id, role:'user'|'ai', text, isVoice: boolean, timestamp: number, entryData?: object}]
let aiChatSessions = []; // Archived sessions: [{id, title, timestamp, messages: [...]}]
let activeAiChatSessionId = null;
window.aiChatMessages = aiChatMessages;
window.aiChatSessions = aiChatSessions;

function loadAiChatSessions(){
 try {
  const raw = localStorage.getItem(AI_CHAT_SESSIONS_KEY);
  if (raw) {
   const parsed = JSON.parse(raw);
   if (Array.isArray(parsed)) {
    aiChatSessions = parsed;
    window.aiChatSessions = aiChatSessions;
    return;
   }
  }
 } catch(e){
  console.warn("loadAiChatSessions error:", e);
 }
 aiChatSessions = [];
 window.aiChatSessions = aiChatSessions;
}

function saveAiChatSessions(){
 try {
  if (!Array.isArray(aiChatSessions)) return;
  window.aiChatSessions = aiChatSessions;
  localStorage.setItem(AI_CHAT_SESSIONS_KEY, JSON.stringify(aiChatSessions.slice(0, 80)));
 } catch(e){
  console.warn("saveAiChatSessions error:", e);
 }
}

function saveCurrentAiChatSession(){
 try {
  if (!Array.isArray(aiChatMessages)) return;
  const cleanMsgs = aiChatMessages.filter(m => m && m.text && m.text !== '__THINKING__' && m.text !== '💭...');
  if (cleanMsgs.length === 0) return;

  loadAiChatSessions();

  if (!activeAiChatSessionId) {
   activeAiChatSessionId = 'sess_' + Date.now();
  }

  let title = 'Conversation';
  const firstUser = cleanMsgs.find(m => m.role === 'user');
  if (firstUser && firstUser.text) {
   title = firstUser.text.replace(/^[🎙️⚡\s]+/, '').trim().slice(0, 42);
  } else if (cleanMsgs[0] && cleanMsgs[0].text) {
   title = cleanMsgs[0].text.trim().slice(0, 42);
  }

  const existingIdx = aiChatSessions.findIndex(s => s.id === activeAiChatSessionId);
  const prev = existingIdx >= 0 ? aiChatSessions[existingIdx] : null;
  const sessionObj = {
   id: activeAiChatSessionId,
   title: title || 'New Conversation',
   timestamp: (prev && prev.timestamp) || Date.now(),
   updatedAt: Date.now(),
   pinned: !!(prev && prev.pinned),
   messages: cleanMsgs
  };

  if (existingIdx >= 0) {
   aiChatSessions[existingIdx] = sessionObj;
  } else {
   aiChatSessions.unshift(sessionObj);
  }

  saveAiChatSessions();
 } catch(e){
  console.warn("saveCurrentAiChatSession error:", e);
 }
}

function loadAiChatHistory(){
 loadAiChatSessions();
 // Resume last chat if memory empty but we have a saved last session
 if ((!aiChatMessages || aiChatMessages.length === 0) && !activeAiChatSessionId) {
  try {
   const lastId = localStorage.getItem('aiChatLastSessionId');
   if (lastId) {
    const sess = (aiChatSessions || []).find(s => s.id === lastId);
    if (sess && Array.isArray(sess.messages) && sess.messages.length) {
     activeAiChatSessionId = sess.id;
     aiChatMessages = sess.messages.map(m => ({ ...m }));
     window.aiChatMessages = aiChatMessages;
     return;
    }
   }
  } catch(e){}
 }
 if (!activeAiChatSessionId && (!aiChatMessages || !aiChatMessages.length)) {
  aiChatMessages = [];
  window.aiChatMessages = aiChatMessages;
 } else {
  window.aiChatMessages = aiChatMessages;
 }
}

function saveAiChatHistory(){
 saveCurrentAiChatSession();
}

// Load sessions on boot
try { loadAiChatSessions(); } catch(e){}

window.aiChatVoiceMuted = (typeof localStorage !== 'undefined' && localStorage.getItem('aiChatVoiceMuted') === 'true');
window.aiChatContinuousVoice = true; // keep listening after answer like Grok voice

// Ensure modern styles for AI Chat & Messenger
function ensureAiChatStyles(){
 let style = document.getElementById('aiChatModernStyles');
 if (!style) {
  style = document.createElement('style');
  style.id = 'aiChatModernStyles';
  document.head.appendChild(style);
 }
 style.textContent = `
/* ===== Modern Chat UI (dark + light) ===== */
#aiChatModal {
  position: fixed; inset: 0; width: 100%; height: 100%; height: 100dvh;
  z-index: 2000;
  display: flex; flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
  color: #ececec; overflow: hidden; box-sizing: border-box;
  /* Dark mode: black dotted screen */
  background-color: #0a0b0f !important;
  background-image:
    radial-gradient(circle at center, rgba(255, 255, 255, 0.10) 1.15px, transparent 1.15px),
    radial-gradient(ellipse 65% 50% at 0% 0%, rgba(124, 58, 237, 0.14) 0%, transparent 70%),
    radial-gradient(ellipse 60% 50% at 100% 100%, rgba(245, 158, 11, 0.08) 0%, transparent 65%),
    linear-gradient(180deg, #10121a 0%, #0a0b0f 50%, #07080b 100%) !important;
  background-size: 18px 18px, 100% 100%, 100% 100%, 100% 100% !important;
  background-position: 0 0, 0 0, 0 0, 0 0 !important;
  background-repeat: repeat, no-repeat, no-repeat, no-repeat !important;
  background-attachment: fixed !important;
}
body.light-theme #aiChatModal {
  color: #0d0d0d;
  /* Light mode: white dotted screen */
  background-color: #ffffff !important;
  background-image:
    url("data:image/svg+xml,%3Csvg width='22' height='22' viewBox='0 0 22 22' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='11' cy='11' r='1.35' fill='%231e293b' fill-opacity='0.22'/%3E%3C/svg%3E"),
    radial-gradient(ellipse 70% 55% at 0% 0%, rgba(216, 202, 254, 0.45) 0%, rgba(230, 222, 255, 0.20) 50%, transparent 75%),
    radial-gradient(ellipse 65% 55% at 100% 0%, rgba(254, 224, 210, 0.50) 0%, rgba(255, 236, 226, 0.20) 50%, transparent 75%),
    linear-gradient(180deg, #ffffff 0%, #fdfcff 40%, #fffbfa 100%) !important;
  background-size: 22px 22px, 100% 100%, 100% 100%, 100% 100% !important;
  background-position: 0 0, 0 0, 0 0, 0 0 !important;
  background-repeat: repeat, no-repeat, no-repeat, no-repeat !important;
  background-attachment: fixed !important;
}

/* Header — 3-dot line menu on left, centered title, clean action on right */
.ai-chat-header {
  flex-shrink: 0; background: rgba(10, 11, 15, 0.82);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: calc(6px + env(safe-area-inset-top, 0px)) 14px 6px;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
body.light-theme .ai-chat-header {
  background: rgba(255, 255, 255, 0.82);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.ai-chat-header-inner {
  max-width: 720px; margin: 0 auto; width: 100%;
  display: flex; align-items: center; justify-content: space-between;
  height: 44px; gap: 8px;
}
.ai-header-title-box {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; min-width: 0; text-align: center;
}
.ai-header-main-title {
  font-size: 16px; font-weight: 700; color: inherit; letter-spacing: -0.2px; line-height: 1.2;
}
.ai-header-sub-badge {
  font-size: 11px; color: #10b981; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;
}
.ai-header-sub-badge::before {
  content: ''; width: 6px; height: 6px; border-radius: 50%; background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.8);
}
.ai-header-btn {
  width: 40px; height: 40px; border-radius: 50%; border: none;
  background: #2f2f2f; color: #e8e8e8;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 18px; flex-shrink: 0;
}
.ai-header-btn:hover { background: #3a3a3a; }

.ai-header-right-group {
  display: flex; align-items: center; gap: 6px;
}

.ai-header-menu-wrap { position: relative; }
.ai-header-menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 50;
  min-width: 168px;
  background: #1c1c1e; border: 1px solid #2c2c2e; border-radius: 14px;
  padding: 6px; box-shadow: 0 12px 32px rgba(0,0,0,0.5);
  display: flex; flex-direction: column; gap: 2px;
}
body.light-theme .ai-header-menu {
  background: #fff; border-color: #e5e5e5; box-shadow: 0 12px 28px rgba(0,0,0,0.12);
}
.ai-header-menu button {
  display: flex; align-items: center; gap: 10px;
  width: 100%; border: none; background: transparent;
  color: #e5e5ea; font-size: 14px; font-weight: 500;
  padding: 11px 12px; border-radius: 10px; cursor: pointer;
  font-family: inherit; text-align: left;
}
.ai-header-menu button i { font-size: 17px; color: #aeaeb2; width: 20px; }
.ai-header-menu button:hover { background: #2c2c2e; }
body.light-theme .ai-header-menu button { color: #1c1c1e; }
body.light-theme .ai-header-menu button:hover { background: #f2f2f7; }
body.light-theme .ai-header-menu button i { color: #636366; }

.ai-inchat-search {
  max-width: 720px; margin: 6px auto 0; width: 100%;
  display: flex; align-items: center; gap: 8px;
  background: #1a1a1a; border-radius: 12px; padding: 6px 10px;
  box-sizing: border-box;
}
body.light-theme .ai-inchat-search { background: #eee; }
.ai-inchat-search input {
  flex: 1; border: none; background: transparent; color: inherit;
  outline: none; font-size: 14px;
}
.ai-inchat-search i { color: #8e8e8e; font-size: 16px; }
.ai-msg-row.ai-search-hidden { display: none !important; }
.ai-header-btn.pinned { color: #a78bfa !important; background: #3b2f5a !important; }

body.light-theme .ai-header-btn {
  background: #e8e8e8; color: #1a1a1a;
}
body.light-theme .ai-header-btn:hover { background: #ddd; }
.ai-chat-avatar, .ai-chat-title-col, .ai-status-pill, .ai-status-dot { display: none !important; }
.ai-chat-title-text { display: none; }

/* Body */
.ai-chat-body {
  flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 8px 16px 24px;
}
#aiChatList {
  max-width: 720px; margin: 0 auto; width: 100%;
  display: flex; flex-direction: column; gap: 20px;
  min-height: 100%; box-sizing: border-box;
}

/* Messages */
.ai-msg-row {
  display: flex; flex-direction: column; width: 100%;
}
.ai-msg-row.user { align-items: flex-end; }
.ai-msg-row.assistant { align-items: flex-start; }

/* User bubble — Grok gray pill right */
.ai-user-bubble {
  max-width: 85%;
  background: #2f2f2f;
  color: #f5f5f5;
  border-radius: 22px;
  padding: 10px 16px;
  font-size: 15.5px;
  line-height: 1.45;
  font-weight: 400;
  word-break: break-word;
}
body.light-theme .ai-user-bubble {
  background: #e8e8e8; color: #0d0d0d;
}
.ai-user-meta, .ai-user-actions { display: none !important; }

/* Assistant — plain text, no heavy card */
.ai-assistant-bubble {
  max-width: 100%;
  background: transparent;
  border: none;
  padding: 0;
  color: #ececec;
  font-size: 16px;
  line-height: 1.55;
}
body.light-theme .ai-assistant-bubble { color: #0d0d0d; }

.ai-thought-label {
  display: flex; align-items: center; gap: 8px;
  color: #8e8e8e; font-size: 14px; margin-bottom: 10px;
  font-weight: 400;
}
body.light-theme .ai-thought-label { color: #6b6b6b; }
.ai-thought-label i { font-size: 16px; opacity: 0.9; }

.ai-bubble-content { color: inherit; }
.ai-para { margin: 0 0 8px; line-height: 1.55; }
.ai-para-gap { height: 8px; }
.ai-h2 { font-size: 17px; font-weight: 600; margin: 12px 0 6px; color: inherit; }
.ai-h3 { font-size: 15px; font-weight: 600; margin: 10px 0 4px; }
.ai-strong { font-weight: 600; color: inherit; }
.ai-bullet-line {
  display: flex; gap: 8px; align-items: flex-start; margin: 4px 0;
}
.ai-bullet-sparkle, .ai-num { color: #8e8e8e; flex-shrink: 0; min-width: 14px; }
.ai-bullet-text { flex: 1; }
.ai-chip {
  display: inline; color: inherit; background: transparent; padding: 0;
  font-weight: 500;
}
.ai-inline-code {
  background: #2a2a2a; padding: 2px 6px; border-radius: 6px;
  font-size: 13px; font-family: ui-monospace, monospace;
}
body.light-theme .ai-inline-code { background: #ececec; }

/* Action row under AI reply — Grok icon strip */
.ai-msg-actions {
  display: flex; align-items: center; gap: 2px;
  margin-top: 10px; flex-wrap: nowrap;
  max-width: 100%; overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.ai-bubble-action-btn {
  width: 34px; height: 34px; border-radius: 8px; border: none;
  background: transparent; color: #8e8e8e;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 16px; padding: 0;
}
.ai-bubble-action-btn span { display: none; }
.ai-bubble-action-btn:hover { background: #2a2a2a; color: #e0e0e0; }
body.light-theme .ai-bubble-action-btn { color: #6b6b6b; }
body.light-theme .ai-bubble-action-btn:hover { background: #ececec; color: #111; }

/* Thinking placeholder */
.ai-thinking-card {
  display: flex; align-items: center; gap: 10px;
  color: #8e8e8e; font-size: 14px; padding: 4px 0;
}
.ai-thinking-dots { display: flex; gap: 4px; }
.ai-thinking-dots span {
  width: 6px; height: 6px; border-radius: 50%; background: #8e8e8e;
  animation: aiSendDotBounce 1.1s infinite ease-in-out both;
}
.ai-thinking-dots span:nth-child(1) { animation-delay: 0s; }
.ai-thinking-dots span:nth-child(2) { animation-delay: 0.15s; }
.ai-thinking-dots span:nth-child(3) { animation-delay: 0.3s; }

/* Welcome */
.ai-welcome-wrap {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; text-align: center;
  padding: 48px 20px 24px; min-height: 50vh;
}
.ai-welcome-avatar {
  width: 56px; height: 56px; border-radius: 50%;
  background: #2f2f2f; display: flex; align-items: center; justify-content: center;
  font-size: 24px; color: #a0a0a0; margin-bottom: 16px;
}
body.light-theme .ai-welcome-avatar { background: #e8e8e8; color: #555; }
.ai-welcome-title {
  font-size: 22px; font-weight: 600; color: #f0f0f0; margin-bottom: 8px;
}
body.light-theme .ai-welcome-title { color: #111; }
.ai-welcome-sub {
  font-size: 14px; color: #8e8e8e; max-width: 320px; line-height: 1.45;
  margin-bottom: 28px;
}
.ai-welcome-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  width: 100%; max-width: 400px;
}
.ai-welcome-chip {
  text-align: left; background: #1a1a1a; border: 1px solid #2a2a2a;
  border-radius: 14px; padding: 12px 14px; cursor: pointer;
}
body.light-theme .ai-welcome-chip {
  background: #fff; border-color: #e5e5e5;
}
.ai-welcome-chip-title { font-size: 13px; font-weight: 600; color: #e8e8e8; margin-bottom: 4px; }
body.light-theme .ai-welcome-chip-title { color: #111; }
.ai-welcome-chip-desc { font-size: 11.5px; color: #8e8e8e; line-height: 1.35; }

/* Quick pills */
.ai-quick-scroll {
  display: flex; gap: 8px; overflow-x: auto; padding: 4px 0 10px;
  -webkit-overflow-scrolling: touch; scrollbar-width: none;
}
.ai-quick-scroll::-webkit-scrollbar { display: none; }
.ai-quick-pill {
  flex-shrink: 0; border-radius: 999px; border: 1px solid #333;
  background: transparent; color: #c8c8c8; font-size: 13px;
  padding: 7px 14px; cursor: pointer; white-space: nowrap;
}
.ai-quick-pill:hover { background: #1f1f1f; }
body.light-theme .ai-quick-pill {
  border-color: #ddd; color: #333; background: #fff;
}

/* Bottom composer */
.ai-chat-bottom-wrap {
  flex-shrink: 0; background: transparent;
  border-top: none;
  /* No big bottom padding — nav is hidden in chat. JS handles keyboard via visualViewport. */
  padding: 6px 12px max(6px, env(safe-area-inset-bottom, 6px));
}
.ai-chat-bottom-inner { max-width: 720px; margin: 0 auto; width: 100%; }
.ai-chat-live-status {
  display: none !important; /* hide status lines — only chat text results show */
  font-size: 12px; color: #8e8e8e; text-align: center;
  min-height: 0; margin-bottom: 0;
}

.ai-chat-input-bar { margin: 0; padding: 0; width: 100%; }

.ai-composer-box {
  display: flex; flex-direction: column;
  background: #2f2f2f;
  border-radius: 28px;
  border: 1px solid transparent;
  padding: 12px 14px 10px;
  gap: 6px;
  /* Line 1: Ask anything | Line 2: +  mic  ↑ */
}
body.light-theme .ai-composer-box {
  background: #ffffff;
  border: 1px solid #e5e5e5;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.ai-composer-box:focus-within {
  border-color: #444;
}
body.light-theme .ai-composer-box:focus-within { border-color: #ccc; }

#aiChatInput {
  width: 100%; border: none; outline: none; background: transparent;
  color: #f0f0f0; font-size: 16px; padding: 4px 4px 2px;
  font-family: inherit; min-height: 28px;
}
#aiChatInput::placeholder { color: #8e8e8e; }
body.light-theme #aiChatInput { color: #111; }
body.light-theme #aiChatInput::placeholder { color: #999; }

.ai-composer-toolbar {
  display: flex; align-items: center; gap: 6px;
}
.ai-composer-toolbar .spacer { flex: 1; }

.ai-pill-mic-btn, .ai-tool-btn {
  width: 36px; height: 36px; border-radius: 50%; border: none;
  background: transparent; color: #b0b0b0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 20px;
}
.ai-pill-mic-btn:hover, .ai-tool-btn:hover {
  background: #3a3a3a; color: #fff;
}
body.light-theme .ai-pill-mic-btn,
body.light-theme .ai-tool-btn { color: #555; }
body.light-theme .ai-pill-mic-btn:hover,
body.light-theme .ai-tool-btn:hover { background: #eee; color: #111; }

.ai-entry-mic-btn {
  width: 36px; height: 36px; border-radius: 50%; border: none;
  background: transparent; color: #b0b0b0; font-size: 20px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.ai-entry-mic-btn.listening {
  background: #5b21b6 !important; color: #fff !important;
  animation: aiEntryMicPulse 1.1s ease-in-out infinite;
}
@keyframes aiEntryMicPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
.ai-pill-mic-btn.listening {
  background: rgba(236,72,153,0.2) !important; color: #ec4899 !important;
}

/* Purple up-arrow send — Grok */
.ai-send-circle, .ai-squircle-send-btn {
  width: 36px; height: 36px; border-radius: 10px; border: none;
  background: #8b5cf6; color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  transition: background 0.15s, transform 0.15s;
}
.ai-send-circle:hover:not(:disabled):not(.is-thinking) {
  background: #7c3aed;
}
.ai-send-circle.is-thinking, .ai-send-circle:disabled {
  background: #4c1d95; cursor: default;
}
body.light-theme .ai-send-circle {
  background: #7c3aed; color: #fff;
}
body.light-theme .ai-send-circle.is-thinking {
  background: #c4b5fd; color: #4c1d95;
}
.ai-send-dots {
  display: inline-flex; gap: 3px; align-items: center;
}
.ai-send-dots i {
  width: 4px; height: 4px; border-radius: 50%; background: currentColor;
  animation: aiSendDotBounce 1.1s infinite ease-in-out both;
}
.ai-send-dots i:nth-child(1) { animation-delay: 0s; }
.ai-send-dots i:nth-child(2) { animation-delay: 0.15s; }
.ai-send-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes aiSendDotBounce {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* Entry saved card — SAME design + colors in light AND dark mode */
.ai-entry-card {
  display: flex; align-items: center; gap: 12px;
  background: #ffffff !important;
  border: 1px solid rgba(0,0,0,0.06) !important;
  border-radius: 18px;
  padding: 12px 14px;
  max-width: 320px; width: 100%;
  margin-top: 6px;
  box-shadow: 0 6px 18px rgba(20,30,60,0.10) !important;
  position: relative;
  overflow: hidden;
  transform-origin: center center;
  color: #111827;
}
body.light-theme .ai-entry-card,
body:not(.light-theme) .ai-entry-card {
  background: #ffffff !important;
  border: 1px solid rgba(0,0,0,0.06) !important;
  box-shadow: 0 6px 18px rgba(20,30,60,0.10) !important;
}

/* Type accent bar on left edge */
.ai-entry-card::before {
  content: '';
  position: absolute; left: 0; top: 0; bottom: 0; width: 3.5px;
  border-radius: 18px 0 0 18px;
  background: var(--ec-accent, #FF5C93);
}

/* Type colors */
.ai-entry-card.expense, .ai-entry-card.payment {
  --ec-accent: #FF5C93; --ec-ink: #C41F5E; --ec-rgb: 255,92,147;
  --ec-icon-bg: rgba(255,92,147,0.14);
}
.ai-entry-card.income, .ai-entry-card.receive {
  --ec-accent: #2FD08A; --ec-ink: #0E7C52; --ec-rgb: 47,208,138;
  --ec-icon-bg: rgba(47,208,138,0.14);
}
.ai-entry-card.lend {
  --ec-accent: #FFB547; --ec-ink: #9A5B00; --ec-rgb: 255,181,71;
  --ec-icon-bg: rgba(255,181,71,0.16);
}
.ai-entry-card.borrow {
  --ec-accent: #6C8CFF; --ec-ink: #3450CF; --ec-rgb: 108,140,255;
  --ec-icon-bg: rgba(108,140,255,0.14);
}
.ai-entry-card.transfer {
  --ec-accent: #A77BFF; --ec-ink: #6B3FD1; --ec-rgb: 167,123,255;
  --ec-icon-bg: rgba(167,123,255,0.14);
}
.ai-entry-card.savings {
  --ec-accent: #19C8D9; --ec-ink: #087A8C; --ec-rgb: 25,200,217;
  --ec-icon-bg: rgba(25,200,217,0.14);
}

/* Entrance animations (from 7 Save Card Motions) */
@keyframes ecUp {
  0% { opacity: 0; transform: translateY(22px) scale(.96); }
  55% { opacity: 1; transform: translateY(-4px) scale(1.02); }
  100% { opacity: 1; transform: none; }
}
@keyframes ecDrop {
  0% { opacity: 0; transform: translateY(-28px); }
  55% { opacity: 1; transform: translateY(5px); }
  70% { transform: translateY(-2px); }
  100% { opacity: 1; transform: none; }
}
@keyframes ecLeft {
  0% { opacity: 0; transform: translateX(-48px); }
  60% { opacity: 1; transform: translateX(4px); }
  100% { opacity: 1; transform: none; }
}
@keyframes ecRight {
  0% { opacity: 0; transform: translateX(48px); }
  60% { opacity: 1; transform: translateX(-4px); }
  100% { opacity: 1; transform: none; }
}
@keyframes ecFlip {
  0% { opacity: 0; transform: perspective(600px) rotateX(-75deg); }
  60% { opacity: 1; transform: perspective(600px) rotateX(6deg); }
  100% { opacity: 1; transform: perspective(600px) rotateX(0); }
}
@keyframes ecPop {
  0% { opacity: 0; transform: scale(.55); }
  55% { opacity: 1; transform: scale(1.06); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes ecSwing {
  0% { opacity: 0; transform: translateY(-24px) rotate(-5deg); }
  55% { opacity: 1; transform: translateY(0) rotate(2deg); }
  100% { opacity: 1; transform: none; }
}
@keyframes ecConfetti {
  0% { opacity: 0; transform: translateY(0) scale(0); }
  30% { opacity: 1; transform: translateY(-8px) scale(1); }
  100% { opacity: 0; transform: translateY(-28px) scale(.6); }
}
@keyframes ecRipple {
  0% { transform: scale(.6); opacity: .45; }
  100% { transform: scale(1.8); opacity: 0; }
}
@keyframes ecSavedPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(47,208,138,0.35); }
  50% { box-shadow: 0 0 0 5px rgba(47,208,138,0); }
}

.ai-entry-card.anim-up { animation: ecUp 0.5s cubic-bezier(0.22,1,0.36,1) both; }
.ai-entry-card.anim-drop { animation: ecDrop 0.55s cubic-bezier(0.22,1,0.36,1) both; }
.ai-entry-card.anim-left { animation: ecLeft 0.5s cubic-bezier(0.22,1,0.36,1) both; }
.ai-entry-card.anim-right { animation: ecRight 0.5s cubic-bezier(0.22,1,0.36,1) both; }
.ai-entry-card.anim-flip { animation: ecFlip 0.55s cubic-bezier(0.22,1,0.36,1) both; }
.ai-entry-card.anim-pop { animation: ecPop 0.48s cubic-bezier(0.22,1,0.36,1) both; }
.ai-entry-card.anim-swing { animation: ecSwing 0.55s cubic-bezier(0.22,1,0.36,1) both; }

/* Icon circle */
.ai-ec-icon {
  width: 42px; height: 42px; border-radius: 14px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--ec-icon-bg);
  color: var(--ec-accent);
  position: relative;
}
.ai-ec-icon svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.ai-ec-icon .ec-ripple {
  position: absolute; inset: -4px; border-radius: 16px;
  border: 2px solid var(--ec-accent); opacity: 0;
  animation: ecRipple 0.9s ease-out 0.25s 1 both;
}

/* Main content */
.ai-ec-body { flex: 1; min-width: 0; }
.ai-ec-title {
  font-size: 14.5px; font-weight: 700; color: #111827 !important;
  letter-spacing: -0.2px; line-height: 1.25;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
body.light-theme .ai-ec-title,
body:not(.light-theme) .ai-ec-title { color: #111827 !important; }
.ai-ec-sub {
  font-size: 12px; color: #6b7280 !important; margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
body.light-theme .ai-ec-sub,
body:not(.light-theme) .ai-ec-sub { color: #6b7280 !important; }

/* Right side: amount + saved badge */
.ai-ec-right { flex-shrink: 0; text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.ai-ec-amount {
  font-size: 15.5px; font-weight: 750; letter-spacing: -0.3px;
  color: var(--ec-accent);
}
.ai-ec-saved {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 650; color: #047857 !important;
  background: rgba(16,185,129,0.12) !important;
  border-radius: 20px; padding: 2px 8px 2px 5px;
  animation: ecSavedPulse 1.6s ease-in-out 2;
}
body.light-theme .ai-ec-saved,
body:not(.light-theme) .ai-ec-saved {
  color: #047857 !important;
  background: rgba(16,185,129,0.12) !important;
}
.ai-ec-saved svg { width: 12px; height: 12px; }

/* Confetti dots for income */
.ai-ec-confetti { position: absolute; inset: 0; pointer-events: none; overflow: hidden; border-radius: 18px; }
.ai-ec-confetti i {
  position: absolute; width: 5px; height: 5px; border-radius: 50%;
  animation: ecConfetti 0.9s ease-out both;
}
.ai-ec-confetti i:nth-child(1) { left: 18%; top: 40%; background: #2FD08A; animation-delay: 0.15s; }
.ai-ec-confetti i:nth-child(2) { left: 35%; top: 25%; background: #FFB547; animation-delay: 0.22s; }
.ai-ec-confetti i:nth-child(3) { left: 55%; top: 35%; background: #6C8CFF; animation-delay: 0.18s; }
.ai-ec-confetti i:nth-child(4) { left: 72%; top: 22%; background: #FF5C93; animation-delay: 0.28s; }
.ai-ec-confetti i:nth-child(5) { left: 85%; top: 45%; background: #19C8D9; animation-delay: 0.20s; }

/* Actions row below card */
.ai-entry-card-actions {
  display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px;
  max-width: 320px;
}
.ai-entry-action-btn {
  border: none; border-radius: 16px; padding: 5px 9px;
  font-size: 11px; font-weight: 550; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  background: #f2f2f7 !important; color: #1c1c1e !important;
  font-family: inherit;
  touch-action: manipulation;
}
body.light-theme .ai-entry-action-btn,
body:not(.light-theme) .ai-entry-action-btn {
  background: #f2f2f7 !important; color: #1c1c1e !important;
}
.ai-entry-action-btn.search { color: #64d2ff; }
.ai-entry-action-btn.edit { color: #ffd60a; }
.ai-entry-action-btn:hover { filter: brightness(1.12); }

/* Keep old class names harmless if referenced */
.ai-entry-card-badge-col, .ai-entry-saved-badge, .ai-entry-burst { display: none !important; }
.ai-check-circle, .ai-entry-aura, .ai-burst-ray { display: none; }

/* Separate Page / Drawer for 3-dot line menu */
.ai-history-panel {
  position: fixed; inset: 0; width: 100%; height: 100%; height: 100dvh;
  background: #0e1117; z-index: 2600;
  display: flex; flex-direction: column;
  box-sizing: border-box;
  animation: aiSlideIn .22s cubic-bezier(0.16, 1, 0.3, 1);
}
body.light-theme .ai-history-panel { background: #ffffff; color: #111827; }
@keyframes aiSlideIn {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}
.ai-history-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: calc(10px + env(safe-area-inset-top,0px)) 16px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}
body.light-theme .ai-history-header { border-bottom-color: rgba(0, 0, 0, 0.08); }
.ai-history-title { font-size: 17px; font-weight: 700; }
.ai-drawer-newchat-wrap {
  padding: 14px 16px 6px; flex-shrink: 0;
}
.ai-drawer-newchat-btn {
  width: 100%; display: flex; align-items: center; gap: 12px;
  background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
  color: #ffffff; border: none; border-radius: 14px;
  padding: 12px 16px; cursor: pointer; text-align: left;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.3);
  transition: transform 0.15s ease;
  box-sizing: border-box;
}
.ai-drawer-newchat-btn:active { transform: scale(0.98); }
.ai-drawer-newchat-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.22);
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; flex-shrink: 0;
}
.ai-drawer-newchat-title {
  font-size: 15px; font-weight: 700; line-height: 1.2;
}
.ai-drawer-newchat-desc {
  font-size: 11.5px; opacity: 0.85; margin-top: 2px;
}
.ai-history-search-wrap {
  display: flex; align-items: center; gap: 8px; margin: 8px 16px 10px;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 12px; padding: 9px 12px; box-sizing: border-box; flex-shrink: 0;
}
body.light-theme .ai-history-search-wrap { background: #f1f5f9; border-color: #e2e8f0; }
.ai-history-search-wrap input {
  flex: 1; border: none; background: transparent; color: inherit; outline: none; font-size: 14px;
}
.ai-history-list { flex: 1; overflow-y: auto; padding: 4px 14px 30px; box-sizing: border-box; }
.ai-history-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 12px; cursor: pointer;
  color: #e5e5e5; margin-bottom: 2px;
}
.ai-history-item:hover { background: #1c1c1e; }
.ai-history-item.active { background: #2c2c2e; }
body.light-theme .ai-history-item { color: #1c1c1e; }
body.light-theme .ai-history-item:hover,
body.light-theme .ai-history-item.active { background: #ececec; }
.ai-history-item-title {
  flex: 1; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ai-history-item-meta { font-size: 11px; color: #8e8e93; flex-shrink: 0; }
.ai-history-item .pin-ico { color: #a78bfa; font-size: 14px; }
.ai-history-section-label {
  font-size: 11px; font-weight: 600; color: #8e8e93; text-transform: uppercase;
  letter-spacing: 0.04em; padding: 12px 12px 6px;
}

.ai-live-voice-row {
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.ai-soundwave span {
  display: inline-block; width: 3px; height: 12px; background: #8b5cf6;
  border-radius: 2px; animation: aiWave 0.8s ease-in-out infinite;
}
.ai-soundwave span:nth-child(2) { animation-delay: 0.1s; }
.ai-soundwave span:nth-child(3) { animation-delay: 0.2s; }
.ai-soundwave span:nth-child(4) { animation-delay: 0.3s; }
.ai-soundwave span:nth-child(5) { animation-delay: 0.4s; }
@keyframes aiWave {
  0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1.2); }
}

@keyframes aiDotPulse {
  0%, 100% { opacity: 0.4; } 50% { opacity: 1; }
}
`;
}

// ===== Google Gemini Live: Ask Balance Chat & Voice Assistant (Modern Redesign) =====
function formatChatTimestamp(ts){
 if (!ts) return '';
 const d = new Date(ts);
 if (isNaN(d.getTime())) return '';
 const now = new Date();
 const isToday = d.toDateString() === now.toDateString();
 const timeStr = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
 if (isToday) return timeStr;
 const yest = new Date(now);
 yest.setDate(now.getDate() - 1);
 if (d.toDateString() === yest.toDateString()) return `Yesterday ${timeStr}`;
 return `${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })} ${timeStr}`;
}

function handleAiChatVisualViewport(){
 const modal = document.getElementById('aiChatModal');
 if (!modal) return;
 if (window.visualViewport) {
  const vv = window.visualViewport;
  // Pin modal to visible area without wiping background (dotted pattern must stay)
  modal.style.position = 'fixed';
  modal.style.left = '0';
  modal.style.right = '0';
  modal.style.width = '100%';
  modal.style.top = vv.offsetTop + 'px';
  modal.style.height = vv.height + 'px';
  modal.style.bottom = 'auto';
  modal.style.zIndex = '2000';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.overflow = 'hidden';
  modal.style.boxSizing = 'border-box';
  // Do NOT set background here — CSS dotted pattern must remain visible

  const bottomWrap = modal.querySelector('.ai-chat-bottom-wrap');
  if (bottomWrap) {
    const keyboardOpen = vv.height < (window.innerHeight * 0.82);
    bottomWrap.style.paddingBottom = keyboardOpen ? '2px' : 'max(6px, env(safe-area-inset-bottom, 6px))';
    bottomWrap.style.paddingTop = '6px';
  }
 }
 requestAnimationFrame(() => {
   const bodyEl = document.querySelector('.ai-chat-body');
   if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
   const listEl = document.getElementById('aiChatList');
   if (listEl) listEl.scrollTop = listEl.scrollHeight;
 });
}

// ===== Finance Assistant: Scroll, Sessions, Messenger Modal & History =====
function scrollAiChatToBottom(smooth = false){
 const bodyEl = document.querySelector('.ai-chat-body');
 if (!bodyEl) return;
 if (smooth && typeof bodyEl.scrollTo === 'function') {
  bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'smooth' });
 } else {
  bodyEl.scrollTop = bodyEl.scrollHeight;
 }
}

function startNewAiChatSession(){
 if (aiChatMessages && aiChatMessages.length > 0) {
  saveCurrentAiChatSession();
 }
 activeAiChatSessionId = null;
 aiChatMessages = [];
 window.aiChatMessages = aiChatMessages;
 try { localStorage.removeItem('aiChatLastSessionId'); } catch(e){}
 renderAiChatMessages();
 scrollAiChatToBottom(false);
 const inputEl = document.getElementById('aiChatInput');
 if (inputEl) {
  inputEl.value = '';
  inputEl.focus();
 }
}

function openAiChatModal(){
 ensureAiChatStyles();
 const existing = document.getElementById('aiChatModal');
 if (existing) existing.remove();

 try { loadAiChatHistory(); } catch(e){}

 const rawUser = (typeof currentUser !== 'undefined' && currentUser) || null;
 let userName = '';
 try {
  if (rawUser && rawUser.displayName) userName = rawUser.displayName.split(' ')[0];
  else if (rawUser && rawUser.email) userName = rawUser.email.split('@')[0].toUpperCase();
 } catch(e){}
 if (!userName) userName = 'there';

 const isMuted = !!window.aiChatVoiceMuted;

 const html = `
 <div id="aiChatModal">
  <div class="ai-chat-header">
   <div class="ai-chat-header-inner">
    <!-- 3-dot line menu button (replaces back button) -->
    <button type="button" class="ai-header-btn" id="aiChatMenuBtn" onclick="toggleAiChatHistoryPanel()" title="Menu: New Chat & History">
     <i class="ti ti-menu-2" style="font-size:20px;"></i>
    </button>
    <div class="ai-header-title-box">
     <span class="ai-header-main-title">Ask Balance</span>
     <span class="ai-header-sub-badge">AI Assistant</span>
    </div>
    <div class="ai-header-right-group" style="width:36px;"></div>
    <button type="button" id="aiChatMuteBtn" onclick="toggleAiChatMute()" style="display:none!important"></button>
    <span id="aiChatStatusPill" style="display:none!important"><span id="aiChatStatusDot"></span><span id="aiChatStatusLabel"></span></span>
   </div>
   <div id="aiChatInChatSearchBar" class="ai-inchat-search" style="display:none;">
    <i class="ti ti-search"></i>
    <input type="text" id="aiChatInChatSearchInput" placeholder="Search in this chat..." oninput="filterAiChatMessagesView()" autocomplete="off">
    <button type="button" class="ai-header-btn" onclick="toggleAiChatInChatSearch()" style="width:32px;height:32px;"><i class="ti ti-x"></i></button>
   </div>
  </div>

  <div class="ai-chat-body">
   <div id="aiChatList"></div>
  </div>

  <div class="ai-chat-bottom-wrap">
   <div class="ai-chat-bottom-inner">
    <div id="aiChatMsg" class="ai-chat-live-status"></div>
    <form id="aiChatForm" class="ai-chat-input-bar grok-composer" onsubmit="event.preventDefault(); sendAiChatMessage(); return false;">
     <div class="ai-composer-box">
      <input id="aiChatInput" type="text" enterkeyhint="send" placeholder="Ask anything" autocomplete="off">
      <div class="ai-composer-toolbar">
       <input type="file" id="aiChatBillInput" accept="image/*" capture="environment" style="display:none" onchange="handleChatBillImage(event)">
       <button type="button" onclick="triggerChatBillScan()" id="aiChatBillBtn" class="ai-tool-btn" title="Attach / scan bill">
        <i class="ti ti-plus" style="font-size:20px;"></i>
       </button>
       <span class="spacer"></span>
       <button type="button" onclick="toggleAiChatMic()" id="aiChatMicBtn" class="ai-entry-mic-btn" title="Voice">
        <i class="ti ti-microphone" id="aiChatMicIcon"></i>
       </button>
       <button type="submit" id="aiChatSendBtn" class="ai-send-circle" title="Send">
        <svg class="ai-send-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
         <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
       </button>
      </div>
     </div>
    </form>
   </div>
  </div>

  <!-- Separate Page: 3-dot line Menu (New Chat & History with Search Bar) -->
  <div id="aiChatHistoryPanel" class="ai-history-panel" style="display:none;">
   <div class="ai-history-header">
    <div style="display:flex;align-items:center;gap:10px;">
     <button type="button" class="ai-header-btn" onclick="toggleAiChatHistoryPanel()" title="Back to Chat">
      <i class="ti ti-arrow-left" style="font-size:19px;"></i>
     </button>
     <div class="ai-history-title">Chats &amp; History</div>
    </div>
    <button type="button" class="ai-header-btn" onclick="confirmClearAllAiChatSessions()" title="Clear All History">
     <i class="ti ti-trash" style="font-size:17px;color:#f87171;"></i>
    </button>
   </div>

   <!-- 1. New Chat Option -->
   <div class="ai-drawer-newchat-wrap">
    <button type="button" class="ai-drawer-newchat-btn" onclick="handleNewChatFromDrawer()">
     <div class="ai-drawer-newchat-icon"><i class="ti ti-plus"></i></div>
     <div style="flex:1;">
      <div class="ai-drawer-newchat-title">New Chat</div>
      <div class="ai-drawer-newchat-desc">Start a fresh conversation</div>
     </div>
     <i class="ti ti-chevron-right" style="opacity:0.75;font-size:17px;"></i>
    </button>
   </div>

   <!-- Pin / Unpin Current Chat Option inside 3-dot drawer -->
   <div class="ai-drawer-pin-wrap" style="padding:0 16px 10px;">
    <button type="button" id="aiDrawerPinCurrentBtn" class="ai-drawer-newchat-btn" onclick="togglePinCurrentFromDrawer()" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">
     <div class="ai-drawer-newchat-icon" style="background:rgba(167,139,250,0.18);color:#a78bfa;"><i class="ti ti-pinned" id="aiDrawerPinIcon"></i></div>
     <div style="flex:1;text-align:left;">
      <div class="ai-drawer-newchat-title" id="aiDrawerPinTitle">Pin Current Chat</div>
      <div class="ai-drawer-newchat-desc" id="aiDrawerPinDesc">Pin this conversation to top of history</div>
     </div>
     <span id="aiDrawerPinBadge" style="font-size:11px;padding:3px 8px;border-radius:6px;background:rgba(255,255,255,0.06);color:var(--uf-muted,#94a3b8);font-weight:600;">Pin</span>
    </button>
   </div>

   <!-- 2. History with Search Bar -->
   <div style="padding:10px 16px 4px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:12.5px;font-weight:700;color:var(--uf-muted);text-transform:uppercase;letter-spacing:0.5px;">Chat History</span>
    <span id="aiChatHistoryCountBadge" style="font-size:11.5px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.08);color:var(--uf-muted);font-weight:600;">0</span>
   </div>
   <div class="ai-history-search-wrap">
    <i class="ti ti-search" style="font-size:16px;color:#94a3b8;"></i>
    <input type="text" id="aiChatHistorySearchInput" placeholder="Search chat history..." oninput="renderAiChatHistoryList()" autocomplete="off">
   </div>
   <div id="aiChatHistoryList" class="ai-history-list"></div>
  </div>
 </div>`;

 const appEl = document.getElementById('app') || document.body;
 const bottomNav = document.querySelector('.bottom-nav-wrap');
 if (bottomNav && bottomNav.parentNode === appEl) {
   bottomNav.insertAdjacentHTML('beforebegin', html);
 } else {
   appEl.insertAdjacentHTML('beforeend', html);
 }

 const fab = document.getElementById('homeChatFabBtn');
 if (fab) {
  fab.style.setProperty('display', 'none', 'important');
  fab.classList.remove('show');
 }

 // Hide bottom navigation for true full-screen chat experience
 if (bottomNav) {
   bottomNav.style.setProperty('display', 'none', 'important');
   bottomNav.setAttribute('data-hidden-by-chat', '1');
 }
 // Also hide the floating + if present
 const navPlus = document.getElementById('navPlusBtn');
 if (navPlus) navPlus.style.setProperty('display', 'none', 'important');

 if (window.visualViewport) {
  let _vvTimer = null;
  const _vvDebounced = () => {
    if (_vvTimer) cancelAnimationFrame(_vvTimer);
    _vvTimer = requestAnimationFrame(handleAiChatVisualViewport);
  };
  window.visualViewport.addEventListener('resize', _vvDebounced, { passive: true });
  window.visualViewport.addEventListener('scroll', _vvDebounced, { passive: true });
  window.__aiChatVvDebounced = _vvDebounced;
  handleAiChatVisualViewport();
 }

 renderAiChatMessages(userName);
 requestAnimationFrame(() => scrollAiChatToBottom(false));
 setTimeout(() => scrollAiChatToBottom(false), 60);
 setTimeout(() => scrollAiChatToBottom(false), 250);

 // Status line hidden — only chat message results are shown
 const msgEl = document.getElementById('aiChatMsg');
 if (msgEl) msgEl.innerHTML = '';
}


function closeAiChatModal(){
 const fab = document.getElementById('homeChatFabBtn');
 if (fab) {
  fab.style.removeProperty('display');
  if (typeof currentAppScreen !== 'undefined' && currentAppScreen === 'wallet') {
   fab.classList.add('show');
  }
 }
 // Restore bottom navigation
 const bottomNav = document.querySelector('.bottom-nav-wrap');
 if (bottomNav && bottomNav.getAttribute('data-hidden-by-chat') === '1') {
   bottomNav.style.removeProperty('display');
   bottomNav.removeAttribute('data-hidden-by-chat');
 }
 const navPlus = document.getElementById('navPlusBtn');
 if (navPlus) navPlus.style.removeProperty('display');

 if (window.visualViewport) {
  try {
   const fn = window.__aiChatVvDebounced || handleAiChatVisualViewport;
   window.visualViewport.removeEventListener('resize', fn);
   window.visualViewport.removeEventListener('scroll', fn);
  } catch(e){}
 }
 window.__aiChatUserCancelled = true;
 window.__aiChatResumeAfterSpeak = false;
 try { if (typeof stopAiChatVoiceCapture === 'function') stopAiChatVoiceCapture(false); } catch(e){}
 try { if (typeof stopAiChatMic === 'function') stopAiChatMic(); } catch(e){}
 if (window.__aiChatRecognition) {
  try { window.__aiChatRecognition.abort(); } catch(e){}
  window.__aiChatRecognition = null;
 }
 if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch(e){} }

 // Save but KEEP last session so reopen shows same chat (not blank new page)
 if (aiChatMessages && aiChatMessages.length > 0) {
  saveCurrentAiChatSession();
  try {
   if (activeAiChatSessionId) localStorage.setItem('aiChatLastSessionId', activeAiChatSessionId);
  } catch(e){}
 }
 // Do NOT clear aiChatMessages / activeAiChatSessionId — resume on next open

 const el = document.getElementById('aiChatModal');
 if (el) el.remove();
}

function toggleAiChatMute(){
 window.aiChatVoiceMuted = !window.aiChatVoiceMuted;
 try { localStorage.setItem('aiChatVoiceMuted', window.aiChatVoiceMuted ? 'true' : 'false'); } catch(e){}
 const btn = document.getElementById('aiChatMuteBtn');
 if (btn) {
  if (window.aiChatVoiceMuted) {
   btn.innerHTML = '<i class="ti ti-volume-off" style="color:#f87171;font-size:17px;"></i>';
   btn.title = "Voice Muted (Text-only replies)";
  } else {
   btn.innerHTML = '<i class="ti ti-volume" style="color:#38bdf8;font-size:17px;"></i>';
   btn.title = "Voice Response ON";
  }
 }
 if (window.speechSynthesis && window.aiChatVoiceMuted) {
  try { window.speechSynthesis.cancel(); } catch(e){}
 }
}

function confirmClearAiChatHistory(){
 if (!aiChatMessages || aiChatMessages.length === 0) {
  return;
 }
 if (confirm("Do you want to clear the current chat?")) {
  clearAiChatHistory();
 }
}

function clearAiChatHistory(){
 aiChatMessages = [];
 activeAiChatSessionId = null;
 renderAiChatMessages();
 renderAiChatHistoryList();
 if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch(e){} }
 setAiChatHeaderState('idle');
}



function toggleAiChatHeaderMenu(){
  const m = document.getElementById('aiChatHeaderMenu');
  if (!m) return;
  m.style.display = (m.style.display === 'none' || !m.style.display) ? 'flex' : 'none';
}
document.addEventListener('click', function(e){
  const wrap = document.querySelector('.ai-header-menu-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const m = document.getElementById('aiChatHeaderMenu');
    if (m) m.style.display = 'none';
  }
});
function toggleAiChatInChatSearch(){
  const bar = document.getElementById('aiChatInChatSearchBar');
  if (!bar) return;
  const show = bar.style.display === 'none' || !bar.style.display;
  bar.style.display = show ? 'flex' : 'none';
  if (show) {
    const inp = document.getElementById('aiChatInChatSearchInput');
    if (inp) { inp.value = ''; inp.focus(); }
    filterAiChatMessagesView();
  } else {
    document.querySelectorAll('#aiChatList .ai-msg-row').forEach(el => el.classList.remove('ai-search-hidden'));
  }
}
function filterAiChatMessagesView(){
  const inp = document.getElementById('aiChatInChatSearchInput');
  const q = (inp && inp.value || '').toLowerCase().trim();
  const rows = document.querySelectorAll('#aiChatList .ai-msg-row');
  rows.forEach((row, i) => {
    if (!q) { row.classList.remove('ai-search-hidden'); return; }
    const m = (aiChatMessages || [])[i];
    const text = (m && m.text || row.textContent || '').toLowerCase();
    row.classList.toggle('ai-search-hidden', !text.includes(q));
  });
}
function updateDrawerPinCurrentState(){
  try {
    const titleEl = document.getElementById('aiDrawerPinTitle');
    const descEl = document.getElementById('aiDrawerPinDesc');
    const badgeEl = document.getElementById('aiDrawerPinBadge');
    const iconEl = document.getElementById('aiDrawerPinIcon');
    if (!titleEl || !badgeEl) return;

    loadAiChatSessions();
    const currentSess = (aiChatSessions || []).find(s => s.id === activeAiChatSessionId);
    const isPinned = !!(currentSess && currentSess.pinned);

    if (isPinned) {
      titleEl.textContent = 'Unpin Current Chat';
      if (descEl) descEl.textContent = 'Currently pinned at the top of history';
      badgeEl.textContent = 'Pinned';
      badgeEl.style.background = 'rgba(167,139,250,0.25)';
      badgeEl.style.color = '#c4b5fd';
      if (iconEl) {
        iconEl.className = 'ti ti-pinned';
        iconEl.style.color = '#a78bfa';
      }
    } else {
      titleEl.textContent = 'Pin Current Chat';
      if (descEl) descEl.textContent = 'Pin this conversation to top of history';
      badgeEl.textContent = 'Pin';
      badgeEl.style.background = 'rgba(255,255,255,0.06)';
      badgeEl.style.color = 'var(--uf-muted, #94a3b8)';
      if (iconEl) {
        iconEl.className = 'ti ti-pin';
        iconEl.style.color = '#94a3b8';
      }
    }
  } catch(e){ console.warn(e); }
}

function togglePinCurrentFromDrawer(){
  try {
    if (typeof saveCurrentAiChatSession === 'function') saveCurrentAiChatSession();
    loadAiChatSessions();
    if (!activeAiChatSessionId) {
      if (typeof showNotification === 'function') showNotification('Pehle kuch chat karein, phir pin karein', 'info');
      return;
    }
    let sess = (aiChatSessions || []).find(s => s.id === activeAiChatSessionId);
    if (!sess) {
      if (typeof showNotification === 'function') showNotification('Session save karke phir pin karein', 'info');
      return;
    }
    sess.pinned = !sess.pinned;
    sess.updatedAt = Date.now();
    // sort pinned first
    aiChatSessions.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
    saveAiChatSessions();
    renderAiChatHistoryList();
    updateDrawerPinCurrentState();
    if (typeof showNotification === 'function') {
      showNotification(sess.pinned ? 'Chat pinned to top' : 'Chat unpinned', 'success');
    }
  } catch(e) { console.warn(e); }
}

function togglePinChatSession(id){
  try {
    loadAiChatSessions();
    const sess = (aiChatSessions || []).find(s => s.id === id);
    if (!sess) return;
    sess.pinned = !sess.pinned;
    sess.updatedAt = Date.now();
    aiChatSessions.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
    saveAiChatSessions();
    renderAiChatHistoryList();
    updateDrawerPinCurrentState();
    if (typeof showNotification === 'function') {
      showNotification(sess.pinned ? 'Chat pinned to top' : 'Chat unpinned', 'success');
    }
  } catch(e) { console.warn(e); }
}

function togglePinCurrentAiChat(){
  togglePinCurrentFromDrawer();
}
function feedbackAiMessage(idx, good){
  const btns = document.querySelectorAll(`#aiChatList .ai-msg-row.assistant`);
  // visual only
  if (typeof showNotification === 'function') {
    showNotification(good ? 'Thanks for the feedback 👍' : 'Thanks — we will improve 👎', 'success');
  }
}
function shareAiChatMessage(idx){
  const m = (aiChatMessages || [])[idx];
  if (!m) return;
  if (m.entryData && typeof shareAiChatEntry === 'function') {
    shareAiChatEntry(idx);
    return;
  }
  const text = m.text || '';
  if (!text) return;
  if (navigator.share) {
    navigator.share({ text: text }).catch(() => {});
  } else {
    copyAiChatText(text, null);
    if (typeof showNotification === 'function') showNotification('Copied to share', 'success');
  }
}
function retryAiChatMessage(idx){
  // find previous user message
  for (let i = idx - 1; i >= 0; i--) {
    const m = aiChatMessages[i];
    if (m && m.role === 'user' && m.text) {
      sendAiChatMessage(m.text);
      return;
    }
  }
}

function handleNewChatFromDrawer(){
 closeAiChatHistoryPanel();
 startNewAiChatSession();
 updateDrawerPinCurrentState();
 setTimeout(() => {
  const inp = document.getElementById('aiChatInput');
  if (inp) inp.focus();
 }, 80);
}

function toggleAiChatHistoryPanel(){
 const panel = document.getElementById('aiChatHistoryPanel');
 if (!panel) return;
 if (panel.style.display === 'none' || !panel.style.display) {
  panel.style.display = 'flex';
  renderAiChatHistoryList();
  updateDrawerPinCurrentState();
 } else {
  panel.style.display = 'none';
 }
}

function closeAiChatHistoryPanel(){
 const panel = document.getElementById('aiChatHistoryPanel');
 if (panel) panel.style.display = 'none';
}

function renderAiChatHistoryList(){
 const container = document.getElementById('aiChatHistoryList');
 if (!container) return;
 const searchInput = document.getElementById('aiChatHistorySearchInput');
 const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

 loadAiChatSessions();
 let list = aiChatSessions || [];
 const badge = document.getElementById('aiChatHistoryCountBadge');
 if (badge) badge.textContent = list.length;

 list = [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
 if (query) {
  list = list.filter(s => {
   const inTitle = (s.title || '').toLowerCase().includes(query);
   const inMsgs = Array.isArray(s.messages) && s.messages.some(m => (m.text || '').toLowerCase().includes(query));
   return inTitle || inMsgs;
  });
 }

 if (list.length === 0) {
  container.innerHTML = `
   <div class="ai-history-empty" style="text-align:center;padding:40px 16px;color:#64748b;">
    <i class="ti ti-messages-off" style="font-size:32px;margin-bottom:8px;display:block;color:#64748b;"></i>
    <div style="font-size:14px;font-weight:600;color:#94a3b8;">${query ? 'No matching chat found' : 'No chat history yet'}</div>
    <div style="font-size:12px;color:#64748b;margin-top:4px;">Past conversations are automatically saved here when you close a chat.</div>
   </div>
  `;
  updateDrawerPinCurrentState();
  return;
 }

 const pinned = list.filter(s => s.pinned);
 const rest = list.filter(s => !s.pinned);
 const renderItem = (s) => {
  const d = new Date(s.updatedAt || s.timestamp || Date.now());
  const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const timeStr = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const title = s.title || 'Conversation';
  const isActive = s.id === activeAiChatSessionId;
  return `
   <div class="ai-history-item ${isActive ? 'active' : ''}" onclick="resumeAiChatSession('${s.id}')">
    ${s.pinned ? '<i class="ti ti-pinned pin-ico"></i>' : '<i class="ti ti-message" style="color:#8e8e93;font-size:15px;"></i>'}
    <div class="ai-history-item-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
    <span class="ai-history-item-meta">${dateStr}</span>
    <button type="button" class="ai-header-btn ${s.pinned ? 'pinned' : ''}" style="width:28px;height:28px;background:transparent;margin-right:2px;" onclick="event.stopPropagation();togglePinChatSession('${s.id}')" title="${s.pinned ? 'Unpin chat' : 'Pin chat to top'}">
     <i class="${s.pinned ? 'ti ti-pinned' : 'ti ti-pin'}" style="font-size:15px;color:${s.pinned ? '#a78bfa' : '#8e8e93'};"></i>
    </button>
    <button type="button" class="ai-header-btn" style="width:28px;height:28px;background:transparent;" onclick="event.stopPropagation();deleteAiChatSession('${s.id}')" title="Delete">
     <i class="ti ti-trash" style="font-size:14px;color:#8e8e93;"></i>
    </button>
   </div>`;
 };
 let html = '';
 if (pinned.length) {
  html += '<div class="ai-history-section-label">Pinned</div>' + pinned.map(renderItem).join('');
 }
 if (rest.length) {
  html += '<div class="ai-history-section-label">Chats</div>' + rest.map(renderItem).join('');
 }
 container.innerHTML = html;
 updateDrawerPinCurrentState();
}

function resumeAiChatSession(id){
 const session = (aiChatSessions || []).find(s => s.id === id);
 if (!session) return;
 saveCurrentAiChatSession();
 activeAiChatSessionId = session.id;
 aiChatMessages = (session.messages || []).map(m => ({ ...m }));
 window.aiChatMessages = aiChatMessages;
 try { localStorage.setItem('aiChatLastSessionId', id); } catch(e){}
 closeAiChatHistoryPanel();
 renderAiChatMessages();
 updateDrawerPinCurrentState();
 setTimeout(() => scrollAiChatToBottom(true), 60);
}

function deleteAiChatSession(id){
 aiChatSessions = (aiChatSessions || []).filter(s => s.id !== id);
 saveAiChatSessions();
 if (activeAiChatSessionId === id) {
  activeAiChatSessionId = null;
  aiChatMessages = [];
  renderAiChatMessages();
 }
 renderAiChatHistoryList();
}

function confirmClearAllAiChatSessions(){
 if (!aiChatSessions || aiChatSessions.length === 0) return;
 if (confirm("Are you sure you want to delete all chat history?")) {
  aiChatSessions = [];
  saveAiChatSessions();
  activeAiChatSessionId = null;
  aiChatMessages = [];
  renderAiChatMessages();
  renderAiChatHistoryList();
 }
}

function deleteAiChatHistoryItem(idx){
 if (idx >= 0 && idx < aiChatMessages.length) {
  aiChatMessages.splice(idx, 1);
  saveCurrentAiChatSession();
  renderAiChatMessages();
 }
}

function executeInChatSearch(keyword){
 const q = String(keyword || '').toLowerCase().trim();
 const allEntries = (typeof entries !== 'undefined' ? entries : []);
 const matches = allEntries.filter(e => {
  const p = (e.party || '').toLowerCase();
  const n = (e.notes || '').toLowerCase();
  const m = (e.method || '').toLowerCase();
  const a = String(e.amount || '');
  return p.includes(q) || n.includes(q) || m.includes(q) || a.includes(q);
 });

 let reply = '';
 if (matches.length === 0) {
  reply = `🔍 No transactions found matching "${keyword}".`;
 } else {
  const list = matches.slice(0, 6).map(e => {
   const sign = (typeof isExpenseType === 'function' ? isExpenseType(e.type) : e.type !== 'income') ? '-' : '+';
   return `• ${e.date}: ${sign}₹${Number(e.amount).toLocaleString('en-IN')} (${e.party || 'Self'} • ${e.method || 'Cash'}${e.notes ? ' • ' + e.notes : ''})`;
  }).join('\n');
  reply = `🔍 Found ${matches.length} transaction${matches.length > 1 ? 's' : ''} matching "${keyword}":\n\n${list}${matches.length > 6 ? `\n\n*(Showing top 6 of ${matches.length})*` : ''}`;
 }

 aiChatMessages.push({ role: 'user', text: `Search: ${keyword}`, timestamp: Date.now() });
 aiChatMessages.push({ role: 'ai', text: reply, timestamp: Date.now() });
 saveCurrentAiChatSession();
 renderAiChatMessages();
 setTimeout(() => scrollAiChatToBottom(true), 60);
}

function searchChatQueryInEntries(queryOrIdx){
 let q = '';
 if (typeof queryOrIdx === 'number') {
  const m = (window.aiChatMessages || aiChatMessages)[queryOrIdx];
  if (m) {
   if (m.entryData && m.entryData.party) q = m.entryData.party;
   else q = m.text || '';
  }
 } else {
  q = String(queryOrIdx || '').trim();
 }
 if (!q) q = 'Food';
 q = q.replace(/^["']|["']$/g, '');
 q = q.replace(/^(search|khojo|dekho|check|poocho|batao|kripya)\s+/i, '').trim();

 // Directly search and display results inside the assistant chat without kicking user out
 executeInChatSearch(q);
}

function useChatInNewEntry(textOrIdx, entryData){
 let text = '';
 let data = entryData;
 if (typeof textOrIdx === 'number') {
  const m = (window.aiChatMessages || aiChatMessages)[textOrIdx];
  if (m) {
   text = m.text || '';
   if (!data && m.entryData) data = m.entryData;
  }
 } else {
  text = String(textOrIdx || '');
 }

 // Direct in-chat action: populate input field ready for instant confirmation/edit
 const inputEl = document.getElementById('aiChatInput');
 if (inputEl) {
  if (data && data.amount) {
   inputEl.value = `Paid ₹${data.amount} to ${data.party || 'Self'} via ${data.method || 'Cash'}${data.notes ? ' for ' + data.notes : ''}`;
  } else if (text) {
   inputEl.value = text;
  } else {
   inputEl.value = 'Paid ₹500 via Cash for ';
  }
  inputEl.focus();
  const len = inputEl.value.length;
  inputEl.setSelectionRange(len, len);
 }
}

function editAndReuseChatMessage(textOrIdx){
 closeAiChatHistoryPanel();
 let text = '';
 if (typeof textOrIdx === 'number') {
  const m = (window.aiChatMessages || aiChatMessages)[textOrIdx];
  text = m ? (m.text || '') : '';
 } else {
  text = String(textOrIdx || '');
 }
 const inputEl = document.getElementById('aiChatInput');
 if (inputEl) {
  inputEl.value = text || '';
  inputEl.focus();
  const len = inputEl.value.length;
  inputEl.setSelectionRange(len, len);
 }
}

function copyAiChatText(textOrIdx, btn){
 let text = '';
 if (typeof textOrIdx === 'number') {
  const m = (window.aiChatMessages || aiChatMessages)[textOrIdx];
  text = m ? (m.text || '') : '';
 } else {
  text = String(textOrIdx || '');
 }
 if (!text) return;
 try {
  if (navigator.clipboard && navigator.clipboard.writeText) {
   navigator.clipboard.writeText(text);
  } else {
   const ta = document.createElement('textarea');
   ta.value = text;
   document.body.appendChild(ta);
   ta.select();
   document.execCommand('copy');
   ta.remove();
  }
  if (btn) {
   const oldHtml = btn.innerHTML;
   btn.innerHTML = '<i class="ti ti-check" style="color:#10b981;"></i>';
   setTimeout(() => { if (btn) btn.innerHTML = oldHtml; }, 1500);
  }
  if (typeof showNotification === 'function') showNotification('Copied', 'success');
 } catch(e){}
}


function setAiChatSendThinking(isThinking){
  const btn = document.getElementById('aiChatSendBtn');
  if (!btn) return;
  if (isThinking) {
    btn.classList.add('is-thinking');
    btn.disabled = true;
    btn.setAttribute('title', 'Thinking...');
    btn.innerHTML = '<span class="ai-send-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
  } else {
    btn.classList.remove('is-thinking');
    btn.disabled = false;
    btn.setAttribute('title', 'Send');
    btn.innerHTML = `<svg class="ai-send-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M12 5l-6 6M12 5l6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
}

function setAiChatHeaderState(state, customText){
 const pill = document.getElementById('aiChatStatusPill');
 const dot = document.getElementById('aiChatStatusDot');
 const label = document.getElementById('aiChatStatusLabel');
 if (!pill || !dot || !label) return;

 const s = state || 'idle';
 pill.className = 'ai-status-pill ' + s;
 dot.className = 'ai-status-dot ' + s;

 if (s === 'listening') {
  label.textContent = customText || 'Listening...';
  if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(false);
 } else if (s === 'thinking') {
  label.textContent = customText || 'Thinking...';
  if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(true);
 } else if (s === 'speaking') {
  const activeModelDisplay = (typeof getActiveGeminiModelDisplay === 'function') ? getActiveGeminiModelDisplay() : 'Online';
  label.textContent = customText || activeModelDisplay;
  if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(false);
 } else {
  label.textContent = customText || 'Online';
  if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(false);
 }
}

function copyAiMessageText(idx, btn){
 if (!aiChatMessages[idx] || !aiChatMessages[idx].text) return;
 const text = aiChatMessages[idx].text;
 copyAiChatText(text, btn);
}

function speakAiMessageFromChat(idx){
 if (!aiChatMessages[idx] || !aiChatMessages[idx].text) return;
 const text = aiChatMessages[idx].text;
 setAiChatHeaderState('speaking');
 speakText(text, () => {
  setAiChatHeaderState('idle');
 });
}

function formatAiMessage(text){
 if (!text) return '';
 let formatted = String(text);
 formatted = formatted.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
 // Grok-style: headings, bold, bullets, numbers
 formatted = formatted.replace(/^###\s+(.+)$/gm, '<div class="ai-h3">$1</div>');
 formatted = formatted.replace(/^##\s+(.+)$/gm, '<div class="ai-h2">$1</div>');
 formatted = formatted.replace(/^#\s+(.+)$/gm, '<div class="ai-h2">$1</div>');
 formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong class="ai-strong">$1</strong>');
 formatted = formatted.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');
 formatted = formatted.replace(/(₹\s?[\d,]+(?:\.\d+)?)/g, '<span class="ai-chip">$1</span>');
 const lines = formatted.split(/\r?\n/);
 const out = [];
 for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const line = raw.trim();
  if (!line) {
   out.push('<div class="ai-para-gap"></div>');
   continue;
  }
  if (line.startsWith('<div class="ai-h')) {
   out.push(line);
   continue;
  }
  const numMatch = line.match(/^(\d+)[\.)]\s+(.+)$/);
  const bulletMatch = line.match(/^[•\-\*]\s*(.+)$/);
  if (numMatch) {
   out.push('<div class="ai-bullet-line"><span class="ai-num">' + numMatch[1] + '.</span><span class="ai-bullet-text">' + numMatch[2] + '</span></div>');
  } else if (bulletMatch) {
   out.push('<div class="ai-bullet-line"><span class="ai-bullet-sparkle">•</span><span class="ai-bullet-text">' + bulletMatch[1] + '</span></div>');
  } else {
   out.push('<div class="ai-para">' + line + '</div>');
  }
 }
 return out.join('');
}

// ===== Gemini Live Voice Mic inside Ask Balance Chat =====
let aiChatVoiceActive = false;
let aiChatVoicePcm = [];
let aiChatVoiceCtx = null;
let aiChatVoiceProc = null;
let aiChatVoiceSrc = null;
let aiChatVoiceStream = null;
let aiChatVoiceAbortCtrl = null;
let aiChatVoiceProcessing = false;

async function toggleAiChatMic(){
 if (aiChatVoiceProcessing) {
  try { if (aiChatVoiceAbortCtrl) { aiChatVoiceAbortCtrl.abort(); aiChatVoiceAbortCtrl = null; } } catch(e){}
  aiChatVoiceProcessing = false;
  window.__aiChatUserCancelled = true;
  const msgEl = document.getElementById('aiChatMsg');
  if (msgEl) msgEl.textContent = "";
  setAiChatHeaderState('idle');
  return;
 }
 // Second tap while listening = stop & user explicitly ended voice session
 if (aiChatVoiceActive) {
  window.__aiChatUserCancelled = true;
  stopAiChatVoiceCapture(true);
  return;
 }
 window.__aiChatUserCancelled = false;
 if (window.speechSynthesis && window.speechSynthesis.speaking) {
  try { window.speechSynthesis.cancel(); } catch(e){}
 }
 // Gemini key optional for listen; answers/complex entry better with key
 await startAiChatVoiceCapture();
}

async function startAiChatAudioCaptureFallback(){
 const msgEl = document.getElementById('aiChatMsg');
 if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  aiChatVoiceActive = false;
  setAiChatHeaderState('idle');
  if (msgEl) msgEl.textContent = "⚠️ Ye browser microphone support nahi karta.";
  return;
 }
 try {
  const stream = await navigator.mediaDevices.getUserMedia({
   audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  aiChatVoiceStream = stream;
  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtxClass) return;
  const audioCtx = new AudioCtxClass();
  aiChatVoiceCtx = audioCtx;
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  const source = audioCtx.createMediaStreamSource(stream);
  aiChatVoiceSrc = source;
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  aiChatVoiceProc = processor;
  aiChatVoicePcm = [];
  aiChatVoiceActive = true;
  let hasSpoken = false;
  let silenceStart = null;
  const SILENCE_MS_TO_STOP = 2200;
  const SPEECH_THRESHOLD = 0.006;
  const startedAt = Date.now();
  const MAX_RECORD_MS = 25000;

  processor.onaudioprocess = (e) => {
   if (!aiChatVoiceActive) return;
   const inputData = e.inputBuffer.getChannelData(0);
   aiChatVoicePcm.push(new Float32Array(inputData));
   let sum = 0;
   for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
   const rms = Math.sqrt(sum / inputData.length);
   if (rms > SPEECH_THRESHOLD) {
    hasSpoken = true;
    silenceStart = null;
   } else if (hasSpoken) {
    if (silenceStart === null) silenceStart = Date.now();
    else if (Date.now() - silenceStart > SILENCE_MS_TO_STOP) {
     stopAiChatVoiceCapture(hasSpoken);
     return;
    }
   }
   if (Date.now() - startedAt > MAX_RECORD_MS) {
    stopAiChatVoiceCapture(hasSpoken);
    return;
   }
  };
  source.connect(processor);
  processor.connect(audioCtx.destination);
 } catch(err) {
  aiChatVoiceActive = false;
  setAiChatHeaderState('idle');
  if (msgEl) msgEl.textContent = "⚠️ Mic error: " + (err.message || err);
 }
}


// ===== Voice accuracy: normalize Hindi/Hinglish ASR output =====
function deduplicateSpeechPhrase(str) {
  if (!str || typeof str !== 'string') return '';
  let text = str.trim().replace(/\s+/g, ' ');
  text = text.replace(/(\S+)(?:\s+\1)+/gi, '$1');
  let changed = true, loops = 0;
  while (changed && loops < 8) {
    changed = false; loops++;
    for (let len = 10; len >= 2; len--) {
      const pattern = new RegExp('((?:\\S+\\s+){' + (len - 1) + '}\\S+)(?:\\s+\\1)+', 'gi');
      const next = text.replace(pattern, '$1');
      if (next !== text) { text = next; changed = true; }
    }
  }
  const words = text.split(' ');
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[0]) {
      const p1 = words.slice(0, i).join(' ');
      const p2 = words.slice(i).join(' ');
      if (p2.startsWith(p1)) return deduplicateSpeechPhrase(p2);
    }
  }
  return text.trim();
}

function normalizeVoiceTranscript(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let t = deduplicateSpeechPhrase(raw);
  // Common ASR Hindi number words → digits (entry accuracy)
  const numMap = {
    'zero': '0', 'ek': '1', 'एक': '1', 'do': '2', 'दो': '2', 'teen': '3', 'तीन': '3',
    'char': '4', 'chaar': '4', 'चार': '4', 'paanch': '5', 'panch': '5', 'पाँच': '5', 'पांच': '5',
    'chhe': '6', 'chhah': '6', 'छह': '6', 'saat': '7', 'सात': '7', 'aath': '8', 'आठ': '8',
    'nau': '9', 'नौ': '9', 'das': '10', 'दस': '10', 'bees': '20', 'बीस': '20',
    'tees': '30', 'तीस': '30', 'chalis': '40', 'चालीस': '40', 'pachaas': '50', 'पचास': '50',
    'saath': '60', 'साठ': '60', 'sattar': '70', 'सत्तर': '70', 'assi': '80', 'अस्सी': '80',
    'nabbe': '90', 'नब्बे': '90', 'sau': '100', 'सौ': '100', 'hazaar': '1000', 'हजार': '1000',
    'hazār': '1000'
  };
  // Fix common finance ASR mishears
  const wordFix = {
    'self': 'self', 'सैलफ': 'self', 'सेल्फ': 'self', 'shelf': 'self',
    'upi': 'UPI', 'यू पी आई': 'UPI', 'up i': 'UPI', 'you p i': 'UPI',
    'cash': 'cash', 'कैश': 'cash', 'kash': 'cash',
    'pay kiye': 'pay kiye', 'pe kiye': 'pay kiye', 'paykiye': 'pay kiye',
    'diye': 'diye', 'mila': 'mila', 'receive': 'receive',
    'rupees': 'rupees', 'rupaye': 'rupees', 'रुपये': 'rupees', 'rs': 'rupees'
  };
  // Apply number words as whole words
  t = t.replace(/\b([a-zA-Z\u0900-\u097F]+)\b/g, (w) => {
    const low = w.toLowerCase();
    if (numMap[low]) return numMap[low];
    if (numMap[w]) return numMap[w];
    return w;
  });
  // Phrase fixes
  t = t.replace(/\b(shelf|सैलफ|सेल्फ)\b/gi, 'self');
  t = t.replace(/\b(you\s*p\s*i|yu\s*p\s*i|यू\s*पी\s*आई)\b/gi, 'UPI');
  t = t.replace(/\b(kash|कैश)\b/gi, 'cash');
  t = t.replace(/\b(paykiye|pe kiye)\b/gi, 'pay kiye');
  t = t.replace(/\b(rupaye|रुपये|rs\.?)\b/gi, 'rupees');
  // "500 rupees" spacing
  t = t.replace(/(\d)\s*(rupees|rs)/gi, '$1 rupees');
  // Collapse spaces
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function pickBestSpeechAlternative(result) {
  if (!result || !result.length) return { transcript: '', confidence: 0 };
  let best = result[0];
  let bestConf = typeof best.confidence === 'number' ? best.confidence : 0;
  for (let i = 1; i < result.length; i++) {
    const c = typeof result[i].confidence === 'number' ? result[i].confidence : 0;
    if (c > bestConf) { best = result[i]; bestConf = c; }
  }
  return { transcript: (best.transcript || '').trim(), confidence: bestConf };
}

async function startAiChatVoiceCapture(){
 const micBtn = document.getElementById('aiChatMicBtn');
 const msgEl = document.getElementById('aiChatMsg');
 const inputEl = document.getElementById('aiChatInput');

 try { if (aiChatVoiceAbortCtrl) { aiChatVoiceAbortCtrl.abort(); aiChatVoiceAbortCtrl = null; } } catch(e){}
 aiChatVoiceProcessing = false;

 // Clean up lingering stream / processor / recognition before new session
 try {
  if (window.__aiChatRecognition) {
   try { window.__aiChatRecognition.abort(); } catch(e){}
   window.__aiChatRecognition = null;
  }
  if (aiChatVoiceProc) { aiChatVoiceProc.disconnect(); aiChatVoiceProc.onaudioprocess = null; aiChatVoiceProc = null; }
  if (aiChatVoiceSrc) { aiChatVoiceSrc.disconnect(); aiChatVoiceSrc = null; }
  if (aiChatVoiceCtx) { const c = aiChatVoiceCtx; aiChatVoiceCtx = null; try { c.close(); } catch(e){} }
  if (aiChatVoiceStream) { aiChatVoiceStream.getTracks().forEach(t => t.stop()); aiChatVoiceStream = null; }
 } catch(e){}
 aiChatVoiceActive = false;
 aiChatVoicePcm = [];
 window.__aiChatTranscript = "";

 if (micBtn) {
  micBtn.classList.add('listening');
  micBtn.innerHTML = '<i class="ti ti-player-stop" id="aiChatMicIcon" style="font-size:19px;color:#ec4899;"></i>';
 }
 setAiChatHeaderState('listening', 'Listening — entry / question...');

// (uses global deduplicateSpeechPhrase / normalizeVoiceTranscript)

 if (msgEl) {
  msgEl.innerHTML = `<div class="ai-live-voice-row"><div class="ai-soundwave"><span></span><span></span><span></span><span></span><span></span></div><span class="ai-live-voice-text">🎤 Bolkar entry ya sawal — e.g. 500 cash se chai</span></div>`;
 }

 playMicFeedbackSound('switch_ask');
 aiChatVoiceActive = true;

 const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
 if (SR) {
  try {
   const liveRec = new SR();
   // hi-IN best for Hindi+Hinglish; browser may also accept mixed English words
   liveRec.lang = 'hi-IN';
   liveRec.continuous = true;
   liveRec.interimResults = true;
   liveRec.maxAlternatives = 5;
   let silenceTimer = null;
   let hasSpoken = false;
   let lastResultTime = Date.now();

   // 8.5s silence guard: if user remains silent during continuous Q&A, return to idle smoothly
   let noSpeechAutoTimeout = setTimeout(() => {
    if (aiChatVoiceActive && !hasSpoken) {
     window.__aiChatUserCancelled = true;
     stopAiChatVoiceCapture(false);
     const m = document.getElementById('aiChatMsg');
     if (m) m.innerHTML = '';
     setAiChatHeaderState('idle');
    }
   }, 8500);

   const scheduleSilenceStop = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    // 1.8s pause after speech -> auto-process answer or entry (Gemini Live responsiveness)
    silenceTimer = setTimeout(() => {
     if (aiChatVoiceActive && hasSpoken) {
      stopAiChatVoiceCapture(true);
     }
    }, 1800);
   };

   liveRec.onresult = (ev) => {
    let finalParts = [];
    let interim = '';
    for (let i = 0; i < ev.results.length; i++) {
      const res = ev.results[i];
      const best = (typeof pickBestSpeechAlternative === 'function')
        ? pickBestSpeechAlternative(res)
        : { transcript: (res[0] && res[0].transcript) || '', confidence: 0 };
      const piece = (best.transcript || '').trim();
      if (!piece) continue;
      if (res.isFinal) finalParts.push(piece);
      else interim = piece;
    }
    let full = finalParts.join(' ').trim();
    if (interim) full = (full ? full + ' ' : '') + interim;
    const cleanText = (typeof normalizeVoiceTranscript === 'function')
      ? normalizeVoiceTranscript(full)
      : deduplicateSpeechPhrase(full);
    if (cleanText) {
     if (noSpeechAutoTimeout) { clearTimeout(noSpeechAutoTimeout); noSpeechAutoTimeout = null; }
     hasSpoken = true;
     lastResultTime = Date.now();
     window.__aiChatTranscript = cleanText;
     if (msgEl) msgEl.innerHTML = `<span style="color:#2dd4bf;">🎙️ "${cleanText}"</span>`;
     if (inputEl) inputEl.value = cleanText;
     scheduleSilenceStop();
    }
   };

   liveRec.onerror = (ev) => {
    if (noSpeechAutoTimeout) { clearTimeout(noSpeechAutoTimeout); noSpeechAutoTimeout = null; }
    if (ev?.error === 'no-speech') return;
    if (ev?.error === 'audio-capture' || ev?.error === 'not-allowed') {
     if (!window.__aiChatTranscript) {
      startAiChatAudioCaptureFallback();
     }
    }
   };

   liveRec.onend = () => {
    if (noSpeechAutoTimeout) { clearTimeout(noSpeechAutoTimeout); noSpeechAutoTimeout = null; }
    if (aiChatVoiceActive) {
     if (hasSpoken) {
      // Already scheduling stop via silence timer; force if needed
      if (Date.now() - lastResultTime > 1200) stopAiChatVoiceCapture(true);
     } else {
      setTimeout(() => {
       if (aiChatVoiceActive && !hasSpoken) {
        try { liveRec.start(); } catch(e){ stopAiChatVoiceCapture(false); }
       }
      }, 250);
     }
    }
   };

   liveRec.start();
   window.__aiChatRecognition = liveRec;
   return;
  } catch(e){}
 }

 await startAiChatAudioCaptureFallback();
}

async function stopAiChatVoiceCapture(hasSpokenManual){
 if (!aiChatVoiceActive) return;
 aiChatVoiceActive = false;
 playMicFeedbackSound('stop');

 if (window.__aiChatRecognition) {
  try { window.__aiChatRecognition.stop(); } catch(e){}
  window.__aiChatRecognition = null;
 }

 const srcRate = (aiChatVoiceCtx && aiChatVoiceCtx.sampleRate) || 44100;

 try {
  if (aiChatVoiceProc) { aiChatVoiceProc.disconnect(); aiChatVoiceProc.onaudioprocess = null; aiChatVoiceProc = null; }
  if (aiChatVoiceSrc) { aiChatVoiceSrc.disconnect(); aiChatVoiceSrc = null; }
  if (aiChatVoiceCtx) { const c = aiChatVoiceCtx; aiChatVoiceCtx = null; try { c.close(); } catch(e){} }
  if (aiChatVoiceStream) { aiChatVoiceStream.getTracks().forEach(t => t.stop()); aiChatVoiceStream = null; }
 } catch(e){}

 const micBtn = document.getElementById('aiChatMicBtn');
 const msgEl = document.getElementById('aiChatMsg');
 const inputEl = document.getElementById('aiChatInput');

 if (micBtn) {
  micBtn.classList.remove('listening');
  micBtn.innerHTML = '<i class="ti ti-microphone" id="aiChatMicIcon"></i>';
 }
 if (msgEl) msgEl.innerHTML = '';

 const liveSpoken = (window.__aiChatTranscript || (inputEl ? inputEl.value : "")).trim();
 if (liveSpoken) {
  // FLOW: mic → speech → AI auto process → entry OR answer
  setAiChatHeaderState('thinking', 'Processing...');
  if (msgEl) msgEl.innerHTML = '<span style="color:#2dd4bf;">⚡ AI process kar raha hai...</span>';
  if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(true);
  try {
   if (typeof sendAiChatMessage === 'function') {
    await sendAiChatMessage(liveSpoken, true);
   } else {
    throw new Error('sendAiChatMessage missing');
   }
   if (msgEl) msgEl.innerHTML = '';
  } catch (e) {
   console.error('Voice→chat error:', e);
   if (msgEl) msgEl.innerHTML = '<span style="color:#f87171;">⚠️ Process fail. Dobara mic dabao.</span>';
   setAiChatHeaderState('idle');
  } finally {
   if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(false);
  }
  return;
 }
 // No SR transcript — fall through to PCM audio path if any
 let totalLength = 0;
 for (let i = 0; i < aiChatVoicePcm.length; i++) totalLength += aiChatVoicePcm[i].length;

 if (totalLength < 3200 && !hasSpokenManual) {
  setAiChatHeaderState('idle');
  if (msgEl) {
   msgEl.innerHTML = '<span style="color:#f59e0b;">⚠️ Kuch bola nahi gaya — AI Mic dabakar bolein.</span>';
   setTimeout(() => { if (msgEl && !aiChatVoiceActive) msgEl.innerHTML = ''; }, 3000);
  }
  return;
 }

 const merged = new Float32Array(totalLength);
 let offset = 0;
 for (let i = 0; i < aiChatVoicePcm.length; i++) {
  merged.set(aiChatVoicePcm[i], offset);
  offset += aiChatVoicePcm[i].length;
 }
 aiChatVoicePcm = [];

 const TARGET_RATE = 16000;
 let resampled = merged;
 if (srcRate !== TARGET_RATE && srcRate > 0) {
  const ratio = srcRate / TARGET_RATE;
  const targetLen = Math.round(totalLength / ratio);
  resampled = new Float32Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
   const srcPos = i * ratio;
   const srcIdx = Math.floor(srcPos);
   const frac = srcPos - srcIdx;
   const s0 = merged[srcIdx] || 0;
   const s1 = merged[srcIdx + 1] || s0;
   resampled[i] = s0 + frac * (s1 - s0);
  }
 }

 const wavBlob = _encodeWavDirect(resampled, TARGET_RATE);
 const base64Audio = await blobToBase64(wavBlob);

 setAiChatHeaderState('thinking', 'AI Analyzing...');
 if (msgEl) msgEl.innerHTML = '<span style="color:#c084fc;">⚡ Shiva AI audio sun raha hai...</span>';

 try {
  const summary = buildAiContextText(true);
  const knownParties = typeof getOfficialPartyNames === 'function' ? getOfficialPartyNames() : ['Self'];
  const promptText = `You are DayToDay finance assistant. Reply in Hinglish (Roman Hindi+English) unless user asks pure Hindi or pure English.
User ne microphone me jo audio bola hai usko dhyan se suno aur samjho. Today's date: ${getLocalDateStr()}.
KNOWN PARTIES LIST IN APP: ${JSON.stringify(knownParties)}

CRITICAL RESPONSE FORMAT:
Humesha STRICTLY valid JSON format me response do (bina kisi code fence ya extra markdown ke):
{
  "transcript": "User ne audio me jo bola verbatim natural hindi/hinglish me",
  "isEntry": true|false,
  "amount": 500,
  "party": "SELF",
  "method": "Cash",
  "type": "expense"|"income",
  "notes": "...",
  "reply": "User ke liye natural aur clean hindi/hinglish response"
}

DETAILED RULES:
1. TRANSACTION ENTRY (Agar user ne koi len-den / kharcha / aavak bola hai):
   - "isEntry": true
   - "transcript": Audio ka exact sentence (jaise: "500 self ko cash se poha khariden ke liye pay kiye")
   - "amount": Number (e.g. 500)
   - "party": CRITICAL PARTY RULE: Tumhe STRICTLY upar di gayi KNOWN PARTIES LIST me se hi party chun-ni hai. Nayi party ka naam kabhi mat banao! Agar user ne kharche/saman ka naam bola (jaise poha, chai, petrol, recharge, auto), toh party 'Self' hogi aur saman ka naam 'notes' me jayega. Agar user ne kisi person ka naam bola jo list me nahi hai, toh party 'Self' use karo aur person ka naam notes me likho.
   - "method": Cash, Bank, UPI, Card, etc. (Default: "Cash")
   - "type": "expense" (agar diya, kharch kiya, pay kiya) ya "income" (agar mila, aaya, salary)
   - CRITICAL TRIGGER RULE FOR NOTES:
     Jab bhi user instruction me "SE " ya "FOR " word ho, toh "SE " ya "FOR " ke theek baad jo bhi text bola gaya hai, SIRF wahi exact text transaction ka "notes" banega!
     Jaise:
     - "500 SELF KO CASH SE POHA KHARIDEN KE LIYE PAY KIYE" -> notes: "POHA KHARIDEN KE LIYE PAY KIYE", party: "SELF", method: "Cash", amount: 500
     - "paid 800 to Amit in cash for dinner with friends" -> notes: "dinner with friends", party: "Amit", method: "Cash", amount: 800
   - "reply": Entry save hone ka clear confirmation + current total balance zaroor batao (jaise: "₹500 SELF ko Cash se pay kiye. Entry save ho gayi. Ab aapka total balance ₹XXXX hai.")

2. FINANCIAL QUESTION / BALANCE / HISAB (Agar user ne balance, report ya kisi party ka hisaab poocha):
   - "isEntry": false
   - "transcript": Jo question user ne poocha (jaise: "Party wise balance batao jo mujhe dena hai")
   - "reply": Niche diye gaye real financial data se exact, clear aur accurate 2-4 lines ka Hinglish answer. DO NOT use markdown bold stars (write ₹500 cleanly). Agar kisi party ko dena hai to party ka naam aur amount saaf saaf batao.

REAL FINANCIAL DATA:
${summary}`;

  const body = {
   contents: [{
    role: "user",
    parts: [
     { text: promptText },
     { inlineData: { mimeType: "audio/wav", data: base64Audio } }
    ]
   }],
   generationConfig: {
    temperature: 0.1,
    maxOutputTokens: 1000
   }
  };

  aiChatVoiceAbortCtrl = new AbortController();
  aiChatVoiceProcessing = true;
  let reply;
  try {
   reply = await _geminiRawFetch(body, aiChatVoiceAbortCtrl.signal);
  } finally {
   aiChatVoiceProcessing = false;
  }
  if (!reply) throw new Error("Khali response mila");

  const audioParsed = _parseGeminiJson(reply);
  const userSpeechTranscript = (audioParsed && audioParsed.transcript) ? audioParsed.transcript : "🎙️ AI Voice Query";

  // Check if user spoke a transaction entry
  if (audioParsed && audioParsed.isEntry && audioParsed.amount > 0) {
   shivaRuleOverride(audioParsed, userSpeechTranscript);
   audioParsed.originalText = userSpeechTranscript;
   const saved = createEntryFromAi(audioParsed);
   if (saved) {
    const isInc = saved.type === 'income';
    const dateFormatted = (typeof formatDisplayDate === 'function') ? formatDisplayDate(saved.date) : saved.date;
    const dateNotice = (saved.date !== getLocalDateStr()) ? ` [Date: ${dateFormatted}]` : '';
    let replyText = (audioParsed.reply) ? audioParsed.reply
      : `✅ Entry saved${dateNotice}: ₹${Number(saved.amount).toLocaleString('en-IN')} ${saved.party} ko ${saved.method} se ${isInc ? 'receive hue' : 'pay kiye'} entry successfully save ho gayi!`;
    // Always include current balance after successful voice entry
    try {
      const bal = (typeof getTotalBalance === 'function') ? getTotalBalance() : 0;
      const balStr = (bal < 0 ? '-' : '') + Math.abs(bal).toLocaleString('en-IN');
      if (!/balance|बैलेंस|balance/i.test(replyText)) {
        replyText += ` Ab aapka total balance ₹${balStr} hai.`;
      }
    } catch(e){}
    aiChatMessages.push({ role: 'user', text: userSpeechTranscript, isVoice: true });
    aiChatMessages.push({ role: 'ai', text: replyText, entryData: saved });
    renderAiChatMessages();
    if (!window.aiChatVoiceMuted) {
     setAiChatHeaderState('speaking');
     if (msgEl) msgEl.textContent = "🔊 Speaking...";
     speakText(replyText, () => {
      if (msgEl) msgEl.textContent = "";
      setAiChatHeaderState('idle');
     });
    } else {
     setAiChatHeaderState('idle');
     if (msgEl) msgEl.textContent = "";
    }
    return;
   }
  }

  // Regular financial query answer
  const answerText = (audioParsed && audioParsed.reply) ? audioParsed.reply : reply;
  aiChatMessages.push({ role: 'user', text: userSpeechTranscript, isVoice: true });
  aiChatMessages.push({ role: 'ai', text: answerText });
  renderAiChatMessages();

  if (!window.aiChatVoiceMuted) {
   setAiChatHeaderState('speaking');
   if (msgEl) msgEl.textContent = "🔊 Speaking...";
   speakText(answerText, () => {
    if (msgEl) msgEl.textContent = "";
    setAiChatHeaderState('idle');
   });
  } else {
   setAiChatHeaderState('idle');
   if (msgEl) msgEl.textContent = "";
  }
 } catch (err) {
  aiChatVoiceProcessing = false;
  setAiChatHeaderState('idle');
  if (err && err.name === 'AbortError') return;
  console.error("Chat voice error:", err);
  const errMsg = (err && err.message) ? err.message : String(err || '');
  if (errMsg.startsWith("INVALID_KEY") || /API_KEY_INVALID|api key not valid/i.test(errMsg)) {
   if (msgEl) msgEl.innerHTML = '<span style="color:#f87171;">⚠️ Invalid API Key. Profile > AI Settings me key update karein.</span>';
   setTimeout(() => { openAiSettingsModal(); }, 900);
  } else if (errMsg.startsWith("QUOTA_EXHAUSTED") || /quota|exceeded|rate limit/i.test(errMsg)) {
   if (msgEl) msgEl.innerHTML = '<span style="color:#f59e0b;">⏳ Gemini free limit full hai. 1 min baad bolein ya text se poochhein.</span>';
  } else {
   if (msgEl) msgEl.innerHTML = '<span style="color:#f87171;">⚠️ ' + errMsg + '</span>';
  }
 }
}

function stopAiChatMic(){
 if (aiChatVoiceActive) stopAiChatVoiceCapture(false);
 if (window.__aiChatRecognition) {
  try { window.__aiChatRecognition.abort(); } catch(e){}
  window.__aiChatRecognition = null;
 }
 setAiChatHeaderState('idle');
}

function formatAiEntryCardDate(dateStr) {
 if (!dateStr) {
  const d = new Date();
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
 }
 if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[parseInt(m, 10) - 1] || m;
  return `${d.padStart(2, '0')} ${monthName} ${y}`;
 }
 if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
  const [d, m, y] = dateStr.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[parseInt(m, 10) - 1] || m;
  return `${d.padStart(2, '0')} ${monthName} ${y}`;
 }
 try {
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
   return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
 } catch(e){}
 return dateStr;
}

function formatAiEntryCardTime(timeStr) {
 if (!timeStr) {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
 }
 let s = String(timeStr).trim();
 s = s.replace(/([ap]m)/i, (m) => m.toUpperCase());
 return s;
}

function dismissAiChatMessage(idx){
 if (aiChatMessages && aiChatMessages[idx] !== undefined) {
  aiChatMessages.splice(idx, 1);
  renderAiChatMessages();
 }
}

function formatAiEntryShareText(e) {
 if (!e) return '';
 const isInc = e.type === 'income';
 const sign = isInc ? '+' : '-';
 const amt = `₹${Number(e.amount || 0).toLocaleString('en-IN')}`;
 const party = e.party || (isInc ? 'Income' : 'Self');
 const method = e.method || 'Cash';
 const date = formatAiEntryCardDate(e.date);
 const time = formatAiEntryCardTime(e.time);
 const note = (e.notes || '').trim();

 let text = `🧾 *DayToDay Entry Receipt*\n`;
 text += `━━━━━━━━━━━━━━━━━━━━\n`;
 text += `💰 *Amount:* ${sign} ${amt}\n`;
 text += `👤 *Party:* ${party}\n`;
 text += `💳 *Payment Method:* ${method}\n`;
 text += `📊 *Type:* ${isInc ? 'Income (Received)' : 'Expense (Payment)'}\n`;
 text += `📅 *Date & Time:* ${date}, ${time}\n`;
 if (note) {
  text += `📝 *Note:* ${note}\n`;
 }
 text += `━━━━━━━━━━━━━━━━━━━━\n`;
 text += `_Recorded via DayToDay Finance Tracker_`;
 return text;
}

window.__currentAiShareEntry = null;

function shareAiChatEntry(idx){
 const m = aiChatMessages[idx];
 if (!m || !m.entryData) return;
 openAiShareEntryModal(m.entryData);
}

function openAiShareEntryModal(e){
 window.__currentAiShareEntry = e;
 const existing = document.getElementById('aiShareEntryModal');
 if (existing) existing.remove();

 const isInc = e.type === 'income';
 const sign = isInc ? '+' : '-';
 const amt = `₹${Number(e.amount || 0).toLocaleString('en-IN')}`;
 const party = e.party || (isInc ? 'Income' : 'Self');
 const method = e.method || 'Cash';
 const date = formatAiEntryCardDate(e.date);
 const time = formatAiEntryCardTime(e.time);
 const note = (e.notes || '').trim();

 const html = `
 <div id="aiShareEntryModal" class="ai-share-modal-backdrop" onclick="if(event.target===this)closeAiShareEntryModal()">
  <div class="ai-share-sheet">
   <div class="ai-share-sheet-handle"></div>
   <div class="ai-share-sheet-header">
    <div class="ai-share-sheet-title">
     <i class="ti ti-share" style="color:#10b981;"></i> Share Entry
    </div>
    <button class="ai-share-close-btn" onclick="closeAiShareEntryModal()" title="Close">
     <i class="ti ti-x"></i>
    </button>
   </div>

   <div class="ai-share-preview-card">
    <div class="ai-share-preview-amt ${isInc ? 'income' : 'expense'}">${sign} ${amt}</div>
    <div class="ai-share-preview-sub">${party} • ${method}${note ? ' • ' + note : ''}</div>
    <div class="ai-share-preview-date">${date}, ${time}</div>
   </div>

   <div class="ai-share-grid">
    <!-- WhatsApp -->
    <button type="button" class="ai-share-opt-btn" onclick="shareEntryAction('whatsapp')">
     <div class="ai-share-opt-icon wa"><i class="ti ti-brand-whatsapp"></i></div>
     <span>WhatsApp</span>
    </button>

    <!-- Message / SMS -->
    <button type="button" class="ai-share-opt-btn" onclick="shareEntryAction('sms')">
     <div class="ai-share-opt-icon sms"><i class="ti ti-message-dots"></i></div>
     <span>Message</span>
    </button>

    <!-- Other Apps (Web Share API) -->
    <button type="button" class="ai-share-opt-btn" onclick="shareEntryAction('other')">
     <div class="ai-share-opt-icon other"><i class="ti ti-share"></i></div>
     <span>Other Apps</span>
    </button>

    <!-- Copy Text -->
    <button type="button" class="ai-share-opt-btn" onclick="shareEntryAction('copy')">
     <div class="ai-share-opt-icon copy"><i class="ti ti-copy"></i></div>
     <span>Copy Text</span>
    </button>
   </div>
  </div>
 </div>`;

 document.body.insertAdjacentHTML('beforeend', html);
}

function closeAiShareEntryModal(){
 const modal = document.getElementById('aiShareEntryModal');
 if (modal) modal.remove();
}

function shareEntryAction(type){
 const e = window.__currentAiShareEntry;
 if (!e) return;
 const text = formatAiEntryShareText(e);

 if (type === 'whatsapp') {
  window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
  closeAiShareEntryModal();
 } else if (type === 'sms') {
  window.location.href = 'sms:?body=' + encodeURIComponent(text);
  closeAiShareEntryModal();
 } else if (type === 'other') {
  if (navigator.share) {
   navigator.share({
    title: 'DayToDay Transaction Entry',
    text: text
   }).then(() => {
    closeAiShareEntryModal();
   }).catch(err => {
    if (err.name !== 'AbortError') {
     copyAiEntryTextToClipboard(text);
     closeAiShareEntryModal();
    }
   });
  } else {
   copyAiEntryTextToClipboard(text);
   closeAiShareEntryModal();
  }
 } else if (type === 'copy') {
  copyAiEntryTextToClipboard(text);
  closeAiShareEntryModal();
 }
}

function copyAiEntryTextToClipboard(text){
 try {
  if (navigator.clipboard && navigator.clipboard.writeText) {
   navigator.clipboard.writeText(text).then(() => {
    showNotification('Entry copied to clipboard', 'success', 'You can now paste and share it anywhere.');
   }).catch(() => {
    fallbackCopyText(text);
   });
  } else {
   fallbackCopyText(text);
  }
 } catch(e){
  fallbackCopyText(text);
 }
}

function fallbackCopyText(text){
 const ta = document.createElement('textarea');
 ta.value = text;
 ta.style.position = 'fixed';
 ta.style.left = '-9999px';
 document.body.appendChild(ta);
 ta.focus();
 ta.select();
 try {
  document.execCommand('copy');
  showNotification('Entry copied to clipboard', 'success', 'You can now paste and share it anywhere.');
 } catch(e){
  showNotification('Copy failed', 'warning', 'Please copy manually.');
 }
 document.body.removeChild(ta);
}


// Typewriter effect for AI chat replies
function typeAiMessage(el, fullText, speed) {
  if (!el) return;
  // Decode HTML entities from data attribute
  const ta = document.createElement('textarea');
  ta.innerHTML = fullText || '';
  fullText = ta.value || fullText || '';
  speed = speed || 12;
  el.textContent = '';
  el.classList.add('ai-typing');
  let i = 0;
  const tick = () => {
    if (i >= fullText.length) {
      el.classList.remove('ai-typing');
      if (typeof formatAiMessage === 'function') {
        el.innerHTML = formatAiMessage(fullText);
      } else {
        el.innerHTML = escapeHtml(fullText).replace(/\n/g, '<br>');
      }
      if (typeof scrollAiChatToBottom === 'function') scrollAiChatToBottom(true);
      return;
    }
    const chunk = fullText.slice(i, i + 3);
    el.textContent += chunk;
    i += chunk.length;
    if (typeof scrollAiChatToBottom === 'function' && i % 24 === 0) scrollAiChatToBottom(true);
    setTimeout(tick, speed);
  };
  tick();
}

function renderAiChatMessages(nameOverride){
 const listEl = document.getElementById('aiChatList');
 if (!listEl) return;

 const rawUser = (typeof currentUser !== 'undefined' && currentUser) || null;
 let userName = nameOverride || '';
 if (!userName && rawUser) {
  if (rawUser.displayName) userName = rawUser.displayName.split(' ')[0];
  else if (rawUser.email) userName = rawUser.email.split('@')[0].toUpperCase();
 }
 if (!userName) userName = 'RAVI';

 // Persist history changes whenever messages render
 try { saveAiChatHistory(); } catch(e){}

 if (aiChatMessages.length === 0){
  listEl.innerHTML = `
  <div class="ai-welcome-wrap">
   <div class="ai-welcome-avatar">
    <i class="ti ti-message-2"></i>
   </div>

   <div class="ai-welcome-title">
    How can I help you today?
   </div>
   <div class="ai-welcome-sub">
    Ask anything — balance, entries, bills, or general questions.
   </div>

   <!-- Clean Suggestion Grid -->
   <div class="ai-welcome-grid">
    <div class="ai-welcome-chip" onclick="sendQuickChatPrompt('Paid 500 cash for snacks')">
     <div class="ai-welcome-chip-title"><span style="color:#10b981;">⚡</span> New Entry</div>
     <div class="ai-welcome-chip-desc">Paid 500 via cash for snacks</div>
    </div>
    <div class="ai-welcome-chip" onclick="sendQuickChatPrompt('What is my total balance?')">
     <div class="ai-welcome-chip-title"><span style="color:#f59e0b;">💰</span> Total Balance</div>
     <div class="ai-welcome-chip-desc">Net bank and cash balances</div>
    </div>
    <div class="ai-welcome-chip" onclick="sendQuickChatPrompt('Who owes me money or whom do I owe?')">
     <div class="ai-welcome-chip-title"><span style="color:#38bdf8;">👥</span> Party Balances</div>
     <div class="ai-welcome-chip-desc">Pending receivables &amp; payables</div>
    </div>
    <div class="ai-welcome-chip" onclick="sendQuickChatPrompt('What were my expenses today?')">
     <div class="ai-welcome-chip-title"><span style="color:#ec4899;">📅</span> Today's Expenses</div>
     <div class="ai-welcome-chip-desc">All transactions recorded today</div>
    </div>
    <div class="ai-welcome-chip" onclick="sendQuickChatPrompt('What is 18% GST on 25000?')">
     <div class="ai-welcome-chip-title"><span style="color:#a855f7;">🧮</span> Calculation / GST</div>
     <div class="ai-welcome-chip-desc">Percentage and math solver</div>
    </div>
    <div class="ai-welcome-chip" onclick="sendQuickChatPrompt('What is the difference between SIP and Mutual Funds?')">
     <div class="ai-welcome-chip-title"><span style="color:#6366f1;">📈</span> Finance Guide</div>
     <div class="ai-welcome-chip-desc">Savings &amp; investment guidance</div>
    </div>
   </div>
  </div>`;
  scrollAiChatToBottom(false);
  return;
 }

 listEl.innerHTML = aiChatMessages.map((m, idx) => {
  const isUser = m.role === 'user';
  const timeStr = formatChatTimestamp(m.timestamp);

  if (isUser) {
   const isVoice = m.isVoice || (m.text && m.text.startsWith('🎙️'));
   return `
   <div class="ai-msg-row user">
    <div class="ai-user-bubble">
     ${escapeHtml(m.text)}
    </div>
    <div class="ai-user-meta">
     ${isVoice ? '<i class="ti ti-microphone" style="font-size:11px;color:#a855f7;"></i> Voice · ' : ''}${timeStr ? `${timeStr} · ` : ''}<i class="ti ti-check" style="font-size:11px;"></i>
    </div>
    <div class="ai-user-actions">
     <button type="button" class="ai-bubble-action-btn search" onclick="searchChatQueryInEntries(${idx})" title="Search entries">
      <i class="ti ti-search"></i> Search
     </button>
     <button type="button" class="ai-bubble-action-btn entry" onclick="useChatInNewEntry(${idx})" title="Use in new entry">
      <i class="ti ti-plus"></i> New Entry
     </button>
     <button type="button" class="ai-bubble-action-btn edit" onclick="editAndReuseChatMessage(${idx})" title="Edit text">
      <i class="ti ti-edit"></i> Edit
     </button>
    </div>
   </div>`;
  }

  // Thinking Skeleton
  if (m.text === '💭...' || m.text === '__THINKING__') {
   return `
   <div class="ai-msg-row assistant">
    <div class="ai-thinking-card">
     <div class="ai-thinking-dots">
      <span></span><span></span><span></span>
     </div>
     <span style="font-size:12.5px;color:#38bdf8;font-weight:500;">Assistant is thinking...</span>
    </div>
   </div>`;
  }

  // Modern AI Entry Confirmation Card
  if (m.entryData) {
   const e = m.entryData;
   const isInc = e.type === 'income';
   const notesLower = String(e.notes || '').toLowerCase() + ' ' + String(e.party || '').toLowerCase();
   // Detect special entry kinds for different card designs
   let kind = isInc ? 'receive' : 'payment';
   let anim = isInc ? 'anim-drop' : 'anim-up';
   // Advance Diye → Lend animation | Advance Liye → Borrow animation
   if (/\b(advance\s*diye|advance\s*diya|adv\s*diye|adv\s*diya|udhaar\s*diya|lend|loan\s*diya|उधार\s*दिया|एडवांस\s*दिए|एडवांस\s*दिया)\b/i.test(notesLower)) { kind = 'lend'; anim = 'anim-left'; }
   else if (/\b(advance\s*liye|advance\s*liya|adv\s*liye|adv\s*liya|udhaar\s*liya|borrow|loan\s*liya|उधार\s*लिया|एडवांस\s*लिए|एडवांस\s*लिया)\b/i.test(notesLower)) { kind = 'borrow'; anim = 'anim-right'; }
   else if (/\b(transfer|transfer kiya|account transfer|अकाउंट ट्रांसफर)\b/i.test(notesLower)) { kind = 'transfer'; anim = 'anim-flip'; }
   else if (/\b(saving|savings|goal|seva|सेविंग|गोल)\b/i.test(notesLower)) { kind = 'savings'; anim = 'anim-pop'; }

   const sign = isInc ? '+' : '−';
   const partyName = e.party || (isInc ? 'Income' : 'Self');
   const paymentMethod = e.method || 'Cash';
   const notesText = (e.notes || '').trim();
   const subParts = [];
   if (notesText) subParts.push(notesText);
   if (paymentMethod) subParts.push(paymentMethod);
   const subLine = subParts.join(' · ') || (isInc ? 'Income' : 'Expense');
   const amtStr = Number(e.amount || 0).toLocaleString('en-IN');

   // Type-specific SVG icons (stroke)
   const icons = {
     payment: '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
     receive: '<path d="M17 7L7 17"/><path d="M16 17H7V8"/>',
     lend: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
     borrow: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
     transfer: '<path d="M7 7h13"/><path d="M16 3l4 4-4 4"/><path d="M17 17H4"/><path d="M8 13l-4 4 4 4"/>',
     savings: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>'
   };
   const iconSvg = icons[kind] || icons.payment;
   const showConfetti = (kind === 'receive');
   const showRipple = (kind === 'lend' || kind === 'borrow');
   const typeLabel = kind.charAt(0).toUpperCase() + kind.slice(1);

   return `
   <div class="ai-msg-row assistant">
    <div class="ai-entry-card ${kind} ${isInc ? 'income' : 'expense'} ${anim}" id="aiEntryCard_${idx}">
      ${showConfetti ? '<div class="ai-ec-confetti"><i></i><i></i><i></i><i></i><i></i></div>' : ''}
      <div class="ai-ec-icon" title="${typeLabel}">
        ${showRipple ? '<span class="ec-ripple"></span>' : ''}
        <svg viewBox="0 0 24 24">${iconSvg}</svg>
      </div>
      <div class="ai-ec-body">
        <div class="ai-ec-title">${partyName}</div>
        <div class="ai-ec-sub">${subLine}</div>
      </div>
      <div class="ai-ec-right">
        <div class="ai-ec-amount">${sign}₹${amtStr}</div>
        <div class="ai-ec-saved">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
          Saved
        </div>
      </div>
    </div>
    <div class="ai-entry-card-actions">
      <button type="button" class="ai-entry-action-btn search" onclick="searchChatQueryInEntries(${idx})" title="Search entries">
        <i class="ti ti-search"></i> <span>Search</span>
      </button>
      <button type="button" class="ai-entry-action-btn edit" onclick="useChatInNewEntry(${idx})" title="Edit entry">
        <i class="ti ti-edit"></i> <span>Edit</span>
      </button>
      <button type="button" class="ai-entry-action-btn" onclick="speakAiMessageFromChat(${idx})" title="Listen">
        <i class="ti ti-volume"></i> <span>Listen</span>
      </button>
      <button type="button" class="ai-entry-action-btn" onclick="shareAiChatEntry(${idx})" title="Share Entry">
        <i class="ti ti-share"></i> <span>Share</span>
      </button>
    </div>
   </div>`;
  }

  // Grok-style assistant message — last AI text msg gets typing animation
  const isLastAiText = (idx === aiChatMessages.length - 1) && !m.entryData && m.text !== '💭...' && m.text !== '__THINKING__';
  const formattedHtml = isLastAiText ? '' : formatAiMessage(m.text);
  return `
  <div class="ai-msg-row assistant">
   <div class="ai-assistant-bubble">
    <div class="ai-thought-label"><i class="ti ti-bulb"></i> Thought for 1s</div>
    <div class="ai-bubble-content" ${isLastAiText ? `data-type-text="${escapeHtml(m.text).replace(/"/g, '&quot;')}" data-needs-typing="1"` : ''}>
     ${formattedHtml}
    </div>
    <div class="ai-msg-actions">
     <button type="button" class="ai-bubble-action-btn" onclick="event.stopPropagation();copyAiMessageText(${idx}, this)" title="Copy"><i class="ti ti-copy"></i></button>
     <button type="button" class="ai-bubble-action-btn" onclick="event.stopPropagation();shareAiChatMessage(${idx})" title="Share"><i class="ti ti-share"></i></button>
     <button type="button" class="ai-bubble-action-btn" onclick="event.stopPropagation();feedbackAiMessage(${idx}, true)" title="Good"><i class="ti ti-thumb-up"></i></button>
     <button type="button" class="ai-bubble-action-btn" onclick="event.stopPropagation();feedbackAiMessage(${idx}, false)" title="Bad"><i class="ti ti-thumb-down"></i></button>
     <button type="button" class="ai-bubble-action-btn" onclick="event.stopPropagation();speakAiMessageFromChat(${idx})" title="Speak"><i class="ti ti-volume"></i></button>
     <button type="button" class="ai-bubble-action-btn" onclick="event.stopPropagation();retryAiChatMessage(${idx})" title="Retry"><i class="ti ti-refresh"></i></button>
    </div>
   </div>
  </div>`;
 }).join('');
 scrollAiChatToBottom(false);
 requestAnimationFrame(() => scrollAiChatToBottom(false));
 setTimeout(() => scrollAiChatToBottom(false), 40);
 // Start typing animation on latest AI reply
 const typeEl = listEl.querySelector('[data-needs-typing="1"]');
 if (typeEl) {
   const raw = typeEl.getAttribute('data-type-text') || '';
   typeEl.removeAttribute('data-needs-typing');
   typeEl.removeAttribute('data-type-text');
   if (typeof typeAiMessage === 'function' && raw) {
     typeAiMessage(typeEl, raw, 12);
   } else {
     typeEl.innerHTML = formatAiMessage(raw);
   }
 }
}

function sendQuickChatPrompt(promptText){
 const inputEl = document.getElementById('aiChatInput');
 if (inputEl) inputEl.value = promptText;
 sendAiChatMessage(promptText);
}

// ===== 🧠 INSTANT LOCAL FINANCIAL QUERY ENGINE (<5ms accurate answer) =====
function instantAnswerFinancialQuery(rawText) {
 if (!rawText || typeof rawText !== 'string') return null;
 if (typeof isQuestionNotEntry === 'function' && !isQuestionNotEntry(rawText)) return null;
 const q = rawText.toLowerCase().trim();
 const qClean = q.replace(/[?.,!]/g, '').trim();
 const allEntries = (typeof entries !== 'undefined' ? entries : []);
 const allWallets = (typeof wallets !== 'undefined' ? wallets : []);
 const now = new Date();
 const curMonth = now.getMonth(), curYear = now.getFullYear();
 const todayStr = getLocalDateStr(now);
 const yesterday = new Date(now);
 yesterday.setDate(yesterday.getDate() - 1);
 const yesterdayStr = getLocalDateStr(yesterday);
 const toINR = n => `₹${(Number(n)||0).toLocaleString('en-IN')}`;

 const totalPaid = allEntries.filter(e => isExpenseType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
 const totalRecd = allEntries.filter(e => isIncomeType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
 const totalBal = totalRecd - totalPaid;

 const partyRows = typeof buildAllPartyBalances === 'function' ? buildAllPartyBalances() : [];
 const realPeople = partyRows.filter(r => !r.isInvestment && !r.isIncome && !r.isPersonal);
 const peopleToTake = realPeople.filter(r => r.net > 0);
 const peopleToGive = realPeople.filter(r => r.net < 0);

 // 1. Top Expenses / Biggest Spends (e.g. "top 3 expenses", "top expenses", "sabse bade kharche", "is mahine ka top expense")
 if (
  /\b(top\s*\d*|sabse\s*bade|highest|bada|bade)\s*(kharch|expense|expenses|kharcha)\b/i.test(qClean) ||
  /\b(top\s*\d*\s*expenses?)\b/i.test(qClean) ||
  qClean.includes('top 3') || qClean.includes('top expense')
 ) {
  const isMonthSpecific = qClean.includes('mahine') || qClean.includes('month') || qClean.includes('mahina');
  let targetList = allEntries.filter(e => isExpenseType(e.type));
  if (isMonthSpecific) {
   targetList = targetList.filter(e => {
    const d = new Date(normalizeDate(e.date));
    return d.getFullYear() === curYear && d.getMonth() === curMonth;
   });
  }
  targetList.sort((a,b) => (Number(b.amount)||0) - (Number(a.amount)||0));
  const top3 = targetList.slice(0, 3);
  if (top3.length === 0) return isMonthSpecific ? "No expenses recorded this month yet." : "No expenses recorded yet.";
  const listStr = top3.map((e,i) => `${i+1}. ${e.party||'Other'}: ${toINR(e.amount)} (${e.date}${e.notes ? ' - ' + e.notes : ''})`).join('\n');
  return `${isMonthSpecific ? 'This month\'s' : 'All-time'} top ${top3.length} expenses:\n${listStr}`;
 }

 // 2. Total Balance / Net Balance / Mera Balance / Khate me kitna paisa hai
 if (
  /\b(total\s+balance|net\s+balance|mera\s+balance|balance\s+kitna|kul\s+balance|khate\s+me\s+kitna|account\s+balance)\b/i.test(qClean) ||
  /^(mera\s+)?(total\s+)?(net\s+)?balance(\s+kitna(\s+hai)?)?$/i.test(qClean) ||
  /^(mera\s+)?balance\s*(kitna|kya|batao|check)/i.test(qClean) ||
  /^(kul|total)\s+(balance|paisa|rupaye)/i.test(qClean) ||
  /^(khate|account)\s+me\s+kitna\s+(paisa|balance)/i.test(qClean) ||
  qClean === 'total balance' || qClean === 'balance' || qClean === 'mera balance'
 ) {
  let walletBreakdown = '';
  if (allWallets && allWallets.length > 0) {
   const parts = allWallets.map(w => `${w.name}: ${toINR(w.balance)}`);
   walletBreakdown = `\n💳 Wallets: ${parts.join(' | ')}`;
  }
  return `Your total net balance is ${toINR(totalBal)}.\n• Total Received: ${toINR(totalRecd)}\n• Total Paid: ${toINR(totalPaid)}${walletBreakdown}`;
 }

 // 3. Lena Ya Dena / Kisse kitna paisa lena ya dena hai / Party Balances
 if (
  /\b(lena\s*(?:ya|aur|and|\/)\s*dena|dena\s*(?:ya|aur|and|\/)\s*lena|party\s+balances?)\b/i.test(qClean) ||
  (/\b(lena)\b/i.test(qClean) && /\b(dena)\b/i.test(qClean) && /\b(kisse|kisko|kinse|paisa|paise)\b/i.test(qClean))
 ) {
  let resText = '👥 Party Balances (Receivables & Payables):\n\n';
  if (peopleToTake.length > 0) {
   const totalTakeAmt = peopleToTake.reduce((s,r) => s + r.net, 0);
   const listTake = peopleToTake.map(r => `• ${r.party}: ${toINR(r.net)} pending to receive`).join('\n');
   resText += `📥 RECEIVABLES (Total ${toINR(totalTakeAmt)}):\n${listTake}\n\n`;
  } else {
   resText += `📥 RECEIVABLES: No pending dues from anyone.\n\n`;
  }
  if (peopleToGive.length > 0) {
   const totalGiveAmt = peopleToGive.reduce((s,r) => s + Math.abs(r.net), 0);
   const listGive = peopleToGive.map(r => `• ${r.party}: ${toINR(Math.abs(r.net))} pending to pay`).join('\n');
   resText += `📤 PAYABLES (Total ${toINR(totalGiveAmt)}):\n${listGive}`;
  } else {
   resText += `📤 PAYABLES: No pending payments to anyone.`;
  }
  return resText;
 }

 // 4. Kisse Paise Lena Hai / Who owes me money / Receivables
 if (
  (/\b(kisse|kis kis se|kinse|kis se|who)\b/i.test(qClean) && /\b(lena|baaki|baki|aana|owes|due)\b/i.test(qClean)) ||
  /\b(who\s+owes|receivable|pending\s+from|lena\s+hai)\b/i.test(qClean) ||
  qClean === 'kisse lena hai' || qClean === 'who owes me'
 ) {
  if (peopleToTake.length === 0) {
   return "No pending receivables. All party accounts are clear!";
  }
  const totalTakeAmt = peopleToTake.reduce((s,r) => s + r.net, 0);
  const list = peopleToTake.map(r => `• ${r.party}: ${toINR(r.net)} (Paid: ${toINR(r.paid)}, Received: ${toINR(r.received)})`).join('\n');
  return `You are owed a total of ${toINR(totalTakeAmt)} by:\n${list}`;
 }

 // 5. Kisko Paise Dena Hai / Whom do I owe / Payables
 if (
  (/\b(kisko|kis kis ko|kinko|kis ko|whom|who)\b/i.test(qClean) && /\b(dena|baaki|baki|i\s+owe|payable)\b/i.test(qClean)) ||
  /\b(whom\s+i\s+owe|payable|pending\s+to|dena\s+hai)\b/i.test(qClean) ||
  qClean === 'kisko dena hai' || qClean === 'whom do i owe'
 ) {
  if (peopleToGive.length === 0) {
   return "No pending payables. All payments are settled!";
  }
  const totalGiveAmt = peopleToGive.reduce((s,r) => s + Math.abs(r.net), 0);
  const list = peopleToGive.map(r => `• ${r.party}: ${toINR(Math.abs(r.net))} (Received: ${toINR(r.received)}, Paid: ${toINR(r.paid)})`).join('\n');
  return `You owe a total of ${toINR(totalGiveAmt)} to:\n${list}`;
 }

 // 6. Aaj Ka Kharcha / Today's Expense & Income
 if (
  /(aaj|today)\s*(ka)?\s*(kharcha|expense|spending|kharch|income|hisaab)/i.test(qClean) ||
  qClean === 'aaj ka kharcha' || qClean === 'today expense' || qClean === 'today spending'
 ) {
  const todayEntries = allEntries.filter(e => normalizeDate(e.date) === todayStr);
  const todayExp = todayEntries.filter(e => isExpenseType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
  const todayInc = todayEntries.filter(e => isIncomeType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
  const recentToday = todayEntries.slice(0, 4).map(e => `• ${e.party||'Other'}: ${toINR(e.amount)} (${e.type==='income'?'Receive':'Pay'})`).join('\n');

  return `Today's (${todayStr}) Summary:\n• Total Expenses: ${toINR(todayExp)}\n• Total Received: ${toINR(todayInc)}\n• Total Entries Today: ${todayEntries.length}${recentToday ? '\n\nEntries:\n' + recentToday : ''}`;
 }

 // 6b. Yesterday's Expense & Income
 if (
  /(kal|yesterday)\s*(ka)?\s*(kharcha|expense|spending|kharch|income|hisaab)/i.test(q)
 ) {
  const yestEntries = allEntries.filter(e => normalizeDate(e.date) === yesterdayStr);
  const yestExp = yestEntries.filter(e => isExpenseType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
  const yestInc = yestEntries.filter(e => isIncomeType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
  return `Yesterday's (${yesterdayStr}) Summary:\n• Total Expenses: ${toINR(yestExp)}\n• Total Received: ${toINR(yestInc)}\n• Entries: ${yestEntries.length}`;
 }

 // 7. This Month Spending / Monthly Summary
 if (
  /(is\s+mahine|this\s+month|mahine\s+ka)\s*(ka)?\s*(kharcha|expense|spending|summary|total|income)/i.test(q) ||
  q === 'monthly expense' || q === 'this month' || q === 'monthly summary'
 ) {
  const monthEntries = allEntries.filter(e => {
   const d = new Date(normalizeDate(e.date));
   return d.getFullYear() === curYear && d.getMonth() === curMonth;
  });
  const mExp = monthEntries.filter(e => isExpenseType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
  const mInc = monthEntries.filter(e => isIncomeType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
  const days = now.getDate() || 1;
  const dailyAvg = Math.round(mExp / days);

  return `This Month's Summary:\n• Total Expenses: ${toINR(mExp)}\n• Total Income: ${toINR(mInc)}\n• Net Savings: ${toINR(mInc - mExp)}\n• Daily Average Spending: ${toINR(dailyAvg)}/day (${days} days)`;
 }

 // 8. Payment Method Specific (SBI 8974, PNB 1907, Cash, UPI)
 const methods = ['sbi 8974', 'pnb 1907', 'sbi', 'pnb', 'cash', 'upi'];
 for (const m of methods) {
  const isMethodInquiry = qClean === m || /\b(balance|hisaab|hisab|summary|total|account|khata|paisa|kitna)\b/i.test(qClean);
  if (isMethodInquiry && (qClean.includes(m) || new RegExp('(?:^|\\s)' + m + '(?:$|\\s)', 'i').test(qClean))) {
   const targetMethod = m.includes('sbi') ? 'SBI 8974' : m.includes('pnb') ? 'PNB 1907' : m.toUpperCase();
   const mEntries = allEntries.filter(e => (e.method || '').toLowerCase().includes(m));
   const mPaid = mEntries.filter(e => isExpenseType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
   const mRecd = mEntries.filter(e => isIncomeType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
   const wObj = allWallets.find(w => w.name && w.name.toLowerCase().includes(m));
   const wBal = wObj ? toINR(wObj.balance) : toINR(mRecd - mPaid);

   return `${targetMethod} Account Summary:\n• Balance: ${wBal}\n• Total Received: ${toINR(mRecd)}\n• Total Paid: ${toINR(mPaid)}\n• Total Transactions: ${mEntries.length}`;
  }
 }

 // 9. Recent Transactions / Last 5 Entries
 if (
  /(last|recent|latest)\s*(transaction|entry|entries|kharcha)/i.test(q) ||
  q === 'recent transactions' || q === 'last entries'
 ) {
  if (allEntries.length === 0) return "No transactions recorded yet.";
  const recent = allEntries.slice(0, 5).map(e => `• ${e.date}: ${toINR(e.amount)} ${e.type==='income'?'Received from':'Paid to'} ${e.party||'Other'} (${e.method||'Cash'}${e.notes?' - '+e.notes:''})`).join('\n');
  return `Latest 5 transactions:\n${recent}`;
 }

 // 10. Savings Goals / Targets
 if (
  /(goal|target|savings|bachat)/i.test(q)
 ) {
  const goalsList = typeof goals !== 'undefined' ? goals : [];
  if (goalsList.length === 0) return "No Savings Goals created yet.";
  const gSummary = goalsList.map(g => `• ${g.name}: Saved ${toINR(g.saved)} of ${toINR(g.target)} (${g.target > 0 ? Math.round((g.saved/g.target)*100) : 0}%)`).join('\n');
  return `Your Savings Goals:\n${gSummary}`;
 }

 // 11. Specific Party Name Check (Exact word boundary matching)
 const allPartyNames = typeof getAllPartyNames === 'function' ? getAllPartyNames() : [];
 for (const pName of allPartyNames) {
  if (!pName || pName.length < 2) continue;
  const pLower = pName.toLowerCase().trim();
  if (['food', 'petrol', 'cash', 'upi', 'bank', 'self', 'other', 'today', 'aaj', 'kal', 'mahina', 'mahine'].includes(pLower)) continue;
  if (pLower === 'mahi' && (q.includes('mahine') || q.includes('mahina') || q.includes('month'))) continue;

  const regex = new RegExp('(?:^|\\s|[.,!?-])' + pLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|\\s|[.,!?-]|ka|ke|ki)', 'i');
  if (regex.test(q)) {
   const pEntries = allEntries.filter(e => (e.party || '').toLowerCase() === pLower);
   const pPaid = pEntries.filter(e => isExpenseType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
   const pRecd = pEntries.filter(e => isIncomeType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
   const pNet = pPaid - pRecd;

   let statusMsg = '';
   if (pNet > 0) statusMsg = `👉 ₹${pNet.toLocaleString('en-IN')} pending to RECEIVE from ${pName}.`;
   else if (pNet < 0) statusMsg = `👉 ₹${Math.abs(pNet).toLocaleString('en-IN')} pending to PAY to ${pName}.`;
   else statusMsg = `👉 Account Settled (₹0 Balance).`;

   const last2 = pEntries.slice(0, 3).map(e => `• ${e.date}: ${toINR(e.amount)} (${e.type==='income'?'Received':'Paid'}${e.method?' via '+e.method:''}${e.notes?' - '+e.notes:''})`).join('\n');

   return `Summary for ${pName}:\n• Total Paid: ${toINR(pPaid)}\n• Total Received: ${toINR(pRecd)}\n${statusMsg}${last2 ? '\n\nRecent Entries:\n' + last2 : ''}`;
  }
 }

 return null;
}

function smartFallbackFinancialAnswer(question) {
 const allEntries = (typeof entries !== 'undefined' ? entries : []);
 const partyRows = typeof buildAllPartyBalances === 'function' ? buildAllPartyBalances() : [];
 const realPeople = partyRows.filter(r => !r.isInvestment && !r.isIncome && !r.isPersonal);
 const peopleToTake = realPeople.filter(r => r.net > 0);
 const peopleToGive = realPeople.filter(r => r.net < 0);
 const totalPaid = allEntries.filter(e => isExpenseType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
 const totalRecd = allEntries.filter(e => isIncomeType(e.type)).reduce((s,e) => s + (Number(e.amount)||0), 0);
 const totalBal = totalRecd - totalPaid;
 const toINR = n => `₹${(Number(n)||0).toLocaleString('en-IN')}`;

 let takeStr = peopleToTake.length > 0 ? peopleToTake.map(r => `${r.party} (₹${r.net.toLocaleString('en-IN')})`).join(', ') : 'None pending';
 let giveStr = peopleToGive.length > 0 ? peopleToGive.map(r => `${r.party} (₹${Math.abs(r.net).toLocaleString('en-IN')})`).join(', ') : 'None pending';

 return `Financial Overview:\n• Net Balance: ${toINR(totalBal)} (Received: ${toINR(totalRecd)} | Paid: ${toINR(totalPaid)})\n• Receivables: ${takeStr}\n• Payables: ${giveStr}\n\nTip: You can ask specific questions like "What is my balance?", "Who owes me money?", "Today's expenses", or "Search snacks".`;
}

// ===== Smart Local Fallback for Math, General & Financial Questions =====
function smartFallbackGeneralAnswer(question) {
 if (!question || typeof question !== 'string') return "Kripya apna sawaal poora likhein.";
 const q = question.toLowerCase().trim();

 // 1. Percentage / GST calculation (e.g. "25000 ka 18%", "18% of 50000", "50000 pe 12%")
 const pct1 = q.match(/(\d+(?:\.\d+)?)\s*(?:ka|pe|par|of)?\s*(\d+(?:\.\d+)?)\s*%/i);
 const pct2 = q.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of|ka|pe|par)?\s*(\d+(?:\.\d+)?)/i);
 if (pct1 || pct2) {
  let base = 0, pct = 0;
  if (pct1) {
   base = parseFloat(pct1[1]);
   pct = parseFloat(pct1[2]);
  } else if (pct2) {
   pct = parseFloat(pct2[1]);
   base = parseFloat(pct2[2]);
  }
  if (base > 0 && pct > 0) {
   const val = (base * pct) / 100;
   const totalWith = base + val;
   return `Calculation Result:\n• Base Amount: ₹${base.toLocaleString('en-IN')}\n• ${pct}%: ₹${val.toLocaleString('en-IN')}\n• Total (Base + ${pct}%): ₹${totalWith.toLocaleString('en-IN')}`;
  }
 }

 // 2. Basic Arithmetic (e.g. "1500 * 12", "5000 / 4", "2500 + 4300", "12000 - 4500")
 const arith = q.match(/(\d+(?:\.\d+)?)\s*([\+\-\*\/xX])\s*(\d+(?:\.\d+)?)/);
 if (arith) {
  const n1 = parseFloat(arith[1]);
  let op = arith[2];
  if (op === 'x' || op === 'X') op = '*';
  const n2 = parseFloat(arith[3]);
  let res = 0;
  if (op === '+') res = n1 + n2;
  else if (op === '-') res = n1 - n2;
  else if (op === '*') res = n1 * n2;
  else if (op === '/' && n2 !== 0) res = n1 / n2;
  return `Calculation Result:\n• ${n1.toLocaleString('en-IN')} ${op} ${n2.toLocaleString('en-IN')} = ${Number(res.toFixed(2)).toLocaleString('en-IN')}`;
 }

 // 3. Common Financial & Investment concepts
 if (/\b(sip)\b/i.test(q) && /\b(mutual fund|mutual funds|mf)\b/i.test(q) && /\b(difference|diff|vs)\b/i.test(q)) {
  return `📈 SIP vs Mutual Funds Difference:\n\n` +
   `1. Mutual Fund (Investment Pool):\n` +
   `• An investment instrument where money from multiple investors is pooled and invested in equities, bonds, or securities by professional fund managers.\n\n` +
   `2. SIP (Systematic Investment Plan):\n` +
   `• A disciplined recurring method to invest in mutual funds, where a fixed amount (e.g., ₹500 or ₹1,000) is invested automatically at set intervals (monthly).\n\n` +
   `💡 Simple Analogy: If a Mutual Fund is a vehicle, SIP is your monthly installment ticket to ride it!`;
 }
 if (/\b(sip|systematic investment)\b/i.test(q)) {
  return `SIP (Systematic Investment Plan) Overview:\n• SIP is a disciplined method to invest a fixed amount regularly (e.g. ₹500 or ₹1,000 monthly) into mutual funds.\n• Key benefits include Rupee Cost Averaging and the Power of Compounding.\n• Best suited for long-term (5-10+ years) wealth creation goals.`;
 }
 if (/\b(mutual fund|mutual funds)\b/i.test(q)) {
  return `Mutual Funds Overview:\n• A Mutual Fund pools money from various investors to invest in stocks, bonds, or government securities managed by professional Fund Managers.\n• Offers built-in risk diversification.\n• Main types: Equity Funds (stocks), Debt Funds (fixed interest bonds), and Hybrid Funds (balanced mix).`;
 }
 if (/\b(fd|fixed deposit)\b/i.test(q)) {
  return `Fixed Deposit (FD) Overview:\n• Depositing a lump sum in a bank for a fixed tenure (e.g. 1 to 5 years) yields guaranteed interest.\n• Free from stock market volatility and keeps your principal amount secure.`;
 }
 if (/\b(gst|goods and services tax)\b/i.test(q)) {
  return `GST (Goods & Services Tax) Overview:\n• A unified indirect tax levied on goods and services across India.\n• Primary tax slabs are 5%, 12%, 18%, and 28%. Daily essential commodities are taxed at 0% or 5%.`;
 }
 if (/\b(gold|sona|digital gold|sgb)\b/i.test(q)) {
  return `Gold Investment Overview:\n• Physical Gold: Jewelry, coins, or gold bars.\n• Digital Gold: Start buying or selling digitally from as low as ₹10.\n• Sovereign Gold Bonds (SGB) & Gold ETFs: Safest paper/digital gold options with zero making charges or locker fees.`;
 }
 if (/\b(emergency fund|aapatkalin fund)\b/i.test(q)) {
  return `Emergency Fund Rule:\n• Every individual should maintain an emergency reserve equal to 3 to 6 months of essential living expenses in liquid cash or savings account.\n• Avoid locking this reserve in volatile or illiquid investments so it is accessible immediately in emergencies.`;
 }

 // 4. Conversational Greetings, Q&A & Info
 if (/^(hello|hi|hey|namaste|pranam|ram ram|salaam)\b/i.test(q)) {
  return "Namaste! Main Shiva AI hoon, aapka smart personal finance assistant. Aap mujhse balance, kharche, party dues, SIP ya koi bhi sawal pooch sakte hain, ya bolkar entry kar sakte hain. Bataiye aaj kya madad karoon?";
 }
 if (/\b(tum kaun ho|aap kaun ho|who are you|shiva kaun hai|about you)\b/i.test(q)) {
  return "Main Shiva AI hoon — DayToDay app ka smart AI voice assistant. Main aapke expense track karne, balance batane, aur Google Gemini ki tarah aapke sawalon ke jawab dene ke liye taiyar hoon.";
 }
 if (/\b(kya kar sakte ho|help|what can you do|features)\b/i.test(q)) {
  return "Main yeh sab kar sakta hoon:\n• 'Mera total balance kitna hai?'\n• 'Aaj ka kharcha batao'\n• 'Ravi ka hisaab kya hai?'\n• '500 chai cash me diya' (Voice Entry)\n• 'Kal 2000 Sunil ko dene ka reminder set karo'\n• SIP, Mutual Funds, FD, GST calculation aur general knowledge ke sawal!";
 }
 if (/\b(joke|chutkula|hasao)\b/i.test(q)) {
  return "😄 Ek mazedaar baat:\nPaisa bolta hai: 'Agar tum mujhe aaj bachaoge, to kal main tumhe bachaunga!' Lekin weekend bolta hai: 'Aao party karein, dekha jayega!'";
 }
 if (/\b(tips?|budget tips|bachat|savings tips|kharcha kam)\b/i.test(q)) {
  return "💡 Smart Money Tips:\n1. 50-30-20 Rule: 50% zaroorat, 30% chahatein, aur 20% savings me daalein.\n2. Rozana DayToDay app me entry karein taaki har chhote kharch par nazar rahe.\n3. Har mahine income aate hi pehle SIP/Savings alag karein, bache hue paise se kharch karein.";
 }
 if (/\b(inflation|mehangai)\b/i.test(q)) {
  return "Inflation (Mehangai) ka matlab hai samay ke sath cheezon ke daam badhna aur paise ki purchasing power kam hona. Isse ladne ke liye paise ko sirf savings bank me rakhne ke bajaye inflation se zyada return dene wale instruments jaise SIP, Mutual Funds ya Equity me invest karna chahiye.";
 }
 if (/\b(cibil|credit score)\b/i.test(q)) {
  return "Credit Score (CIBIL) 300 se 900 ke beech ek number hota hai jo aapki loan repayment history dikhata hai. 750+ score ko bohot accha mana jaata hai, jisse low interest rate par loan aur credit card aasaani se milte hain.";
 }

 // 5. Check if it relates to app finances / balances
 if (/\b(balance|hisaab|kharch|expense|lena|dena|kisse|kisko|kitna|aaj|mahine|month|wallet|entry|entries|income)\b/i.test(q)) {
  return smartFallbackFinancialAnswer(question);
 }

 // 6. General outside query fallback when offline / no key
 return `Aapka sawaal: "${question}"\n\nIs tarah ke general sawaalon ke full live AI answers ke liye App Settings me Gemini API key add karein.\n💡 Tip: Free Gemini API key add karne ke baad Shiva AI bilkul Google Gemini ki tarah live answer deta hai!`;
}

// ===== ⚡ SMART AI CHAT TRANSACTION PARSER & PERMANENT SAVER =====
function isQuestionNotEntry(text) {
 if (!text || typeof text !== 'string') return true;
 const lower = text.toLowerCase().trim();
 if (lower.includes('?')) return true;

 // Strict question keywords
 const qWords = /\b(kya|kitna|kitne|kitni|kab|kisko|kisse|kaise|kaun|kyun|kahan|batao|bataiye|dikhao|dikhayein|samjhao|explain|bolo|boliye|who|what|when|where|why|how|which|whom|whose|tell|calc|calculate|meaning|difference|diff|versus|vs|tips|advice|salah|recommend|joke|shayari)\b/i;
 if (qWords.test(lower)) return true;

 // Question inquiry phrases
 const qPhrases = /\b(check\s*karo|check\s*karna|bata\s*do|dikha\s*do|kaise\s*ho|tum\s*kaun|aap\s*kaun|who\s*are\s*you|can\s*you|kya\s*hai)\b/i;
 if (qPhrases.test(lower)) return true;

 // Must have a valid monetary amount to be an entry
 const hasAmount = /\b\d+(?:\.\d+)?\b/.test(lower);
 if (!hasAmount) return true; // Queries/greetings without amount are treated as questions/chat

 return false; // Has amount, no question marks/words -> It is an ENTRY!
}

// ═══════════════════════════════════════════════════════════════════════
// 👥 OFFICIAL PARTY MATCHER & 📅 TRANSACTION DATE EXTRACTOR
// Strict party matching: Only matches against configured parties in app
// Natural date extraction: Parses dates like '4-OCT', '4-10-26', 'yesterday', 'kal'
// ═══════════════════════════════════════════════════════════════════════

function getOfficialPartyNames() {
  const sel = document.getElementById('partySel');
  const selOptions = sel ? Array.from(sel.options).map(o => (o.value || '').trim()).filter(v => v && v.toLowerCase() !== 'select party') : [];
  let custom = [];
  try {
    custom = JSON.parse(localStorage.getItem('customParties') || '[]');
  } catch(e){}
  return Array.from(new Set(['Self', ...selOptions, ...custom])).filter(Boolean);
}

function matchOfficialParty(text) {
  if (!text || typeof text !== 'string') return null;
  const official = getOfficialPartyNames();
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (!lower) return null;

  // 1. Exact match
  for (const p of official) {
    if (p && p.toLowerCase() === lower) return p;
  }

  // 2. Word-boundary contains (longer names first)
  const sorted = [...official].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    if (p.toLowerCase() === 'self') continue;
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:^|[^a-zA-Z0-9_\\u0900-\\u097F])' + escaped + '(?:$|[^a-zA-Z0-9_\\u0900-\\u097F])', 'i');
    if (re.test(trimmed)) return p;
  }

  // 3. Includes either way (min length 3)
  for (const p of sorted) {
    const pl = p.toLowerCase();
    if (pl.length < 3) continue;
    if (lower.includes(pl) || pl.includes(lower)) return p;
  }

  // 4. Fuzzy: Levenshtein / similarity for typos (e.g. ritesha → Ritesh)
  function similarity(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    if (a === b) return 1;
    const al = a.length, bl = b.length;
    if (!al || !bl) return 0;
    const row = new Array(bl + 1);
    for (let j = 0; j <= bl; j++) row[j] = j;
    for (let i = 1; i <= al; i++) {
      let prev = i - 1, cur = i;
      for (let j = 1; j <= bl; j++) {
        const next = (a[i - 1] === b[j - 1]) ? prev : Math.min(prev, cur, row[j]) + 1;
        prev = row[j];
        row[j] = next;
        cur = next;
      }
    }
    const dist = row[bl];
    return 1 - dist / Math.max(al, bl);
  }
  const ignored = new Set(['cash','bank','upi','online','pay','paid','diye','mila','self','income','advance','rupees','rupaye','for','se','ko','ke','liye']);
  // Extract candidate tokens from text
  const tokens = lower.split(/[^a-zA-Z0-9\u0900-\u097F]+/).filter(t => t.length >= 3 && !ignored.has(t));
  let best = null, bestScore = 0.72;
  for (const token of (tokens.length ? tokens : [lower])) {
    if (ignored.has(token)) continue;
    for (const p of official) {
      if (!p) continue;
      const sc = similarity(token, p);
      if (sc > bestScore) { bestScore = sc; best = p; }
    }
  }
  return best;
}

function extractTransactionDate(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const lower = rawText.toLowerCase();
  const now = new Date();
  const curYear = now.getFullYear();

  const monthMap = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
  };

  // 1. Relative dates: kal, yesterday, parso, aaj, today
  if (/\b(kal|yesterday|beeta\s*kal)\b/i.test(lower)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const m = lower.match(/\b(kal|yesterday|beeta\s*kal)\b/i);
    return { date: d.toISOString().slice(0, 10), matchedText: m[0] };
  }
  if (/\b(parso|parson|day\s+before\s+yesterday)\b/i.test(lower)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
    const m = lower.match(/\b(parso|parson|day\s+before\s+yesterday)\b/i);
    return { date: d.toISOString().slice(0, 10), matchedText: m[0] };
  }
  if (/\b(aaj|today)\b/i.test(lower)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const m = lower.match(/\b(aaj|today)\b/i);
    return { date: d.toISOString().slice(0, 10), matchedText: m[0] };
  }

  // 2. Named month formats: e.g. '4-OCT', '4-oct-26', '4/oct/2026', '4 oct', '4th october'
  const mNamed = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?[-/\s]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[-/\s]+(\d{2,4}))?\b/i) ||
                 lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[-/\s]+(\d{1,2})(?:st|nd|rd|th)?(?:[-/\s]+(\d{2,4}))?\b/i);
  if (mNamed) {
    let day, monStr, yrStr;
    if (isNaN(mNamed[1])) {
      monStr = mNamed[1]; day = parseInt(mNamed[2], 10); yrStr = mNamed[3];
    } else {
      day = parseInt(mNamed[1], 10); monStr = mNamed[2]; yrStr = mNamed[3];
    }
    const monKey = monStr.slice(0, 3).toLowerCase();
    const monIdx = monthMap[monKey] !== undefined ? monthMap[monKey] : monthMap[monStr.toLowerCase()];
    if (monIdx !== undefined && day >= 1 && day <= 31) {
      let year = curYear;
      if (yrStr) {
        year = yrStr.length === 2 ? 2000 + parseInt(yrStr, 10) : parseInt(yrStr, 10);
      }
      const yStr = String(year);
      const mStr = String(monIdx + 1).padStart(2, '0');
      const dStr = String(day).padStart(2, '0');
      return { date: `${yStr}-${mStr}-${dStr}`, matchedText: mNamed[0] };
    }
  }

  // 3. Numeric Full Date: DD-MM-YYYY or DD/MM/YYYY
  const mFull = lower.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (mFull) {
    const day = parseInt(mFull[1], 10);
    const mon = parseInt(mFull[2], 10);
    const yr = parseInt(mFull[3], 10);
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
      return { date: `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`, matchedText: mFull[0] };
    }
  }

  // 4. ISO Date: YYYY-MM-DD
  const mIso = lower.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (mIso) {
    const yr = parseInt(mIso[1], 10);
    const mon = parseInt(mIso[2], 10);
    const day = parseInt(mIso[3], 10);
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
      return { date: `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`, matchedText: mIso[0] };
    }
  }

  // 5. Short Numeric: DD-MM-YY or DD/MM/YY (e.g. 4-10-26)
  const mShort = lower.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2})\b/);
  if (mShort) {
    const day = parseInt(mShort[1], 10);
    const mon = parseInt(mShort[2], 10);
    const yr = 2000 + parseInt(mShort[3], 10);
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
      return { date: `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`, matchedText: mShort[0] };
    }
  }

  // 6. Day-Month followed by ko/date/tarikh (e.g. 4-10 ko, 04/10)
  const mDm = lower.match(/\b(\d{1,2})[-/](\d{1,2})\s*(?:ko|date|tarikh|tareekh)?\b/);
  if (mDm) {
    const day = parseInt(mDm[1], 10);
    const mon = parseInt(mDm[2], 10);
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
      return { date: `${curYear}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`, matchedText: mDm[0] };
    }
  }

  // 7. Day + tarikh/date
  const mTarikh = lower.match(/\b(\d{1,2})\s*(?:tarikh|taarikh|tareekh|date)\b/);
  if (mTarikh) {
    const day = parseInt(mTarikh[1], 10);
    if (day >= 1 && day <= 31) {
      const mon = now.getMonth() + 1;
      return { date: `${curYear}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`, matchedText: mTarikh[0] };
    }
  }

  return null;
}

function parseLocalTransactionInstruction(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim();
  if (isQuestionNotEntry(raw)) return null;

  const lower = raw.toLowerCase();

  // 0. Extract Date from instruction (e.g. '4-OCT', '4-10-26', 'kal', 'parso')
  const dateInfo = extractTransactionDate(raw);
  const entryDate = (dateInfo && dateInfo.date) ? dateInfo.date : getLocalDateStr();

  // Remove the matched date from text so any numbers in the date (like '4' in '4-OCT') are not mistakenly treated as amount!
  let textForParsing = raw;
  if (dateInfo && dateInfo.matchedText) {
    textForParsing = textForParsing.replace(new RegExp(dateInfo.matchedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s*ko)?', 'gi'), ' ');
  }

  // 1. Must contain an amount
  const amtMatch = textForParsing.match(/(?:₹|rs\.?|inr|rupaye?|rupees?)?\s*(\d+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|inr|rupaye?|rupees?)?/i);
  if (!amtMatch) return null;
  const amount = parseFloat(amtMatch[1]);
  if (!amount || isNaN(amount) || amount <= 0) return null;

  // 2. Check for action keywords indicating transaction
  const isExpense = /\b(pay|paid|diye|diya|de\s*diye|de\s*diya|kharch|spent|bhada|kharida|kharide|purchase|khareeda|bhar|bhara|send|sent|advance)\b/i.test(lower);
  const isIncome = /\b(mile|mila|mil\s*gaya|mil\s*gaye|aaye|aaya|aayi|aa\s*gaye|received|receive|got|salary|kamaya|jama|credited|earn|earned)\b/i.test(lower);
  const hasMethod = /\b(cash|rokad|nagad|upi|gpay|google\s*pay|phonepe|paytm|online|qr|bank|netbanking|cheque|card)\b/i.test(lower);
  const hasEntryKw = /\b(entry|add|save|record|hisaab)\b/i.test(lower);

  const type = isIncome ? 'income' : 'expense';

  // 3. Payment Method detection
  let method = 'Cash';
  if (/\b(upi|gpay|google\s*pay|phonepe|paytm|online|qr)\b/i.test(lower)) method = 'UPI';
  else if (/\b(bank|netbanking|cheque|neft|rtgs|imps|card|debit|credit)\b/i.test(lower)) method = 'Bank';
  else if (/\b(cash|rokad|nagad)\b/i.test(lower)) method = 'Cash';

  // 4. Party detection — STRICT: Only match against existing official parties!
  // Nayi party ka naam kabhi nahi banega.
  let party = '';
  const matchedOfficial = matchOfficialParty(raw) || matchOfficialParty(textForParsing);
  if (matchedOfficial) {
    party = matchedOfficial;
  } else if (/\bself\b/i.test(lower)) {
    party = 'Self';
  } else {
    // If party not matched in official list, default strictly to 'Self' or 'Income'
    party = (type === 'income') ? 'Income' : 'Self';
  }

  // 5. TRIGGER WORD NOTE EXTRACTION ("SE " and "FOR "):
  let notes = '';
  const forMatch = raw.match(/\bfor\s+(.+)$/i);
  if (forMatch && forMatch[1].trim()) {
    notes = forMatch[1].trim();
  } else {
    const regex = /\bse\s+/gi;
    let match;
    let lastIndex = -1;
    while ((match = regex.exec(raw)) !== null) {
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex !== -1) {
      const noteAfterSe = raw.slice(lastIndex).trim();
      if (noteAfterSe) {
        notes = noteAfterSe;
      }
    }
  }

  // Fallback note extraction
  if (!notes) {
    let cleaned = textForParsing;
    cleaned = cleaned.replace(new RegExp('(?:₹|rs\\.?|inr|rupaye?)?\\s*' + amount + '\\s*(?:₹|rs\\.?|inr|rupaye?)?', 'i'), '');
    if (party && party !== 'Self' && party !== 'Income') {
      cleaned = cleaned.replace(new RegExp('\\b' + party.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(?:ko|se)?\\b', 'gi'), '');
    }
    if (method) {
      cleaned = cleaned.replace(new RegExp('\\b' + method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(?:se|me|dwara|by)?\\b', 'gi'), '');
    }
    cleaned = cleaned.replace(/\s+/g, ' ').trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (cleaned && cleaned.length >= 3) {
      notes = cleaned;
    }
  }
  if (!notes) notes = raw;

  return {
    amount: amount,
    party: party,
    method: method,
    type: type,
    notes: notes,
    date: entryDate,
    originalText: raw
  };
}

function getTotalBalance() {
  let total = 0;
  (entries || []).forEach(e => {
    const amt = Number(e.amount) || 0;
    if (typeof isIncomeType === 'function' ? isIncomeType(e.type) : e.type === 'income') total += amt;
    else if (typeof isExpenseType === 'function' ? isExpenseType(e.type) : e.type === 'expense') total -= amt;
  });
  return total;
}

function createEntryFromAi(params) {
  if (!params) return null;
  const amt = parseFloat(params.amount || 0);
  if (!amt || isNaN(amt) || amt <= 0) return null;

  // PARTY MATCHING: Prefer official list, else use spoken/typed name (title-case)
  // so "2000 Ram ko cash se..." becomes party=Ram instead of Self
  const rawParty = (params.party || '').trim();
  // NEVER invent new party from AI/voice/bill — only existing list; else Self + notes
  const _resolvedP = (typeof resolveVoiceParty === 'function')
    ? resolveVoiceParty(rawParty, params.notes || '')
    : { party: (typeof matchPartyName === 'function' && matchPartyName(rawParty)) || 'Self', notesExtra: params.notes || '' };
  let party = _resolvedP.party || (params.type === 'income' ? 'Income' : 'Self');
  if (_resolvedP.notesExtra) params.notes = _resolvedP.notesExtra;

  let method = 'Cash';
  if (typeof normalizeVoiceMethod === 'function') {
    method = normalizeVoiceMethod(params.method) || params.method || 'Cash';
  } else if (params.method) {
    method = params.method;
  }

  const type = (params.type === 'income') ? 'income' : 'expense';

  // DATE RESOLUTION: Use past/custom date if specified in chat, otherwise fallback to today
  let date = '';
  if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(String(params.date).trim())) {
    date = String(params.date).trim();
  } else if (typeof extractTransactionDate === 'function') {
    const dObj = extractTransactionDate(params.originalText || params.date || params.notes || '');
    if (dObj && dObj.date) date = dObj.date;
  }
  if (!date && typeof quickAddParseDate === 'function' && params.date) {
    date = quickAddParseDate(params.date);
  }
  if (!date) date = getLocalDateStr();

  const time = new Date().toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit' });
  let notes = (params.notes || '').trim();
  // Party already set to spoken name when unmatched — don't duplicate name into notes
  if (notes && rawParty && notes.toLowerCase() === rawParty.toLowerCase()) {
    notes = '';
  }

  const nowIso = new Date().toISOString();
  const entryData = {
    id: generateEntryId(),
    party: party,
    method: method,
    amount: amt,
    type: type,
    date: date,
    time: time,
    notes: notes,
    timestamp: nowIso,
    updatedAt: nowIso,
    syncedWithCloud: false,
    image: null,
    userId: (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null
  };

  // 💾 PERMANENT STORAGE: unshifted to memory, saved to localStorage, synced to Firebase & offline queue
  entries.unshift(entryData);
  persistAllEntries('createEntryFromAi');

  try {
    if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
    if (typeof renderWallet === 'function') renderWallet();
    if (typeof renderEntries === 'function') renderEntries();
    if (typeof renderAnalytics === 'function') renderAnalytics();
    if (typeof renderList === 'function') renderList();
  } catch(uiErr) {
    console.warn('createEntryFromAi UI sync error (non-fatal):', uiErr);
  }

  const dateNotice = (date && date !== getLocalDateStr() && typeof formatDisplayDate === 'function') ? ` on ${formatDisplayDate(date)}` : '';
  if (typeof showMiniSaveToast === 'function') showMiniSaveToast(navigator.onLine ? 'synced' : 'local');

  try {
    if (typeof queueOfflineSync === 'function') queueOfflineSync('set', entryData);
    if (typeof saveEntryToFirebase === 'function') {
      saveEntryToFirebase(entryData);
    } else if (firebaseReady && db) {
      db.collection('entries').doc(entryData.id).set(entryData).catch(err => console.warn('Firebase save:', err));
    }
  } catch(syncErr) {
    console.warn('createEntryFromAi sync error (non-fatal):', syncErr);
  }

  return entryData;
}

async function parseTransactionWithGemini(text) {
  const apiKey = getGeminiKey();
  if (!apiKey) return null;
  const knownParties = typeof getOfficialPartyNames === 'function' ? getOfficialPartyNames() : ['Self'];
  const todayStr = getLocalDateStr();

  const prompt = `Tum DayToDay personal finance app ke smart AI parser ho.
User ne chat me instruction di: "${text}"
Today's date: "${todayStr}"
KNOWN PARTIES LIST IN APP: ${JSON.stringify(knownParties)}

TASK: Check karo kya user koi income ya expense entry add karne ki instruction de raha hai?

CRITICAL PARTY RULE:
1) Pehle KNOWN PARTIES LIST se best match karo (case-insensitive / partial ok).
2) Agar user ne kisi PERSON ka naam bola (Ram, Sita, Ravi, Amit...) jo list me nahi hai, toh WAHI naam party field me do (title-case). Self mat force karo.
3) Agar sirf item/kharch bola (poha, chai, petrol, sabzi, recharge, auto, grocery) bina person ke, tabhi party = "Self" aur item notes me.
Examples:
- "2000 Ram ko cash se kapde ke liye pay kiye" -> party: "Ram", method: "Cash", notes: "kapde ke liye", amount: 2000
- "500 poha kharida cash" -> party: "Self", notes: "poha", method: "Cash", amount: 500

CRITICAL DATE RULE:
Agar user ne instruction me koi date ya din bola hai (jaise "4-OCT", "4-10-26", "yesterday", "kal", "parso", "15 September", "4 tarikh ko"):
Toh wahi date STRICTLY "YYYY-MM-DD" format me "date" field me do (jaise "2026-10-04").
Agar koi date nahi boli, toh aaj ki date "${todayStr}" do.

CRITICAL TRIGGER RULE FOR NOTES:
Jab bhi user instruction me "SE " ya "FOR " bole ya type kare, toh "SE " ya "FOR " ke theek baad jo bhi text bola/likha gaya hai, SIRF wahi text transaction ka "notes" banega!
Jaise:
- "29 MAHI KO 4-OCT KO CASH SE ADVANCE PAY KIYE" -> date: "2026-10-04", notes: "ADVANCE PAY KIYE", party: "Mahi", method: "Cash", amount: 29
- "500 SELF KO CASH SE POHA KHARIDEN KE LIYE PAY KIYE" -> date: "${todayStr}", notes: "POHA KHARIDEN KE LIYE PAY KIYE", party: "SELF", method: "Cash", amount: 500
- "paid 800 to Amit in cash for dinner with friends" -> notes: "dinner with friends", party: "Amit", method: "Cash", amount: 800

FORMAT: "<amount> <party> ko <method> se <note>". Party = "ko" se pehle ka naam (item ho to bhi wahi party), method = "se" se pehle (cash/upi/bank), notes = "se" ke baad ka poora text.
- "500 auto ko cash se auto wale ko pay kiya" -> amount: 500, party: "Auto", method: "Cash", notes: "auto wale ko pay kiya"

Agar entry instruction hai, toh JSON me return karo:
{
  "isEntry": true,
  "amount": 500,
  "party": "SELF",
  "type": "expense",
  "method": "Cash",
  "date": "${todayStr}",
  "notes": "POHA KHARIDEN KE LIYE PAY KIYE",
  "reply": "Entry successfully save ho gayi."
}

Agar ye SIRF koi financial sawaal ya balance query ya aam baat hai:
{
  "isEntry": false
}`;

  const schema = {
    type: "OBJECT",
    properties: {
      isEntry: { type: "BOOLEAN" },
      amount: { type: "NUMBER" },
      party: { type: "STRING" },
      type: { type: "STRING", enum: ["expense", "income"] },
      method: { type: "STRING", enum: ["Cash", "UPI", "Bank"] },
      date: { type: "STRING" },
      notes: { type: "STRING" },
      reply: { type: "STRING" }
    },
    required: ["isEntry"]
  };

  try {
    const res = await callGeminiJSON(prompt, schema);
    return res;
  } catch(e) {
    console.warn("parseTransactionWithGemini error:", e);
    return null;
  }
}


// ===== Bill / Receipt scan → entry (Gemini Vision) =====
let pendingChatBillImage = null;

function triggerChatBillScan(){
  const input = document.getElementById('aiChatBillInput');
  if (input) input.click();
}

async function handleChatBillImage(event){
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  event.target.value = '';

  // Read image first so we can retry after key is fixed
  let dataUrl = null;
  try {
    dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1280;
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            const s = maxDim / Math.max(w, h);
            w = Math.round(w * s); h = Math.round(h * s);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    pendingChatBillImage = dataUrl;
    try { sessionStorage.setItem('pendingChatBillImage', dataUrl); } catch(e){}
  } catch (readErr) {
    showNotification('Image read nahi ho payi. Clear photo try karein.', 'error');
    return;
  }

  const apiKey = (typeof getGeminiKey === 'function') ? getGeminiKey() : '';
  if (!apiKey || apiKey.length < 20) {
    aiChatMessages.push({
      role: 'ai',
      text: '⚠️ Bill scan ke liye Gemini API key chahiye.\n\n1. aistudio.google.com/apikey pe free key banao\n2. Settings → AI Settings me paste karke Save\n3. Phir yahan + se bill dubara upload karo (ya "retry bill" likho)\n\nKey ke bina photo se entry auto-save nahi ho sakti.',
      timestamp: Date.now()
    });
    if (typeof renderAiChatMessages === 'function') renderAiChatMessages();
    if (typeof openAiSettingsModal === 'function') setTimeout(() => openAiSettingsModal(), 400);
    showNotification('Gemini API key set karein (AI Settings)', 'warning');
    return;
  }

  await processChatBillImageDataUrl(dataUrl);
}

async function processChatBillImageDataUrl(dataUrl){
  if (!dataUrl) {
    showNotification('Koi pending bill image nahi mili', 'error');
    return;
  }
  const msgEl = document.getElementById('aiChatMsg');
  setAiChatHeaderState('thinking', 'Scanning bill...');
  if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(true);
  if (msgEl) msgEl.innerHTML = '<span style="color:#2dd4bf;">📄 Bill scan ho raha hai...</span>';

  try {
    pendingChatBillImage = dataUrl;
    try { sessionStorage.setItem('pendingChatBillImage', dataUrl); } catch(e){}
    const base64 = dataUrl.split(',')[1] || '';
    if (!base64 || base64.length < 100) {
      throw new Error('Image data invalid. Clear photo dubara upload karein.');
    }
    const knownParties = typeof getOfficialPartyNames === 'function' ? getOfficialPartyNames() : ['Self'];
    const promptText = `Ye bill/receipt/invoice ki photo hai. Extract ONE transaction for DayToDay expense app.
KNOWN PARTIES: ${JSON.stringify(knownParties)}
Today: ${typeof getLocalDateStr === 'function' ? getLocalDateStr() : ''}

Return ONLY valid JSON (no markdown, no extra text):
{
  "isEntry": true,
  "amount": 0,
  "party": "Self",
  "method": "UPI",
  "type": "expense",
  "date": "YYYY-MM-DD",
  "notes": "merchant or item summary",
  "reply": "short Hinglish confirmation"
}
Rules:
- amount = GRAND TOTAL / amount paid (number only, no commas). Prefer largest total on bill.
- type = "expense" unless clearly refund/credit/salary.
- party = best match from KNOWN PARTIES if similar; else use clear merchant/shop name from bill (do not invent random names).
- method = Cash / UPI / Bank / Card (guess from bill if possible, else UPI).
- date = bill date if visible else today.
- notes = shop name + short items (max 80 chars).
- reply = short Hinglish e.g. "Bill se ₹120 chai entry save ho gayi".`;

    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: promptText },
          { inlineData: { mimeType: 'image/jpeg', data: base64 } }
        ]
      }],
      generationConfig: { temperature: 0.05, maxOutputTokens: 600 }
    };
    const reply = await _geminiRawFetch(body);
    let parsed = typeof _parseGeminiJson === 'function' ? _parseGeminiJson(reply) : null;

    // Fallback: if JSON parse failed but reply has a clear amount, still try to save
    if ((!parsed || !(Number(parsed.amount) > 0)) && reply) {
      const amtMatch = String(reply).replace(/,/g, '').match(/(?:₹|rs\.?|inr|total|amount|paid)[^\d]{0,12}(\d+(?:\.\d{1,2})?)/i)
        || String(reply).replace(/,/g, '').match(/(\d{2,}(?:\.\d{1,2})?)/);
      if (amtMatch) {
        parsed = parsed || {};
        parsed.isEntry = true;
        parsed.amount = parseFloat(amtMatch[1]);
        parsed.party = parsed.party || 'Self';
        parsed.type = parsed.type || 'expense';
        parsed.method = parsed.method || 'UPI';
        parsed.notes = parsed.notes || 'Bill scan';
        parsed.reply = parsed.reply || ('Bill se ₹' + parsed.amount + ' entry banayi');
      }
    }

    aiChatMessages.push({
      role: 'user',
      text: '📄 Bill / receipt scanned',
      isVoice: false,
      image: dataUrl,
      timestamp: Date.now()
    });
    if (parsed && (parsed.isEntry !== false) && Number(parsed.amount) > 0) {
      parsed.originalText = parsed.notes || 'Bill scan';
      const saved = createEntryFromAi(parsed);
      if (saved) {
        let replyText = (parsed.reply) || `✅ Bill se entry save: ₹${Number(saved.amount).toLocaleString('en-IN')} (${saved.party})`;
        try {
          const bal = typeof getTotalBalance === 'function' ? getTotalBalance() : 0;
          const balStr = (bal < 0 ? '-' : '') + Math.abs(bal).toLocaleString('en-IN');
          if (!/balance/i.test(replyText)) replyText += ` Ab total balance ₹${balStr} hai.`;
        } catch(e){}
        aiChatMessages.push({ role: 'ai', text: replyText, entryData: saved, timestamp: Date.now() });
        showNotification('Bill entry saved ✓', 'success');
        pendingChatBillImage = null;
        try { sessionStorage.removeItem('pendingChatBillImage'); } catch(e){}
      } else {
        aiChatMessages.push({ role: 'ai', text: '⚠️ Amount mila lekin entry save nahi hui. Dobara try karein.', timestamp: Date.now() });
      }
    } else {
      const failMsg = (parsed && parsed.reply) || 'Bill se amount clearly nahi mila. Clear photo leke dobara try karein ya manual entry karein.';
      aiChatMessages.push({ role: 'ai', text: failMsg, timestamp: Date.now() });
      showNotification('Bill se amount nahi mila', 'warning');
    }
    renderAiChatMessages();
    setAiChatHeaderState('idle');
    if (msgEl) msgEl.innerHTML = '';
  } catch (err) {
    console.error('Bill scan error', err);
    let errText = (err && err.message) ? String(err.message) : String(err || 'Unknown error');
    if (/INVALID_KEY|API_KEY_INVALID|api key not valid|expired|API Key set nahi/i.test(errText)) {
      errText = '⚠️ Bill scan fail: Gemini API key missing / invalid / expired.\n\n✅ Fix steps:\n1. aistudio.google.com/apikey → Create API key\n2. App Settings → AI Settings → key paste → Save\n3. Chat me "retry bill" likho YA + se photo dubara upload karo\n\nNote: Free Gemini key se hi bill/receipt photo se entry banti hai.';
      if (typeof openAiSettingsModal === 'function') {
        setTimeout(() => { try { openAiSettingsModal(); } catch(e){} }, 500);
      }
    } else if (/quota|rate limit|RESOURCE_EXHAUSTED|429/i.test(errText)) {
      errText = '⚠️ Bill scan: Gemini free limit full hai. 1-2 min baad "retry bill" likh ke try karein.';
    } else {
      errText = '⚠️ Bill scan fail: ' + errText + '\n\nTip: Clear photo lo, total amount dikhna chahiye. Phir "retry bill" try karo.';
    }
    aiChatMessages.push({ role: 'ai', text: errText, timestamp: Date.now() });
    renderAiChatMessages();
    setAiChatHeaderState('idle');
    if (msgEl) msgEl.innerHTML = '';
    // Keep pending image for retry — do NOT clear
  } finally {
    if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(false);
  }
}

/** Retry last pending bill image after key is fixed */
async function retryPendingChatBillScan(){
  let dataUrl = pendingChatBillImage;
  if (!dataUrl) {
    try { dataUrl = sessionStorage.getItem('pendingChatBillImage'); } catch(e){}
  }
  if (!dataUrl) {
    showNotification('Koi pending bill nahi. + se photo upload karein.', 'warning');
    return false;
  }
  const key = (typeof getGeminiKey === 'function') ? getGeminiKey() : '';
  if (!key || key.length < 20) {
    showNotification('Pehle AI Settings me valid Gemini key Save karein', 'warning');
    if (typeof openAiSettingsModal === 'function') openAiSettingsModal();
    return false;
  }
  showNotification('Bill dubara scan ho raha hai...', 'info');
  await processChatBillImageDataUrl(dataUrl);
  return true;
}

async function sendAiChatMessage(textOverride, isVoiceQuery){
 const inputEl = document.getElementById('aiChatInput');
 const msgEl = document.getElementById('aiChatMsg');
 const sendBtn = document.getElementById('aiChatSendBtn');
 const question = (typeof textOverride === 'string' && textOverride.trim() ? textOverride : (inputEl ? inputEl.value : '')).trim();

 // Retry last bill scan after API key is fixed
 if (/^(retry\s*bill|bill\s*retry|dubara\s*scan|scan\s*dobara|retry\s*scan)$/i.test(question)) {
  if (inputEl) inputEl.value = '';
  aiChatMessages.push({ role: 'user', text: question, timestamp: Date.now() });
  if (typeof renderAiChatMessages === 'function') renderAiChatMessages();
  if (typeof retryPendingChatBillScan === 'function') {
    await retryPendingChatBillScan();
  } else {
    showNotification('Retry available nahi', 'error');
  }
  return;
 }

 if (isVoiceQuery && isQuestionNotEntry(question)) {
  window.__aiChatResumeAfterSpeak = true;
  window.__aiChatUserCancelled = false;
 } else {
  window.__aiChatResumeAfterSpeak = false;
 }

 // Cancel previous in-flight answer — only latest request wins
 aiChatRequestToken = (aiChatRequestToken || 0) + 1;
 const myToken = aiChatRequestToken;
 try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch(e){}
 // Drop stale thinking bubbles from older requests
 try {
  aiChatMessages = (aiChatMessages || []).filter(m => m && m.text !== '__THINKING__' && m.text !== '💭...');
  window.aiChatMessages = aiChatMessages;
 } catch(e){}
 const stillMine = () => myToken === aiChatRequestToken;

 const userMsgObj = {
  id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
  role: 'user',
  text: question,
  isVoice: !!isVoiceQuery,
  timestamp: Date.now()
 };
 aiChatMessages.push(userMsgObj);
 if (inputEl) inputEl.value = "";
 saveAiChatHistory();
 renderAiChatMessages();
 if (msgEl) msgEl.textContent = "";
 if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(true);
 else if (sendBtn) sendBtn.disabled = true;

 setAiChatHeaderState('thinking');
 const thinkingIdx = aiChatMessages.length;
 aiChatMessages.push({ role: 'ai', text: '__THINKING__', timestamp: Date.now() });
 renderAiChatMessages();

 try {
 // ⚡ 0. REMINDER INSTRUCTION DETECTION (Voice or Typed instruction to set a reminder)
 const remCandidate = parseReminderInstruction(question);
 if (remCandidate && remCandidate.isReminder) {
  if (remCandidate.needsClarification) {
   const clarifyMsg = remCandidate.askText;
   aiChatMessages[thinkingIdx] = {
    id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
    role: 'ai',
    text: clarifyMsg,
    timestamp: Date.now()
   };
   saveAiChatHistory();
   renderAiChatMessages();
   if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(false);
   else if (sendBtn) sendBtn.disabled = false;
   if (!window.aiChatVoiceMuted) {
    setAiChatHeaderState('speaking');
    if (msgEl) msgEl.textContent = "🔊 Speaking...";
    speakText(clarifyMsg, () => {
     if (msgEl) msgEl.textContent = "";
     setAiChatHeaderState('idle');
    });
   } else {
    setAiChatHeaderState('idle');
   }
   return;
  }

  // Save the reminder
  const newReminder = {
   id: 'r_' + Date.now(),
   title: remCandidate.title,
   amount: remCandidate.amount || 0,
   dueDate: remCandidate.dueDate,
   notes: remCandidate.notes,
   direction: remCandidate.direction,
   paid: false,
   createdAt: new Date().toISOString()
  };
  paymentReminders.unshift(newReminder);
  saveRemindersToLocalStorage();
  renderRemindersList();
  if (typeof updateReminderUnreadDot === 'function') updateReminderUnreadDot();

  const amtStr = remCandidate.amount > 0 ? ` of ₹${Number(remCandidate.amount).toLocaleString('en-IN')}` : '';
  const dirStr = remCandidate.direction === 'incoming' ? 'to receive' : 'to pay';
  const dateFormatted = (typeof formatDisplayDate === 'function') ? formatDisplayDate(remCandidate.dueDate) : remCandidate.dueDate;
  const replyText = `✅ Reminder set for ${dateFormatted}: "${remCandidate.title}"${amtStr} (${dirStr}). Opening reminders page...`;

  aiChatMessages[thinkingIdx] = {
   id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
   role: 'ai',
   text: replyText,
   timestamp: Date.now()
  };
  saveAiChatHistory();
  renderAiChatMessages();
  if (sendBtn) sendBtn.disabled = false;

  const navigateToReminders = () => {
   setTimeout(() => {
    if (typeof closeAiChatModal === 'function') closeAiChatModal();
    if (typeof closeAiVoiceFullscreen === 'function') closeAiVoiceFullscreen();
    openRemindersPanel();
   }, 1200);
  };

  if (!window.aiChatVoiceMuted) {
   setAiChatHeaderState('speaking');
   if (msgEl) msgEl.textContent = "🔊 Speaking...";
   speakText(replyText, () => {
    if (msgEl) msgEl.textContent = "";
    setAiChatHeaderState('idle');
    navigateToReminders();
   });
  } else {
   setAiChatHeaderState('idle');
   navigateToReminders();
  }
  return;
 }

 // ⚡ 1. ENTRY INSTRUCTION DETECTION (Voice or Typed instruction to save expense/income)
 if (!isQuestionNotEntry(question)) {
  const localCandidate = parseLocalTransactionInstruction(question);
  let parsedEntry = null;

  if (localCandidate && localCandidate.amount > 0 && localCandidate.party) {
   parsedEntry = localCandidate;
  } else {
   // Try quick-add parser as local fallback
   try {
    const quickLine = (typeof parseVoiceToQuickAddLine === 'function') ? parseVoiceToQuickAddLine(question) : '';
    if (quickLine) {
     const [qAmt, qParty, qDate, qMeth, qNotes] = quickLine.split(',');
     const numAmt = parseFloat(qAmt);
     if (!isNaN(numAmt) && numAmt > 0) {
      parsedEntry = {
       amount: numAmt,
       party: qParty || 'Self',
       method: qMeth || 'Cash',
       type: (typeof quickAddVoiceType === 'string' && quickAddVoiceType) ? quickAddVoiceType : 'expense',
       date: (typeof quickAddParseDate === 'function' ? quickAddParseDate(qDate) : null) || getLocalDateStr(),
       notes: qNotes || ''
      };
     }
    }
   } catch(e){}

   // Try Gemini JSON parser if still not parsed
   if (!parsedEntry || !parsedEntry.amount) {
    try {
     const aiParsed = await parseTransactionWithGemini(question);
     if (typeof stillMine === 'function' && !stillMine()) return;
     if (aiParsed && aiParsed.isEntry && aiParsed.amount > 0) {
      parsedEntry = aiParsed;
     }
    } catch(e){}
   }
   // Fallback to localCandidate if Gemini failed or no key
   if (!parsedEntry && localCandidate && localCandidate.amount > 0) {
    parsedEntry = localCandidate;
   }
  }

  if (parsedEntry && parsedEntry.amount > 0) {
   shivaRuleOverride(parsedEntry, question);
   parsedEntry.originalText = question;
   const saved = createEntryFromAi(parsedEntry);
   if (saved) {
    const isInc = saved.type === 'income';
    const dateFormatted = (typeof formatDisplayDate === 'function') ? formatDisplayDate(saved.date) : saved.date;
    const dateNotice = (saved.date !== getLocalDateStr()) ? ` [Date: ${dateFormatted}]` : '';
    const replyText = parsedEntry.reply && parsedEntry.reply.includes(dateFormatted)
      ? parsedEntry.reply
      : `✅ Entry saved${dateNotice}: ₹${Number(saved.amount).toLocaleString('en-IN')} ${isInc ? 'received from' : 'paid to'} ${saved.party} via ${saved.method}!`;
    aiChatMessages[thinkingIdx] = {
     id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
     role: 'ai',
     text: replyText,
     entryData: saved,
     timestamp: Date.now()
    };
    saveAiChatHistory();
    renderAiChatMessages();
    if (sendBtn) sendBtn.disabled = false;

    if (!window.aiChatVoiceMuted) {
     setAiChatHeaderState('speaking');
     if (msgEl) msgEl.textContent = "🔊 Speaking...";
     speakText(replyText, () => {
      if (msgEl) msgEl.textContent = "";
      setAiChatHeaderState('idle');
     });
    } else {
     setAiChatHeaderState('idle');
    }
    return;
   }
  }
 }

 // 2. Instant local financial solver check (<5ms)
 const instant = instantAnswerFinancialQuery(question);
 if (instant) {
  aiChatMessages[thinkingIdx] = {
   id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
   role: 'ai',
   text: instant,
   timestamp: Date.now()
  };
  saveAiChatHistory();
  renderAiChatMessages();
  if (sendBtn) sendBtn.disabled = false;
  if (!window.aiChatVoiceMuted) {
   setAiChatHeaderState('speaking');
   if (msgEl) msgEl.textContent = "🔊 Speaking...";
   speakText(instant, () => {
    if (msgEl) msgEl.textContent = "";
    if (!window.__aiChatResumeAfterSpeak) setAiChatHeaderState('idle');
   });
  } else {
   setAiChatHeaderState('idle');
  }
  return;
 }

 // 3. Try Gemini AI if API key exists (handles app finances AND external/general questions)
 const apiKey = getGeminiKey();
 if (apiKey) {
  try {
   const summary = buildAiContextText(true);
    const prompt = `You are a Grok-style ultra-helpful AI inside DayToDay expense app.

LANGUAGE RULES (strict):
- Default: **Hinglish** (simple Hindi words in Roman script + English) e.g. "Aapka total balance ₹5000 hai."
- If user writes mostly **English**, reply in clear **English**.
- Pure **Hindi (Devanagari)** ONLY if user clearly asks "Hindi me batao" / "हिंदी में".
- Never force pure Hindi Devanagari by default.
- Voice/read-aloud friendly: short sentences, no heavy Sanskrit words.

CRITICAL ACCURACY RULES:
- For APP FINANCE questions (balance, party dues, monthly total, last entry, savings): use ONLY the REAL FINANCIAL DATA below. Never invent amounts, parties, or dates.
- If data is missing or zero, say clearly "Is baare me data nahi mila" — do not guess.
- Double-check arithmetic (sum of entries) before answering.
- When user asks about a party name, search the data for that exact / similar name.

ROLES:
1) APP FINANCE: exact numbers from REAL FINANCIAL DATA below.
2) MATH/GST/EMI: step-by-step with ₹.
3) GENERAL: full useful answer (knowledge, news, tech, life).

FORMAT:
- Short opening line
- **bold** for key points, - bullets when useful
- Keep it scannable and honest

REAL FINANCIAL DATA:
${summary}

User: "${question}"`;

   const reply = await callGeminiText(prompt);
   if (typeof stillMine === 'function' && !stillMine()) return;
   const finalReply = reply || smartFallbackGeneralAnswer(question);
   aiChatMessages[thinkingIdx] = {
    id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
    role: 'ai',
    text: finalReply,
    timestamp: Date.now()
   };
   saveAiChatHistory();
   renderAiChatMessages();
   if (!window.aiChatVoiceMuted) {
    setAiChatHeaderState('speaking');
    if (msgEl) msgEl.textContent = "🔊 Speaking...";
    speakText(finalReply, () => {
     if (msgEl) msgEl.textContent = "";
     if (!window.__aiChatResumeAfterSpeak) setAiChatHeaderState('idle');
    });
   } else {
    setAiChatHeaderState('idle');
   }
   return;
  } catch (err) {
   console.error("Gemini call failed, using smart general fallback:", err);
  } finally {
   if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(false);
   else if (sendBtn) sendBtn.disabled = false;
  }
 }

 // 4. Smart local general fallback if no API key or API call failed
 const fallbackAnswer = smartFallbackGeneralAnswer(question);
 aiChatMessages[thinkingIdx] = {
  id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
  role: 'ai',
  text: fallbackAnswer,
  timestamp: Date.now()
 };
 saveAiChatHistory();
 renderAiChatMessages();
 if (!window.aiChatVoiceMuted) {
  setAiChatHeaderState('speaking');
  if (msgEl) msgEl.textContent = "🔊 Speaking...";
  speakText(fallbackAnswer, () => {
   if (msgEl) msgEl.textContent = "";
   if (!window.__aiChatResumeAfterSpeak) setAiChatHeaderState('idle');
  });
 } else {
  setAiChatHeaderState('idle');
 }
 } catch (err) {
  console.error("sendAiChatMessage error:", err);
  const fallback = smartFallbackGeneralAnswer(question) || "Maaf kijiye, abhi response process karne me dikkat aayi. Kripya dobara try karein.";
  aiChatMessages[thinkingIdx] = {
   id: 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2,4),
   role: 'ai',
   text: fallback,
   timestamp: Date.now()
  };
  saveAiChatHistory();
  renderAiChatMessages();
 } finally {
  if (typeof setAiChatSendThinking === 'function') setAiChatSendThinking(false);
  else if (sendBtn) sendBtn.disabled = false;
  if (window.aiChatVoiceMuted) {
   setAiChatHeaderState('idle');
  }
 }
}

function renderDashboardTotals(){
 const now = new Date();
 const curMonth = now.getMonth(), curYear = now.getFullYear();
 const prevDate = new Date(curYear, curMonth-1, 1);
 const prevMonth = prevDate.getMonth(), prevYear = prevDate.getFullYear();

 let income=0, expense=0;
 let savings=0; // Investment-aware: only Groww/APJ EMI Bank/Mutual Fund/Other Investment affect this
 let totalBalance = 0; // Cumulative balance across all time: Total Received - Total Paid
 let curMonthIncome = 0, prevIncome = 0;

 (entries || []).forEach(e=>{
  const dStr = normalizeDate(e.date);
  const d = new Date(dStr);
  const amt = Number(e.amount)||0;
  const toSavingsParty = isSavingsParty(e.party);

  // Lifetime balance calculation: Received (+) and Payment (-)
  if(isIncomeType(e.type)) {
   totalBalance += amt;
   income += amt;
   if(toSavingsParty) savings -= amt; // withdrawing from an investment reduces savings
  } else if(isExpenseType(e.type)) {
   totalBalance -= amt;
   expense += amt;
   if(toSavingsParty) savings += amt; // paying into an investment grows savings
  }

  // Sirf growth badge ke liye month-wise Receive tracking
  if(d.getFullYear()===curYear && d.getMonth()===curMonth){
   if(isIncomeType(e.type)) curMonthIncome+=amt;
  } else if(d.getFullYear()===prevYear && d.getMonth()===prevMonth){
   if(isIncomeType(e.type)) prevIncome+=amt;
  }
 });

 savings = savings > 0 ? savings : 0;

 document.getElementById("walBalance").textContent = (totalBalance<0?'-':'') + Math.abs(totalBalance).toLocaleString("en-IN");
 document.getElementById("statIncome").textContent = "₹"+income.toLocaleString("en-IN");
 document.getElementById("statExpense").textContent = "₹"+expense.toLocaleString("en-IN");
 document.getElementById("statSavings").textContent = "₹"+savings.toLocaleString("en-IN");

 // Growth: month change display like Unfold "+₹865 (+0.2%) past month"
 let growthPct = 0;
 if(prevIncome > 0){
  growthPct = ((curMonthIncome - prevIncome) / prevIncome) * 100;
 } else if(curMonthIncome > 0){
  growthPct = 100;
 }
 const monthDelta = curMonthIncome - prevIncome;
 const growthEl = document.getElementById("growthLabel");
 if(growthEl){
  const sign = monthDelta >= 0 ? "+" : "-";
  const pctSign = growthPct >= 0 ? "+" : "";
  growthEl.innerHTML = `${sign}₹${Math.abs(monthDelta).toLocaleString("en-IN")} (${pctSign}${growthPct.toFixed(1)}%) <span style="color:#9ca3af;font-weight:400;">past month</span>`;
  growthEl.style.color = monthDelta >= 0 ? "#10b981" : "#ef4444";
 }

 const balEl = document.getElementById("walBalance");
 if(balEl){
  balEl.style.color = totalBalance < 0 ? "#ef4444" : "";
 }

 try { if (typeof renderNetWorthChart === 'function') renderNetWorthChart(); } catch(e){}
}

// ===== Net Worth period + line chart =====
let netWorthPeriod = '1M';
let netWorthChartObj = null;

function setNetWorthPeriod(period, btn){
  netWorthPeriod = period || '1M';
  document.querySelectorAll('.nw-period').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const el = document.querySelector(`.nw-period[data-period="${netWorthPeriod}"]`);
    if (el) el.classList.add('active');
  }
  renderNetWorthChart();
}

function renderNetWorthChart(){
  try {
    const canvas = document.getElementById('netWorthChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const now = new Date();
    let days = 30;
    if (netWorthPeriod === '3M') days = 90;
    else if (netWorthPeriod === '6M') days = 180;
    else if (netWorthPeriod === 'All') days = 365;

    // Build cumulative net-worth series (Receive - Payment running total)
    const labels = [];
    const data = [];
    let running = 0;

    // Sort entries by date
    const sorted = (typeof entries !== 'undefined' ? [...entries] : []).sort((a, b) => new Date(a.date) - new Date(b.date));

    // Start from earliest within window
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0,0,0,0);

    // Pre-sum everything before window so running starts correctly
    sorted.forEach(e => {
      const d = new Date(e.date);
      if (d < startDate) {
        const amt = parseFloat(e.amount) || 0;
        running += (e.type === 'income' || e.type === 'receive') ? amt : -amt;
      }
    });

    // Daily points
    const dayMap = {};
    for (let i = 0; i <= days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = 0;
    }
    sorted.forEach(e => {
      const d = new Date(e.date);
      if (d < startDate) return;
      const key = d.toISOString().slice(0, 10);
      if (dayMap[key] === undefined) return;
      const amt = parseFloat(e.amount) || 0;
      dayMap[key] += (e.type === 'income' || e.type === 'receive') ? amt : -amt;
    });

    const keys = Object.keys(dayMap).sort();
    keys.forEach((key, idx) => {
      running += dayMap[key];
      // Show fewer labels for longer periods
      const step = days > 90 ? 14 : (days > 30 ? 7 : 5);
      labels.push(idx % step === 0 || idx === keys.length - 1 ? key.slice(5) : '');
      data.push(running);
    });

    const isLight = document.body.classList.contains('light-theme');
    const lineColor = isLight ? '#ea580c' : '#fb923c';
    const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';

    if (netWorthChartObj) {
      netWorthChartObj.destroy();
      netWorthChartObj = null;
    }

    netWorthChartObj = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: lineColor,
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: lineColor,
          tension: 0.35,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => '₹' + (ctx.parsed.y || 0).toLocaleString('en-IN')
            }
          }
        },
        scales: {
          x: {
            display: true,
            grid: { display: false },
            ticks: { color: isLight ? '#9ca3af' : '#6b7280', font: { size: 10 }, maxRotation: 0 }
          },
          y: {
            display: true,
            grid: { color: gridColor, drawBorder: false },
            ticks: {
              color: isLight ? '#9ca3af' : '#6b7280',
              font: { size: 10 },
              callback: (v) => '₹' + Number(v).toLocaleString('en-IN', { notation: 'compact' })
            }
          }
        },
        interaction: { mode: 'index', intersect: false }
      }
    });
  } catch (err) {
    console.warn('Net worth chart error:', err);
  }
}

// Render mini chart with last 7 days trend
let miniChartObj = null;
let miniChartDayEntries = []; // parallel array: entries per day, for tooltip

function renderMiniChart(){
 try {
 const canvas = document.getElementById("miniChart");
 if(!canvas || typeof Chart === 'undefined') return;
 
 const now = new Date();
 const labels = [];
 const data = [];
 miniChartDayEntries = [];
 
 for(let i = 6; i >= 0; i--){
 const d = new Date(now);
 d.setDate(d.getDate() - i);
 labels.push(d.getDate());
 
 let daySum = 0;
 const dayList = [];
 entries.forEach(e => {
 const eDate = new Date(e.date);
 if(eDate.getDate() === d.getDate() && eDate.getMonth() === d.getMonth() && eDate.getFullYear() === d.getFullYear()){
 const amt = parseFloat(e.amount) || 0;
 daySum += (e.type === 'income' ? amt : -amt);
 dayList.push(e);
 }
 });
 data.push(daySum);
 miniChartDayEntries.push({ date: d, list: dayList });
 }
 
 if(miniChartObj) miniChartObj.destroy();
  miniChartObj = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        borderColor: '#4c9be8',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          padding: 8,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              const day = miniChartDayEntries[idx];
              return day ? day.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';
            },
            label: (item) => {
              const idx = item.dataIndex;
              const day = miniChartDayEntries[idx];
              if (!day || !day.list.length) return 'No entries';
              return day.list.map(e => {
                const amt = (parseFloat(e.amount) || 0).toLocaleString('en-IN');
                const label = e.notes || e.party || e.method || '';
                return (e.type === 'income' ? '+₹' + amt : '-₹' + amt) + (label ? ' (' + label + ')' : '');
              });
            }
          }
        }
      },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { display: false, grid: { display: false } }
      }
    }
  }); } catch(e) {
 console.warn('Chart error:', e);
 }
}

// Helper to extract timestamp ms for chronological sorting
function getEntryTimeValue(e) {
 if (!e) return 0;
 const dStr = normalizeDate(e.date);
 let h = 12, min = 0, sec = 0;
 if (e.time) {
  const m = String(e.time).match(/(\d+):(\d+)(?::(\d+))?\s*(am|pm)?/i);
  if (m) {
   h = parseInt(m[1], 10);
   min = parseInt(m[2], 10) || 0;
   sec = parseInt(m[3], 10) || 0;
   const ampm = (m[4] || '').toLowerCase();
   if (ampm === 'pm' && h < 12) h += 12;
   if (ampm === 'am' && h === 12) h = 0;
  }
 }
 const parts = dStr.split('-').map(Number);
 const dt = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, h, min, sec);
 return isNaN(dt.getTime()) ? 0 : dt.getTime();
}

function getSortedEntriesDesc() {
 // getEntryTimeValue (date parse) har entry ke liye sirf EK baar
 const dec = (entries || []).map(e => ({ e, t: getEntryTimeValue(e), ts: e.timestamp ? new Date(e.timestamp).getTime() : NaN }));
 dec.sort((a, b) => {
  if (a.t !== b.t) return b.t - a.t; // newest first
  if (!isNaN(a.ts) && !isNaN(b.ts) && a.ts !== b.ts) return b.ts - a.ts;
  return 0;
 });
 return dec.map(x => x.e);
}

// ===== RUNNING TOTAL BALANCE CALCULATION =====
function computeRunningBalances(){
 const listWithIdx = (entries || []).map((e, idx) => ({ e, idx, t: getEntryTimeValue(e) }));
 
 // Sort from OLDEST to NEWEST for chronological running balance calculation
 listWithIdx.sort((a, b) => {
  const timeA = a.t;
  const timeB = b.t;
  if (timeA !== timeB) return timeA - timeB;
  
  if (a.e.timestamp && b.e.timestamp) {
   const tsA = new Date(a.e.timestamp).getTime();
   const tsB = new Date(b.e.timestamp).getTime();
   if (!isNaN(tsA) && !isNaN(tsB) && tsA !== tsB) return tsA - tsB;
  }
  
  // Array is newest first (unshift), so higher index = earlier entry
  return b.idx - a.idx;
 });

 const map = new Map();
 let running = 0;
 for(const item of listWithIdx){
  const e = item.e;
  const prev = running;
  const amt = parseFloat(e.amount) || 0;
  const inc = isIncomeType(e.type);
  const exp = isExpenseType(e.type);
  if(inc){
   running += amt;
  } else if(exp){
   running -= amt;
  }
  map.set(String(e.id), {
   prevBal: prev,
   amt: amt,
   type: e.type,
   sign: inc ? '+' : (exp ? '-' : ''),
   newBal: running,
   isPartyBalance: false
  });
 }
 return map;
}

// ===== PARTY RUNNING BALANCE CALCULATION (DYNAMIC ON PARTY SEARCH) =====
// Calculates running balance chronologically from oldest to newest for a specific party.
// Receive/Income: +amt, Payment/Expense: -amt.
function computePartyRunningBalances(partyName, partyEntriesList){
 const listWithIdx = (partyEntriesList || []).map((e, idx) => ({ e, idx }));
 
 // Sort from OLDEST to NEWEST for chronological party running balance calculation
 listWithIdx.sort((a, b) => {
  const timeA = getEntryTimeValue(a.e);
  const timeB = getEntryTimeValue(b.e);
  if (timeA !== timeB) return timeA - timeB;
  
  if (a.e.timestamp && b.e.timestamp) {
   const tsA = new Date(a.e.timestamp).getTime();
   const tsB = new Date(b.e.timestamp).getTime();
   if (!isNaN(tsA) && !isNaN(tsB) && tsA !== tsB) return tsA - tsB;
  }
  
  return b.idx - a.idx;
 });

 const map = new Map();
 let running = 0;
 for(const item of listWithIdx){
  const e = item.e;
  const prev = running;
  const amt = parseFloat(e.amount) || 0;
  const inc = isIncomeType(e.type);
  const exp = isExpenseType(e.type);
  if(inc){
   running += amt; // Receive/Income adds to party balance (+)
  } else if(exp){
   running -= amt; // Payment/Expense minuses from party balance (-)
  }
  map.set(String(e.id), {
   prevBal: prev,
   amt: amt,
   type: e.type,
   sign: inc ? '+' : (exp ? '-' : ''),
   newBal: running,
   isPartyBalance: true
  });
 }
 return { map, finalBalance: running };
}

function txnRowHTML(e, showEdit, balInfo){
 const editBtn = showEdit ? `<div style="cursor:pointer;color:#e8b64c;font-size:15px;margin-left:8px;display:inline-flex;align-items:center;" onclick="openEditModal('${e.id}')"><i class="ti ti-edit"></i></div>` : "";
 const imgBtn = e.image ? `<div style="cursor:pointer;color:#8b9099;font-size:14px;margin-left:6px;display:inline-flex;align-items:center;" onclick="viewEntryImageById('${String(e.id).replace(/['\"]/g,'')}')"><i class="ti ti-camera"></i></div>` : "";
 const partyIcon = getPartyIcon(e.party);
 const partyColor = getPartyColor(e.party || 'Unknown');

 let balHTML = "";
 if(balInfo){
  const isNeg = balInfo.newBal < 0;
  const numStr = Math.abs(balInfo.newBal).toLocaleString("en-IN");
  const balStr = (isNeg ? "-₹" : "₹") + numStr;
  const balCls = isNeg ? "neg" : "pos";
  balHTML = `<div class="txn-balance-text">Balance: <span class="${balCls}">${balStr}</span></div>`;
 } else {
  balHTML = `<div class="txn-balance-text" style="visibility:hidden;">Balance: ₹0</div>`;
 }

 return `
 <div class="txn">
  <div class="txn-icon" style="background:${partyColor}22;color:${partyColor};font-size:20px;">${partyIcon}</div>
  <div class="txn-info">
   <div class="name">${e.party || 'Unknown'}</div>
   <div class="cat">${e.method || 'Cash'}${e.notes ? ' • '+e.notes : ''}</div>
   <div class="time">${e.time || '—'}</div>
  </div>
  <div class="txn-right">
   <div class="txn-amt-row">
    <div class="amt ${isExpenseType(e.type)?'neg':'pos'}">${fmtAmt(e)}</div>
    ${imgBtn}
    ${editBtn}
   </div>
   ${balHTML}
  </div>
 </div>`;
}

function renderEntries(){
 if (!calInitialSetupDone && typeof initEntriesCalendar === 'function') {
  initEntriesCalendar();
 }
 let list = getSortedEntriesDesc();
 if(currentFilter!=="all") {
  if (currentFilter === 'expense') list = list.filter(e => isExpenseType(e.type));
  else if (currentFilter === 'income') list = list.filter(e => isIncomeType(e.type));
  else list = list.filter(e => e.type === currentFilter);
 }

 // 1. Text Search Filter (Party Name & General Search)
 const searchVal = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
 let searchedParty = null;

 if(searchVal){
  // Check if search specifically matches a known Party Name
  const allKnownParties = [...new Set((entries || []).map(e => (e.party || '').trim()).filter(Boolean))];
  const matchedKnownParty = allKnownParties.find(p => p.toLowerCase() === searchVal) ||
                            allKnownParties.find(p => p.toLowerCase().includes(searchVal));

  if (matchedKnownParty) {
   const partyFiltered = list.filter(e => (e.party || '').toLowerCase().includes(searchVal));
   if (partyFiltered.length > 0) {
    list = partyFiltered;
    searchedParty = matchedKnownParty;
   }
  }

  // Fallback to general multi-field search if not a dedicated party match
  if (!searchedParty) {
   list = list.filter(e=>
    (e.party||"").toLowerCase().includes(searchVal) ||
    (e.method||"").toLowerCase().includes(searchVal) ||
    (e.notes||"").toLowerCase().includes(searchVal) ||
    (e.category||"").toLowerCase().includes(searchVal) ||
    String(e.amount||"").includes(searchVal)
   );
   const uniquePartiesInList = [...new Set(list.map(e => (e.party || '').trim()).filter(Boolean))];
   if (uniquePartiesInList.length === 1 && uniquePartiesInList[0].toLowerCase().includes(searchVal)) {
    searchedParty = uniquePartiesInList[0];
   }
  }
 }

 // 2. Date Filter (Preset or Custom Range)
 if(dateRangeFilter && dateRangeFilter.from && dateRangeFilter.to){
  list = list.filter(e=>{
   const d = normalizeDate(e.date);
   return d >= dateRangeFilter.from && d <= dateRangeFilter.to;
  });
 }

 let balMap;
 if (searchedParty && list.length > 0) {
  // Dynamically compute Party Running Balance from oldest to newest (no top summary banner)
  const partyBalResult = computePartyRunningBalances(searchedParty, list);
  balMap = partyBalResult.map;
  updatePartyTotalBar(list, searchVal);
 } else {
  // Global Wallet Running Balance (unmodified)
  balMap = computeRunningBalances();
  updatePartyTotalBar(list, searchVal);
 }

 if(list.length===0){
  document.getElementById("entriesContainer").innerHTML = '<div class="empty-state" style="padding:40px 0;"><i class="ti ti-receipt-off"></i><br>No entries found matching search / date filter</div>';
  updatePartyTotalBar([], searchVal);
  return;
 }

 // Lag fix: sirf pehle N entries DOM me; baaki "Show more" se
 const _sig = [currentFilter, searchVal, dateRangeFilter && dateRangeFilter.from, dateRangeFilter && dateRangeFilter.to].join('|');
 if (window.__entriesSig !== _sig) { window.__entriesSig = _sig; window.__entriesLimit = 60; }
 const _limit = window.__entriesLimit || 60;
 const _totalRows = list.length;
 if (_totalRows > _limit) list = list.slice(0, _limit);
 const groups = {};
 list.forEach(e=>{ 
  const normD = normalizeDate(e.date);
  (groups[normD] = groups[normD]||[]).push(e); 
 });
 const dates = Object.keys(groups).sort((a,b) => b.localeCompare(a));
 let html="";
 dates.forEach(d=>{
  html += `<div class="date-divider">${fmtDateLabel(d)}</div><div class="txn-list">`;
  html += groups[d].map(e=>txnRowHTML(e, true, balMap.get(String(e.id)))).join("");
  html += `</div>`;
 });
 if (_totalRows > _limit) {
  html += `<div style="text-align:center;padding:14px 0 24px;"><button type="button" onclick="entriesShowMore()" style="border:0;border-radius:12px;padding:11px 22px;font-weight:700;font-size:13.5px;cursor:pointer;background:rgba(127,127,127,.15);color:inherit;">Show more (${_totalRows - _limit} aur)</button></div>`;
 }
 document.getElementById("entriesContainer").innerHTML = html;
}
function entriesShowMore(){
 window.__entriesLimit = (window.__entriesLimit || 60) + 80;
 renderEntries();
}

// ===== PARTY TOTAL BAR =====
// Jab search box mein kisi ek party ka naam search ho, entries list ke end mein
// us party ka "Total Dena" (expense) aur "Total Lena" (income) ka total dikhata hai.
// Agar search khaali ho ya multiple alag parties match ho rahi ho, toh bar hide ho jaata hai.
function updatePartyTotalBar(list, searchVal){
 const bar = document.getElementById("partyTotalBar");
 if(!bar) return;
 if(!list || list.length === 0 || !searchVal){ bar.style.display = "none"; return; }

 const uniqueParties = [...new Set(list.map(e => (e.party||"Unknown").trim()).filter(Boolean))];
 const matchedParty = uniqueParties.length === 1 ? uniqueParties[0] : null;

 if(!matchedParty || !matchedParty.toLowerCase().includes(searchVal)){
  bar.style.display = "none";
  return;
 }

 let totalGive = 0, totalTake = 0;
 list.forEach(e=>{
  if(isExpenseType(e.type)) totalGive += Number(e.amount||0);
  else if(isIncomeType(e.type)) totalTake += Number(e.amount||0);
 });

 document.getElementById("ptbPartyName").textContent = matchedParty;
 document.getElementById("ptbGiveAmt").textContent = "₹" + totalGive.toLocaleString("en-IN");
 document.getElementById("ptbTakeAmt").textContent = "₹" + totalTake.toLocaleString("en-IN");

 const msgEl = document.getElementById("ptbStatusMsg");
 if(msgEl){
  // totalGive = Paid (Expense), totalTake = Received (Income)
  // If totalTake > totalGive: Received more than paid => User owes party => HAVE TO PAY (Dena hai)
  // If totalGive > totalTake: Paid more than received => Party owes user => HAVE TO RECEIVE (Lena hai)
  msgEl.classList.remove("status-settled","status-pay","status-receive");
  if(totalTake === totalGive){
   msgEl.textContent = "Everything is paid / settled.";
   msgEl.classList.add("status-settled");
  } else if(totalTake > totalGive){
   const toPay = totalTake - totalGive;
   msgEl.textContent = "Have to pay this amount... ₹" + toPay.toLocaleString("en-IN");
   msgEl.classList.add("status-pay");
  } else {
   const toReceive = totalGive - totalTake;
   msgEl.textContent = "Have to receive this amount... ₹" + toReceive.toLocaleString("en-IN");
   msgEl.classList.add("status-receive");
  }
 }

 bar.style.display = "block";
}

// ===== ENTRIES SEARCH BAR TOGGLE & SWIPE-TO-CLOSE =====
function toggleEntriesSearchBar(){
 const container = document.getElementById("entriesSearchContainer");
 const btn = document.getElementById("searchToggleBtn");
 const inp = document.getElementById("searchInput");
 if(!container) return;

 const isHidden = container.style.display === "none" || !container.style.display;
 if(isHidden){
  container.style.display = "block";
  if(btn) btn.classList.add("active");
  if(inp) setTimeout(()=>{ inp.focus(); }, 60);
 } else {
  container.style.display = "none";
  if(btn) btn.classList.remove("active");
  if(inp) inp.blur();
 }
}


function closeEntriesSearchBar(){
 const container = document.getElementById("entriesSearchContainer");
 const btn = document.getElementById("searchToggleBtn");
 const inp = document.getElementById("searchInput");
 const dropdown = document.getElementById("entriesCalendarDropdown");
 const calBtn = document.getElementById("entriesCalBtn");
 const chevron = document.getElementById("calendarToggleChevron");
 if(!container) return;

 container.style.display = "none";
 if(dropdown) dropdown.style.display = "none";
 calIsExpanded = false;
 if(calBtn) calBtn.classList.remove("active");
 if(chevron) chevron.className = "ti ti-chevron-down";
 if(btn) btn.classList.remove("active");
 if(inp) inp.blur();
}

// Auto-close search bar when explicitly swiping outside entries area
(function initSearchSwipeAutoClose(){
 let touchStartY = 0;
 let touchStartX = 0;

 window.addEventListener('touchstart', (e) => {
  if(!e.touches || !e.touches[0]) return;
  touchStartY = e.touches[0].clientY;
  touchStartX = e.touches[0].clientX;
 }, { passive: true });

 window.addEventListener('touchmove', (e) => {
  if(!e.touches || !e.touches[0]) return;
  const diffY = Math.abs(e.touches[0].clientY - touchStartY);
  const diffX = Math.abs(e.touches[0].clientX - touchStartX);
  if(diffY > 40 || diffX > 40){
   const container = document.getElementById("entriesSearchContainer");
   if(container && container.style.display !== "none"){
    if(e.target && !e.target.closest('#entriesSearchContainer') && !e.target.closest('#searchToggleBtn')){
     closeEntriesSearchBar();
    }
   }
  }
 }, { passive: true });
})();

// ===== INTERACTIVE CALENDAR & DATE RANGE FILTER SYSTEM (Exact Replica of User Image) =====
const CAL_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CAL_MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth(); // 0-indexed
let calStartDate = null; // 'YYYY-MM-DD'
let calEndDate = null;   // 'YYYY-MM-DD'
let calIsExpanded = false;
let selectedDatePreset = 'all';
let dateRangeFilter = null;
let calInitialSetupDone = false;

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  const y = parts[0];
  const m = parseInt(parts[1], 10) - 1;
  const d = parts[2].padStart(2, '0');
  const mName = CAL_MONTH_SHORT[m] || parts[1];
  return `${d} ${mName} ${y}`;
}

function updateRangePillText(text) {
  const pillText = document.getElementById('calRangePillText');
  const clearBtn = document.getElementById('calPillClearBtn');
  if (pillText) pillText.textContent = text || 'Select Date Range';
  if (clearBtn) clearBtn.style.display = (calStartDate || dateRangeFilter) ? 'flex' : 'none';
}

function updateCalendarPresetLabel(text) {
  const lbl = document.getElementById('calPresetLabel');
  if (lbl) lbl.textContent = text || 'All Time';
}

function togglePresetMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('calPresetMenu');
  if (!menu) return;
  menu.style.display = (menu.style.display === 'none' || !menu.style.display) ? 'block' : 'none';
}

function selectCalendarPreset(preset) {
  const menu = document.getElementById('calPresetMenu');
  if (menu) menu.style.display = 'none';

  selectedDatePreset = preset;
  const now = new Date();
  const todayStr = getLocalDateStr(now);

  if (preset === 'today') {
    calStartDate = todayStr;
    calEndDate = todayStr;
    calCurrentYear = now.getFullYear();
    calCurrentMonth = now.getMonth();
    dateRangeFilter = { from: todayStr, to: todayStr };
    updateCalendarPresetLabel('Today');
    updateRangePillText(formatDisplayDate(todayStr));
  } else if (preset === 'yesterday') {
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const yestStr = getLocalDateStr(yest);
    calStartDate = yestStr;
    calEndDate = yestStr;
    calCurrentYear = yest.getFullYear();
    calCurrentMonth = yest.getMonth();
    dateRangeFilter = { from: yestStr, to: yestStr };
    updateCalendarPresetLabel('Yesterday');
    updateRangePillText(formatDisplayDate(yestStr));
  } else if (preset === 'thisWeek') {
    const d7 = new Date(now);
    d7.setDate(d7.getDate() - 6);
    const fromStr = getLocalDateStr(d7);
    calStartDate = fromStr;
    calEndDate = todayStr;
    calCurrentYear = now.getFullYear();
    calCurrentMonth = now.getMonth();
    dateRangeFilter = { from: fromStr, to: todayStr };
    updateCalendarPresetLabel('This Week');
    updateRangePillText(`${formatDisplayDate(fromStr)} ➔ ${formatDisplayDate(todayStr)}`);
  } else if (preset === 'thisMonth') {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    const fromStr = `${y}-${m}-01`;
    const toStr = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    calStartDate = fromStr;
    calEndDate = toStr;
    calCurrentYear = y;
    calCurrentMonth = now.getMonth();
    dateRangeFilter = { from: fromStr, to: toStr };
    updateCalendarPresetLabel('This Month');
    updateRangePillText(`${formatDisplayDate(fromStr)} ➔ ${formatDisplayDate(toStr)}`);
  } else if (preset === 'lastMonth') {
    const prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayPrevM = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const prevY = prevM.getFullYear();
    const prevMNum = String(prevM.getMonth() + 1).padStart(2, '0');
    const fromStr = `${prevY}-${prevMNum}-01`;
    const toStr = `${prevY}-${prevMNum}-${String(lastDayPrevM).padStart(2, '0')}`;
    calStartDate = fromStr;
    calEndDate = toStr;
    calCurrentYear = prevY;
    calCurrentMonth = prevM.getMonth();
    dateRangeFilter = { from: fromStr, to: toStr };
    updateCalendarPresetLabel('Last Month');
    updateRangePillText(`${formatDisplayDate(fromStr)} ➔ ${formatDisplayDate(toStr)}`);
  } else {
    // all time
    calStartDate = null;
    calEndDate = null;
    dateRangeFilter = null;
    updateCalendarPresetLabel('All Time');
    updateRangePillText('All Transactions');
  }

  renderCalendarGrid();
  renderEntries();
}

function calPrevMonth() {
  calCurrentMonth--;
  if (calCurrentMonth < 0) {
    calCurrentMonth = 11;
    calCurrentYear--;
  }
  renderCalendarGrid();
}

function calNextMonth() {
  calCurrentMonth++;
  if (calCurrentMonth > 11) {
    calCurrentMonth = 0;
    calCurrentYear++;
  }
  renderCalendarGrid();
}

function renderCalendarGrid() {
  const titleEl = document.getElementById('calMonthTitle');
  const gridEl = document.getElementById('calDaysGrid');
  if (!gridEl) return;

  if (titleEl) {
    titleEl.textContent = `${CAL_MONTH_NAMES[calCurrentMonth]} ${calCurrentYear}`;
  }

  const firstDayIndex = new Date(calCurrentYear, calCurrentMonth, 1).getDay(); // 0 = Sun
  const totalDays = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
  const prevMonthTotalDays = new Date(calCurrentYear, calCurrentMonth, 0).getDate();

  let html = '';
  let cellCount = 0;

  // 1. Fill previous month tail days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dNum = prevMonthTotalDays - i;
    const prevM = calCurrentMonth === 0 ? 11 : calCurrentMonth - 1;
    const prevY = calCurrentMonth === 0 ? calCurrentYear - 1 : calCurrentYear;
    const dStr = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
    const rangeClasses = getCellRangeClasses(dStr);
    html += `
      <div class="cal-day-cell other-month ${rangeClasses}" data-date="${dStr}" onclick="handleCalendarDayClick('${dStr}')">
        <span class="cal-day-num">${dNum}</span>
      </div>`;
    cellCount++;
  }

  // 2. Fill current month days
  for (let d = 1; d <= totalDays; d++) {
    const dStr = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rangeClasses = getCellRangeClasses(dStr);
    html += `
      <div class="cal-day-cell ${rangeClasses}" data-date="${dStr}" onclick="handleCalendarDayClick('${dStr}')">
        <span class="cal-day-num">${d}</span>
      </div>`;
    cellCount++;
  }

  // 3. Fill next month head days (complete remaining grid cells)
  const remainingCells = (7 - (cellCount % 7)) % 7;
  for (let n = 1; n <= remainingCells; n++) {
    const nextM = calCurrentMonth === 11 ? 0 : calCurrentMonth + 1;
    const nextY = calCurrentMonth === 11 ? calCurrentYear + 1 : calCurrentYear;
    const dStr = `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    const rangeClasses = getCellRangeClasses(dStr);
    html += `
      <div class="cal-day-cell other-month ${rangeClasses}" data-date="${dStr}" onclick="handleCalendarDayClick('${dStr}')">
        <span class="cal-day-num">${n}</span>
      </div>`;
    cellCount++;
  }

  gridEl.innerHTML = html;
}

function getCellRangeClasses(dStr) {
  if (!calStartDate) return '';
  if (calStartDate && !calEndDate) {
    return dStr === calStartDate ? 'range-single' : '';
  }
  if (calStartDate && calEndDate) {
    if (calStartDate === calEndDate) {
      return dStr === calStartDate ? 'range-single' : '';
    }
    if (dStr === calStartDate) return 'range-start';
    if (dStr === calEndDate) return 'range-end';
    if (dStr > calStartDate && dStr < calEndDate) return 'in-range';
  }
  return '';
}

function handleCalendarDayClick(dateStr) {
  if (!calStartDate || (calStartDate && calEndDate)) {
    // First click: select start date
    calStartDate = dateStr;
    calEndDate = null;
    selectedDatePreset = 'custom';
    updateCalendarPresetLabel('Custom');
    dateRangeFilter = { from: dateStr, to: dateStr };
    updateRangePillText(formatDisplayDate(dateStr));
  } else {
    // Second click: complete range
    if (dateStr < calStartDate) {
      calEndDate = calStartDate;
      calStartDate = dateStr;
    } else {
      calEndDate = dateStr;
    }
    selectedDatePreset = 'custom';
    updateCalendarPresetLabel('Custom');
    dateRangeFilter = { from: calStartDate, to: calEndDate };
    updateRangePillText(`${formatDisplayDate(calStartDate)} ➔ ${formatDisplayDate(calEndDate)}`);
  }
  renderCalendarGrid();
  renderEntries();
}

function clearDateRangeFilter(event) {
  if (event) event.stopPropagation();
  calStartDate = null;
  calEndDate = null;
  dateRangeFilter = null;
  selectedDatePreset = 'all';
  updateCalendarPresetLabel('All Time');
  updateRangePillText('All Transactions');
  renderCalendarGrid();
  renderEntries();
}

function toggleCalendarDropdown() {
  const dropdown = document.getElementById('entriesCalendarDropdown');
  if (!dropdown) return;

  const isHidden = dropdown.style.display === 'none' || !dropdown.style.display;
  if (isHidden) {
    dropdown.style.display = 'block';
    calIsExpanded = true;
    renderCalendarGrid();
  } else {
    dropdown.style.display = 'none';
    calIsExpanded = false;
  }
}


/** Open search bar (if closed) and expand the calendar so user can pick a date in one click */
function openEntriesCalendar() {
  // Simple standalone calendar only — does NOT open search bar
  const dropdown = document.getElementById('entriesCalendarDropdown');
  if (!dropdown) return;

  const isHidden = dropdown.style.display === 'none' || !dropdown.style.display;
  if (isHidden) {
    dropdown.style.display = 'block';
    calIsExpanded = true;
    if (typeof renderCalendarGrid === 'function') renderCalendarGrid();
  } else {
    dropdown.style.display = 'none';
    calIsExpanded = false;
  }
}



function onEntriesSearchInput() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClearBtn');
  if (input && clearBtn) {
    clearBtn.style.display = input.value.trim() ? 'flex' : 'none';
  }
  renderEntries();
}

function clearEntriesSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClearBtn');
  if (input) input.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  renderEntries();
}

// Backwards compatibility aliases
const applyDatePreset = selectCalendarPreset;
const setDatePreset = selectCalendarPreset;
function openEntriesCalendarModal() { toggleCalendarDropdown(); }
function closeEntriesCalendarModal() { if (calIsExpanded) toggleCalendarDropdown(); }

// Close preset menu when clicking outside
document.addEventListener('click', function(e) {
  const presetMenu = document.getElementById('calPresetMenu');
  const presetBtn = document.getElementById('calPresetBtn');
  if (presetMenu && presetMenu.style.display !== 'none') {
    if (!presetMenu.contains(e.target) && (!presetBtn || !presetBtn.contains(e.target))) {
      presetMenu.style.display = 'none';
    }
  }
});

// Auto initialize on first Entries render or app load
function initEntriesCalendar() {
  if (calInitialSetupDone) return;
  calInitialSetupDone = true;
  calStartDate = null;
  calEndDate = null;
  dateRangeFilter = null; // No date filter by default: all transactions show!
  selectedDatePreset = 'all';
  updateCalendarPresetLabel('All Time');
  updateRangePillText('All Transactions');
}
// ===== ADD ENTRY =====
let isSaving = false; // Lock to prevent duplicate saves

function setEntryType(t){
 entryType = t;
 document.getElementById("addExpenseBtn").classList.toggle("active", t==="expense");
 document.getElementById("addIncomeBtn").classList.toggle("active", t==="income");
}

// ═══════════════════════════════════════════════════════════════════════
// ADD-ENTRY: attach a photo (receipt/screenshot) via the camera button
// ═══════════════════════════════════════════════════════════════════════
let pendingEntryImage = null; // base64 (compressed) image for the entry currently being created

function handleEntryImageSelect(event) {
 const file = event.target.files[0];
 if (!file) return;
 const reader = new FileReader();
 reader.onload = (e) => {
  const img = new Image();
  img.onload = () => {
   // Resize/compress so it stays small enough to store as a normal field
   const maxDim = 900;
   let { width, height } = img;
   if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
   }
   const canvas = document.createElement('canvas');
   canvas.width = width; canvas.height = height;
   canvas.getContext('2d').drawImage(img, 0, 0, width, height);
   pendingEntryImage = canvas.toDataURL('image/jpeg', 0.6);
   showEntryImagePreview(pendingEntryImage);
  };
  img.src = e.target.result;
 };
 reader.readAsDataURL(file);
 event.target.value = ''; // allow picking the same file again later
}

function showEntryImagePreview(dataUrl) {
 const wrap = document.getElementById('entryImagePreviewWrap');
 const img = document.getElementById('entryImagePreview');
 const camBtn = document.getElementById('entryCameraBtn');
 if (wrap && img) { img.src = dataUrl; wrap.style.display = 'block'; }
 if (camBtn) camBtn.style.display = 'none';
}

function removeEntryImage() {
 pendingEntryImage = null;
 const wrap = document.getElementById('entryImagePreviewWrap');
 const camBtn = document.getElementById('entryCameraBtn');
 if (wrap) wrap.style.display = 'none';
 if (camBtn) camBtn.style.display = '';
}

function viewEntryImageById(id) {
  try {
    const en = (entries || []).find(x => String(x.id) === String(id));
    if (en && en.image) viewEntryImage(en.image);
  } catch (e) {}
}
function viewEntryImage(url) {
 if (!url) return;
 const overlay = document.createElement('div');
 overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
 overlay.onclick = () => overlay.remove();
 overlay.innerHTML = `<img src="${url}" style="max-width:100%;max-height:100%;border-radius:12px;">`;
 document.body.appendChild(overlay);
}

// ===== SEARCHABLE PARTY AUTOCOMPLETE & DROPDOWN =====
function escapePartyHtml(str) {
 if (!str) return '';
 return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getAllPartyNames() {
 const sel = document.getElementById('partySel');
 const selOptions = sel ? Array.from(sel.options).map(o => (o.value || '').trim()).filter(Boolean) : [];
 const entryParties = (entries || []).map(e => (e.party || '').trim()).filter(Boolean);
 return Array.from(new Set([...selOptions, ...entryParties])).filter(Boolean);
}

function renderPartySuggestions(filterVal) {
 const listEl = document.getElementById('partySuggestionsList');
 if (!listEl) return;
 const val = (filterVal !== undefined ? filterVal : (document.getElementById('partyInput')?.value || '')).toLowerCase().trim();
 const allParties = getAllPartyNames();
 const filtered = val ? allParties.filter(p => p.toLowerCase().includes(val)) : allParties;

 if (filtered.length === 0) {
  if (val) {
   listEl.innerHTML = `<div class="party-suggestion-item" onclick="selectPartyName('${encodeURIComponent(val)}')"><i class="ti ti-plus" style="color:#38bdf8;"></i><span>Use <b>"${escapePartyHtml(val)}"</b></span></div>`;
   listEl.style.display = 'block';
  } else {
   listEl.style.display = 'none';
  }
  return;
 }

 let html = '';
 filtered.forEach(p => {
  html += `<div class="party-suggestion-item" onclick="selectPartyName('${encodeURIComponent(p)}')"><i class="ti ti-user"></i><span>${escapePartyHtml(p)}</span></div>`;
 });
 listEl.innerHTML = html;
 listEl.style.display = 'block';
}

function showPartySuggestions() {
 renderPartySuggestions();
}

function togglePartySuggestions() {
 const listEl = document.getElementById('partySuggestionsList');
 if (listEl && listEl.style.display === 'block') {
  listEl.style.display = 'none';
 } else {
  showPartySuggestions();
 }
}

function filterPartySuggestions(val) {
 const sel = document.getElementById('partySel');
 if (sel) {
  let found = Array.from(sel.options).find(o => o.value.toLowerCase() === (val||'').toLowerCase());
  if (found) {
   sel.value = found.value;
  } else {
   let customOpt = sel.querySelector('option[data-custom="true"]');
   if (!customOpt) {
    customOpt = document.createElement('option');
    customOpt.setAttribute('data-custom', 'true');
    sel.appendChild(customOpt);
   }
   customOpt.value = val;
   customOpt.textContent = val;
   sel.value = val;
  }
 }
 renderPartySuggestions(val);
}

function selectPartyName(encodedParty) {
 const party = decodeURIComponent(encodedParty);
 const input = document.getElementById('partyInput');
 const sel = document.getElementById('partySel');
 if (input) input.value = party;
 if (sel) {
  let opt = Array.from(sel.options).find(o => o.value.toLowerCase() === party.toLowerCase());
  if (!opt) {
   opt = document.createElement('option');
   opt.value = party;
   opt.textContent = party;
   sel.appendChild(opt);
  }
  sel.value = opt.value;
 }
 const listEl = document.getElementById('partySuggestionsList');
 if (listEl) listEl.style.display = 'none';
}

// ===== SEARCHABLE PAYMENT METHOD AUTOCOMPLETE & DROPDOWN =====
const DEFAULT_PAYMENT_METHODS = ["Cash", "UPI", "SBI 8974", "PNB 1907"];

function getAllPaymentMethods() {
 let list = [];
 try {
  const saved = localStorage.getItem('app_payment_methods');
  if (saved) list = JSON.parse(saved);
 } catch(e) {}
 if (!Array.isArray(list) || list.length === 0) {
  list = [...DEFAULT_PAYMENT_METHODS];
 }
 // Guarantee default methods are present
 DEFAULT_PAYMENT_METHODS.forEach(def => {
  if (!list.some(m => m.toLowerCase() === def.toLowerCase())) {
   list.push(def);
  }
 });
 // Also collect any methods present in historical entries
 if (typeof entries !== 'undefined' && Array.isArray(entries)) {
  entries.forEach(e => {
   if (e && e.method && typeof e.method === 'string') {
    const m = e.method.trim();
    if (m && !list.some(item => item.toLowerCase() === m.toLowerCase())) {
     list.push(m);
    }
   }
  });
 }
 return list;
}

function getPaymentIcon(method) {
 const m = (method || '').toLowerCase();
 if (m.includes('upi') || m.includes('gpay') || m.includes('phonepe') || m.includes('paytm') || m.includes('qr')) return 'ti-qrcode';
 if (m.includes('sbi') || m.includes('pnb') || m.includes('hdfc') || m.includes('icici') || m.includes('axis') || m.includes('bank') || m.includes('bob') || m.includes('canara') || m.includes('kotak')) return 'ti-building-bank';
 if (m.includes('card') || m.includes('visa') || m.includes('mastercard') || m.includes('rupay')) return 'ti-credit-card';
 if (m.includes('cash')) return 'ti-cash';
 return 'ti-wallet';
}

function renderPaymentSuggestions(filterVal) {
 const listEl = document.getElementById('paymentSuggestionsList');
 if (!listEl) return;
 const val = (filterVal !== undefined ? filterVal : (document.getElementById('paymentInput')?.value || '')).toLowerCase().trim();
 const allMethods = getAllPaymentMethods();
 const filtered = val ? allMethods.filter(p => p.toLowerCase().includes(val)) : allMethods;

 if (filtered.length === 0) {
  if (val) {
   listEl.innerHTML = `<div class="party-suggestion-item" onclick="selectPaymentSuggestion('${encodeURIComponent(val)}')"><i class="ti ti-plus" style="color:#38bdf8;"></i><span>Use <b>"${escapePartyHtml(val)}"</b></span></div>`;
   listEl.style.display = 'block';
  } else {
   listEl.style.display = 'none';
  }
  return;
 }

 let html = '';
 filtered.forEach(m => {
  const icon = getPaymentIcon(m);
  html += `<div class="party-suggestion-item" onclick="selectPaymentSuggestion('${encodeURIComponent(m)}')"><i class="ti ${icon}"></i><span>${escapePartyHtml(m)}</span></div>`;
 });
 listEl.innerHTML = html;
 listEl.style.display = 'block';
}

function showPaymentSuggestions() {
 // Always show full list on open (ignore current filter so user can pick any method)
 renderPaymentSuggestions('');
 const listEl = document.getElementById('paymentSuggestionsList');
 if (listEl) {
   listEl.style.display = 'block';
   listEl.style.zIndex = '9999';
 }
 const chev = document.getElementById('paymentChevIcon');
 if (chev) chev.style.transform = 'rotate(180deg)';
}

function hidePaymentSuggestions() {
 const listEl = document.getElementById('paymentSuggestionsList');
 if (listEl) listEl.style.display = 'none';
 const chev = document.getElementById('paymentChevIcon');
 if (chev) chev.style.transform = 'rotate(0deg)';
}

function togglePaymentSuggestions() {
 const listEl = document.getElementById('paymentSuggestionsList');
 if (listEl && listEl.style.display === 'block') {
  hidePaymentSuggestions();
 } else {
  showPaymentSuggestions();
 }
}

function filterPaymentSuggestions(val) {
 const sel = document.getElementById('paymentSel');
 if (sel) {
  let found = Array.from(sel.options).find(o => o.value.toLowerCase() === (val||'').toLowerCase());
  if (found) {
   sel.value = found.value;
  } else {
   let customOpt = sel.querySelector('option[data-custom="true"]');
   if (!customOpt) {
    customOpt = document.createElement('option');
    customOpt.setAttribute('data-custom', 'true');
    sel.appendChild(customOpt);
   }
   customOpt.value = val;
   customOpt.textContent = val;
   sel.value = val;
  }
 }
 renderPaymentSuggestions(val);
}

function selectPaymentSuggestion(encodedMethod) {
 const method = decodeURIComponent(encodedMethod);
 const input = document.getElementById('paymentInput');
 const sel = document.getElementById('paymentSel');
 if (input) input.value = method;
 if (sel) {
  let opt = Array.from(sel.options).find(o => o.value.toLowerCase() === method.toLowerCase());
  if (!opt) {
   opt = document.createElement('option');
   opt.value = method;
   opt.textContent = method;
   sel.appendChild(opt);
  }
  sel.value = opt.value;
 }
 hidePaymentSuggestions();
}

// Close party & payment dropdowns when clicking outside
document.addEventListener('click', function(e) {
 const partyRow = document.getElementById('partyFieldRow');
 const partyList = document.getElementById('partySuggestionsList');
 if (partyRow && !partyRow.contains(e.target) && partyList) {
  partyList.style.display = 'none';
 }

 const payRow = document.getElementById('paymentFieldRow');
 const payList = document.getElementById('paymentSuggestionsList');
 if (payRow && !payRow.contains(e.target) && payList && payList.style.display === 'block') {
  if (typeof hidePaymentSuggestions === 'function') hidePaymentSuggestions();
  else payList.style.display = 'none';
 }
}, { passive: true });

async function saveEntry(evt){
 // LOCK — prevent duplicate saves on double-tap
 if (isSaving) return;
 isSaving = true;

 const btn = evt.target.closest('.save-btn');
 btn.disabled = true;
 btn.textContent = 'Saving...';

 const amt = parseFloat(document.getElementById("hiddenAmountInput").value || 0);
 const party = (document.getElementById("partyInput")?.value || document.getElementById("partySel")?.value || "").trim();
 const method = (document.getElementById("paymentInput")?.value || document.getElementById("paymentSel")?.value || "Cash").trim();
 const notes = document.getElementById("notesInput").value;

 if (!amt) {
  showNotification("Enter amount", "warning");
  btn.disabled = false; btn.textContent = 'Save Entry'; isSaving = false; return;
 }
 if (!party) {
  showNotification("Please enter or select a party", "warning");
  btn.disabled = false; btn.textContent = 'Save Entry'; isSaving = false; return;
 }


 const date = document.getElementById("dateInput").value || getLocalDateStr();

 const nowIso = new Date().toISOString();
 const entryData = {
  id: generateEntryId(),
  party: party,
  method: method,
  amount: parseFloat(amt),
  type: normalizeType(entryType),
  date: date,
  time: new Date().toLocaleTimeString("en-IN", {hour:'2-digit', minute:'2-digit'}),
  notes: notes,
  timestamp: nowIso,
  updatedAt: nowIso,
  syncedWithCloud: false,
  image: pendingEntryImage || null,
  userId: (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null
 };

 // Add to memory ONCE
 entries.unshift(entryData);
 persistAllEntries('saveEntry');
 // Keep any Goal whose name matches this Party Name in sync
 if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();

 // Reset form + navigate immediately
 document.getElementById("hiddenAmountInput").value = "";
 document.getElementById("amountDisplay").textContent = "0.00";
 if (document.getElementById("partyInput")) document.getElementById("partyInput").value = "";
 document.getElementById("partySel").value = "";
 if (document.getElementById("paymentInput")) document.getElementById("paymentInput").value = "Cash";
 document.getElementById("paymentSel").value = "Cash";
 document.getElementById("notesInput").value = "";
 document.getElementById("dateInput").value = getLocalDateStr();
 updateDateLabel(document.getElementById("dateInput").value);
 removeEntryImage();
 const partyList = document.getElementById("partySuggestionsList");
 if (partyList) partyList.style.display = "none";
 const payList = document.getElementById("paymentSuggestionsList");
 if (payList) payList.style.display = "none";
 setEntryType('expense');

 // Re-render from memory (no reload)
 renderWallet();
 renderEntries();
 renderAnalytics();
 goTo('entries');
 setEntryFilter('all');
 if (typeof showMiniSaveToast === 'function') showMiniSaveToast('synced');
 if (typeof renderList === "function") renderList(); // keep Goals tab live if entries change

 // Unlock right away — local save already succeeded, no need to wait.
 btn.disabled = false;
 btn.textContent = 'Save Entry';
 isSaving = false;

 // Sync to Firebase in the background (non-blocking, fire-and-forget) —
 // same pattern as updateEntry(); never blocks the UI above.
 if (typeof queueOfflineSync === 'function') queueOfflineSync('set', entryData);
 if (firebaseReady && db) {
  db.collection('entries').doc(entryData.id).set(entryData)
   .catch(err => console.warn('Firebase save failed (kept locally):', err));
 }
}

// ===== QUICK ADD ENTRY POPUP (long-press the + nav button) =====

function openQuickAdd(){
 document.getElementById("qaLine").value = "";
 document.getElementById("qaVoiceStatus").textContent = "";
 document.getElementById("qaLiveCaption").value = "";
 quickAddVoiceType = null;
 // Purana black-box popup (.active class on quickAddModal) ab kabhi nahi
 // lagta — seedha fullscreen AI Voice screen khulta hai (same to same
 // jaisa demo me tha).
 openAiVoiceFullscreen();
 // AI Mic ab primary hai aur audio actually RECORD karta hai (privacy-
 // sensitive) — isliye khud-ba-khud shuru nahi hota, user ko khud dabana
 // hota hai. (Pehle purana browser-mic auto-start hota tha; wo ab sirf
 // backup hai, wo bhi manual hi rehta hai.)
}

// ===== Devanagari -> Roman (Hinglish) transliteration =====
// Web Speech API ka "en-IN" mode English hi samajhta hai — pure Hindi bola
// hua sunta hi nahi (isliye mic "sun" raha tha lekin kuch bhi type nahi ho
// raha tha). Hindi ko sahi se sunne/samajhne ke liye "hi-IN" hi chahiye,
// lekin hi-IN result Devanagari (हिंदी लिपि) me deta hai. Isliye hum hi-IN
// se sunte hain (taaki bolti hui Hindi sahi pakड़ी jaaye) aur result ko
// yahan khud Roman/Hinglish letters me convert kar dete hain.
const DEVANAGARI_CONSONANTS = {
 'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng',
 'च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
 'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n',
 'त':'t','थ':'th','द':'d','ध':'dh','न':'n',
 'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m',
 'य':'y','र':'r','ल':'l','ळ':'l','व':'v',
 'श':'sh','ष':'sh','स':'s','ह':'h',
 'क़':'k','ख़':'kh','ग़':'g','ज़':'z','ड़':'r','ढ़':'rh','फ़':'f','य़':'y'
};
const DEVANAGARI_INDEP_VOWELS = {
 'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ऋ':'ri',
 'ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऑ':'o','ऍ':'e'
};
const DEVANAGARI_MATRAS = {
 'ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo','ृ':'ri',
 'े':'e','ै':'ai','ो':'o','ौ':'au','ॉ':'o','ॅ':'e'
};
const DEVANAGARI_SIGNS = { 'ं':'n', 'ः':'h', 'ँ':'n' };
const DEVANAGARI_DIGITS = { '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9' };

function transliterateDevanagariToRoman(text){
 if (!text) return text;
 const chars = Array.from(text);
 let out = '';
 for (let i = 0; i < chars.length; i++) {
  const c = chars[i];
  const next = chars[i+1];
  if (DEVANAGARI_CONSONANTS[c]) {
   const base = DEVANAGARI_CONSONANTS[c];
   if (next === '्') { out += base; i++; }                    // halant -> no vowel
   else if (next && DEVANAGARI_MATRAS[next]) { out += base + DEVANAGARI_MATRAS[next]; i++; }
   else if (next && DEVANAGARI_SIGNS[next]) { out += base + 'a' + DEVANAGARI_SIGNS[next]; i++; }
   else out += base + 'a';                                     // inherent "a"
  } else if (DEVANAGARI_INDEP_VOWELS[c]) {
   out += DEVANAGARI_INDEP_VOWELS[c];
  } else if (DEVANAGARI_MATRAS[c]) {
   out += DEVANAGARI_MATRAS[c];                                 // stray matra (rare)
  } else if (DEVANAGARI_SIGNS[c]) {
   out += DEVANAGARI_SIGNS[c];
  } else if (DEVANAGARI_DIGITS[c]) {
   out += DEVANAGARI_DIGITS[c];
  } else if (c === '्') {
   // stray halant, skip
  } else {
   out += c;                                                    // Latin letters, digits, spaces, punctuation pass through
  }
 }
 return out;
}

// ===== Gemini AI (free tier) — API key management + core caller =====
// SECURITY MODEL — please read before touching this section:
//  1) Ye key KABHI BHI is file/source-code me hardcode NAHI hoti — na
//     kisi variable me, na kisi comment me, kahin nahi. User isse Profile
//     > AI Voice Parsing se khud runtime par type/paste karta hai. Isliye
//     agar ye .html file kisi repository (GitHub waghera) me commit/push
//     ho, us repo me KABHI koi API key nahi hogi — chahe kitni baar bhi
//     commit karo. Ye sabse zaroori guarantee hai.
//  2) Key sirf isi device ke browser localStorage me rehti hai — kisi
//     server pe nahi jaati (sirf Google ko jaati hai, jab AI feature
//     actually use ho).
//  3) Neeche localStorage me plaintext ki bajaye halka obfuscate (encode)
//     karke store kiya jaata hai, taaki koi casually devtools/localStorage
//     khol ke seedha key na padh le. IMPORTANT: ye asli encryption NAHI
//     hai — jis bhi insaan ke paas is device/browser tak physical/devtools
//     access hai, wo isse reverse bhi kar sakta hai (client-side JS me
//     sacchi secrecy possible hi nahi hoti bina server ke). Real-world
//     threat jo ye rokta hai: repository/source-code leakage (#1) aur
//     casual/accidental exposure — koi bhi jaan-boojh kar dedicated tareeke
//     se try kare to client-side kabhi 100% secure nahi ho sakta.
function _aiKeyObfuscate(str){
 // Simple reversible XOR + base64 — obscurity, encryption nahi (upar note dekho)
 const salt = "expenseAppAiKey";
 let out = "";
 for (let i = 0; i < str.length; i++) out += String.fromCharCode(str.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
 try { return btoa(unescape(encodeURIComponent(out))); } catch(e) { return ""; }
}
function _aiKeyDeobfuscate(encoded){
 const salt = "expenseAppAiKey";
 try {
  const raw = decodeURIComponent(escape(atob(encoded)));
  let out = "";
  for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
  return out;
 } catch(e) { return ""; }
}
function getGeminiKey(){
 // 1. Direct raw check in localStorage
 const raw = localStorage.getItem('geminiApiKey');
 if (raw && typeof raw === 'string' && raw.trim()) {
  return raw.trim();
 }

 // 2. Check stored key in 'geminiApiKeyEnc'
 const stored = localStorage.getItem('geminiApiKeyEnc');
 if (stored && typeof stored === 'string' && stored.trim()) {
  const trimmed = stored.trim();
  // If stored directly in plaintext (e.g. starts with AIzaSy)
  if (trimmed.startsWith('AIzaSy')) {
   return trimmed;
  }
  const val = _aiKeyDeobfuscate(trimmed).trim();
  if (val && val.length > 10) return val;
  // If deobfuscation failed or returned empty but trimmed looks like raw key
  if (trimmed.length > 20 && !trimmed.includes(' ')) return trimmed;
 }

 // 3. Fallback to APP_CONFIG in config.js
 if (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.geminiApiKey) {
  const cfg = String(window.APP_CONFIG.geminiApiKey).trim();
  if (cfg) return cfg;
 }
 return '';
}
function setGeminiKey(k){
 if (k && typeof k === 'string' && k.trim()) {
  const clean = k.trim().replace(/^["'`]|["'`]$/g, '').replace(/^API\s*Key\s*:\s*/i, '').trim();
  if (clean.length < 20) {
    if (typeof showNotification === 'function') showNotification('API key bahut short lag rahi hai. Poori key paste karein.', 'warning');
  }
  localStorage.setItem('geminiApiKey', clean);
  localStorage.setItem('geminiApiKeyEnc', _aiKeyObfuscate(clean));
  // If user had a pending bill scan, offer retry
  let pending = null;
  try { pending = pendingChatBillImage || sessionStorage.getItem('pendingChatBillImage'); } catch(e){}
  if (pending && typeof showNotification === 'function') {
    showNotification('Key saved ✓ — chat me "retry bill" likho bill scan ke liye', 'success');
  }
 } else {
  localStorage.removeItem('geminiApiKey');
  localStorage.removeItem('geminiApiKeyEnc');
 }
 _cachedGeminiModels = null;
 _cachedWorkingAudioModel = null;
 _cachedWorkingTextModel = null;
}

// prompt bhejta hai, JSON mode me structured response maangta hai (schema
// diya ho to usi shape me), aur parsed JS object/array/value wapas karta
// hai. Agar key hi na ho to turant null (koi network call nahi).
//
// MODEL NOTE: Real active Google Gemini models supporting generateContent on v1beta
const FALLBACK_GEMINI_MODELS = [
 "gemini-2.0-flash",       // 1. Reliable multimodal (vision + text) — best default
 "gemini-2.5-flash",       // 2. Newer multimodal if available on key
 "gemini-2.0-flash-lite",  // 3. Fast / cheap multimodal
 "gemini-2.5-flash-lite",  // 4. Newer lite
 "gemini-1.5-flash",       // 5. Stable older fallback
 "gemini-1.5-pro"          // 6. Strong vision fallback
];

let _cachedGeminiModels = null;
let _cachedWorkingAudioModel = null;
let _cachedWorkingTextModel = null;
const _modelQuotaCooldowns = {}; // Tracks models that hit rate/quota limit: { [model]: expireTimestamp }
const _permanentBlacklistModels = new Set(); // Models confirmed 404/unsupported by Google API

// Dynamically refresh active models for the user's API key directly from Google
async function refreshAvailableGeminiModels(apiKey) {
 const k = apiKey || getGeminiKey();
 if (!k) return;
 try {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`);
  if (!resp.ok) return;
  const data = await resp.json();
  if (Array.isArray(data?.models)) {
   const supported = data.models
    .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(name => !name.includes('embedding') && !name.includes('aqa') && !name.includes('tts') && !_permanentBlacklistModels.has(name));
   if (supported.length > 0) {
    supported.sort((a, b) => {
     const score = (m) => {
      if (m === 'gemini-2.0-flash') return 10;
      if (m === 'gemini-2.0-flash-lite') return 8;
      if (m === 'gemini-1.5-flash') return 6;
      if (m === 'gemini-1.5-pro') return 4;
      return 1;
     };
     return score(b) - score(a);
    });
    _cachedGeminiModels = supported;
    try { localStorage.setItem('cached_gemini_models', JSON.stringify(supported)); } catch(e){}
   }
  }
 } catch(e){}
}

function getAvailableGeminiModels(apiKey, isAudio){
 const now = Date.now();
 let baseList = (_cachedGeminiModels && _cachedGeminiModels.length > 0) ? _cachedGeminiModels : FALLBACK_GEMINI_MODELS;
 // Exclude blacklisted (404/unsupported) models
 baseList = baseList.filter(m => !_permanentBlacklistModels.has(m));
 if (isAudio) {
  // gemini-*-lite models, tts, and image models do not support audio input on v1beta
  baseList = baseList.filter(m => !m.includes('lite') && !m.includes('8b') && !m.includes('tts') && !m.includes('image'));
 } else {
  baseList = baseList.filter(m => !m.includes('8b') && !m.includes('tts') && !m.includes('image'));
 }
 if (baseList.length === 0) {
  baseList = isAudio ? ["gemini-2.0-flash", "gemini-1.5-flash"] : ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"];
 }
 const sorted = [...baseList].sort((a, b) => {
  const aCool = (_modelQuotaCooldowns[a] && _modelQuotaCooldowns[a] > now) ? 1 : 0;
  const bCool = (_modelQuotaCooldowns[b] && _modelQuotaCooldowns[b] > now) ? 1 : 0;
  return aCool - bCool;
 });

 const cachedModel = isAudio ? _cachedWorkingAudioModel : _cachedWorkingTextModel;
 if (cachedModel && baseList.includes(cachedModel) && (!_modelQuotaCooldowns[cachedModel] || _modelQuotaCooldowns[cachedModel] <= now)) {
  const others = sorted.filter(m => m !== cachedModel);
  return [cachedModel, ...others];
 }
 return sorted;
}

if (typeof window !== 'undefined') {
 window.getGeminiModelStatus = function() {
  const now = Date.now();
  const audioModels = getAvailableGeminiModels(getGeminiKey(), true);
  const textModels = getAvailableGeminiModels(getGeminiKey(), false);
  const cooldowns = Object.entries(_modelQuotaCooldowns).map(([m, time]) => ({
   model: m,
   onCooldown: time > now,
   remainingSec: Math.max(0, Math.round((time - now) / 1000))
  }));
  return {
   activeAudioModel: _cachedWorkingAudioModel || audioModels[0],
   activeTextModel: _cachedWorkingTextModel || textModels[0],
   audioFallbackList: audioModels,
   textFallbackList: textModels,
   cooldowns: cooldowns
  };
 };
}

function getActiveGeminiModelDisplay(){
 const m = _cachedWorkingTextModel || (FALLBACK_GEMINI_MODELS && FALLBACK_GEMINI_MODELS[0]) || 'gemini-2.0-flash';
 return m.replace(/^gemini-?/i, 'Gemini ').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _parseGeminiJson(textOut){
 if (!textOut) return null;
 let clean = String(textOut).trim();
 if (clean.startsWith('```json')) clean = clean.slice(7);
 else if (clean.startsWith('```')) clean = clean.slice(3);
 if (clean.endsWith('```')) clean = clean.slice(0, -3);
 clean = clean.trim();
 try {
  return JSON.parse(clean);
 } catch(e){
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
   try { return JSON.parse(match[0]); } catch(e2){}
  }
  return null;
 }
}

async function _geminiRawFetch(body, signal){
 const apiKey = getGeminiKey();
 if (!apiKey) {
  throw new Error("API Key set nahi hai — Profile > AI Settings me aistudio.google.com/apikey se free key daalein.");
 }

 // Trigger non-blocking refresh of models list if not yet loaded
 if (!_cachedGeminiModels && typeof refreshAvailableGeminiModels === 'function') {
  refreshAvailableGeminiModels(apiKey).catch(()=>{});
 }

 // Ensure fast token generation limits without truncating responses
 const reqBody = Object.assign({}, body);
 if (!reqBody.generationConfig) reqBody.generationConfig = {};
 if (!reqBody.generationConfig.maxOutputTokens) reqBody.generationConfig.maxOutputTokens = 1000;
 if (reqBody.generationConfig.temperature === undefined) reqBody.generationConfig.temperature = 0.2;

 const isAudio = JSON.stringify(reqBody).includes('inlineData');
 // Vision/bill images need longer timeout
 const timeoutMs = isAudio ? 35000 : 15000;
 const models = getAvailableGeminiModels(apiKey, isAudio);
 let lastErr = null;
 let hasQuotaFailure = false;

 for (const model of models) {
  if (signal && signal.aborted) break;

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const onParentAbort = () => timeoutCtrl.abort();
  if (signal) signal.addEventListener('abort', onParentAbort);

  try {
   const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(reqBody), signal: timeoutCtrl.signal }
   );
   clearTimeout(timer);
   if (signal) signal.removeEventListener('abort', onParentAbort);

   if (!resp.ok) {
    let msg = "AI request failed (" + resp.status + ")";
    let errCode = "";
    try { 
     const errBody = await resp.json(); 
     if (errBody?.error?.message) msg = errBody.error.message; 
     if (errBody?.error?.status) errCode = errBody.error.status;
    } catch(e){}
    
    // 1. Quota / Rate-limit exceeded check: Auto-switch to next model instantly
    const isQuotaExceeded = (resp.status === 429) || 
     /quota|exceeded|rate limit|limit:\s*0|resource_exhausted|RESOURCE_EXHAUSTED/i.test(msg) ||
     errCode === 'RESOURCE_EXHAUSTED';

    // 2. Genuine Invalid/Expired Key
    const isKeyInvalid = (resp.status === 401) || 
     (resp.status === 400 && /API_KEY_INVALID|api key not valid|key.*invalid/i.test(msg));

    if (isKeyInvalid && !isQuotaExceeded) {
     throw new Error("INVALID_KEY: Invalid/Expired API Key. Free key yahan se lein: aistudio.google.com/apikey (" + msg + ")");
    }

    if (resp.status === 403 && /Generative Language API has not been used|disabled/i.test(msg)) {
     throw new Error("INVALID_KEY: Generative Language API disabled hai. Kripya aistudio.google.com/apikey se nayi free key banayein.");
    }

    if (resp.status === 404 || /not found|not supported for generateContent/i.test(msg)) {
     console.warn(`[Gemini API] Model ${model} not supported on v1beta. Auto-switching to next model...`);
     _permanentBlacklistModels.add(model);
     // Keep lastErr generic — never show intermediate "model switch" message to user
     lastErr = new Error(`AI model unavailable, trying next...`);
     continue;
    }

    if (isQuotaExceeded) {
     hasQuotaFailure = true;
     const isDailyQuota = /daily|per\s*day|day\s*limit|capacity|24\s*hour|free tier limit/i.test(msg);
     // Daily limit gets 2 hours cooldown; per-minute rate limit gets 60 seconds
     _modelQuotaCooldowns[model] = Date.now() + (isDailyQuota ? 7200000 : 60000);
     if (_cachedWorkingAudioModel === model) _cachedWorkingAudioModel = null;
     if (_cachedWorkingTextModel === model) _cachedWorkingTextModel = null;
     console.warn(`[Gemini API] Model ${model} ${isDailyQuota ? 'daily quota' : 'rate limit'} exceeded. Auto-switching to fallback...`);
     lastErr = new Error(`AI quota full hai, fallback model try ho raha hai...`);
     continue; // Try next model immediately!
    }

    lastErr = new Error(msg);
    console.warn(`[Gemini API] Model ${model} failed (${resp.status}): ${msg}. Trying fallback...`);
    continue;
   }

   const data = await resp.json();
   const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
   if (!textOut) { lastErr = new Error("No text response from AI"); continue; }

   // Cache successful model so future queries are instant
   if (isAudio) {
    _cachedWorkingAudioModel = model;
   } else {
    _cachedWorkingTextModel = model;
   }
   return textOut;
  } catch (err) {
   clearTimeout(timer);
   if (signal) signal.removeEventListener('abort', onParentAbort);
   lastErr = err;
   if (err && err.message && err.message.startsWith("INVALID_KEY")) {
    throw err;
   }
   if (err && err.name === 'AbortError') {
    if (signal && signal.aborted) {
     lastErr = new Error("AI request timeout ho gaya. Kripya dobara bolein.");
     break;
    }
    console.warn(`[Gemini API] Model ${model} timed out. Trying fallback...`);
   }
  }
 }

 if (hasQuotaFailure) {
  throw new Error("QUOTA_EXHAUSTED: Sabhi Gemini models ki free daily/minute limit poori ho chuki hai. Kripya thodi der baad dobara try karein.");
 }
 if (lastErr && /model switch|model unavailable|trying next/i.test(String(lastErr.message||''))) {
  throw new Error("Bill/AI scan fail: koi supported Gemini model nahi mila. API key check karein ya thodi der baad try karein.");
 }
 throw lastErr || new Error("AI service response nahi de rahi hai.");
}

async function callGeminiJSON(prompt, schema){
 const apiKey = getGeminiKey();
 if (!apiKey) return null;
 const body = {
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  generationConfig: {
   responseMimeType: "application/json",
   ...(schema ? { responseSchema: schema } : {})
  }
 };
 const textOut = await _geminiRawFetch(body);
 return _parseGeminiJson(textOut);
}

// Free-form text reply chahiye ho (JSON nahi, jaise chat ke liye) — same
// endpoint, bas JSON mode off.
async function callGeminiText(prompt){
 const apiKey = getGeminiKey();
 if (!apiKey) return null;
 const body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
 const textOut = await _geminiRawFetch(body);
 return textOut ? textOut.trim() : textOut;
}

// ===== AI Settings modal (Gemini API key) =====
function openAiSettingsModal(){
 const existing = document.getElementById('aiSettingsModal');
 if (existing) existing.remove();
 const currentKey = getGeminiKey();
 const masked = currentKey ? (currentKey.slice(0,6) + '••••••••' + currentKey.slice(-4)) : '';
 const html = `
 <div class="modal-bg active" id="aiSettingsModal">
  <div class="modal" style="max-width:380px;">
   <div class="modal-header">
    <h3 style="font-size:16px;"><i class="ti ti-sparkles"></i> AI Voice Parsing (Free)</h3>
    <button class="modal-close" onclick="document.getElementById('aiSettingsModal').remove()">&times;</button>
   </div>
   <div class="modal-body">
    <div style="font-size:12.5px;color:#8b9099;line-height:1.6;margin-bottom:12px;">
     AI Voice &amp; Balance Assistant ko connect karne ke liye aapki <b>free</b> AI Key chahiye (credit card nahi lagta). Free key 1 minute me yahan se milti hai:
     <br><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:#e8b64c;">aistudio.google.com/apikey →</a>
    </div>
    ${currentKey ? `<div style="font-size:12px;color:#3ddc84;margin-bottom:10px;">✅ Key connected: ${masked}</div>` : `<div style="font-size:12px;color:#f0a860;margin-bottom:10px;">⚠️ Abhi koi key nahi daali hai — AI features off rahenge, app normal (local) parsing use karta rahega.</div>`}
    <div style="position:relative;margin-bottom:10px;">
     <input id="aiKeyInput" type="password" placeholder="Paste AI API key here" value="${currentKey || ''}" autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:11px 40px 11px 12px;border-radius:10px;border:1px solid #232838;background:#0d1117;color:#e8eaf0;font-size:13.5px;font-family:monospace;">
     <i class="ti ti-eye" id="aiKeyToggleIcon" onclick="toggleAiKeyVisibility()" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#8b9099;cursor:pointer;font-size:16px;"></i>
    </div>
    <div style="font-size:11px;color:#6b7280;margin-bottom:10px;line-height:1.5;">🔒 This key is never saved in this repository — it is only stored in your local browser (mildly obfuscated).</div>
    <div style="display:flex;gap:8px;">
     <button id="saveAiKeyBtn" onclick="saveAiSettingsKey()" style="flex:1;padding:11px 0;border:none;border-radius:10px;background:linear-gradient(135deg,#f0c060,#e8b64c);color:#1a1305;font-weight:700;font-size:13.5px;cursor:pointer;">Save Key</button>
     ${currentKey ? `<button onclick="clearAiSettingsKey()" style="padding:11px 14px;border-radius:10px;border:1px solid #f06464;background:transparent;color:#f06464;font-weight:600;font-size:13px;cursor:pointer;">Remove</button>` : ''}
    </div>
    <div id="aiSettingsMsg" style="font-size:12px;color:#8b9099;margin-top:10px;"></div>
   </div>
  </div>
 </div>`;
 document.body.insertAdjacentHTML('beforeend', html);
}
function toggleAiKeyVisibility(){
 const input = document.getElementById('aiKeyInput');
 const icon = document.getElementById('aiKeyToggleIcon');
 if (!input) return;
 const showing = input.type === 'text';
 input.type = showing ? 'password' : 'text';
 if (icon) { icon.classList.toggle('ti-eye', showing); icon.classList.toggle('ti-eye-off', !showing); }
}
async function saveAiSettingsKey(){
 const inputEl = document.getElementById('aiKeyInput');
 let val = inputEl ? inputEl.value.trim() : '';
 val = val.replace(/^["'`]|["'`]$/g, '').replace(/^API\s*Key\s*:\s*/i, '').trim(); // Remove accidental quotes or labels
 const msgEl = document.getElementById('aiSettingsMsg');
 const btn = document.getElementById('saveAiKeyBtn');
 if (!val) { if (msgEl) { msgEl.textContent = "Please paste your API key."; msgEl.style.color = "#f06464"; } return; }
 if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }

 // 1. IMMEDIATELY SAVE KEY into localStorage so user never loses it
 setGeminiKey(val);

 if (msgEl) { msgEl.textContent = "⏳ Testing API key with Google AI Studio..."; msgEl.style.color = "#f0c060"; }
 
 try {
  const models = await getAvailableGeminiModels(val, true);
  const activeModel = models[0] || "gemini-2.0-flash";
  if (msgEl) {
   msgEl.textContent = `✅ Saved & Connected! Active model: ${activeModel}`;
   msgEl.style.color = "#3ddc84";
  }
  setTimeout(() => { const m = document.getElementById('aiSettingsModal'); if (m) m.remove(); }, 1000);
 } catch (err) {
  const errMsg = err?.message || String(err || '');
  if (errMsg.startsWith("INVALID_KEY")) {
   if (btn) { btn.disabled = false; btn.textContent = "Save Key"; }
   if (msgEl) {
    msgEl.textContent = "❌ Google AI Studio key invalid hai. Kripya aistudio.google.com/apikey se sahi key lein.";
    msgEl.style.color = "#f06464";
   }
  } else {
   // Network slow or quota on list query — key is saved, let user proceed
   if (msgEl) {
    msgEl.textContent = "✅ Key saved! Ready for voice assistant.";
    msgEl.style.color = "#3ddc84";
   }
   setTimeout(() => { const m = document.getElementById('aiSettingsModal'); if (m) m.remove(); }, 1000);
  }
 }
}
function clearAiSettingsKey(){
 setGeminiKey(null);
 const m = document.getElementById('aiSettingsModal');
 if (m) m.remove();
 openAiSettingsModal();
}

// ===== Voice entry: Google Voice Search jaisa — bolte waqt text live
// screen pe dikhta rehta hai (interim results), rukte hi final ho jaata hai. =====
let quickAddActiveRecognition = null; // ek waqt me sirf ek hi session chalega
let qaAutoRestarts = 0;
let qaRestarting = false;
let qaUserStopped = false;   // true jab user khud mic dabake roke
let qaChainCount = 0;
const QA_MAX_CHAIN = 30;     // safety cap — kabhi bhi hamesha ke liye loop na ho
// Jab session restart hota hai, ek naya `rec` object banta hai jiska apna
// khaali e.results shuru se start hota hai. Pehle is wajah se pichhle
// session me jo bhi final text ban chuka tha, wo naye session ke pehle
// onresult par poori tarah overwrite ho ke kho jaata tha — isiliye lambe
// sentence beech me hi katta hua lagta tha. Ab qaAccumulatedFinal isko
// restarts ke paar bhi save rakhta hai.
let qaAccumulatedFinal = "";

function startQuickAddVoice(){
 const statusEl = document.getElementById('qaVoiceStatus');
 const captionEl = document.getElementById('qaLiveCaption');
 const micBtn = document.getElementById('qaMicBtn');
 const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
 if (!SR) { statusEl.textContent = "⚠️This browser does not support voice input."; return; }

 // Chrome/Web Speech API sirf secure context (https:// ya localhost) me
 // mic allow karta hai — file:// ya plain http:// pe hamesha "not-allowed"
 // milega, permission dene ke baad bhi.
 if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  statusEl.textContent = "⚠️ Voice sirf HTTPS ya localhost pe chalta hai.";
  return;
 }

 // Agar mic pehle se sun raha hai, to dubara tap karne par use turant rok
 // do (ab tak jo bola hai wahi final maan liya jaayega) — isse user khud
 // decide kar sakta hai ki bolna kab khatam hua, naya session shuru nahi
 // hoga.
 if (quickAddActiveRecognition) {
  qaUserStopped = true;
  try { quickAddActiveRecognition.stop(); } catch(e){}
  return;
 }

 qaUserStopped = false;
 qaChainCount = 0;
 qaAutoRestarts = 0;
 qaAccumulatedFinal = "";
 captionEl.value = "";
 statusEl.textContent = "";
 runQuickAddVoiceSession(statusEl, captionEl, micBtn, SR);
}

function runQuickAddVoiceSession(statusEl, captionEl, micBtn, SR){
 micBtn.style.boxShadow = "0 0 0 8px rgba(230,50,50,.25), 0 6px 16px rgba(230,50,50,.4)";
 micBtn.classList.add('qa-listening');
 const stateDotEl = document.getElementById('qaMicStateDot');
 const stateTextEl = document.getElementById('qaMicStateText');
 if (stateDotEl) stateDotEl.classList.add('on');
 if (stateTextEl) { stateTextEl.textContent = "Mic ON — I'm listening..."; stateTextEl.style.color = "#e63232"; }

 const rec = new SR();
 quickAddActiveRecognition = rec;
 // hi-IN use kiya hai kyunki ye hi actually bola gaya Hindi audio sunta/
 // samajhta hai (en-IN Hindi bolne par kuch sunta hi nahi tha — isiliye
 // mic "on" dikhta tha par text aata hi nahi tha). hi-IN ka result
 // Devanagari script me aata hai, jisko hum neeche khud Roman/Hinglish me
 // convert kar dete hain (transliterateDevanagariToRoman) taaki screen par
 // Hinglish text dikhe aur party names (jo Roman letters me stored hain)
 // se bhi match ho sake.
 rec.lang = "hi-IN";
 rec.interimResults = true;   // live, typing-as-you-speak effect
 // continuous=false — YE JAAN-BOOJH KAR false rakha hai. continuous:true
 // Android Chrome me ek jaana-mana bug trigger karta hai: engine wahi
 // pichla suna hua shabd/phrase baar-baar khud hi repeat karke bolta rehta
 // hai (jaise "aaraesa 20 aaraesa 20 aaraesa 20..."). Fix: har utterance
 // ek chhota, bounded session hai (continuous=false), aur neeche onend me
 // hum khud usse turant naya session chain kar dete hain — isse
 // "continuous sunte rehna" wala UX milta hai lekin bina us repeat-loop
 // bug ke.
 rec.continuous = false;

 const haloEl = document.getElementById('qaMicHalo');
 if (haloEl) haloEl.classList.add('listening');
 rec.onstart = () => statusEl.textContent = "🔴 listening...";

 rec.onresult = (e) => {
  let interim = "", sessionFinal = "";
  for (let i = 0; i < e.results.length; i++) {
   const said = e.results[i][0].transcript;
   if (e.results[i].isFinal) sessionFinal += said;
   else interim += said;
  }
  // hi-IN se jo Devanagari text aaya hai, use Roman/Hinglish me convert
  // karke hi screen par dikhate hain aur usi se amount/party/method nikalte
  // hain — taaki dikhta bhi Hinglish me hai aur party match bhi sahi chale.
  const interimRoman = transliterateDevanagariToRoman(interim);
  const sessionFinalRoman = transliterateDevanagariToRoman(sessionFinal);

  // Pichhle chained session(s) ka final + is session ka final jodo — taaki
  // koi hissa khoye nahi.
  const combinedFinal = (qaAccumulatedFinal + " " + sessionFinalRoman).trim();

  // Live caption update — dikhta hai chahe abhi final hua ho ya nahi.
  // captionEl ab ek editable <input> hai (textContent nahi, .value use hota
  // hai) taaki user chahe to cursor rakh ke ise haath se edit kar sake.
  captionEl.value = (combinedFinal + " " + interimRoman).trim();

  if (sessionFinal) {
   qaAccumulatedFinal = combinedFinal;
   document.getElementById('qaLine').value = parseVoiceToQuickAddLine(qaAccumulatedFinal);
   statusEl.textContent = `✅ "${qaAccumulatedFinal}" — Okay, tap Confirm(or edit text above).`;
  }
 };

 // Ek utterance/session khatam hone ke baad — agar user ne khud mic
 // dabake roka nahi hai, to turant ek naya chhota session shuru kar do.
 // Isse mic "continuous" jaisa lagta hai (jab tak khud na roko sunta
 // rehta hai), lekin har session bounded hone ki wajah se wo repeat-loop
 // bug nahi aata jo continuous:true se aata tha.
 function chainNextSessionIfNeeded(){
  if (qaUserStopped) return false;
  if (qaChainCount >= QA_MAX_CHAIN) {
   statusEl.textContent = "Mic band ho gaya (lambi der tak chala) — dabao dobara bolne ke liye.";
   return false;
  }
  qaChainCount++;
  qaRestarting = true;
  quickAddActiveRecognition = null;
  setTimeout(() => runQuickAddVoiceSession(statusEl, captionEl, micBtn, SR), 120);
  return true;
 }

 // Mic poori tarah band ho gaya. UI ko "OFF" dikhao, aur agar kuch bola
 // gaya tha to turant AI ko bhej do taaki wo seedha entry samajh ke
 // taiyar kar de (AI available na ho to jo local parsing already ho chuki
 // hai wahi rehti hai — kuch tootta nahi).
 function finalizeQaMicOff(offMessage){
  micBtn.style.boxShadow = "0 6px 16px rgba(230,50,50,.4)";
  micBtn.classList.remove('qa-listening');
  if (haloEl) haloEl.classList.remove('listening');
  if (stateDotEl) stateDotEl.classList.remove('on');
  if (stateTextEl) { stateTextEl.textContent = offMessage; stateTextEl.style.color = "#888"; }
  if (qaAccumulatedFinal.trim() && typeof aiImproveQuickAddText === 'function') aiImproveQuickAddText(true);
 }

 rec.onerror = (e) => {
  if (e.error === 'no-speech') {
   // Kuch nahi suna is chhote se session me (gap ya thodi der ki khamoshi)
   // — real fail nahi hai, chup-chaap agla chained session shuru kar do.
   if (chainNextSessionIfNeeded()) return;
  }
  if (e.error === 'not-allowed') {
   statusEl.textContent = "⚠️ Mic blocked — Allow mic in browser settings 🔒, then tap the mic.";
  } else if (e.error === 'no-speech') {
   statusEl.textContent = "Couldn't hear you — tap the mic and try again. Speak clearly and closer.";
  } else if (e.error !== 'aborted') {
   statusEl.textContent = "Error: " + e.error;
  }
  finalizeQaMicOff("Mic is off now");
 };
 rec.onend = () => {
  if (quickAddActiveRecognition === rec) quickAddActiveRecognition = null;
  if (qaRestarting) { qaRestarting = false; return; }   // chained restart already scheduled, UI abhi "ON" hi rahega
  if (chainNextSessionIfNeeded()) return;
  finalizeQaMicOff("The mic is off — click to speak again.");
 };

 try { rec.start(); } catch(err) { statusEl.textContent = "Error: " + err.message; }
}

// Bola gaya sentence ("200 auto ke liye cash diye") ko amount/party/method
// me todta hai. Party sirf existing list se hi match hota hai (matchPartyName
// ke through) — voice se bhi kabhi naya party create nahi hota.
let quickAddVoiceType = null; // 'income' | 'expense' | null (voice se detect hua)
// ===== SHIVA VOICE ENTRY RULE PARSER =====
// Pattern:  "<amount> <party> ko <method> se <note>"
//   "500 auto ko cash se auto wale ko pay kiya"
//   -> amount 500 | party auto | method Cash | note "auto wale ko pay kiya"
// "se" ya "for" ke BAAD ka sara text = note (word-for-word). Gemini ke jawab par
// bharosa nahi — ye deterministic rule pehle chalta hai aur Gemini ke party/method/notes ko override karta hai.
const _SHIVA_TOKEN_MAP = {
  '\u0915\u094B':'ko','\u0938\u0947':'se','\u0915\u0948\u0936':'cash','\u0928\u0915\u0926':'cash','\u0928\u0917\u0926':'cash',
  '\u092F\u0942\u092A\u0940\u0906\u0908':'upi','\u092C\u0948\u0902\u0915':'bank','\u092B\u0949\u0930':'for','\u0930\u0941\u092A\u092F\u0947':'rupaye','\u0930\u0941\u092A\u090F':'rupaye'
};
const _SHIVA_METHOD_WORDS = /^(cash|nakad|nakd|upi|opi|yupi|gpay|phonepe|paytm|bhim|bank|online|neft|imps)$/i;
function parseShivaVoiceRule(input){
  if (!input) return null;
  const clean = String(input).replace(/[\u0966-\u096F]/g, d => String(d.charCodeAt(0) - 0x966)).replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const orig = clean.split(' ').map(w => w.replace(/^[\s"'\u201C\u201D(]+|[\s"'\u201C\u201D),.!?;:\u0964]+$/g, '')).filter(Boolean);
  const low = orig.map(w => { const l = w.toLowerCase(); return _SHIVA_TOKEN_MAP[w] || l; });
  const isNoise = w => /^(rs|rs\.|\u20B9|rupaye|rupees|rupee|rupay|inr)$/i.test(w);

  // amount: pehla number token
  let aIdx = -1, amount = 0;
  for (let i = 0; i < low.length; i++) {
    const m = low[i].match(/^(?:\u20B9|rs\.?)?(\d[\d,]*(?:\.\d+)?)(?:\/-)?(?:rs|rupaye)?$/i);
    if (m) { amount = parseFloat(m[1].replace(/,/g, '')); aIdx = i; break; }
  }
  if (aIdx < 0 || !(amount > 0)) return null;

  // method + note trigger ("se" / "for")
  let mIdx = -1;
  for (let i = aIdx + 1; i < low.length; i++) if (_SHIVA_METHOD_WORDS.test(low[i])) { mIdx = i; break; }
  let trigIdx = -1;
  if (mIdx >= 0 && low[mIdx + 1] === 'se') trigIdx = mIdx + 1;
  else {
    for (let i = aIdx + 1; i < low.length; i++) if (low[i] === 'se' || low[i] === 'for') { trigIdx = i; break; }
  }
  let koIdx = -1;
  for (let i = aIdx + 1; i < low.length; i++) if (low[i] === 'ko') { koIdx = i; break; }
  let toIdx = -1;
  for (let i = 0; i < low.length; i++) if (low[i] === 'to' && i !== aIdx) { toIdx = i; break; }

  // sirf tab lage jab pattern clear ho (warna purana logic chale, e.g. "Sagar se 500 mile")
  const methodSe = (mIdx >= 0 && trigIdx === mIdx + 1);
  const hasKo = (koIdx > aIdx && (trigIdx < 0 || koIdx < trigIdx));
  const hasForTo = (toIdx >= 0 && trigIdx >= 0 && low[trigIdx] === 'for');
  if (!(methodSe || hasKo || hasForTo)) return null;

  // party
  let pTokens = [];
  if (hasKo) pTokens = orig.slice(aIdx + 1, koIdx);
  else if (toIdx >= 0) {
    const stop = /^(in|via|by|cash|upi|bank|for|se|nakad|online)$/i;
    for (let i = toIdx + 1; i < orig.length && !stop.test(low[i]); i++) pTokens.push(orig[i]);
  } else {
    const end = mIdx >= 0 ? mIdx : (trigIdx >= 0 ? trigIdx : orig.length);
    pTokens = orig.slice(aIdx + 1, end);
  }
  pTokens = pTokens.filter((w, i) => !isNoise(w) && !_SHIVA_METHOD_WORDS.test(w));
  const party = pTokens.slice(0, 4).join(' ').trim();

  // notes = "se"/"for" ke baad ka sara text (as-is)
  let notes = '';
  if (trigIdx >= 0) notes = orig.slice(trigIdx + 1).join(' ').trim();

  // method
  let method = 'Cash';
  if (mIdx >= 0) method = (typeof normalizeVoiceMethod === 'function') ? normalizeVoiceMethod(low[mIdx]) : 'Cash';
  else if (typeof detectMethodFromTranscript === 'function') method = detectMethodFromTranscript(clean) || 'Cash';

  // type
  const lower = clean.toLowerCase();
  const income = /\b(recd|received|mila|mile|receive|aaye|aaya|kamaya|jama|credit|credited|dividend|refund|cashback|wapas|income|inward)\b/i.test(lower.replace(notes.toLowerCase(), ''));
  return { amount, party, method, notes, type: income ? 'income' : 'expense', matched: true };
}

// Gemini/local parse ke object ko rule-result se override karo (agar pattern match hua)
function shivaRuleOverride(obj, text){
  try {
    const r = parseShivaVoiceRule(text);
    if (!r) return obj;
    obj = obj || {};
    obj.amount = r.amount;
    if (r.party) obj.party = r.party;
    obj.method = r.method;
    obj.notes = r.notes;
    obj.type = r.type;
    obj.isEntry = true;
    obj.__shivaRule = true;
  } catch (e) { console.warn('shivaRuleOverride:', e); }
  return obj;
}

function parseVoiceToQuickAddLine(said){
 // Example: "30 office expence ko cash se chai ke liye pay kiya"
 // → amount 30, party matched from list (office Expence), method Cash,
 //   notes = everything after "se" or "for"
 const raw = said.trim();
 const lower = raw.toLowerCase();

 // Shiva rule: "<amount> <party> ko <method> se <note>" — deterministic
 const _rule = parseShivaVoiceRule(raw);
 if (_rule) {
  quickAddVoiceType = _rule.type;
  const _res = (typeof resolveVoiceParty === 'function')
   ? resolveVoiceParty(_rule.party, _rule.notes)
   : { party: (typeof matchPartyName === 'function' && matchPartyName(_rule.party)) || 'Self', notesExtra: _rule.notes };
  return `${_rule.amount},${_res.party},,${_rule.method},${_res.notesExtra || ""}`;
 }

 const amtMatch = raw.match(/(\d+(?:\.\d+)?)/);
 const amount = amtMatch ? amtMatch[1] : "";
 if (!amount) return "";

 // Method
 let method = "Cash";
 if (/\b(upi|opi|o\.p\.i|u\.p\.i|yupi|you\s*pee\s*eye|gpay|phonepe|paytm|bhim)\b/i.test(lower)) method = "UPI";
 else if (/\b(bank|online|neft|imps|transfer|account)\b/i.test(lower)) method = "Bank";
 else if (/\b(cash|nakad|nakd|नकद|नगद)\b/i.test(lower) || /नकद|नगद/.test(raw)) method = "Cash";

 // Type — improved income detection (credit / dividend / refund etc.)
 if (/\b(recd|received|mila|mile|receive|aaye|aaya|aaya hai|salary|kamaya|jama|credit|credited|dividend|refund|cashback|return|wapas|income|inward)\b/i.test(lower)
     || /\bcredit\s+hua\b/i.test(lower)
     || /\bse\s+credit\b/i.test(lower)) {
   quickAddVoiceType = "income";
 } else if (/\b(pay|paid|diye|de diye|dede|kharch|kharcha|spent|bheje|bhara|debit|expense|nikala|nikal)\b/i.test(lower)) {
   quickAddVoiceType = "expense";
 } else {
   quickAddVoiceType = "expense";
 }

// Party: multi-word before "ko" / "to" / after amount
 // "30 office expence ko cash se ..." → "office expence"
 let partyGuess = "";
 const koMulti = raw.match(/\b\d+(?:\.\d+)?\s+([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F\s]{0,50}?)\s+ko\b/i);
 const koSingle = raw.match(/\b([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F]{1,40})\s+ko\b/i);
 const toMatch = raw.match(/\b(?:to|from)\s+([A-Za-z][A-Za-z\s]{1,40}?)(?:\s+(?:for|via|by|cash|upi|bank)|\s*$)/i);
 const afterAmt = raw.match(/\b\d+(?:\.\d+)?\s+([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F\s]{1,40}?)(?:\s+(?:ko|se|ke|ki|ka|cash|upi|bank|pay|paid|for)\b)/i);
 if (koMulti) partyGuess = (koMulti[1] || "").trim();
 else if (koSingle) partyGuess = (koSingle[1] || "").trim();
 else if (toMatch) partyGuess = (toMatch[1] || "").trim();
 else if (afterAmt) partyGuess = (afterAmt[1] || "").trim();
 else {
  let stripped = raw
   .replace(amtMatch ? amtMatch[0] : "", "")
   .replace(/₹|rs\.?|rupaye|rupees/gi, "")
   .replace(/\b(cash|upi|opi|bank|online|ke|liye|diye|de|do|pay|paid|recd|received|mila|mile|kiye|kiya|kar|karo|hai|the|ka|ki|ko|se|aur|and|for|me|mein|par|pe|bheje|bhara)\b/gi, "")
   .trim();
  partyGuess = stripped.split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
 }
 // Strip method words stuck in party
 partyGuess = partyGuess.replace(/\b(cash|upi|bank|online|nakad)\b/gi, "").replace(/\s+/g, " ").trim();
 if (/^(cash|upi|bank|online|self|income|null|nakad|नकद)$/i.test(partyGuess)) partyGuess = "";

 // NOTES RULE: "se" OR "for" ke baad jo bhi aaye → notes (as-is, minimal clean)
 let notes = "";
 let noteMatch = raw.match(/\bse\b\s+(.+)$/i) || raw.match(/\bfor\b\s+(.+)$/i);
 if (noteMatch) {
  notes = noteMatch[1].replace(/\s+/g, " ").trim();
 }

 // NEVER invent party — only existing list; else Self + put guess into notes
 const resolved = (typeof resolveVoiceParty === 'function')
  ? resolveVoiceParty(partyGuess, notes)
  : { party: (typeof matchPartyName === 'function' && matchPartyName(partyGuess)) || 'Self', notesExtra: notes || partyGuess || '' };

 return `${amount},${resolved.party},,${method},${resolved.notesExtra || ""}`;
}



// Jab user live caption box me khud type/edit karta hai
function onQaLiveCaptionEdit(){
 const captionEl = document.getElementById('qaLiveCaption');
 const statusEl = document.getElementById('qaVoiceStatus');
 const text = captionEl.value.trim();
 if (!text) {
  document.getElementById('qaLine').value = "";
  statusEl.textContent = "";
  return;
 }
 document.getElementById('qaLine').value = parseVoiceToQuickAddLine(text);
 statusEl.textContent = `✅ "${text}" — theek hai to Confirm & Save dabao`;
}

// AI (Gemini) se text ko parse karta hai
async function aiImproveQuickAddText(auto){
 const apiKey = getGeminiKey();
 const captionEl = document.getElementById('qaLiveCaption');
 const statusEl = document.getElementById('qaVoiceStatus');
 const btn = document.getElementById('qaAiBtn');
 const stateTextEl = document.getElementById('qaMicStateText');
 const text = captionEl.value.trim();

 if (!apiKey) {
  if (!auto) openAiSettingsModal();
  return;
 }
 if (!text) {
  if (!auto) statusEl.textContent = "Please speak or write entry first, then tap AI.";
  return;
 }

 // Instant local financial query answer check (answers in 0.01s!)
 const localFastAnswer = instantAnswerFinancialQuery(text);
 if (localFastAnswer) {
  document.getElementById('qaLine').value = "";
  statusEl.textContent = `💬 ${localFastAnswer}`;
  if (stateTextEl) { stateTextEl.textContent = "🔊 AI bol raha hai..."; stateTextEl.style.color = "#a855f7"; }
  speakText(localFastAnswer, () => {
   if (stateTextEl) { stateTextEl.textContent = "AI Mic band hai — entry bolo ya sawaal poochho"; stateTextEl.style.color = "#888"; }
  });
  return;
 }

 const sel = document.getElementById('partySel');
 const partyNames = sel ? Array.from(sel.options).map(o => o.value).filter(Boolean) : [];
 const prevBtnHtml = btn ? btn.innerHTML : '';
 if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> AI processing...'; }
 if (auto) statusEl.textContent = "✨ Processing entry with AI...";

 try {
  const balanceSummary = buildAiContextText();
  const todayStr = getLocalDateStr();
  const schema = {
   type: "OBJECT",
   properties: {
    intent: { type: "STRING", enum: ["transaction", "question"] },
    amount: { type: "NUMBER" },
    party: { type: "STRING" },
    date: { type: "STRING" },
    method: { type: "STRING", enum: ["Cash", "UPI", "Bank"] },
    type: { type: "STRING", enum: ["income", "expense"] },
    notes: { type: "STRING" },
    answer: { type: "STRING" }
   },
   required: ["intent"]
  };
  const prompt = `Tum ek Hindi/Hinglish personal-finance app ("DayToDay") ke assistant ho. User ne ye bola/likha: "${text}"

Intent decide karo:
1) TRANSACTION — user transaction bata raha hai:
   - amount: number
   - party: pehle existing list se match: ${JSON.stringify(partyNames)}. Agar person ka naam list me nahi (jaise Ram, Sita), toh WAHI naam title-case me do — Self mat force karo. Sirf item (poha/chai) bina person ke ho tab Self.
   - date: agar user ne koi date/din bola ho (jaise "kal", "parso", "yesterday", "15 august", "10 tarik"), to exact YYYY-MM-DD format me calculate karke do. Aaj ki date: ${todayStr}. Agar koi date na boli ho to "${todayStr}" do.
   - method: "UPI" (agar upi/opi/gpay/phonepe/paytm bola), "Bank", ya "Cash"
   - type: "expense" (pay kiya/diye) ya "income" (mila/receive hua)
   - notes: "se" ya "for" ke baad ka word-for-word text, warna ""

2) QUESTION — user koi sawaal poochh raha hai (balance, analysis, goal, etc.):
   - answer: SEEDHA aur SIRF asli jawaab do — KABHI bhi "Maine samjha", "Theek hai", "Samajh gaya" mat likho. Pehle hi shabd se direct jawaab do. REAL DATA ke base par chhota jawaab (2-3 lines).

REAL DATA:
${balanceSummary}`;

  const result = await callGeminiJSON(prompt, schema);
  if (!result) throw new Error("AI key set nahi hai");

  if (result.intent === "question") {
   const answer = (result.answer || "Sorry, no answer available.").trim();
   document.getElementById('qaLine').value = "";
   statusEl.textContent = `💬 ${answer}`;
   if (stateTextEl) { stateTextEl.textContent = "🔊 AI bol raha hai..."; stateTextEl.style.color = "#a855f7"; }
   speakText(answer, () => {
    if (stateTextEl) { stateTextEl.textContent = "AI Mic band hai — entry bolo ya sawaal poochho"; stateTextEl.style.color = "#888"; }
   });
   return;
  }

  try { shivaRuleOverride(result, text); } catch(e){}
  const matchedParty = matchPartyName(result.party) || result.party || "";
  const amount = Number(result.amount) || "";
  const entryDate = quickAddParseDate(result.date) || getLocalDateStr();
  const method = detectMethodFromTranscript(text) || normalizeVoiceMethod(result.method);
  if (result.type === "income" || result.type === "expense") quickAddVoiceType = result.type;
  const cleanNotes = sanitizeVoiceNotes(result.notes, text);

  document.getElementById('qaLine').value = `${amount},${matchedParty},${entryDate},${method},${cleanNotes}`;
  statusEl.textContent = `✨ Entry: ₹${amount || '?'} · ${matchedParty || '(party set nahi)'} · ${method} · ${entryDate}${cleanNotes ? ' · ' + cleanNotes : ''} — theek hai to Confirm dabao`;
 } catch (err) {
  onQaLiveCaptionEdit();
  statusEl.textContent = auto
   ? `⚠️ AI abhi available nahi hai (${err.message}) — normal parsing se text bhara hai, check karke Confirm dabao.`
   : "⚠️ AI se nahi ho paya: " + err.message;
 } finally {
  if (btn) { btn.disabled = false; btn.innerHTML = prevBtnHtml; }
 }
}

// ===== Voice OUTPUT (TTS) — Gemini Live/Google Assistant jaisa spoken
// reply. Browser ka built-in SpeechSynthesis use karta hai (koi extra
// API key ya cost nahi). Hindi voice mile to wahi use hoti hai, warna
// device ki default voice se hi bol deta hai — dono cases me kaam karta
// hai. onEnd callback milta hai taaki speech khatam hone ke BAAD koi
// agla step (jaise entry auto-save) chalaya ja sake.
let _ttsVoicesCache = null;
function _pickHindiVoice(){
 try {
  if (!_ttsVoicesCache || _ttsVoicesCache.length === 0) {
   _ttsVoicesCache = window.speechSynthesis.getVoices() || [];
  }
  return _ttsVoicesCache.find(v => v.lang && v.lang.toLowerCase().startsWith('hi')) || null;
 } catch(e) { return null; }
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
 window.speechSynthesis.onvoiceschanged = () => { _ttsVoicesCache = window.speechSynthesis.getVoices(); };
}

function resumeAiChatVoiceIfContinuous(){
  if (!window.aiChatContinuousVoice) return;
  if (window.aiChatVoiceMuted) return;
  if (window.__aiChatUserCancelled) return;
  if (document.getElementById('aiChatModal') == null) return;
  setTimeout(() => {
    try {
      if (!aiChatVoiceActive && typeof startAiChatVoiceCapture === 'function' && !window.__aiChatUserCancelled && document.getElementById('aiChatModal')) {
        setAiChatHeaderState('listening', 'Sun raha hoon... Agla sawaal bolein');
        const msgEl = document.getElementById('aiChatMsg');
        if (msgEl) {
          msgEl.innerHTML = `<span style="color:#a855f7;font-weight:600;">🎙️ Sun raha hoon... Agla sawaal bolein (Mic dabayein rokne ke liye)</span>`;
        }
        startAiChatVoiceCapture();
      }
    } catch(e){}
  }, 450);
}

function speakText(text, onEnd){
 try {
  if (!text || !('speechSynthesis' in window)) { if (onEnd) onEnd(); return; }
  window.speechSynthesis.cancel(); // pichli koi speech chal rahi ho to rok do
  let clean = String(text || '').trim();

  // 1. Remove all markdown asterisks (*, **, ***) so TTS never speaks "tarakan" or "star"
  clean = clean.replace(/\*{1,3}/g, '');
  clean = clean.replace(/#{1,6}\s*/g, ''); // Removes # headers
  clean = clean.replace(/`{1,3}[^`]*`{1,3}/g, ''); // Removes code blocks
  clean = clean.replace(/[_~]/g, ''); // Removes underscores and tildes
  clean = clean.replace(/^[•\-\*+]\s+/gm, ''); // Removes bullet marks

  // 2. Remove emojis that speech synthesis reads out awkwardly
  clean = clean.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

  // 3. Strip introductory filler words like "Maine samjha", "Mene samjha", "Theek hai", "Samajh gaya"
  clean = clean.replace(/^(maine\s+samjha|mene\s+samjha|mai\s+samajh\s+gaya|main\s+samajh\s+gaya|samajh\s+gaya|theek\s+hai|ji\s+samajh\s+gaya|chaliye\s+batata\s+hoon)[\s,:\.\-–—]*/i, '');

  // 4. Currency normalization: "₹6,571" or "₹ 6571" -> "6571 rupaye" (stripping commas for clean natural number reading)
  clean = clean.replace(/₹\s*([\d,]+(?:\.\d+)?)/g, (match, p1) => {
    return p1.replace(/,/g, '') + ' rupaye';
  });
  clean = clean.replace(/\bRs\.?\s*([\d,]+(?:\.\d+)?)/gi, (match, p1) => {
    return p1.replace(/,/g, '') + ' rupaye';
  });

  // 5. Pronunciation fixes (Hindi + English) — natural spoken form
  clean = clean.replace(/\bUPI\b/gi, 'U P I');
  clean = clean.replace(/\bGST\b/gi, 'G S T');
  clean = clean.replace(/\bEMI\b/gi, 'E M I');
  clean = clean.replace(/\bSIP\b/gi, 'S I P');
  clean = clean.replace(/\bOK\b/gi, 'okay');
  clean = clean.replace(/\brupaye\b/gi, 'rupees');
  clean = clean.replace(/\bExpence\b/gi, 'Expense');
  clean = clean.replace(/\bexpence\b/gi, 'expense');
  clean = clean.replace(/\bvs\b/gi, 'versus');
  clean = clean.replace(/\betc\b/gi, 'etcetera');
  clean = clean.replace(/\bAPI\b/gi, 'A P I');
  clean = clean.replace(/\bQR\b/gi, 'Q R');
  // Speak large numbers a bit clearer: keep digits, TTS handles them

  // 6. Clean up extra linebreaks and multiple spaces
  clean = clean.replace(/[\r\n]+/g, '. ');
  clean = clean.replace(/\s{2,}/g, ' ').trim();
  if (!clean) { if (onEnd) onEnd(); return; }

  const utter = new SpeechSynthesisUtterance(clean);
  // Hinglish / English → en-IN; pure Devanagari → hi-IN
  const hasDeva = /[\u0900-\u097F]/.test(clean);
  const mostlyEnglish = /^[\x00-\x7F\s₹.,!?0-9%\-]+$/.test(clean) && /[a-zA-Z]{3,}/.test(clean);
  let voice = null;
  if (hasDeva && typeof _pickHindiVoice === 'function') {
    voice = _pickHindiVoice();
    utter.lang = voice ? voice.lang : 'hi-IN';
  } else {
    const voices = window.speechSynthesis.getVoices() || [];
    // Prefer natural Indian English voices for Hinglish (like live Grok-style clarity)
    voice = voices.find(v => /en-IN/i.test(v.lang) && /google|natural|neural|premium/i.test(v.name||'')) ||
            voices.find(v => /en-IN/i.test(v.lang)) ||
            voices.find(v => /en-GB/i.test(v.lang) && /female|natural|google/i.test(v.name||'')) ||
            voices.find(v => /en-US/i.test(v.lang) && /natural|google|premium/i.test(v.name||'')) ||
            voices.find(v => /^en/i.test(v.lang)) ||
            (typeof _pickHindiVoice === 'function' ? _pickHindiVoice() : null);
    utter.lang = voice ? voice.lang : (mostlyEnglish ? 'en-IN' : 'hi-IN');
  }
  if (voice) utter.voice = voice;
  // Slightly slower than 1.0 for clearer Hindi/English mixed pronunciation
  utter.rate = 0.98;
  utter.pitch = 1.02;
  utter.volume = 1;
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      if (onEnd) onEnd();
      if (window.__aiChatResumeAfterSpeak) {
        window.__aiChatResumeAfterSpeak = false;
        if (typeof resumeAiChatVoiceIfContinuous === 'function') resumeAiChatVoiceIfContinuous();
      }
    }
  };
  utter.onend = finish;
  utter.onerror = finish;
  window.speechSynthesis.speak(utter);
  setTimeout(finish, Math.max(4000, clean.length * 90));
 } catch(e) {
  if (onEnd) onEnd();
 }
}

// ===== AI Mic (PRIMARY) — audio seedha Gemini ko jaata hai =====
// Purane mic se fark: purana mic pehle browser ke apne (kabhi kabhi kamzor)
// SpeechRecognition se Devanagari text banata tha, phir usse Roman me
// convert karke, phir alag se AI ko bhejta tha (2 step, thoda lossy). Ye
// naya AI Mic seedha recorded audio Gemini ko bhejta hai — Gemini khud
// sunta hai (jo browser ke built-in engine se kaafi behtar samajhta hai)
// aur ek hi call me transcript + amount/party/method/type sab nikal deta
// hai. Isiliye ye ab MAIN/default mic hai; purana mic sirf backup hai.
// ===== AI Mic 3D Orb (Three.js) — purely visual, state-reactive layer
// behind the mic button. 4 states: idle (grey/calm) -> listening (pink/
// fast, jab user bol raha ho) -> thinking (violet/pulse, jab Gemini
// process kar raha ho) -> speaking (gold/energetic, jab TTS bol raha ho)
// -> wapas idle. Agar WebGL/Three.js kisi wajah se load na ho paaye
// (purana browser, blocked CDN, low-end device), ye function chup-chaap
// skip ho jaata hai — AI Mic ka recording/parsing/save logic isse
// bilkul depend nahi karta, sirf ek visual extra hai.
window.__aiOrbState = 'idle';
function setAiOrbState(state){
 window.__aiOrbState = state;
 if (window.__aiOrbApi) window.__aiOrbApi.setState(state);
}
// Full-screen "aurora orb" — same visual design as the ai_mic_3d_demo.html
// reference (Three.js shader-morphed icosahedron + wireframe shell + gold
// particle field + pointer parallax), just wired to REAL states instead of
// demo timers. Canvases fill the viewport (#aivGlowCanvas / #aivSharpCanvas
// inside the full-screen AI Voice overlay).
function initAiOrb(){
 if (window.__aiOrbInited || window.__aiOrbFailed) return;
 const sharpCanvas = document.getElementById('aivSharpCanvas');
 const glowCanvas = document.getElementById('aivGlowCanvas');
 if (!sharpCanvas || !glowCanvas) return;

 function build(){
  if (window.__aiOrbInited) return;
  if (typeof THREE === 'undefined') { window.__aiOrbFailed = true; return; }
  try {
   window.__aiOrbInited = true;
   const STATE_PARAMS = {
    idle:      { amp:0.16, speed:0.35, intensity:0.90, hueSpeed:0.0  },
    listening: { amp:0.34, speed:0.95, intensity:1.15, hueSpeed:0.6  },
    thinking:  { amp:0.22, speed:0.60, intensity:1.00, hueSpeed:0.25 },
    speaking:  { amp:0.42, speed:1.30, intensity:1.28, hueSpeed:0.9  }
   };
   const STATE_HUE_BASE = { idle:0.62, listening:0.86, thinking:0.70, speaking:0.12 };

   const scene = new THREE.Scene();
   const camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
   // Mobile/portrait fix: camera.position.z was fixed at 5.4, tuned for
   // wide/laptop (landscape, aspect>=1) screens. On a phone (portrait,
   // aspect<1) width is the limiting dimension, so with a fixed distance
   // the orb filled way more of the (narrow) screen — that's the "bubble
   // too big" bug. fitCameraZ() pushes the camera back proportionally to
   // how narrow the screen is, so the orb reads the same relative size on
   // phone and laptop alike.
   function fitCameraZ(w, h){
    const BASE_Z = 5.4;
    const aspect = w / h;
    return aspect < 1 ? BASE_Z / aspect : BASE_Z;
   }
   camera.position.set(0, 0, fitCameraZ(window.innerWidth, window.innerHeight));

   function makeRenderer(canvas){
    const r = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    return r;
   }
   const rendererSharp = makeRenderer(sharpCanvas);
   const rendererGlow  = makeRenderer(glowCanvas);

   const uniforms = {
    uTime:{value:0}, uAmp:{value:0.16}, uSpeed:{value:0.35},
    uHueShift:{value:0}, uIntensity:{value:0.9}, uHueBase:{value:0.62}
   };
   const vertexShader = `
    uniform float uTime; uniform float uAmp; uniform float uSpeed;
    varying vec3 vNormal; varying float vNoise;
    float turb(vec3 p){
     float n = 0.0;
     n += sin(p.x*1.8 + p.y*1.3 + p.z*1.1) * 0.5;
     n += sin(p.x*3.1 - p.y*2.0 + p.z*2.6) * 0.28;
     n += sin(p.x*4.7 + p.y*4.1 - p.z*3.3) * 0.14;
     return n;
    }
    void main(){
     vNormal = normal;
     float t = uTime * uSpeed;
     float n = turb(position * 1.6 + vec3(t, t*0.7, -t*0.9));
     vNoise = n;
     vec3 displaced = position + normal * (n * uAmp);
     vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
     gl_Position = projectionMatrix * mv;
    }
   `;
   const fragmentShader = `
    uniform float uTime; uniform float uHueShift; uniform float uIntensity; uniform float uHueBase;
    varying vec3 vNormal; varying float vNoise;
    vec3 hsl2rgb(vec3 c){
     vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
     return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0*c.z-1.0));
    }
    void main(){
     float hue = fract(uHueBase + vNormal.y*0.18 + vNormal.x*0.10 + uTime*0.03*uHueShift + vNoise*0.05);
     float sat = 0.75;
     float light = 0.52 + vNoise*0.12;
     vec3 col = hsl2rgb(vec3(hue, sat, light));
     float fres = pow(1.0 - abs(vNormal.z), 2.2);
     col += fres * vec3(0.35, 0.25, 0.55);
     gl_FragColor = vec4(col * uIntensity, 1.0);
    }
   `;
   const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
   const geometry = new THREE.IcosahedronGeometry(1.35, 24);
   const orb = new THREE.Mesh(geometry, material);
   scene.add(orb);

   const wireMat = new THREE.MeshBasicMaterial({ color:0xffffff, wireframe:true, transparent:true, opacity:0.05 });
   const wireOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(1.42, 3), wireMat);
   scene.add(wireOrb);

   const PARTICLE_COUNT = 160;
   const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
   for (let i = 0; i < PARTICLE_COUNT; i++) {
    const r = 2.6 + Math.random()*2.6;
    const theta = Math.random()*Math.PI*2;
    const phi = Math.acos((Math.random()*2)-1);
    particlePositions[i*3]   = r*Math.sin(phi)*Math.cos(theta);
    particlePositions[i*3+1] = r*Math.sin(phi)*Math.sin(theta)*0.6;
    particlePositions[i*3+2] = r*Math.cos(phi)*0.6 - 1.0;
   }
   const particleGeo = new THREE.BufferGeometry();
   particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
   const particleMat = new THREE.PointsMaterial({ color:0xf0c060, size:0.028, transparent:true, opacity:0.55, depthWrite:false });
   const particles = new THREE.Points(particleGeo, particleMat);
   scene.add(particles);

   function onResize(){
    if (!document.getElementById('aiVoiceFullscreen')?.classList.contains('active')) return;
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w/h;
    camera.position.z = fitCameraZ(w, h);
    camera.updateProjectionMatrix();
    rendererSharp.setSize(w,h); rendererGlow.setSize(w,h);
   }
   window.addEventListener('resize', onResize);

   let targetRotX = 0, targetRotY = 0;
   window.addEventListener('pointermove', (e) => {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    targetRotY = nx * 0.35;
    targetRotX = ny * 0.25;
   });

   const clock = new THREE.Clock();
   let currentState = 'idle';
   window.__aiOrbApi = { setState:(s)=>{ if (STATE_PARAMS[s]) currentState = s; } };

   let orbAnimRunning = false;
   function animate(){
    if (!document.getElementById('aiVoiceFullscreen')?.classList.contains('active')) {
     orbAnimRunning = false;
     return;
    }
    orbAnimRunning = true;
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    uniforms.uTime.value = t;
    const p = STATE_PARAMS[currentState] || STATE_PARAMS.idle;
    uniforms.uAmp.value       += (p.amp       - uniforms.uAmp.value)       * 0.06;
    uniforms.uSpeed.value     += (p.speed     - uniforms.uSpeed.value)     * 0.06;
    uniforms.uIntensity.value += (p.intensity - uniforms.uIntensity.value) * 0.06;
    uniforms.uHueShift.value  += (p.hueSpeed  - uniforms.uHueShift.value)  * 0.08;
    const targetHueBase = STATE_HUE_BASE[currentState] || 0.62;
    uniforms.uHueBase.value  += (targetHueBase - uniforms.uHueBase.value) * 0.04;

    const scaleTarget = currentState === 'idle' ? 1.0 : (currentState === 'speaking' ? 1.16 : 1.10);
    orb.scale.x += (scaleTarget - orb.scale.x) * 0.06;
    orb.scale.y += (scaleTarget - orb.scale.y) * 0.06;
    orb.scale.z += (scaleTarget - orb.scale.z) * 0.06;
    wireOrb.scale.copy(orb.scale);

    orb.rotation.x += (targetRotX - orb.rotation.x) * 0.04;
    orb.rotation.x += 0.0012;
    orb.rotation.y += (targetRotY - orb.rotation.y) * 0.04;
    orb.rotation.y += 0.0022;
    wireOrb.rotation.copy(orb.rotation);

    const spin = currentState === 'idle' ? 0.0009 : 0.0030;
    particles.rotation.y += spin;
    particles.rotation.x += 0.0004;

    rendererSharp.render(scene, camera);
    rendererGlow.render(scene, camera);
   }
   window.__startAiOrbAnimation = () => { if (!orbAnimRunning) animate(); };
   if (document.getElementById('aiVoiceFullscreen')?.classList.contains('active')) {
    animate();
   }
   onResize();
  } catch(e) {
   // Kisi bhi WebGL/driver issue par chup-chaap fallback — mic button
   // aur uska poora flow bilkul normal kaam karta rehta hai.
   window.__aiOrbFailed = true;
  }
 }

 if (typeof THREE !== 'undefined') { build(); return; }
 if (window.__threeJsLoading) {
  const iv = setInterval(()=>{ if (typeof THREE !== 'undefined'){ clearInterval(iv); build(); } }, 150);
  return;
 }
 window.__threeJsLoading = true;
 const s = document.createElement('script');
 s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
 s.onload = () => { window.__threeJsLoading = false; build(); };
 s.onerror = () => { window.__threeJsLoading = false; window.__aiOrbFailed = true; };
 document.head.appendChild(s);
}

// ===== AI Voice full-screen overlay open/close =====
function openAiVoiceFullscreen(){
 const overlay = document.getElementById('aiVoiceFullscreen');
 if (!overlay) return;
 overlay.classList.add('active');
 qaUserStopped = false;
 initAiOrb(); // lazy — pehli baar hi Three.js load hoga, baad me reuse hota hai
 // Resize event manually fire karo taaki orb turant sahi viewport size le
 // (agar pehle se init ho chuka ho to onResize guard ab active hone ke
 // baad hi kaam karega).
 setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
 setAivState('idle');
 syncAivResultVisibility();
 // qaLiveCaption ka .value bahut jagah se programmatically set hota hai
 // (voice recognition, Gemini response, backup mic) — sirf oninput event
 // se track karna kaafi nahi hai, isliye jab tak screen khuli hai, halka
 // sa poll chalta rehta hai taaki result-bar (caption+Confirm) hamesha
 // sync rahe, chahe value kahin se bhi set hua ho.
 if (aivResultSyncTimer) clearInterval(aivResultSyncTimer);
 aivResultSyncTimer = setInterval(syncAivResultVisibility, 250);

 // SINGLE-TAP SYSTEM: screen kholne wala tap hi mic ko turant start kar
 // deta hai — user ko dobara mic button dabana nahi padta. Agar Gemini
 // key set nahi hai to settings khulega (jaisa toggleAiMic me hota hai).
 if (!getGeminiKey()) {
  setAivCaption("Tip: Gemini API key settings me add karein live web answers ke liye.");
 }
 aiMicKeepListening = true;
 startAiMicRecording();
}
function closeAiVoiceFullscreen(){
 const overlay = document.getElementById('aiVoiceFullscreen');
 if (overlay) overlay.classList.remove('active');
 qaUserStopped = true;
 if (typeof stopAiMicRecording === 'function') { try { stopAiMicRecording(false); } catch(e){} }
 if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch(e){} }
 if (aivResultSyncTimer) { clearInterval(aivResultSyncTimer); aivResultSyncTimer = null; }
}
let aivResultSyncTimer = null;
// Fullscreen overlay ke apne visible caption/state/title text ko update
// karta hai — real toggleAiMic() pipeline isi ko call karta hai taaki
// jo bhi ho raha hai (listening/thinking/speaking) screen par saaf dikhe.
function setAivState(state, text){
 const dot = document.getElementById('aivStateDot');
 const label = document.getElementById('aivStateText');
 const root = document.getElementById('aiVoiceFullscreen');
 if (root) root.setAttribute('data-state', state);
 const labels = { idle: 'Idle — tap to speak', listening: 'Listening...', thinking: 'Thinking...', speaking: 'Speaking...' };
 if (label) label.textContent = text || labels[state] || '';
 if (dot) dot.setAttribute('data-state', state);
 setAiOrbState(state);
}
function setAivCaption(text){
 const el = document.getElementById('aivCaption');
 if (!el) return;
 el.style.opacity = 0;
 setTimeout(() => { el.textContent = text; el.style.opacity = 1; }, 150);
}

// App/AI-voice-screen band hai ya khuli hai, ye check karne ke liye —
// speak() ke "khatam hua" callback me use hota hai taaki screen band hone
// ke baad mic khud-ba-khud dobara ON na ho jaaye (jiski wajah se AI band
// karne ke baad bhi background me sunta/bolta rehta tha).
function isAiVoiceScreenOpen(){
 const overlay = document.getElementById('aiVoiceFullscreen');
 return !!(overlay && overlay.classList.contains('active'));
}

// App band ho jaaye ya background me chala jaaye (home button, app-switch,
// tab close) — chahe X button dabaya ho ya nahi, AI turant chup ho jaana
// chahiye aur mic band ho jaana chahiye. Bina isके, agar user seedha app
// minimize kar de (X na dabaye), to AI background me sunta/bolta reh
// sakta tha.
function stopAiVoiceEverything(){
 try { aiMicKeepListening = false; } catch(e){}
 try { if (aiMicAbortController) { aiMicAbortController.abort(); aiMicAbortController = null; } } catch(e){}
 try { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); } catch(e){}
 try { if (typeof stopAiMicRecording === 'function') stopAiMicRecording(false); } catch(e){}
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAiVoiceEverything(); });
window.addEventListener('pagehide', stopAiVoiceEverything);

let aiAudioContext = null;
let aiAudioSource = null;
let aiAudioProcessor = null;
let aiPcmChunks = [];
let aiMicActive = false;
let aiMicStream = null;
let aiMicAbortController = null;

// SAFETY NET: Gemini ek chhota/fast model hai — prompt me clearly bola
// hone ke bawajood kabhi-kabhi "notes" field me poora bola hua sentence
// hi daal deta hai (amount/party/method repeat karke). Ye function check
// karta hai ki AI ka diya "notes" transcript se bahut zyada milta-julta
// hai kya (matlab poora sentence copy hua) — agar haan, to us bharose
// wale notes ko fenk kar transcript se khud hi "... ke liye" / "advance"
// jaisa chhota reason nikalne ki koshish karta hai, warna khaali chhod
// deta hai (poora sentence dikhane se behtar hai kuch na dikhana).
// Notes ko final shape deta hai. RULE: sirf DO trigger words hain — "se"
// aur "for". AI ne agar notes diya hai to use AS-IS use karte hain (koi
// truncate/shrink NAHI karna — pehle yahan 8-word limit tha jo lambe notes
// ko kaat deta tha, jo galat tha; ab poora jo bhi "se"/"for" ke baad bola
// gaya wahi rakhna hai). Agar AI ne khaali notes diya (kuch extract nahi
// kiya), tab hi transcript se seedha "se"/"for" regex se khud nikalte hain
// — safety net, extra shrinking nahi.
function sanitizeVoiceNotes(rawNotes, transcript){
 // Rule: "se" ya "for" ke baad jo bhi aaye → notes (as-is)
 const notes = (rawNotes || "").trim();
 if (notes) return notes.replace(/\s+/g, ' ').trim();

 const t = (transcript || "").trim();
 let m = t.match(/\bse\b\s+(.+)$/i);
 if (m) return m[1].replace(/\s+/g, ' ').trim();
 m = t.match(/\bfor\b\s+(.+)$/i);
 if (m) return m[1].replace(/\s+/g, ' ').trim();
 return "";
}


// AI kabhi-kabhi method "upi"/"bank" chhote letters me ya extra space ke
// saath bhejta hai — plain .includes() check case-sensitive hone ki wajah
// se aisa response chup-chaap "Cash" pe fallback ho jaata tha (bug: user
// UPI bole aur Cash save ho jaaye). Ab case/whitespace normalize karke
// match karte hain taaki asli method hi save ho.
function normalizeVoiceMethod(rawMethod){
 const m = String(rawMethod || "").trim().toLowerCase();
 if (!m) return "Cash";
 if (/\b(upi|gpay|google\s*pay|phonepe|paytm|bhim|yupi)\b/.test(m) || m === "upi") return "UPI";
 if (/\b(bank|neft|imps|rtgs|online|transfer)\b/.test(m) || m === "bank") return "Bank";
 if (/\b(cash|nakad|nakd|नकद|नगद)\b/.test(m) || m === "cash") return "Cash";
 if (m === "upi") return "UPI";
 if (m === "bank") return "Bank";
 return "Cash";
}


function blobToBase64(blob){
 return new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => {
   const result = reader.result || "";
   const base64 = String(result).split(',')[1] || "";
   resolve(base64);
  };
  reader.onerror = reject;
  reader.readAsDataURL(blob);
 });
}

// ===== BUGFIX: audio format =====
// Asli waja jiske chalte "bolne par text show nahi hota tha" aur "entry
// kabhi sahi kabhi galat" — MediaRecorder browser me audio ko "webm/opus"
// (Chrome/Android) ya "mp4/aac" (Safari/iOS) me record karta hai. Gemini
// ke generateContent audio-understanding endpoint ke liye Google ke apne
// docs sirf WAV/MP3/AIFF/AAC/OGG/FLAC ko guaranteed-supported batate hain
// — webm reliably kaam nahi karta, isliye request kabhi silently fail ho
// jaata tha (caption khaali reh jaata) aur kabhi jo thoda-bahut samjha
// jaata wo galat/adhoora hota. Fix: recording ke baad audio ko humesha
// WAV (universally supported format) me khud convert karke bhejte hain —
// isse har device/browser par reliably kaam karega.
async function blobToWavBase64(blob){
 const arrayBuffer = await blob.arrayBuffer();
 const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
 if (!AudioCtxClass) return await blobToBase64(blob);
 const audioCtx = new AudioCtxClass();
 let audioBuffer;
 try {
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
 } finally {
  try { audioCtx.close(); } catch(e){}
 }
 if (!audioBuffer) return await blobToBase64(blob);

 const TARGET_RATE = 16000;
 const srcRate = audioBuffer.sampleRate;
 const numFrames = audioBuffer.length;
 const ch0 = audioBuffer.getChannelData(0);
 const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

 // Mono downmixing
 const mono = new Float32Array(numFrames);
 if (ch1) {
  for (let i = 0; i < numFrames; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
 } else {
  mono.set(ch0);
 }

 // Fast linear interpolation resampling to 16kHz
 let finalSamples = mono;
 let finalRate = srcRate;
 if (srcRate !== TARGET_RATE && srcRate > 0) {
  const ratio = srcRate / TARGET_RATE;
  const targetLen = Math.round(numFrames / ratio);
  finalSamples = new Float32Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
   const srcPos = i * ratio;
   const srcIndex = Math.floor(srcPos);
   const frac = srcPos - srcIndex;
   const s0 = mono[srcIndex] || 0;
   const s1 = mono[srcIndex + 1] || s0;
   finalSamples[i] = s0 + frac * (s1 - s0);
  }
  finalRate = TARGET_RATE;
 }

 const wavBlob = _encodeWavDirect(finalSamples, finalRate);
 return await blobToBase64(wavBlob);
}

function _encodeWavDirect(samples, sampleRate){
 const bytesPerSample = 2; // 16-bit PCM mono
 const blockAlign = bytesPerSample;
 const byteRate = sampleRate * blockAlign;
 const dataSize = samples.length * bytesPerSample;
 const buffer = new ArrayBuffer(44 + dataSize);
 const view = new DataView(buffer);
 const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
 writeString(0, 'RIFF');
 view.setUint32(4, 36 + dataSize, true);
 writeString(8, 'WAVE');
 writeString(12, 'fmt ');
 view.setUint32(16, 16, true);       // PCM chunk size
 view.setUint16(20, 1, true);        // audio format = PCM
 view.setUint16(22, 1, true);        // channels = mono
 view.setUint32(24, sampleRate, true);
 view.setUint32(28, byteRate, true);
 view.setUint16(32, blockAlign, true);
 view.setUint16(34, 16, true);       // bits per sample
 writeString(36, 'data');
 view.setUint32(40, dataSize, true);
 let offset = 44;
 for (let i = 0; i < samples.length; i++, offset += 2) {
  const s = Math.max(-1, Math.min(1, samples[i]));
  view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
 }
 return new Blob([view], { type: 'audio/wav' });
}

// Audio + prompt Gemini ko bhejta hai. Ab do kaam ek hi mic se hote hain:
// 1) Transaction bolo ("200 adarsh ko cash pay kiye") — entry ke fields milte hain
// 2) Sawaal poochho ("adarsh ka balance kitna hai") — seedha "answer" milta hai
// AI khud decide karta hai ki intent kya hai ("intent": "transaction"/"question").
// Voice se "last transaction delete/edit karo" jaisa action perform karta
// hai. entries[0] hamesha sabse recent entry hai (naye entries unshift()
// hote hain). Delete se pehle deleted-history me save hota hai (existing
// saveToDeletedHistory function), isliye galti se delete hone par bhi
// data poori tarah gum nahi hota — Wallet/Entries/Analytics screens turant
// refresh ho jaate hain taaki voice se kiya gaya change UI me dikh jaaye.
function performAiVoiceAction(result){
 if (result.actionType === "set_reminder" || result.intent === "reminder") {
  const remCandidate = parseReminderInstruction(result.transcript || result.title || "");
  if (remCandidate && remCandidate.isReminder && !remCandidate.needsClarification) {
   const newReminder = {
    id: 'r_' + Date.now(),
    title: remCandidate.title,
    amount: remCandidate.amount || 0,
    dueDate: remCandidate.dueDate,
    notes: remCandidate.notes,
    direction: remCandidate.direction,
    paid: false,
    createdAt: new Date().toISOString()
   };
   paymentReminders.unshift(newReminder);
   saveRemindersToLocalStorage();
   renderRemindersList();
   if (typeof updateReminderUnreadDot === 'function') updateReminderUnreadDot();
   setTimeout(() => {
    if (typeof closeAiVoiceFullscreen === 'function') closeAiVoiceFullscreen();
    if (typeof closeAiChatModal === 'function') closeAiChatModal();
    openRemindersPanel();
   }, 1400);
   const amtStr = remCandidate.amount > 0 ? ` ₹${Number(remCandidate.amount).toLocaleString('en-IN')}` : '';
   const dirStr = remCandidate.direction === 'incoming' ? 'paise lene ka' : 'payment ka';
   const dateFormatted = (typeof formatDisplayDate === 'function') ? formatDisplayDate(remCandidate.dueDate) : remCandidate.dueDate;
   return `✅ ${dateFormatted} ke liye "${remCandidate.title}" se${amtStr} ${dirStr} reminder set ho gaya hai!`;
  }
 }

 if (result.actionType === "set_monthly_budget") {
  const amt = Number(result.amount);
  if (amt && amt > 0) {
   setMonthlyBudgetLimit(amt);
   return `Monthly budget limit set to ₹${amt.toLocaleString('en-IN')}.`;
  }
 }

 if (!entries || entries.length === 0) {
  return "No entries found to delete or edit.";
 }
 const target = entries[0]; // most recent entry

 if (result.actionType === "delete_last_entry") {
  const targetId = String(target.id);
  try { if (typeof saveToDeletedHistory === 'function') saveToDeletedHistory(target); } catch(e){}
  if (typeof trackDeletedEntryId === 'function') trackDeletedEntryId(targetId);
  entries = entries.filter(e => String(e.id) !== targetId);
  localStorage.setItem('entries', JSON.stringify(entries));
  try { renderWallet(); } catch(e){}
  try { renderEntries(); } catch(e){}
  try { renderAnalytics(); } catch(e){}
  try { if (typeof renderList === 'function') renderList(); } catch(e){}
  if (typeof queueOfflineSync === 'function') queueOfflineSync('delete', targetId);
  if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof db !== 'undefined' && db) {
   setTimeout(() => { db.collection("entries").doc(targetId).delete().catch(()=>{}); }, 50);
  }
  return (result.answer && result.answer.trim()) || `Deleted last entry: ₹${Number(target.amount)||0} (${target.party||'Unknown'}).`;
 }

 if (result.actionType === "update_last_entry") {
  const nowIso = new Date().toISOString();
  if (result.amount !== undefined && result.amount !== null && !isNaN(result.amount) && result.amount !== 0) target.amount = Number(result.amount);
  if (result.party) target.party = matchPartyName(result.party) || result.party;
  if (result.method) target.method = detectMethodFromTranscript(result.transcript) || normalizeVoiceMethod(result.method);
  if (result.type === "income" || result.type === "expense") target.type = result.type;
  if (result.notes !== undefined && result.notes !== null && result.notes !== "") target.notes = result.notes;
  target.updatedAt = nowIso;
  target.syncedWithCloud = false;
  const idx = entries.findIndex(e => String(e.id) === String(target.id));
  if (idx > -1) entries[idx] = target;
  localStorage.setItem('entries', JSON.stringify(entries));
  try { renderWallet(); } catch(e){}
  try { renderEntries(); } catch(e){}
  try { renderAnalytics(); } catch(e){}
  if (typeof queueOfflineSync === 'function') queueOfflineSync('set', target);
  if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof db !== 'undefined' && db) {
   setTimeout(() => { db.collection("entries").doc(String(target.id)).set(target, { merge: true }).catch(()=>{}); }, 50);
  }
  return (result.answer && result.answer.trim()) || `Updated last entry: ₹${Number(target.amount)||0} · ${target.party||'Unknown'}.`;
 }

 return "Action not recognized.";
}

function detectMethodFromTranscript(transcript){
 const t = (transcript || "").toLowerCase();
 if (/\b(upi|opi|o\.p\.i|u\.p\.i|yupi|you\s*pee\s*eye|gpay|g-pay|google\s*pay|phonepe|phone\s*pe|paytm|bhim)\b/i.test(t)) return "UPI";
 if (/\b(bank|neft|imps|rtgs|transfer|account\s*se|khaate\s*se|net\s*banking)\b/i.test(t)) return "Bank";
 if (/\b(cash|nakad|nakd|roked)\b/i.test(t)) return "Cash";
 return null;
}



async function aiMicToEntry(base64Audio, mimeType){
 const sel = document.getElementById('partySel');
 const partyNames = sel ? Array.from(sel.options).map(o => o.value).filter(Boolean) : [];
 const balanceSummary = buildAiContextText(true);
 const todayStr = getLocalDateStr();
 const schema = {
  type: "OBJECT",
  properties: {
   intent: { type: "STRING", enum: ["transaction", "question", "action", "none"] },
   transcript: { type: "STRING" },
   amount: { type: "NUMBER" },
   party: { type: "STRING" },
   date: { type: "STRING" },
   method: { type: "STRING", enum: ["Cash", "UPI", "Bank"] },
   type: { type: "STRING", enum: ["income", "expense"] },
   notes: { type: "STRING" },
   answer: { type: "STRING" },
   actionType: { type: "STRING", enum: ["delete_last_entry", "update_last_entry", "set_monthly_budget"] }
  },
  required: ["intent", "transcript"]
 };

 const modeContext = (typeof window !== 'undefined' && window.aivCurrentMode === 'ask')
   ? `\n\n[USER MODE CONTEXT]: User ne explicitly "ASK BALANCE / GEMINI VOICE" mode select kiya hua hai. Isliye user ke audio sawaal ko samajh kar REAL DATA ke base par seedha, exact aur fluent financial assistant answer do (intent: "question").`
   : `\n\n[USER MODE CONTEXT]: User ne explicitly "QUICK ENTRY" mode select kiya hua hai. Agar user ne kisi kharch/income ki baat boli hai to amount, party, date, method, type nikal kar intent: "transaction" banao.`;

 const promptText = `Tum ek Hindi/Hinglish personal-finance app ("DayToDay") ke andar voice assistant ho. Attached audio clip suno — user Hindi/Hinglish me bol raha hai.
${modeContext}

User teen tarah ki cheezein bol sakta hai — pehle decide karo "intent" kya hai:

1) TRANSACTION — user ek expense/income entry bata raha hai:
   - transcript: jo bola gaya uska Roman/Hinglish text.
   - amount: number (sirf digits).
   - party: naam. Agar existing party names (${JSON.stringify(partyNames)}) se close match kare to exact wahi naam use karo.
   - date: agar user ne koi specific din/date bola ho (jaise "kal", "parso", "yesterday", "15 august", "10 tarikh", "2 din pehle"), to calculated exact YYYY-MM-DD format me date do. Aaj ki date hai: "${todayStr}". Agar koi date na boli ho to "${todayStr}" do.
   - method: audio me DHYAN SE suno — agar "UPI", "opi", "u-p-i", "yupi", "GPay", "PhonePe", "Paytm" jaisa bola ho to "UPI" do aur transcript me "UPI" likho; agar "bank", "transfer", "account se" bola ho to "Bank" do; agar "cash"/"nakad" bola ho YA method na bola gaya ho to "Cash" do.
   - type: "expense" (diye/pay kiya/kharch) ya "income" (mila/receive hua/aaye).
   - FORMAT: "<amount> <party> ko <method> se <note>" — jaise "500 auto ko cash se auto wale ko pay kiya" => amount 500, party "Auto", method "Cash", notes "auto wale ko pay kiya". Party "ko" se pehle ka naam hai (auto/food jaisa item ho tab bhi wahi party, Self nahi).
   - notes: sirf DO trigger words hain — "se" aur "for". Jo bhi in shabdon ke baad ka remainder text hai wahi notes me daalo. Dono na ho to notes "" do.

2) QUESTION — user balance, party info, analysis, recent entries, savings goals/targets poochh raha hai:
   - transcript: jo sawaal poocha gaya.
   - answer: SEEDHA aur SIRF asli jawaab do — KABHI bhi "Maine samjha", "Mene samjha", "Theek hai", "Samajh gaya", "Chaliye batata hoon" mat likho. Pehle hi shabd se direct fact/number/answer shuru karo. DO NOT use markdown bold/asterisks (like **₹500** ya *), write clean numbers/text.
   - RULE FOR RECEIVABLES: "Kisse paise lena hai" / "Who owes me money" poochne par Section 1 me diye gaye sabhi Parties / People / Offices (jaise Rahul, Priya, Office, Client, etc. jinme 'INSE LENA HAI' likha ho) ka naam aur exact amount batao. Section 2 ke routine personal kharcho (Food, Auto, Fuel, Medicine, Self) ko udhar me mat jodna. NEECHE diye REAL DATA ke base par chhota jawaab (2-4 lines).

3) ACTION — user apni pichli entry delete/edit karne ko ya monthly budget limit set karne ko bol raha hai:
   - actionType: "delete_last_entry", "update_last_entry", ya "set_monthly_budget" (agar user monthly budget set karne ko bole).
   - amount: number (agar monthly budget set kar raha ho).
   - answer: Chhota confirmation message.

4) NONE — agar audio me sirf silence, background noise, saans ya koi samajh aane wala shabda na ho to "intent":"none", "transcript":"" do.

REAL DATA (all parties balance, date-wise totals, payment methods, analytics, recent entries, goals/targets):
${balanceSummary}`;

 const apiKey = getGeminiKey();
 if (!apiKey) throw new Error("AI key set nahi hai");
 const body = {
  contents: [{
   role: "user",
   parts: [
    { text: promptText },
    { inlineData: { mimeType: mimeType, data: base64Audio } }
   ]
  }],
  generationConfig: {
   responseMimeType: "application/json",
   responseSchema: schema,
   temperature: 0.1 // low temperature = zyada consistent/dhyaan se suna hua output (method/notes jaisi cheezein galti se badalti kam hain)
  }
 };
 aiMicAbortController = new AbortController();
 const textOut = await _geminiRawFetch(body, aiMicAbortController.signal);
 return _parseGeminiJson(textOut);
}

// ⚡ Ultra-fast text-based Gemini parsing (<1s) for real-time live transcribed voice
/** Grok-style open answer for Ask Balance / general questions (same quality as AI chat) */
async function answerVoiceLikeGrok(question){
 if (!question || !String(question).trim()) return null;
 const apiKey = getGeminiKey();
 if (!apiKey) {
  return (typeof smartFallbackGeneralAnswer === 'function')
   ? smartFallbackGeneralAnswer(question)
   : null;
 }
 const summary = (typeof buildAiContextText === 'function') ? buildAiContextText(true) : '';
 const prompt = `You are a Grok-style ultra-helpful voice AI inside DayToDay expense app.

LANGUAGE:
- Default Hinglish (Roman Hindi + English), short spoken sentences.
- If user spoke mostly English → answer English.
- Pure Devanagari Hindi only if user asked "Hindi me".

ACCURACY:
- App finance (balance, party, monthly total): use ONLY REAL FINANCIAL DATA below. Never invent ₹.
- General knowledge / math / life: full useful accurate answer like Grok.

VOICE FORMAT: 2-6 short sentences, no markdown stars, no bullet symbols, natural speakable text.

REAL FINANCIAL DATA:
${summary}

User: "${question}"`;
 try {
  if (typeof callGeminiText === 'function') {
   const reply = await callGeminiText(prompt);
   if (reply && String(reply).trim()) return String(reply).trim();
  }
 } catch (e) {
  console.warn('answerVoiceLikeGrok failed:', e);
 }
 return (typeof smartFallbackGeneralAnswer === 'function')
  ? smartFallbackGeneralAnswer(question)
  : 'Maaf kijiye, abhi jawab nahi de paya. Dobara try karein.';
}

async function processVoiceTextWithGemini(spokenText){
 if (!spokenText || typeof spokenText !== 'string' || !spokenText.trim()) return null;
 const apiKey = getGeminiKey();
 if (!apiKey) return null;

 const partyNames = typeof getAllPartyNames === 'function' ? getAllPartyNames() : [];
 const balanceSummary = buildAiContextText(true);
 const todayStr = getLocalDateStr();
 const currentMode = (typeof window !== 'undefined' && window.aivCurrentMode) || 'entry';

 const schema = {
  type: "OBJECT",
  properties: {
   intent: { type: "STRING", enum: ["transaction", "question", "action", "none"] },
   transcript: { type: "STRING" },
   amount: { type: "NUMBER" },
   party: { type: "STRING" },
   date: { type: "STRING" },
   method: { type: "STRING", enum: ["Cash", "UPI", "Bank"] },
   type: { type: "STRING", enum: ["income", "expense"] },
   notes: { type: "STRING" },
   answer: { type: "STRING" },
   actionType: { type: "STRING", enum: ["delete_last_entry", "update_last_entry", "set_monthly_budget"] }
  },
  required: ["intent", "transcript"]
 };

 const prompt = `You are Grok-style ultra-fast voice AI inside DayToDay expense app. Reply JSON only.

User said: "${spokenText}"
Mode: "${currentMode}" (entry = save expense/income; ask = answer any question)
Today: "${todayStr}"
Known contacts (ONLY valid party names): ${JSON.stringify(partyNames)}

APP FINANCIAL DATA:
${balanceSummary}

RULES:
1) TRANSACTION (amount + pay/paid/diye/kharch OR received/mila):
   intent:"transaction"
   amount: number
   type: "expense" if pay/paid/diye/kharch, else "income" if mila/received/salary
   method: "Cash"|"UPI"|"Bank" only (cash/nakad/नकद→Cash; gpay/phonepe/upi→UPI; bank/neft→Bank)
   date: "${todayStr}"
   party: MUST be EXACT name from Known contacts. Fuzzy match "office expence"/"ऑफिस" to list item like "office Expence". NEVER invent a new party name. If no match → party="Self"
   notes: EVERYTHING after the word "se" or "for" in the sentence (e.g. "chai ke liye pay kiya"). Keep it.
   transcript: short Hinglish summary

2) ANY QUESTION (balance, party dues, app help, general knowledge, math, news, life — same as chat):
   intent:"question"
   answer: Clear useful answer in Hinglish (Roman Hindi+English) unless user spoke pure English then English. Use exact ₹ from APP DATA for finance. Be fast, accurate, conversational like Grok. 2-6 short sentences max for voice.

3) ACTION (delete/edit last entry):
   intent:"action", actionType:"delete_last_entry", answer: short confirmation

4) If unclear: intent:"none", transcript: what was heard`;

 const body = {
  contents: [{
   role: "user",
   parts: [{ text: prompt }]
  }],
  generationConfig: {
   responseMimeType: "application/json",
   responseSchema: schema,
   temperature: 0.1,
   maxOutputTokens: 1000
  }
 };

 const abortCtrl = new AbortController();
 const timer = setTimeout(() => abortCtrl.abort(), 12000);
 try {
  const textOut = await _geminiRawFetch(body, abortCtrl.signal);
  clearTimeout(timer);
  return _parseGeminiJson(textOut);
 } catch(err) {
  clearTimeout(timer);
  throw err;
 }
}

function handleAiVoiceFinalResult(result, captionEl, statusEl, stateTextEl) {
 if (!result || result.intent === "none" || (!result.transcript && !result.amount && !result.answer)) {
  setAiOrbState('idle');
  setAivState('idle');
  setAivCaption("Could not hear clearly. Tap mic to speak.");
  if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak."; stateTextEl.style.color = "#888"; }
  if (statusEl) statusEl.textContent = "Could not hear clearly. Tap mic to speak.";
  return;
 }

 // ⚡ Check if spoken audio is an instruction to set/create a reminder
 const spokenText = result.transcript || "";
 const remVoice = parseReminderInstruction(spokenText);
 if (remVoice && remVoice.isReminder) {
  aiMicKeepListening = false;
  if (captionEl) captionEl.value = spokenText;

  if (remVoice.needsClarification) {
   const askMsg = remVoice.askText;
   if (statusEl) statusEl.textContent = `💬 ${askMsg}`;
   setAiOrbState('speaking');
   setAivState('speaking');
   setAivCaption(askMsg);
   if (stateTextEl) { stateTextEl.textContent = "🔊 Speaking..."; stateTextEl.style.color = "#a855f7"; }
   speakText(askMsg, () => {
    setAiOrbState('idle');
    setAivState('idle');
    setAivCaption("Tap mic to tell reminder details...");
    if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak"; stateTextEl.style.color = "#888"; }
   });
   return;
  }

  // Save reminder
  const newReminder = {
   id: 'r_' + Date.now(),
   title: remVoice.title,
   amount: remVoice.amount || 0,
   dueDate: remVoice.dueDate,
   notes: remVoice.notes,
   direction: remVoice.direction,
   paid: false,
   createdAt: new Date().toISOString()
  };
  paymentReminders.unshift(newReminder);
  saveRemindersToLocalStorage();
  renderRemindersList();
  if (typeof updateReminderUnreadDot === 'function') updateReminderUnreadDot();

  const amtStr = remVoice.amount > 0 ? ` ₹${Number(remVoice.amount).toLocaleString('en-IN')}` : '';
  const dirStr = remVoice.direction === 'incoming' ? 'paise lene ka' : 'payment ka';
  const dateFormatted = (typeof formatDisplayDate === 'function') ? formatDisplayDate(remVoice.dueDate) : remVoice.dueDate;
  const answer = `✅ ${dateFormatted} ke liye "${remVoice.title}" se${amtStr} ${dirStr} reminder set ho gaya hai! Reminders page open kar raha hoon...`;

  if (statusEl) statusEl.textContent = `💬 ${answer}`;
  setAiOrbState('speaking');
  setAivState('speaking');
  setAivCaption(answer);
  if (stateTextEl) { stateTextEl.textContent = "🔊 Speaking..."; stateTextEl.style.color = "#a855f7"; }

  speakText(answer, () => {
   setAiOrbState('idle');
   setAivState('idle');
   setTimeout(() => {
    if (typeof closeAiVoiceFullscreen === 'function') closeAiVoiceFullscreen();
    if (typeof closeAiChatModal === 'function') closeAiChatModal();
    openRemindersPanel();
   }, 500);
  });
  return;
 }

 if (result.intent === "question") {
  aiMicKeepListening = false;
  const askedText = result.transcript || "";
  const answer = (result.answer || "Sorry, could not find an answer.").trim();
  if (captionEl) captionEl.value = askedText;
  if (statusEl) statusEl.textContent = `💬 ${answer}`;
  setAiOrbState('speaking');
  setAivState('speaking');
  setAivCaption(answer);
  if (stateTextEl) { stateTextEl.textContent = "🔊 Speaking..."; stateTextEl.style.color = "#a855f7"; }
  speakText(answer, () => {
   if (isAiVoiceScreenOpen() && !qaUserStopped) {
    setAiOrbState('listening');
    setAivState('listening');
    setAivCaption("Sun raha hoon... Agla sawaal bolein");
    if (stateTextEl) { stateTextEl.textContent = "🎙️ Listening... (Continuous Q&A)"; stateTextEl.style.color = "#a855f7"; }
    setTimeout(() => {
     if (isAiVoiceScreenOpen() && !qaUserStopped && !aiMicActive && !aiMicProcessing) {
      startAiMicRecording();
     }
    }, 450);
   } else {
    setAiOrbState('idle');
    setAivState('idle');
    setAivCaption("Ready. Ask a question or speak an entry...");
    if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak"; stateTextEl.style.color = "#888"; }
   }
  });
  return;
 }

 if (result.intent === "action") {
  aiMicKeepListening = false;
  const askedText = result.transcript || "";
  let answer;
  try {
   answer = performAiVoiceAction(result);
  } catch(actionErr) {
   answer = "Sorry, could not complete action: " + (actionErr && actionErr.message ? actionErr.message : "error occurred.");
  }
  if (captionEl) captionEl.value = askedText;
  if (statusEl) statusEl.textContent = `💬 ${answer}`;
  setAiOrbState('speaking');
  setAivState('speaking');
  setAivCaption(answer);
  if (stateTextEl) { stateTextEl.textContent = "🔊 Speaking..."; stateTextEl.style.color = "#a855f7"; }
  speakText(answer, () => {
   setAiOrbState('idle');
   setAivState('idle');
   setAivCaption("Ready. Ask a question or speak an entry...");
   if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak"; stateTextEl.style.color = "#888"; }
  });
  return;
 }

 try { shivaRuleOverride(result, result.transcript || ''); } catch(e){}
 const amount = Number(result.amount) || "";
 const transcript = result.transcript || "";
 const entryDate = quickAddParseDate(result.date) || getLocalDateStr();
 const method = detectMethodFromTranscript(transcript) || normalizeVoiceMethod(result.method) || result.method || "Cash";
 if (result.type === "income" || result.type === "expense") quickAddVoiceType = result.type;
 const cleanNotes = sanitizeVoiceNotes(result.notes, transcript);
 // NEVER invent party from Gemini — only existing list
 const resolved = (typeof resolveVoiceParty === 'function')
  ? resolveVoiceParty(result.party, cleanNotes)
  : { party: (matchPartyName(result.party) || 'Self'), notesExtra: cleanNotes };
 const effectiveParty = resolved.party || (quickAddVoiceType === "income" ? "Income" : "Self");
 const finalNotes = resolved.notesExtra || cleanNotes || '';

 if (captionEl) captionEl.value = transcript;
 const qaLine = document.getElementById('qaLine');
 if (qaLine) qaLine.value = `${amount},${effectiveParty},${entryDate},${method},${finalNotes}`;

 const typeWord = (quickAddVoiceType === "income") ? "received" : "paid";
 const noteSpeak = finalNotes ? ` Note: ${finalNotes}.` : "";

 if (amount && effectiveParty) {
  const summaryLine = `₹${amount} · ${effectiveParty} · ${method} · ${entryDate}${finalNotes ? ' · ' + finalNotes : ''}`;
  if (statusEl) statusEl.textContent = `✨ Entry: ${summaryLine} — Saving...`;
  setAiOrbState('speaking');
  setAivState('speaking');
  setAivCaption(summaryLine + " — saving...");
  if (stateTextEl) { stateTextEl.textContent = "🔊 Saving entry..."; stateTextEl.style.color = "#a855f7"; }
  const speakLine = `₹${amount}, ${effectiveParty}, ${method}, ${typeWord}.${noteSpeak} Saving entry.`;
  speakText(speakLine, () => {
   submitQuickAdd();
   setAiOrbState('idle');
   setAivState('idle');
   setAivCaption("Speak an entry or ask a question");
   if (stateTextEl) { stateTextEl.textContent = "Mic is off — tap to speak."; stateTextEl.style.color = "#888"; }
  });
 } else {
  const summaryLine = `₹${amount || '?'} · ${effectiveParty || '(no party set)'} · ${method} · ${entryDate}${finalNotes ? ' · ' + finalNotes : ''}`;
  if (statusEl) statusEl.textContent = `✨ Entry: ${summaryLine} — Tap Confirm to save`;
  setAiOrbState('speaking');
  setAivState('speaking');
  setAivCaption("Review and tap Confirm — " + summaryLine);
  if (stateTextEl) { stateTextEl.textContent = "🔊 Review entry..."; stateTextEl.style.color = "#a855f7"; }
  const speakLine = `Please review amount and party, then tap Confirm.`;
  speakText(speakLine, () => {
   setAiOrbState('idle');
   setAivState('idle');
   if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak"; stateTextEl.style.color = "#888"; }
  });
 }
}

// ===== Mode Switching: Quick Entry vs Ask Balance =====
window.aivCurrentMode = 'entry'; // 'entry' | 'ask'

function switchAivMode(mode){
 window.aivCurrentMode = mode;
 const tabEntry = document.getElementById('aivTabEntry');
 const tabAsk = document.getElementById('aivTabAsk');
 const root = document.getElementById('aiVoiceFullscreen');
 const titleEl = document.getElementById('aivTitle');

 if (mode === 'entry') {
  if (tabEntry) tabEntry.classList.add('active');
  if (tabAsk) tabAsk.classList.remove('active');
  if (root) root.setAttribute('data-mode', 'entry');
  if (titleEl) titleEl.innerHTML = '<i class="ti ti-plus" style="color:#f5b301;font-size:19px;vertical-align:middle;"></i> Quick Entry Mode';
  setAivCaption("Speak your entry (e.g. '500 Ravi cash') — auto-saves when you pause.");
  playMicFeedbackSound('switch_entry');
 } else {
  if (tabAsk) tabAsk.classList.add('active');
  if (tabEntry) tabEntry.classList.remove('active');
  if (root) root.setAttribute('data-mode', 'ask');
  if (titleEl) titleEl.innerHTML = '<span style="background:linear-gradient(135deg,#9B72CB,#4E82EE,#F4AF5F);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:800;">✦ Ask Balance · AI Assistant</span>';
  setAivCaption("Ask anything (e.g. 'What is my balance?') — get instant answers.");
  playMicFeedbackSound('switch_ask');
 }
}

// Pleasant futuristic tone feedback on mic start, stop, and mode switch
function playMicFeedbackSound(type){
 try {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const now = ctx.currentTime;

  if (type === 'start') {
   // Soft ascending chime: 520Hz -> 780Hz
   const osc = ctx.createOscillator();
   const gain = ctx.createGain();
   osc.type = 'sine';
   osc.frequency.setValueAtTime(520, now);
   osc.frequency.exponentialRampToValueAtTime(780, now + 0.12);
   gain.gain.setValueAtTime(0.08, now);
   gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
   osc.connect(gain); gain.connect(ctx.destination);
   osc.start(now); osc.stop(now + 0.22);
   if (navigator.vibrate) navigator.vibrate(30);
  } else if (type === 'stop') {
   // Soft descending chime: 660Hz -> 440Hz
   const osc = ctx.createOscillator();
   const gain = ctx.createGain();
   osc.type = 'sine';
   osc.frequency.setValueAtTime(660, now);
   osc.frequency.exponentialRampToValueAtTime(440, now + 0.14);
   gain.gain.setValueAtTime(0.08, now);
   gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
   osc.connect(gain); gain.connect(ctx.destination);
   osc.start(now); osc.stop(now + 0.24);
   if (navigator.vibrate) navigator.vibrate(20);
  } else if (type === 'switch_entry') {
   // Bright dual chime for Quick Entry (Green/Gold chime)
   [523.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + i * 0.07);
    gain.gain.setValueAtTime(0.09, now + i * 0.07);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.18);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now + i * 0.07); osc.stop(now + i * 0.07 + 0.18);
   });
   if (navigator.vibrate) navigator.vibrate([15, 30, 15]);
  } else if (type === 'switch_ask') {
   // Warm celestial chord for Ask Balance / Gemini Live (Purple/Cyan aurora sweep)
   [440, 554.37, 659.25, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + i * 0.05);
    gain.gain.setValueAtTime(0.07, now + i * 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.28);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now + i * 0.05); osc.stop(now + i * 0.05 + 0.28);
   });
   if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  }
  setTimeout(() => { try { ctx.close(); } catch(e){} }, 500);
 } catch(e){}
}

let aiMicKeepListening = false;
let aiMicProcessing = false;

async function toggleAiMic(){
 if (typeof initAiOrb === 'function') initAiOrb();
 qaUserStopped = false;

 if (window.speechSynthesis && window.speechSynthesis.speaking) {
  try { window.speechSynthesis.cancel(); } catch(e){}
 }

 if (aiMicProcessing) {
  try { if (aiMicAbortController) { aiMicAbortController.abort(); aiMicAbortController = null; } } catch(e){}
  aiMicProcessing = false;
  setAiOrbState('idle');
  setAivState('idle');
 }

 if (aiMicActive) {
  stopAiMicRecording(true);
  return;
 }

 aiMicKeepListening = false;
 await startAiMicRecording();
}

async function startAiMicAudioCaptureFallback(){
 const statusEl = document.getElementById('qaVoiceStatus');
 if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  aiMicActive = false;
  setAiOrbState('idle');
  setAivState('idle');
  const msg = "⚠️ Ye browser microphone support nahi karta.";
  if (statusEl) statusEl.textContent = msg;
  setAivCaption(msg);
  return;
 }
 try {
  const stream = await navigator.mediaDevices.getUserMedia({
   audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  aiMicStream = stream;
  const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtxClass) return;
  const audioCtx = new AudioCtxClass();
  aiAudioContext = audioCtx;
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  const source = audioCtx.createMediaStreamSource(stream);
  aiAudioSource = source;
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  aiAudioProcessor = processor;
  aiPcmChunks = [];
  aiMicActive = true;
  let hasSpoken = false;
  let silenceStart = null;
  const SILENCE_MS_TO_STOP = 2200;
  const SPEECH_THRESHOLD = 0.006;
  const startedAt = Date.now();
  const MAX_RECORD_MS = 25000;

  processor.onaudioprocess = (e) => {
   if (!aiMicActive) return;
   const inputData = e.inputBuffer.getChannelData(0);
   aiPcmChunks.push(new Float32Array(inputData));
   let sum = 0;
   for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
   const rms = Math.sqrt(sum / inputData.length);
   if (rms > SPEECH_THRESHOLD) {
    hasSpoken = true;
    silenceStart = null;
   } else if (hasSpoken) {
    if (silenceStart === null) silenceStart = Date.now();
    else if (Date.now() - silenceStart > SILENCE_MS_TO_STOP) {
     stopAiMicRecording(hasSpoken);
     return;
    }
   }
   if (Date.now() - startedAt > MAX_RECORD_MS) {
    stopAiMicRecording(hasSpoken);
    return;
   }
  };
  source.connect(processor);
  processor.connect(audioCtx.destination);
 } catch(err) {
  aiMicActive = false;
  setAiOrbState('idle');
  setAivState('idle');
  const msg = "⚠️ Mic permission nahi mili: " + (err.message || err);
  if (statusEl) statusEl.textContent = msg;
  setAivCaption(msg);
 }
}

async function startAiMicRecording(){
 const statusEl = document.getElementById('qaVoiceStatus');
 const captionEl = document.getElementById('qaLiveCaption');
 const btn = document.getElementById('qaAiMicBtn');
 const haloEl = document.getElementById('qaAiMicHalo');
 const stateDotEl = document.getElementById('qaMicStateDot');
 const stateTextEl = document.getElementById('qaMicStateText');

 qaUserStopped = false;

 try { if (aiMicAbortController) { aiMicAbortController.abort(); aiMicAbortController = null; } } catch(e){}
 aiMicProcessing = false;

 // Clean up lingering stream / processor / recognition before new session
 try {
  if (window.__liveRecognition) {
   try { window.__liveRecognition.abort(); } catch(e){}
   window.__liveRecognition = null;
  }
  if (aiAudioProcessor) {
   aiAudioProcessor.disconnect();
   aiAudioProcessor.onaudioprocess = null;
   aiAudioProcessor = null;
  }
  if (aiAudioSource) {
   aiAudioSource.disconnect();
   aiAudioSource = null;
  }
  if (aiAudioContext) {
   const ctx = aiAudioContext;
   aiAudioContext = null;
   try { ctx.close(); } catch(e){}
  }
  if (aiMicStream) {
   aiMicStream.getTracks().forEach(t => t.stop());
   aiMicStream = null;
  }
 } catch(e){}
 aiMicActive = false;
 aiPcmChunks = [];
 window.__liveTranscript = "";

 if (captionEl) captionEl.value = "";
 const qaLine = document.getElementById('qaLine');
 if (qaLine) qaLine.value = "";

 if (btn) { btn.classList.add('qa-listening'); btn.style.transform = "scale(1.08)"; }
 if (haloEl) haloEl.classList.add('listening');
 setAiOrbState('listening');
 setAivState('listening');
 setAivCaption("Listening... Speak now");
 if (stateDotEl) stateDotEl.classList.add('on');
 if (stateTextEl) { stateTextEl.textContent = "🔴 Listening... Speak now"; stateTextEl.style.color = "#a855f7"; }
 if (statusEl) statusEl.textContent = "🔴 Listening... Speak an entry or ask a question";

 playMicFeedbackSound('start');
 aiMicActive = true;

 const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
 if (SR) {
  try {
   const liveRec = new SR();
   liveRec.lang = 'hi-IN';
   liveRec.continuous = false;
   liveRec.interimResults = true;
   liveRec.maxAlternatives = 1;
   let silenceTimer = null;
   let hasDetectedSpeech = false;

   // 9.5s idle silence timeout: if user stays silent during continuous Q&A, gracefully return to idle
   let idleNoSpeechTimer = setTimeout(() => {
    if (aiMicActive && !hasDetectedSpeech) {
     qaUserStopped = true;
     stopAiMicRecording(false);
     setAiOrbState('idle');
     setAivState('idle');
     setAivCaption("Ready. Ask a question or speak an entry...");
     if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak"; stateTextEl.style.color = "#888"; }
    }
   }, 9500);

   const scheduleSilenceStop = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
     if (aiMicActive && hasDetectedSpeech) {
      stopAiMicRecording(true);
     }
    }, 1400);
   };

   liveRec.onresult = (ev) => {
    let full = "";
    for (let i = 0; i < ev.results.length; i++) {
     const piece = (ev.results[i][0]?.transcript || "").trim();
     if (piece) {
      if (!full) full = piece;
      else if (piece.startsWith(full)) full = piece;
      else if (full.endsWith(piece)) {}
      else full += " " + piece;
     }
    }
    const combined = deduplicateSpeechPhrase(full);
    if (combined) {
     if (idleNoSpeechTimer) { clearTimeout(idleNoSpeechTimer); idleNoSpeechTimer = null; }
     hasDetectedSpeech = true;
     window.__liveTranscript = combined;
     if (captionEl) captionEl.value = combined;
     setAivCaption(combined);
     if (stateTextEl) { stateTextEl.textContent = "🔴 " + combined; stateTextEl.style.color = "#a855f7"; }
     scheduleSilenceStop();
    }
   };

   liveRec.onerror = (ev) => {
    if (idleNoSpeechTimer) { clearTimeout(idleNoSpeechTimer); idleNoSpeechTimer = null; }
    console.warn("SpeechRecognition notice:", ev?.error);
    if (ev?.error === 'no-speech') return;
    if (ev?.error === 'audio-capture' || ev?.error === 'not-allowed') {
     if (!window.__liveTranscript) {
      startAiMicAudioCaptureFallback();
     }
    }
   };

   liveRec.onend = () => {
    if (idleNoSpeechTimer) { clearTimeout(idleNoSpeechTimer); idleNoSpeechTimer = null; }
    if (aiMicActive) {
     if (hasDetectedSpeech) {
      stopAiMicRecording(true);
     } else {
      setTimeout(() => {
       if (aiMicActive && !hasDetectedSpeech) {
        try { liveRec.start(); } catch(e){ stopAiMicRecording(false); }
       }
      }, 250);
     }
    }
   };

   liveRec.start();
   window.__liveRecognition = liveRec;
   return;
  } catch(srErr) {
   console.warn("SpeechRecognition start notice, fallback to audio:", srErr);
  }
 }

 // Browser without Web Speech API (e.g. Safari iOS) -> fallback to audio capture
 await startAiMicAudioCaptureFallback();
}

async function stopAiMicRecording(hasSpokenManual){
 if (!aiMicActive) return;
 aiMicActive = false;
 playMicFeedbackSound('stop');

 if (window.__liveRecognition) {
  try { window.__liveRecognition.stop(); } catch(e){}
  window.__liveRecognition = null;
 }

 const srcRate = (aiAudioContext && aiAudioContext.sampleRate) || 44100;

 try {
  if (aiAudioProcessor) {
   aiAudioProcessor.disconnect();
   aiAudioProcessor.onaudioprocess = null;
   aiAudioProcessor = null;
  }
  if (aiAudioSource) {
   aiAudioSource.disconnect();
   aiAudioSource = null;
  }
  if (aiAudioContext) {
   const ctx = aiAudioContext;
   aiAudioContext = null;
   try { ctx.close(); } catch(e){}
  }
  if (aiMicStream) {
   aiMicStream.getTracks().forEach(t => t.stop());
   aiMicStream = null;
  }
 } catch(e){}

 const btn = document.getElementById('qaAiMicBtn');
 const haloEl = document.getElementById('qaAiMicHalo');
 const stateDotEl = document.getElementById('qaMicStateDot');
 const stateTextEl = document.getElementById('qaMicStateText');
 const statusEl = document.getElementById('qaVoiceStatus');
 const captionEl = document.getElementById('qaLiveCaption');

 if (btn) { btn.classList.remove('qa-listening'); btn.style.transform = "scale(1)"; }
 if (haloEl) haloEl.classList.remove('listening');
 if (stateDotEl) stateDotEl.classList.remove('on');

 // FAST-PATH: live speech transcript
 const liveSpoken = (window.__liveTranscript || (captionEl ? captionEl.value : "")).trim();
 if (liveSpoken) {
  setAiOrbState('thinking');
  setAivState('thinking');
  setAivCaption("Thinking...");
  if (stateTextEl) { stateTextEl.textContent = "✨ AI Samajh raha hai..."; stateTextEl.style.color = "#a855f7"; }

  const voiceMode = (typeof window !== 'undefined' && window.aivCurrentMode) || 'entry';
  const isAskMode = voiceMode === 'ask';
  const isQuestion = isAskMode || isQuestionNotEntry(liveSpoken);

  const _speakAnswer = (answer) => {
   if (captionEl) captionEl.value = liveSpoken;
   if (statusEl) statusEl.textContent = `💬 ${answer}`;
   setAiOrbState('speaking');
   setAivState('speaking');
   setAivCaption(answer);
   if (stateTextEl) { stateTextEl.textContent = "🔊 Speaking..."; stateTextEl.style.color = "#a855f7"; }
   speakText(answer, () => {
    if (isAiVoiceScreenOpen() && !qaUserStopped) {
     setAiOrbState('listening');
     setAivState('listening');
     setAivCaption("Sun raha hoon... Agla sawaal bolein");
     if (stateTextEl) { stateTextEl.textContent = "🎙️ Listening... (Continuous Q&A)"; stateTextEl.style.color = "#a855f7"; }
     setTimeout(() => {
      if (isAiVoiceScreenOpen() && !qaUserStopped && !aiMicActive && !aiMicProcessing) {
       startAiMicRecording();
      }
     }, 400);
    } else {
     setAiOrbState('idle');
     setAivState('idle');
     setAivCaption("Ready. Ask a question or speak an entry...");
     if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak"; stateTextEl.style.color = "#888"; }
    }
   });
  };

  // 1. ENTRY MODE → if not a question, parse & save transaction immediately!
  if (!isQuestion) {
   const parsedQuick = parseVoiceToQuickAddLine(liveSpoken);
   if (parsedQuick) {
    const [amtStr, partyStr, dateStr, methStr, notesStr] = parsedQuick.split(',');
    const numAmt = parseFloat(amtStr);
    if (!isNaN(numAmt) && numAmt > 0 && partyStr) {
     const entryDate = quickAddParseDate(dateStr) || getLocalDateStr();
     const typeWord = (quickAddVoiceType === "income") ? "received" : "paid";
     if (captionEl) captionEl.value = liveSpoken;
     const qaLine = document.getElementById('qaLine');
     if (qaLine) qaLine.value = parsedQuick;

     const noteBit = (notesStr || '').trim() ? ` · ${notesStr.trim()}` : '';
     const summaryLine = `₹${numAmt} · ${partyStr} · ${methStr || 'Cash'} · ${entryDate}${noteBit}`;
     if (statusEl) statusEl.textContent = `✨ ${summaryLine} — Saved!`;
     setAiOrbState('speaking');
     setAivState('speaking');
     setAivCaption(summaryLine + " — Saved!");
     if (stateTextEl) { stateTextEl.textContent = "🔊 Saving entry..."; stateTextEl.style.color = "#a855f7"; }

     // Persist immediately so transaction is never lost even if audio playback ends early
     if (typeof submitQuickAdd === 'function') {
      submitQuickAdd();
     }

     const speakLine = `₹${numAmt}, ${partyStr}, ${methStr || 'Cash'}, ${typeWord}${notesStr ? '. Note: ' + notesStr : ''}. Saved.`;
     speakText(speakLine, () => {
      setAiOrbState('idle');
      setAivState('idle');
      setAivCaption("Speak an entry or ask a question");
      if (stateTextEl) { stateTextEl.textContent = "Mic is off — tap to speak."; stateTextEl.style.color = "#888"; }
     });
     return;
    }
   }
  }

  // 2. Instant offline finance answers (balance, totals, etc.)
  const localFastAnswer = instantAnswerFinancialQuery(liveSpoken);
  if (localFastAnswer) {
   _speakAnswer(localFastAnswer);
   return;
  }

  // 3. QUESTION / ASK MODE → answer questions with continuous Q&A loop
  if (isQuestion) {
   try {
    aiMicProcessing = true;
    // Prefer structured Gemini; if question → answer; if accidental transaction still ok
    let aiResult = null;
    if (getGeminiKey()) {
     try { aiResult = await processVoiceTextWithGemini(liveSpoken); } catch(e) {}
    }
    aiMicProcessing = false;
    if (aiResult && aiResult.intent === 'transaction' && Number(aiResult.amount) > 0) {
     handleAiVoiceFinalResult(aiResult, captionEl, statusEl, stateTextEl);
     return;
    }
    if (aiResult && aiResult.intent === 'question' && aiResult.answer) {
     _speakAnswer(String(aiResult.answer).trim());
     return;
    }
    // Full Grok-style open answer (same as AI chat)
    aiMicProcessing = true;
    const grokAns = await answerVoiceLikeGrok(liveSpoken);
    aiMicProcessing = false;
    if (grokAns) {
     _speakAnswer(grokAns);
     return;
    }
   } catch (askErr) {
    console.warn('Ask mode voice error:', askErr);
    aiMicProcessing = false;
   }
   const smartAns = smartFallbackGeneralAnswer(liveSpoken);
   if (smartAns) {
    _speakAnswer(smartAns);
    return;
   }
   _speakAnswer('Samajh nahi aaya. Dobara short me poochiye.');
   return;
  }

  // 4. Gemini structured parse (entry or question)
  if (getGeminiKey()) {
   try {
    aiMicProcessing = true;
    const aiResult = await processVoiceTextWithGemini(liveSpoken);
    aiMicProcessing = false;
    if (aiResult && (aiResult.intent || aiResult.amount || aiResult.answer)) {
     handleAiVoiceFinalResult(aiResult, captionEl, statusEl, stateTextEl);
     return;
    }
   } catch(fastErr) {
    console.warn("Fast Gemini text parsing notice:", fastErr);
    aiMicProcessing = false;
   }
  }

  // 5. Fallback entry save if amount present
  const amtMatch = liveSpoken.match(/(\d+(?:\.\d+)?)/);
  if (amtMatch && parseFloat(amtMatch[1]) > 0) {
   const fallbackLine = parseVoiceToQuickAddLine(liveSpoken);
   if (fallbackLine) {
    const [fAmt, fParty, fDate, fMeth, fNotes] = fallbackLine.split(',');
    const fNum = parseFloat(fAmt);
    if (!isNaN(fNum) && fNum > 0) {
     const entryDate = quickAddParseDate(fDate) || getLocalDateStr();
     const typeWord = (quickAddVoiceType === "income") ? "received" : "paid";
     if (captionEl) captionEl.value = liveSpoken;
     const qaLine = document.getElementById('qaLine');
     if (qaLine) qaLine.value = fallbackLine;
     const noteBit = (fNotes || '').trim() ? ` · ${fNotes.trim()}` : '';
     const summaryLine = `₹${fNum} · ${fParty || 'Self'} · ${fMeth || 'Cash'} · ${entryDate}${noteBit}`;
     if (statusEl) statusEl.textContent = `✨ ${summaryLine} — Saved!`;
     setAiOrbState('speaking');
     setAivState('speaking');
     setAivCaption(summaryLine + " — Saved!");
     if (stateTextEl) { stateTextEl.textContent = "🔊 Saving entry..."; stateTextEl.style.color = "#a855f7"; }
     if (typeof submitQuickAdd === 'function') {
      submitQuickAdd();
     }
     speakText(`₹${fNum}, ${fParty || 'Self'}, ${fMeth || 'Cash'}, ${typeWord}. Saved.`, () => {
      setAiOrbState('idle');
      setAivState('idle');
      setAivCaption("Speak an entry or ask a question");
      if (stateTextEl) { stateTextEl.textContent = "Mic is off — tap to speak."; stateTextEl.style.color = "#888"; }
     });
     return;
    }
   }
  }

  // 6. Last resort: treat as question (Grok-style)
  try {
   aiMicProcessing = true;
   const grokAns = await answerVoiceLikeGrok(liveSpoken);
   aiMicProcessing = false;
   if (grokAns) {
    _speakAnswer(grokAns);
    return;
   }
  } catch(e) { aiMicProcessing = false; }

  setAiOrbState('idle');
  setAivState('idle');
  setAivCaption(`Suna: "${liveSpoken}" — Amount aur party saaf bolein`);
  if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak"; stateTextEl.style.color = "#888"; }
  if (statusEl) statusEl.textContent = `Suna: "${liveSpoken}"`;
  speakText("Samajh nahi aaya. Jaise bolein: 30 office expence ko cash se chai ke liye pay kiya.");
  return;
 }

 // If liveSpoken was empty -> check raw audio buffer fallback (for Safari iOS etc.)
 let totalLength = 0;
 for (let i = 0; i < aiPcmChunks.length; i++) {
  totalLength += aiPcmChunks[i].length;
 }

 if (totalLength < 3200 && !hasSpokenManual) {
  setAiOrbState('idle');
  setAivState('idle');
  setAivCaption("Kuch sunayi nahi diya. Mic dabakar dobara bolein.");
  if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak."; stateTextEl.style.color = "#888"; }
  if (statusEl) statusEl.textContent = "Kuch sunayi nahi diya. Mic dabakar dobara bolein.";
  return;
 }

 const mergedSamples = new Float32Array(totalLength);
 let offset = 0;
 for (let i = 0; i < aiPcmChunks.length; i++) {
  mergedSamples.set(aiPcmChunks[i], offset);
  offset += aiPcmChunks[i].length;
 }
 aiPcmChunks = [];

 const TARGET_RATE = 16000;
 let resampled = mergedSamples;
 if (srcRate !== TARGET_RATE && srcRate > 0) {
  const ratio = srcRate / TARGET_RATE;
  const targetLen = Math.round(totalLength / ratio);
  resampled = new Float32Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
   const srcPos = i * ratio;
   const srcIdx = Math.floor(srcPos);
   const frac = srcPos - srcIdx;
   const s0 = mergedSamples[srcIdx] || 0;
   const s1 = mergedSamples[srcIdx + 1] || s0;
   resampled[i] = s0 + frac * (s1 - s0);
  }
 }

 const wavBlob = _encodeWavDirect(resampled, TARGET_RATE);
 const base64Audio = await blobToBase64(wavBlob);

 setAiOrbState('thinking');
 setAivState('thinking');
 setAivCaption("Thinking...");
 if (stateTextEl) { stateTextEl.textContent = "✨ AI is thinking..."; stateTextEl.style.color = "#a855f7"; }
 if (statusEl) statusEl.textContent = "✨ AI is thinking...";
 aiMicProcessing = true;

 try {
  const result = await aiMicToEntry(base64Audio, 'audio/wav');
  aiMicProcessing = false;

  if (!document.getElementById('aiVoiceFullscreen')?.classList.contains('active')) {
   setAiOrbState('idle');
   setAivState('idle');
   return;
  }

  handleAiVoiceFinalResult(result, captionEl, statusEl, stateTextEl);
 } catch (err) {
  aiMicProcessing = false;
  if (err && err.name === 'AbortError') {
   setAiOrbState('idle');
   setAivState('idle');
   return;
  }
  console.error("AI voice error:", err);
  setAiOrbState('idle');
  setAivState('idle');

  const errMsg = (err && err.message) ? err.message : String(err || '');

  if (errMsg.startsWith("INVALID_KEY") || /API_KEY_INVALID|api key not valid/i.test(errMsg)) {
   const errText = "⚠️ Invalid API Key. Profile > AI Settings me new key dalein.";
   setAivCaption(errText);
   if (statusEl) statusEl.textContent = errText;
   setTimeout(() => { openAiSettingsModal(); }, 700);
   speakText("API Key is invalid. Please update it in Profile > AI Settings.");
  } else if (errMsg.startsWith("QUOTA_EXHAUSTED") || /quota|exceeded|rate limit/i.test(errMsg)) {
   const errText = "AI quota limit reached. Please try again in 1-2 minutes.";
   setAivCaption(errText);
   if (statusEl) statusEl.textContent = errText;
   speakText("AI quota limit reached. Please try speaking again in a moment.");
  } else {
   const errText = "⚠️ " + (errMsg || "Could not understand voice");
   setAivCaption(errText);
   if (statusEl) statusEl.textContent = errText;
   speakText("Could not understand. Please try speaking again.");
  }
 }
}

function closeQuickAdd(){
 // Sabse pehle overlay hi hata do — agar niche kisi cleanup line me error
 // aa bhi jaye, to bhi "X" click karte hi screen turant band ho jaayegi.
 // (Pehle ye sabse last me tha, isliye ek chhoti si error aane par overlay
 // kabhi band hi nahi hota tha — "X" dummy jaisa lagta tha.)
 try { document.getElementById('aiVoiceFullscreen')?.classList.remove('active'); } catch(e){}
 try { aiMicKeepListening = false; } catch(e){} // taaki koi pending speak/callback dobara mic start na kare
 try { document.getElementById("quickAddModal")?.classList.remove("active"); } catch(e){}
 try { qaUserStopped = true; } catch(e){}
 try { if (typeof stopAiMicRecording === 'function') { stopAiMicRecording(false); } } catch(e){}
 // Cross (X) button: mic band, AI ka chal raha request cancel, aur agar
 // AI kuch bol raha tha to wo bhi turant chup — taaki band karne ke baad
 // screen ke peeche kuch bhi (jawaab ya awaaz) chalta na rahe.
 try { if (aiMicAbortController) { aiMicAbortController.abort(); aiMicAbortController = null; } } catch(e){}
 try { if (typeof window !== 'undefined' && 'speechSynthesis' in window) { window.speechSynthesis.cancel(); } } catch(e){}
 try { setAiOrbState && setAiOrbState('idle'); } catch(e){}
 try { setAivState && setAivState('idle'); } catch(e){}
 try { if (aivResultSyncTimer) { clearInterval(aivResultSyncTimer); aivResultSyncTimer = null; } } catch(e){}
}

// "DD-MM-YY" ya "DD-MM-YYYY" -> "YYYY-MM-DD". Agar date na di ho ya galat
// format ho, aaj ki date use hoti hai.
function quickAddParseDate(d){
 if (!d) return getLocalDateStr();
 const s = String(d).trim();
 if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
 const parts = s.split(/[-\/]/);
 if (parts.length !== 3) return getLocalDateStr();
 if (parts[0].length === 4) {
  const [yy, mm, dd] = parts;
  if (!dd || !mm || !yy || isNaN(dd) || isNaN(mm) || isNaN(yy)) return getLocalDateStr();
  return `${yy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
 }
 let [dd, mm, yy] = parts;
 if (yy.length === 2) yy = "20" + yy;
 if (!dd || !mm || !yy || isNaN(dd) || isNaN(mm) || isNaN(yy)) return getLocalDateStr();
 return `${yy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
}

// Simple edit-distance (Levenshtein) — batata hai do naam kitne "close" hain,
// taaki "mami" jaisa typo bhi "mummy" se match ho jaye (sirf substring wale
// match se nahi hota tha).
function levenshtein(a, b){
 const m = a.length, n = b.length;
 const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
 for (let i=0;i<=m;i++) dp[i][0]=i;
 for (let j=0;j<=n;j++) dp[0][j]=j;
 for (let i=1;i<=m;i++){
  for (let j=1;j<=n;j++){
   dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
 }
 return dp[m][n];
}

// Aadha/partial/thoda-galat party naam type karne par, existing party list
// me se poora naam dhoondh ke match karta hai (exact -> starts-with ->
// contains -> closest-spelling). Koi bhi naya party YAHAN SE kabhi create
// NAHI hota — agar list me koi bhi bharosemand match nahi milta, to null
// return hota hai aur entry save nahi hoti.
// Hindi / Hinglish spoken words → English keywords for party matching
const VOICE_PARTY_ALIASES = {
  'ऑफिस': 'office', 'आफिस': 'office', 'office': 'office', 'ofis': 'office',
  'खुद': 'self', 'स्वयं': 'self', 'self': 'self',
  'घर': 'ghar', 'ghar': 'ghar', 'home': 'ghar',
  'मम्मी': 'mammi', 'ममी': 'mammi', 'mummy': 'mammi', 'mom': 'mammi',
  'पगार': 'salary', 'सैलरी': 'salary', 'salary': 'salary',
  'दवा': 'medicine', 'मेडिसिन': 'medicine', 'medicine': 'medicine',
  'खाना': 'food', 'फूड': 'food', 'food': 'food',
  'ऑटो': 'auto', 'auto': 'auto',
  'डॉक्टर': 'doctor', 'doctor': 'doctor'
};

function matchPartyName(input){
 if (!input) return null;
 const sel = document.getElementById("partySel");
 const fromSel = sel ? Array.from(sel.options).map(o => o.value).filter(v => v) : [];
 const fromAll = (typeof getAllPartyNames === 'function') ? getAllPartyNames() : [];
 const names = Array.from(new Set([...fromSel, ...fromAll])).filter(Boolean);
 if (names.length === 0) return null;

 let lower = input.trim().toLowerCase();
 // Map Hindi/alias to English keyword then search
 if (VOICE_PARTY_ALIASES[lower]) lower = VOICE_PARTY_ALIASES[lower];
 // also try raw input as key
 if (VOICE_PARTY_ALIASES[input.trim()]) lower = VOICE_PARTY_ALIASES[input.trim()];

 let match = names.find(n => n.toLowerCase() === lower);
 if (match) return match;
 match = names.find(n => n.toLowerCase().startsWith(lower) || lower.startsWith(n.toLowerCase()));
 if (match) return match;
 match = names.find(n => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase().split(/\s+/)[0]));
 if (match) return match;

 // Closest-spelling match (handles typos/phonetic variants like mami/mummy)
 let best = null, bestDist = Infinity;
 names.forEach(n => {
  const d = levenshtein(lower, n.toLowerCase());
  if (d < bestDist) { bestDist = d; best = n; }
 });
 const longer = Math.max(lower.length, best ? best.length : 0);
 const threshold = Math.min(3, Math.ceil(longer * 0.5));
 if (best && bestDist <= threshold) return best;

 return null;
}

/**
 * Voice/AI entry rule: NEVER create a new party name.
 * Only use existing parties. Unmatched text goes into notes; party = Self.
 * Returns { party, notesExtra }
 */
function resolveVoiceParty(rawParty, existingNotes){
 const notes = (existingNotes || '').trim();
 const raw = (rawParty || '').trim();
 if (!raw || /^(self|income|khud|personal|cash|bank|upi|null|undefined|nakad|नकद)$/i.test(raw)) {
  return { party: 'Self', notesExtra: notes };
 }
 let matched = null;
 if (typeof matchOfficialParty === 'function') matched = matchOfficialParty(raw);
 if (!matched && typeof matchPartyName === 'function') matched = matchPartyName(raw);
 if (!matched && typeof matchOfficialParty === 'function') matched = matchOfficialParty(notes || '');
 if (!matched && typeof matchPartyName === 'function') matched = matchPartyName(notes || '');
 if (matched) {
  // Don't duplicate party name into notes
  let n = notes;
  if (n && n.toLowerCase() === matched.toLowerCase()) n = '';
  if (n && n.toLowerCase() === raw.toLowerCase()) n = '';
  return { party: matched, notesExtra: n };
 }
 // No match → Self + put spoken name into notes
 const extra = notes
   ? (notes.toLowerCase().includes(raw.toLowerCase()) ? notes : (raw + ' — ' + notes))
   : raw;
 return { party: 'Self', notesExtra: extra };
}


async function submitQuickAdd(){
 const line = document.getElementById("qaLine").value.trim();
 if (!line) { showNotification("Please enter transaction details", "warning"); return; }

 // Format: amount,party,date,method,notes  (date/method/notes optional)
 const parts = line.split(",").map(s => s.trim());
 const amt = parseFloat(parts[0] || 0);
 const typedParty = (parts[1] || "").trim();
 const method = normalizeVoiceMethod(parts[3]) || parts[3] || "Cash";
 let notes = parts.slice(4).join(",").trim();
 // NEVER auto-create new party from voice/quick-add — only existing names
 const resolved = (typeof resolveVoiceParty === 'function')
  ? resolveVoiceParty(typedParty, notes)
  : { party: (matchPartyName(typedParty) || 'Self'), notesExtra: notes };
 const party = resolved.party || (quickAddVoiceType === 'income' ? 'Income' : 'Self');
 notes = resolved.notesExtra || notes;

 if (!amt) { showNotification("Please enter a valid amount", "warning"); return; }
 if (!party) { showNotification("Please enter a party name", "warning"); return; }


 const nowIso = new Date().toISOString();
 const entryData = {
  id: generateEntryId(),
  party: party,
  method: method,
  amount: amt,
  type: quickAddVoiceType || entryType,
  date: quickAddParseDate(parts[2]),
  time: new Date().toLocaleTimeString("en-IN", {hour:'2-digit', minute:'2-digit'}),
  notes: notes,
  timestamp: nowIso,
  updatedAt: nowIso,
  syncedWithCloud: false,
  image: null,
  userId: (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null
 };

 entries.unshift(entryData);
 persistAllEntries('submitQuickAdd');
 // Keep any Goal whose name matches this Party Name in sync
 if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();

 renderWallet();
 renderEntries();
 renderAnalytics();
 if (typeof showMiniSaveToast === 'function') showMiniSaveToast('synced');
 if (typeof renderList === "function") renderList();

 closeQuickAdd();

 if (typeof queueOfflineSync === 'function') queueOfflineSync('set', entryData);
 if (firebaseReady && db) {
  db.collection('entries').doc(entryData.id).set(entryData)
   .catch(err => console.warn('Firebase save failed (kept locally):', err));
 }
}

// ===== Long-press on the existing + nav button opens Quick Add popup =====
// Short tap keeps its original behavior (goTo('add')) — nothing new added,
// this only listens on the same button that was already there.
(function(){
 const btn = document.getElementById('navPlusBtn');
 if (!btn) return;
 let pressTimer = null;
 let isLongPress = false;
 let touchFired = false; // BUGFIX: real touch devices fire BOTH touchstart
 // and a synthetic mousedown for the same physical press. Previously both
 // were wired to start(), which created TWO separate 500ms timers — both
 // firing openQuickAdd(), which started TWO overlapping SpeechRecognition
 // sessions. Chrome refuses a 2nd concurrent session with "not-allowed",
 // even though mic permission was actually granted. Ignoring the mousedown
 // that immediately follows a touchstart fixes this.

 function start(e){
  if (e.type === 'mousedown' && touchFired) { touchFired = false; return; }
  if (e.type === 'touchstart') touchFired = true;
  clearTimeout(pressTimer);
  isLongPress = false;
  pressTimer = setTimeout(() => {
   isLongPress = true;
   if (navigator.vibrate) navigator.vibrate(15);
   openQuickAdd();
  }, 500);
 }
 function cancel(){ clearTimeout(pressTimer); }

 btn.addEventListener('mousedown', start);
 btn.addEventListener('touchstart', start, {passive:true});
 btn.addEventListener('mouseup', cancel);
 btn.addEventListener('mouseleave', cancel);
 btn.addEventListener('touchend', cancel);

 // Block the normal goTo('add') click when this was actually a long-press
 btn.addEventListener('click', function(e){
  if (isLongPress) { e.preventDefault(); e.stopImmediatePropagation(); isLongPress = false; }
 }, true);
})();

// ===== EDIT FUNCTIONS =====

function openEditModal(entryId) {
 // Find entry — match both string and numeric IDs
 const entry = entries.find(e => String(e.id) === String(entryId));
 if (!entry) { showNotification('Entry not found', 'error'); return; }

 editingEntryId = entry.id;
 editEntryType = entry.type === 'income' ? 'income' : 'expense';

 document.getElementById("modalTitle").textContent = "Edit Entry";
 const partySel = document.getElementById("editPartySel");
 const partyName = entry.party || "Self";
 if (partySel) {
  // ensure party option exists in dropdown
  const exists = Array.from(partySel.options).some(o => o.value === partyName || o.text === partyName);
  if (!exists && partyName) {
   const opt = document.createElement('option');
   opt.value = partyName;
   opt.textContent = partyName;
   partySel.appendChild(opt);
  }
  partySel.value = partyName;
 }
 document.getElementById("editAmountInput").value = entry.amount || "";
 document.getElementById("editDateInput").value = entry.date;
 document.getElementById("editNotesInput").value = entry.notes || "";

 // keep hidden return-no element in sync (if present) for any legacy code
 const retEl = document.getElementById("editReturnNo");
 if (retEl) {
   const idStr = String(entry.id || "").replace(/\D/g, "");
   const tail = (idStr.slice(-6) || Math.floor(Math.random()*900000+100000).toString()).padStart(6, "0");
   retEl.textContent = "RF-" + tail;
 }


 // Party name + icon (same as app)
 const partyDisp = document.getElementById("editPartyDisplay");
 if (partyDisp) partyDisp.textContent = partyName;

 const iconEl = document.getElementById("editPartyIcon");
 if (iconEl) {
   if (typeof getPartyIcon === "function") {
     iconEl.innerHTML = getPartyIcon(partyName);
   } else {
     iconEl.innerHTML = '<i class="ti ti-building-store"></i>';
   }
 }
 const catEl = document.getElementById("editPartyCat");
 if (catEl) catEl.textContent = "General";

 // Type buttons — Receive green / Payment beige when active
 const expBtn = document.getElementById("editExpenseBtn");
 const incBtn = document.getElementById("editIncomeBtn");
 if (expBtn) expBtn.classList.toggle("active", editEntryType === "expense");
 if (incBtn) incBtn.classList.toggle("active", editEntryType === "income");

 document.getElementById("editModal").classList.add("active");
}

// Share current edit entry in receipt text form
async function shareEditEntry() {
  try {
    const party = document.getElementById("editPartySel")?.value || document.getElementById("editPartyDisplay")?.textContent || "Party";

    const amount = document.getElementById("editAmountInput")?.value || "0";
    const date = document.getElementById("editDateInput")?.value || "";
    const notes = document.getElementById("editNotesInput")?.value || "";
    const type = editEntryType === "income" ? "Receive" : "Payment";
    const text = `🧾 Entry Receipt\n\nParty: ${party}\nType: ${type}\nAmount: ₹ ${amount}\nDate: ${date}\nNotes: ${notes || "-"}\n\n— Shared from Ex=Tracker`;
    if (navigator.share) {
      await navigator.share({ title: "Expense Entry", text });
    } else {
      await navigator.clipboard.writeText(text);
      if (typeof showNotification === "function") showNotification("Receipt copied to clipboard", "success");
      else alert("Copied to clipboard");
    }
  } catch (e) {
    console.warn("Share failed", e);
  }
}

function closeEditModal() {
 document.getElementById("editModal").classList.remove("active");
 editingEntryId = null;
}

let updateEntryInProgress = false;
function updateEntry() {
 // Guard: ignore extra clicks while a save is already being processed
 if (updateEntryInProgress) return;

 const entry = entries.find(e => String(e.id) === String(editingEntryId));
 if (!entry) { showNotification('Entry not found!', 'error'); return; }

 const party = document.getElementById("editPartySel").value;
 const amount = parseFloat(document.getElementById("editAmountInput").value || 0);
 const date = document.getElementById("editDateInput").value;
 const notes = document.getElementById("editNotesInput").value;
 const type = editEntryType;

 if (!party) { showNotification("Please select a party", "warning"); return; }
 if (!amount) { showNotification("Enter amount", "warning"); return; }

 updateEntryInProgress = true;

 const nowIso = new Date().toISOString();
 const updatedData = {
  ...entry,
  id: entry.id,
  party: party,
  method: entry.method || 'Cash',
  amount: amount,
  type: type,
  date: date,
  time: entry.time || new Date().toLocaleTimeString("en-IN"),
  notes: notes,
  timestamp: entry.timestamp || nowIso,
  updatedAt: nowIso,
  syncedWithCloud: false,
  userId: entry.userId || (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null
 };

 // Update in memory
 const idx = entries.findIndex(e => String(e.id) === String(editingEntryId));
 if (idx > -1) entries[idx] = updatedData;

 // Save to localStorage
 localStorage.setItem('entries', JSON.stringify(entries));

 // Keep any linked Goal in sync with the (possibly changed) party name / amount / type
 if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();

 // Update UI immediately — don't make the user wait on the network
 closeEditModal();
 renderWallet();
 renderEntries();
 renderAnalytics();
 showNotification('Entry updated successfully', 'success', 'Your income or expense entry has been recorded.');
 updateEntryInProgress = false;

 // Queue offline sync so changes are never lost if offline or app reloads
 if (typeof queueOfflineSync === 'function') queueOfflineSync('set', updatedData);

 // Sync to Firebase in the background (non-blocking, fire-and-forget)
 if (firebaseReady && db) {
  db.collection('entries').doc(String(entry.id)).set(updatedData, { merge: true })
   .then(() => {
    updatedData.syncedWithCloud = true;
    const curIdx = entries.findIndex(e => String(e.id) === String(entry.id));
    if (curIdx > -1) {
     entries[curIdx].syncedWithCloud = true;
     localStorage.setItem('entries', JSON.stringify(entries));
    }
   })
   .catch(err => console.warn('Firebase update queued offline:', err));
 }
}

// ===== EDIT MODAL HELPERS =====

function setEditEntryType(t){
 editEntryType = t;
 const expBtn = document.getElementById("editExpenseBtn");
 const incBtn = document.getElementById("editIncomeBtn");
 if (expBtn) expBtn.classList.toggle("active", t==="expense");
 if (incBtn) incBtn.classList.toggle("active", t==="income");
}

function onEditPartyChange(){
 const sel = document.getElementById('editPartySel');
 const disp = document.getElementById('editPartyDisplay');
 if (sel && disp) disp.textContent = sel.value || '—';
}


async function deleteEntry(){
 if (!(await confirmAppAction('Delete entry?', 'Yeh entry delete ho jayegi. Recover history se wapas la sakte ho.', { danger: true, confirmText: 'Delete', icon: 'ti-trash' }))) return;

 const entry = entries.find(e => String(e.id) === String(editingEntryId));
 if (!entry) { showNotification('Entry not found', 'error'); return; }

 const entryId = String(entry.id);

 // Save to deleted history before removing
 saveToDeletedHistory(entry);

 // Track tombstone so cloud sync NEVER resurrects this entry
 trackDeletedEntryId(entryId);

 // INSTANT: Remove from memory and UI immediately (explicit user action only)
 entries = entries.filter(e => String(e.id) !== entryId);
 if (typeof persistAllEntries === 'function') persistAllEntries('user_delete');
 else localStorage.setItem('entries', JSON.stringify(entries));
 // Keep any linked Goal in sync now that this entry is gone
 if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();

 closeEditModal();
 renderWallet();
 renderEntries();
 renderAnalytics();
 if (typeof renderList === 'function') renderList(); // keep Goals tab live
 showNotification('Entry deleted ✓', 'success');

 // BACKGROUND: Queue offline delete + try cloud (isolated + legacy)
 if (typeof queueOfflineSync === 'function') queueOfflineSync('delete', entryId);
 if (firebaseReady && db) {
  setTimeout(async () => {
   try {
    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || localStorage.getItem('currentUserUid');
    const userCol = (typeof getUserEntriesCollection === 'function') ? getUserEntriesCollection(uid) : null;
    if (userCol) await userCol.doc(entryId).delete().catch(() => {});
    await db.collection("entries").doc(entryId).delete().catch(() => {});
    console.log('✓ Entry deleted from Firebase:', entryId);
   } catch(err) { console.warn('Firebase delete queued offline:', err); }
  }, 50);
 }
}


// ===== ANALYTICS FUNCTIONS =====

function setAnalyticsType(t){
 analyticsType = t;
 document.getElementById("anExpenseBtn").classList.toggle("active", t==="expense");
 document.getElementById("anIncomeBtn").classList.toggle("active", t==="income");
 document.getElementById("overviewTitle").textContent = t==="expense" ? "Payment Overview" : "Receive Overview";
 const trendTitleEl = document.getElementById("trendTitle");
 if (trendTitleEl) trendTitleEl.textContent = t==="expense" ? "Payment Trend" : "Receive Trend";
 renderCharts();
 renderTopCats();
}

function renderCharts(){
 if (typeof Chart === 'undefined') {
  // Chart.js not loaded yet — load it then retry
  if (!window.__chartjsLoading) {
   window.__chartjsLoading = true;
   const s = document.createElement('script');
   s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
   s.onload = () => { window.__chartjsLoading = false; renderCharts(); };
   document.head.appendChild(s);
  }
  return;
 }
 const { total, catArr, trendLabels, trendData, methodTotals } = calculateAnalytics(analyticsType);
 document.getElementById("overviewAmt").textContent = "₹ " + total.toLocaleString("en-IN");

 const ctx = document.getElementById("donutChart");
 if(donutChartObj) donutChartObj.destroy();
 if(typeof Chart === 'undefined') return;

 if(!ctx){
 // Canvas was removed by a previous "no data" render — nothing to draw into, skip safely.
 } else if(catArr.length===0){
 ctx.parentElement.innerHTML = '<canvas id="donutChart"></canvas><div class="legend" id="donutLegend"></div><div class="empty-state" style="width:100%;padding:20px 0;"><i class="ti ti-chart-donut-3"></i><br>i</div>';
 } else {
 donutChartObj = new Chart(ctx, {
 type:"doughnut",
 data:{ labels:catArr.map(d=>d.name), datasets:[{ data:catArr.map(d=>d.pct), backgroundColor:catArr.map(d=>d.color), borderWidth:0 }] },
 options:{
 cutout:"68%",
 plugins:{ legend:{display:false}, tooltip:{enabled:true} },
 onClick:(evt, elements)=>{
 if(elements.length){
 const idx = elements[0].index;
 openPartyDetail(catArr[idx].name);
 }
 },
 onHover:(evt, elements)=>{ evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
 }
 });
 document.getElementById("donutLegend").innerHTML = catArr.map(d=>`
 <div class="legend-item" style="cursor:pointer;" onclick="openPartyDetail('${d.name.replace(/'/g,"\\'")}')"><span class="legend-dot" style="background:${d.color}"></span>
 <span class="pct">${d.pct}%</span><span class="lname">${d.name}</span></div>`).join("");
 }

 const tctx = document.getElementById("trendChart");
 if(trendChartObj) trendChartObj.destroy();
 const chartMuted = isLightMode() ? "#6b7280" : "#8b9099";
 const chartGrid = isLightMode() ? "#e2e8f2" : "#1f2430";
 // Column chart — har bar ka apna alag color (reference image jaisa:
 // blue/green/orange/pink cycle), taaki Payment/Receive Trend visually
 // ek colorful column graph lage, line-graph nahi.
 const TREND_BAR_COLORS = ["#4c9be8", "#8ce84c", "#e8964c", "#e84c8c", "#a855f7", "#4ce8c9"];
 const trendBarColors = trendLabels.map((_, i) => TREND_BAR_COLORS[i % TREND_BAR_COLORS.length]);
 trendChartObj = new Chart(tctx, {
 type:"bar",
 data:{
 labels: trendLabels,
 datasets:[{
 data: trendData,
 backgroundColor: trendBarColors,
 borderRadius:6,
 borderSkipped:false,
 maxBarThickness:36
 }]
 },
 options:{
 plugins:{legend:{display:false}},
 scales:{
 x:{ ticks:{color:chartMuted, font:{size:10}}, grid:{display:false} },
 y:{ ticks:{color:chartMuted, font:{size:10}}, grid:{color:chartGrid}, beginAtZero:true }
 }
 }
 });
 // (Payment/Receive Method bar chart removed from here — it now lives as a
 // list-style widget on the Wallet/home screen instead, see renderPaymentMethodWidget()).
}

function renderTopCats(){
 const { catArr } = calculateAnalytics(analyticsType);
 const list = catArr.slice(0,3);
 if(list.length===0){
 document.getElementById("topCatList").innerHTML = '<div class="empty-state" style="padding:10px 0;">No category data</div>';
 return;
 }
 document.getElementById("topCatList").innerHTML = list.map(c=>`
 <div class="top-cat-row" style="cursor:pointer;" onclick="openPartyDetail('${c.name.replace(/'/g,"\\'")}')">
 <div class="tcr-head">
 <div class="n"><span style="margin-right:4px;">${c.icon}</span> ${c.name}</div>
 <div>₹${c.amt.toLocaleString("en-IN")}</div>
 </div>
 <div class="tcr-bar-bg"><div class="tcr-bar-fill" style="width:${c.pct}%;background:${c.color};"></div></div>
 </div>`).join("");
}

function showAllCategories(){
 const { catArr, total } = calculateAnalytics(analyticsType);
 const body = catArr.length===0 ? '<div class="empty-state">No data</div>' : catArr.map(c=>`
 <div class="top-cat-row" style="cursor:pointer;" onclick="openPartyDetail('${c.name.replace(/'/g,"\\'")}')">
 <div class="tcr-head">
 <div class="n"><span style="margin-right:4px;">${c.icon}</span> ${c.name}</div>
 <div>₹${c.amt.toLocaleString("en-IN")} (${c.pct}%)</div>
 </div>
 <div class="tcr-bar-bg"><div class="tcr-bar-fill" style="width:${c.pct}%;background:${c.color};"></div></div>
 </div>`).join("");
 document.getElementById("allCatModalBody").innerHTML = body;
 document.getElementById("allCatModalTitle").textContent =
 (analyticsType==="expense"?"All Payment Categories":"All Receive Categories") + " — ₹"+total.toLocaleString("en-IN");
 document.getElementById("allCatModal").classList.add("active");
}
function closeAllCatModal(){
 document.getElementById("allCatModal").classList.remove("active");
}

// ===== PARTY DETAIL (click on pie chart / legend / top party) =====
let currentPartyDetailName = null;
let currentPartyDetailEntries = [];
function openPartyDetail(partyName){
 const curMonth = selectedAnalyticsMonth;
 const curYear = selectedAnalyticsYear;
 const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
 const currentMonthLabel = (monthNames[curMonth] || '') + " " + curYear;

 const partyEntries = (entries || []).filter(e => {
  if ((e.party || 'Unknown') !== partyName) return false;
  let d = new Date(e.date);
  if (isNaN(d.getTime())) d = new Date(e.timestamp || 0);
  return !isNaN(d.getTime()) && d.getFullYear() === curYear && d.getMonth() === curMonth;
 });

 let totalIncome = 0, totalExpense = 0;
 partyEntries.forEach(e=>{
  if(e.type==='income') totalIncome += Number(e.amount||0);
  else if(e.type==='expense') totalExpense += Number(e.amount||0);
 });

 const sorted = [...partyEntries].sort((a,b)=> new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
 currentPartyDetailName = partyName;
 currentPartyDetailEntries = sorted;

 document.getElementById("partyDetailTitle").textContent = `${partyName} (${currentMonthLabel})`;
 document.getElementById("partyDetailSummary").innerHTML = `
 <div style="display:flex;gap:10px;margin-bottom:14px;">
 <div style="flex:1;background:#1f2430;border-radius:10px;padding:10px;text-align:center;">
 <div style="font-size:11px;color:#8b9099;">Total Receive (${monthNames[curMonth]?.slice(0,3) || ''})</div>
 <div style="font-size:16px;font-weight:700;color:#3ddc84;">₹${totalIncome.toLocaleString("en-IN")}</div>
 </div>
 <div style="flex:1;background:#1f2430;border-radius:10px;padding:10px;text-align:center;">
 <div style="font-size:11px;color:#8b9099;">Total Payment (${monthNames[curMonth]?.slice(0,3) || ''})</div>
 <div style="font-size:16px;font-weight:700;color:#f06464;">₹${totalExpense.toLocaleString("en-IN")}</div>
 </div>
 </div>`;

 document.getElementById("partyDetailBody").innerHTML = sorted.length===0
 ? '<div class="empty-state" style="padding:10px 0;">No entries in this month</div>'
 : sorted.map(e=>txnRowHTML(e,false)).join("");

 document.getElementById("partyDetailModal").classList.add("active");
}
function closePartyDetailModal(){
 document.getElementById("partyDetailModal").classList.remove("active");
}

// ===== WhatsApp party-wise summary share =====
function sharePartySummaryOnWhatsApp(){
 if (!currentPartyDetailName) return;
 const curMonth = selectedAnalyticsMonth;
 const curYear = selectedAnalyticsYear;
 const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
 const currentMonthLabel = (monthNames[curMonth] || '') + " " + curYear;

 let totalIncome = 0, totalExpense = 0;
 currentPartyDetailEntries.forEach(e=>{
  if(e.type==='income') totalIncome += Number(e.amount||0);
  else if(e.type==='expense') totalExpense += Number(e.amount||0);
 });

 let text = `📋 ${currentPartyDetailName} — Summary (${currentMonthLabel})\n\n`;
 currentPartyDetailEntries.slice(0, 25).forEach(e => {
  const sign = e.type === 'income' ? '+' : '-';
  text += `${e.date}  ${sign}₹${Number(e.amount||0).toLocaleString("en-IN")}  ${e.notes || ''}\n`;
 });
 if (currentPartyDetailEntries.length > 25) text += `...and ${currentPartyDetailEntries.length - 25} more\n`;
 text += `\nTotal Receive: ₹${totalIncome.toLocaleString("en-IN")}`;
 text += `\nTotal Payment: ₹${totalExpense.toLocaleString("en-IN")}`;

 window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
}

// ===== FILTER FUNCTIONS =====


function toggleEntriesFilterMenu(){
  const m = document.getElementById('entriesFilterMenu');
  if (!m) return;
  m.style.display = (m.style.display === 'none' || !m.style.display) ? 'flex' : 'none';
}
function closeEntriesFilterMenu(){
  const m = document.getElementById('entriesFilterMenu');
  if (m) m.style.display = 'none';
}
document.addEventListener('click', function(e){
  const wrap = document.querySelector('.entries-filter-wrap');
  if (wrap && !wrap.contains(e.target)) closeEntriesFilterMenu();
});

function setEntryFilter(f){
 if (f === 'payment' || f === 'paid') f = 'expense';
 if (f === 'receive' || f === 'received') f = 'income';
 currentFilter = f || 'all';

 const filterMap = [
  { key: 'all', id: 'filterAll' },
  { key: 'expense', id: 'filterExpense' },
  { key: 'income', id: 'filterIncome' },
  { key: 'transfer', id: 'filterTransfer' }
 ];

 filterMap.forEach(item => {
  const el = document.getElementById(item.id);
  if (el) {
   el.classList.toggle("active", item.key === currentFilter);
  }
 });
 // Keep old dropdown label in sync if it still exists
 const lab = document.getElementById('entriesFilterLabel');
 if (lab) {
  lab.textContent = currentFilter === 'expense' ? 'Payment' : currentFilter === 'income' ? 'Received' : 'All';
 }

 renderEntries();
}


// ===== SEARCH =====
function toggleSearchBox(){
 if (typeof toggleEntriesSearchBar === 'function') {
  toggleEntriesSearchBar();
 }
}

// ===== FILTER & EXPORT MODAL =====
let exportFilterType = "all";
function openFilterModal(){ document.getElementById("filterModal").classList.add("active"); }
function closeFilterModal(){ document.getElementById("filterModal").classList.remove("active"); }
function setExportFilter(type, btn){
 exportFilterType = type;
 document.querySelectorAll(".exp-filter-opt").forEach(b=>b.classList.remove("active"));
 btn.classList.add("active");
}
function getExportList(){

 let list = entries.slice();

 if(currentFilter !== 'all'){
  list = list.filter(e => e.type === currentFilter);
 }

 const search =
  document.getElementById('searchInput')
  .value
  .toLowerCase()
  .trim();

 if(search){

  list = list.filter(e =>
   (e.party || '').toLowerCase().includes(search) ||
   (e.method || '').toLowerCase().includes(search) ||
   (e.notes || '').toLowerCase().includes(search)
  );

 }

 if(dateRangeFilter){
  list = list.filter(e=>{
   const d = normalizeDate(e.date);
   return d >= dateRangeFilter.from && d <= dateRangeFilter.to;
  });
 }

 if(exportFilterType !== 'all'){
  list = list.filter(e => e.type === exportFilterType);
 }

 return list;
}
function formatDate(date) {
 if (!date) return '';
 const dStr = typeof normalizeDate === 'function' ? normalizeDate(date) : String(date);
 if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dStr)) {
  const parts = dStr.split('-');
  const y = parts[0];
  const m = parts[1].padStart(2, '0');
  const d = parts[2].padStart(2, '0');
  return `${d}/${m}/${y}`;
 }
 return String(date);
}

function exportToExcel(){
 try {
  // Lazy-load xlsx only when needed
  if (typeof XLSX === 'undefined') {
   showNotification('Loading Excel library...', 'info');
   const s = document.createElement('script');
   s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
   s.onload = () => {
     showNotification('Generating Excel...', 'info');
     exportToExcel();
   };
   s.onerror = () => showNotification("Excel library could not be loaded. Please check internet.", "error");
   document.head.appendChild(s);
   return;
  }
  showNotification('Generating Excel file...', 'info');
  const list = getExportList();
  if(!list || list.length === 0){ showNotification("There are no entries to export", "error"); return; }
  
  // Get party name from first entry or use "ALL PARTIES"
  const partyName = list.length > 0 && list[0].party ? list[0].party : "ALL PARTIES";
  
  // Calculate totals
  let totalDebit = 0, totalCredit = 0;
  list.forEach(e => {
   if(e.type === 'expense') totalDebit += parseFloat(e.amount) || 0;
   else totalCredit += parseFloat(e.amount) || 0;
  });
  
  // Create rows with proper format (PDF-style header)
  const todayStr = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : new Date().toISOString().slice(0,10);
  const headerRows = [
   ['WALLET STATEMENT'],
   ['Party: ' + partyName + '  |  Date: ' + todayStr],
   [''],
   ['No.', 'Date', 'Party Name', 'Debit (Expense)', 'Credit (Income)', 'Method', 'Note']
  ];

  const sortedList = list.slice().sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)));
  const dataRows = sortedList.map((e, idx) => [
   idx + 1,
   formatDate(e.date),
   e.party || 'N/A',
   e.type === 'expense' ? (parseFloat(e.amount) || 0) : '',
   e.type === 'income' ? (parseFloat(e.amount) || 0) : '',
   e.method || 'Cash',
   e.notes || ''
  ]);
  
  // Add totals — aligned under Debit / Credit like PDF
  const netBal = totalCredit - totalDebit;
  const totalRows = [
   [],
   [
     'TOTAL',                                    // No.
     '',                                         // Date
     '',                                         // Party Name
     totalDebit,                                 // Debit total (under Debit col)
     totalCredit,                                // Credit total (under Credit col)
     'NET BALANCE',                              // Method col label
     (netBal < 0 ? '- Rs. ' : 'Rs. ') + Math.abs(netBal)  // Note col = net amount
   ]
  ];
  const allRows = [...headerRows, ...dataRows, ...totalRows];
  
  const ws = XLSX.utils.aoa_to_sheet(allRows);

  // Set column widths
  ws['!cols'] = [
   {wch: 8},   // No. / TOTAL
   {wch: 13},  // Date
   {wch: 22},  // Party Name
   {wch: 16},  // Debit (Expense)
   {wch: 16},  // Credit (Income)
   {wch: 14},  // Method / NET BALANCE
   {wch: 32}   // Note / Net amount
  ];

  // Apply number format to Debit & Credit columns for proper Excel display
  try {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let R = 4; R <= range.e.r; R++) {  // data starts after header rows
      for (const C of [3, 4]) {  // Debit col D (3), Credit col E (4)
        const cellRef = XLSX.utils.encode_cell({r: R, c: C});
        if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
          ws[cellRef].t = 'n';
          ws[cellRef].z = '#,##0.00';
        }
      }
    }
  } catch(fmtErr) { console.warn('Excel number format skip:', fmtErr); }
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Wallet Statement");
  
  const cleanParty = (partyName || 'Statement').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `WalletStatement_${cleanParty}_${Date.now()}.xlsx`;

  // Multi-platform safe download trigger (Blob URL + hidden anchor)
  try {
   const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
   const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
   const blobUrl = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = blobUrl;
   a.download = fileName;
   a.style.display = 'none';
   document.body.appendChild(a);
   a.click();
   setTimeout(() => {
    try { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); } catch(e){}
   }, 2000);
  } catch(blobErr) {
   XLSX.writeFile(wb, fileName);
  }

  showNotification("Excel exported! ✓", "success");
  closeFilterModal();
 } catch(err) {
  console.error('Excel export error:', err);
  showNotification('Excel Export error: ' + (err.message || err), 'error');
 }
}
async function exportToPDF(){
 try {
  // Ensure jsPDF + autotable are available
  let JsPdfClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || (typeof jspdf !== 'undefined' && (jspdf.jsPDF || jspdf));
  if (!JsPdfClass) {
   showNotification('Loading PDF library...', 'info');
   try {
     await new Promise((resolve, reject) => {
      const s1 = document.createElement('script');
      s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s1.onload = () => {
       const s2 = document.createElement('script');
       s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
       s2.onload = resolve;
       s2.onerror = reject;
       document.head.appendChild(s2);
      };
      s1.onerror = reject;
      document.head.appendChild(s1);
     });
   } catch (loadErr) {
     showNotification("PDF library could not be loaded. Please check internet.", "error");
     return;
   }
   JsPdfClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || (typeof jspdf !== 'undefined' && (jspdf.jsPDF || jspdf));
  }

  if (!JsPdfClass) {
   showNotification("PDF library could not be loaded. Please check internet.", "error");
   return;
  }

  showNotification('Generating PDF with background...', 'info');
  const list = getExportList();
  if(!list || list.length === 0){ showNotification("There are no entries to export", "error"); return; }
  
  const doc = new JsPdfClass({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  
  // Background fill (Cream) + Full-Bleed Mandala & Temple Artwork Background on Page 1
  doc.setFillColor(255, 252, 248);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  try {
   if (typeof PDF_BG_IMAGE !== 'undefined' && PDF_BG_IMAGE) {
    doc.addImage(PDF_BG_IMAGE, 'JPEG', 0, 0, pageWidth, pageHeight);
   }
  } catch(e) {}
  // Top accent bar
  doc.setFillColor(25, 102, 172);
  doc.rect(0, 0, pageWidth, 4, 'F');
  
  const partyName = list.length > 0 && list[0].party ? list[0].party : "ALL PARTIES";
  const todayFormatted = new Date().toLocaleDateString('en-IN', {day:'2-digit', month:'2-digit', year:'numeric'});
  const todayStr = (typeof getLocalDateStr === 'function') ? getLocalDateStr() : new Date().toISOString().slice(0,10);

  // Title + party line header (Left side only, leaving right side clear for temple logo)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(25, 102, 172);
  doc.text('WALLET STATEMENT', 14, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(60, 60, 60);
  doc.text('Party: ' + partyName + '  |  Date: ' + todayStr, 14, 23);
  doc.setDrawColor(200, 190, 170);
  doc.setLineWidth(0.4);
  doc.line(14, 28, 140, 28); // Stops at x=140 mm to leave temple logo completely unobstructed!

  const cleanText = (str) => {
   if (!str) return '';
   return String(str)
    .replace(/[^\x00-\x7F]/g, (c) => {
     const map = { '\u20B9': 'Rs', '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"' };
     return map[c] || '';
    })
    .trim();
  };

  const sortedList = list.slice().sort((a, b) => normalizeDate(a.date).localeCompare(normalizeDate(b.date)));
  const tableData = sortedList.map((e, idx) => [
    (idx + 1).toString(),
    formatDate(e.date),
    cleanText(e.party) || 'N/A',
    e.type === 'expense' ? Number(e.amount).toLocaleString('en-IN') : '',
    e.type === 'income' ? Number(e.amount).toLocaleString('en-IN') : '',
    cleanText(e.method) || 'Cash',
    cleanText(e.notes)
  ]); 
  
  let totalDebit = 0, totalCredit = 0;
  list.forEach(e => {
   if(e.type === 'expense') totalDebit += parseFloat(e.amount) || 0;
   else totalCredit += parseFloat(e.amount) || 0;
  });
  
  let endY = 42;
  const netBalance = totalCredit - totalDebit;

  if (typeof doc.autoTable === 'function') {
   doc.autoTable({
    startY: 42,
    head: [['No.', 'Date', 'Party Name', 'Debit', 'Credit', 'Method', 'Note']],
    body: tableData,
    styles: {
     font: 'helvetica',
     cellPadding: { top: 2.8, right: 2, bottom: 2.8, left: 2 },
     overflow: 'linebreak',
     valign: 'middle'
    },
    headStyles: {
     fillColor: [25, 102, 172],
     textColor: [255, 255, 255],
     fontStyle: 'bold',
     fontSize: 9.5,
     halign: 'center',
     valign: 'middle'
    },
    bodyStyles: {
     fontSize: 8.5,
     textColor: [30, 30, 30],
     fillColor: [255, 255, 255],
     lineColor: [220, 210, 190],
     lineWidth: 0.1
    },
    alternateRowStyles: {
     fillColor: [252, 248, 240]
    },
    columnStyles: {
     0: {halign: 'center', cellWidth: 10},
     1: {halign: 'left',   cellWidth: 22},
     2: {halign: 'left',   cellWidth: 32},
     3: {halign: 'right',  cellWidth: 24, textColor: [220, 38, 38]},
     4: {halign: 'right',  cellWidth: 24, textColor: [22, 163, 74]},
     5: {halign: 'left',   cellWidth: 20},
     6: {halign: 'left',   cellWidth: 50}
    },
    margin: {left: 14, right: 14, top: 42, bottom: 18},
    tableWidth: 182,
    showHead: 'everyPage',
    willDrawPage: function(data) {
     // Multi-page persistence: draw full-bleed Mandala & Temple background on pages 2+ BEFORE table is drawn!
     if (data.pageNumber > 1) {
      try {
       doc.setFillColor(255, 252, 248);
       doc.rect(0, 0, pageWidth, pageHeight, 'F');
       if (typeof PDF_BG_IMAGE !== 'undefined' && PDF_BG_IMAGE) {
        doc.addImage(PDF_BG_IMAGE, 'JPEG', 0, 0, pageWidth, pageHeight);
       }
       doc.setFillColor(25, 102, 172);
       doc.rect(0, 0, pageWidth, 4, 'F');
      } catch(e) {}
     }
    },
    didDrawPage: function(data) {
     try {
       if (data.pageNumber > 1) {
         doc.setFont('helvetica', 'bold');
         doc.setFontSize(13);
         doc.setTextColor(25, 102, 172);
         doc.text('WALLET STATEMENT (Contd.)', 14, 16);
         doc.setFont('helvetica', 'normal');
         doc.setFontSize(9);
         doc.setTextColor(70, 70, 70);
         doc.text('Party: ' + partyName + '  |  Date: ' + todayStr, 14, 23);
         doc.setDrawColor(200, 190, 170);
         doc.setLineWidth(0.3);
         doc.line(14, 28, 140, 28);
       }
     } catch(e) {}
     // Footer: Page number on right, Generated date on left (no overlap!)
     try {
       doc.setFont('helvetica', 'normal');
       doc.setFontSize(8);
       doc.setTextColor(110, 110, 110);
       doc.text('Generated on ' + todayFormatted, 14, pageHeight - 7);
       doc.text('Page ' + data.pageNumber, pageWidth - 14, pageHeight - 7, { align: 'right' });
     } catch(e) {}
    }
   });
   endY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 6 : 140;
  } else {
   // Fallback simple line printer
   let y = 46;
   doc.setFontSize(8.5);
   tableData.forEach(row => {
    doc.text(row.join(' | '), 14, y);
    y += 6;
    if (y > pageHeight - 25) {
      doc.addPage();
      try {
        doc.setFillColor(255, 252, 248);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        if (typeof PDF_BG_IMAGE !== 'undefined' && PDF_BG_IMAGE) {
          doc.addImage(PDF_BG_IMAGE, 'JPEG', 0, 0, pageWidth, pageHeight);
        }
        doc.setFillColor(25, 102, 172);
        doc.rect(0, 0, pageWidth, 4, 'F');
      } catch(e) {}
      y = 42;
    }
   });
   endY = y + 8;
  }

  // TOTALS — always on the LAST page, create new page only if not enough space
  let finalY = endY;
  if (finalY + 16 > pageHeight - 16) {
    doc.addPage();
    finalY = 42;
    try {
      doc.setFillColor(255, 252, 248);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
      if (typeof PDF_BG_IMAGE !== 'undefined' && PDF_BG_IMAGE) {
        doc.addImage(PDF_BG_IMAGE, 'JPEG', 0, 0, pageWidth, pageHeight);
      }
      doc.setFillColor(25, 102, 172);
      doc.rect(0, 0, pageWidth, 4, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(25, 102, 172);
      doc.text('WALLET STATEMENT (Contd.)', 14, 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(70, 70, 70);
      doc.text('Party: ' + partyName + '  |  Date: ' + todayStr, 14, 23);
      doc.setDrawColor(200, 190, 170);
      doc.setLineWidth(0.3);
      doc.line(14, 28, 140, 28);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(110, 110, 110);
      doc.text('Generated on ' + todayFormatted, 14, pageHeight - 7);
    } catch(e) {}
  }

  doc.setFillColor(245, 247, 250);
  doc.rect(14, finalY, pageWidth - 28, 12, 'F');
  doc.setDrawColor(25, 102, 172);
  doc.setLineWidth(0.4);
  doc.line(14, finalY, pageWidth - 14, finalY);
  doc.line(14, finalY + 12, pageWidth - 14, finalY + 12);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(20, 20, 20);
  doc.text('TOTAL', 17, finalY + 7.5);
  doc.setTextColor(220, 38, 38);
  doc.text(totalDebit.toLocaleString('en-IN'), 100, finalY + 7.5, { align: 'right' });
  doc.setTextColor(22, 163, 74);
  doc.text(totalCredit.toLocaleString('en-IN'), 124, finalY + 7.5, { align: 'right' });
  doc.setTextColor(20, 20, 20);
  doc.text('NET BALANCE', 128, finalY + 7.5);
  doc.setTextColor(netBalance >= 0 ? 22 : 220, netBalance >= 0 ? 163 : 38, netBalance >= 0 ? 74 : 38);
  doc.text(
      (netBalance < 0 ? '- Rs. ' : 'Rs. ') + Math.abs(netBalance).toLocaleString('en-IN'),
      pageWidth - 17,
      finalY + 7.5,
      { align: 'right' }
  );

  const cleanParty = (partyName || 'Statement').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = 'WalletStatement_' + cleanParty + '_' + Date.now() + '.pdf';

  // Multi-platform safe download trigger (Blob URL + hidden anchor)
  try {
   const blob = doc.output('blob');
   const blobUrl = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = blobUrl;
   a.download = fileName;
   a.style.display = 'none';
   document.body.appendChild(a);
   a.click();
   setTimeout(() => {
    try { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); } catch(e){}
   }, 2000);
   showNotification("PDF Downloaded Successfully! ✓", "success");
  } catch(blobErr) {
   doc.save(fileName);
   showNotification("PDF Downloaded Successfully! ✓", "success");
  }

  closeFilterModal();
 } catch(err) {
  console.error('PDF export error:', err);
  showNotification('PDF Export error: ' + (err.message || err), 'error');
 }
}


// ===== UNIFIED APP DIALOG — same popup for permissions, confirm, save entry =====
let _appDialogResolver = null;

function closeAppDialog(result) {
  const modal = document.getElementById('appDialogModal');
  if (modal) modal.classList.remove('active');
  const r = _appDialogResolver;
  _appDialogResolver = null;
  if (typeof r === 'function') r(!!result);
}

/**
 * showAppDialog({ title, message, icon, variant, confirmText, cancelText, danger })
 * variant: 'permission' | 'confirm' | 'save' | 'info'
 * returns Promise<boolean>
 */
function showAppDialog(opts) {
  opts = opts || {};
  return new Promise(function(resolve) {
    _appDialogResolver = resolve;
    const modal = document.getElementById('appDialogModal');
    if (!modal) { resolve(false); return; }

    const title = document.getElementById('appDialogTitle');
    const msg = document.getElementById('appDialogMessage');
    const iconWrap = document.getElementById('appDialogIcon');
    const iconI = document.getElementById('appDialogIconI');
    const confBtn = document.getElementById('appDialogConfirmBtn');
    const cancelBtn = document.getElementById('appDialogCancelBtn');

    if (title) title.textContent = opts.title || 'Confirm';
    if (msg) msg.textContent = opts.message || '';
    if (iconI) iconI.className = 'ti ' + (opts.icon || 'ti-shield-check');
    if (iconWrap) {
      iconWrap.className = 'sheet-icon';
      if (opts.danger) iconWrap.classList.add('danger');
      else if (opts.variant === 'permission') iconWrap.classList.add('info');
      else if (opts.variant === 'save') iconWrap.classList.add('success');
    }
    if (confBtn) {
      confBtn.textContent = opts.confirmText || 'Allow';
      confBtn.className = 'btn-app-dialog-confirm' + (opts.danger ? ' danger' : '');
      confBtn.onclick = function() { closeAppDialog(true); };
    }
    if (cancelBtn) {
      cancelBtn.textContent = opts.cancelText || 'Not now';
      cancelBtn.onclick = function() { closeAppDialog(false); };
    }
    modal.classList.add('active');
  });
}

/** Browser permission with same UI first */
async function requestAppPermission(kind) {
  if (kind === 'mic') return true;
  // kind: 'camera' | 'mic' | 'notifications'
  const map = {
    camera: {
      title: 'Camera Access',
      message: 'Camera permission is required to scan QR codes. Tap Allow, then grant permission.',
      icon: 'ti-camera',
      confirmText: 'Allow Camera'
    },
    mic: {
      title: 'Microphone Access',
      message: 'Microphone permission is required for AI Voice and Quick Entry. Tap Allow, then grant permission.',
      icon: 'ti-microphone',
      confirmText: 'Allow Mic'
    },
    notifications: {
      title: 'Notifications',
      message: 'Allow notifications to receive payment reminders and budget alerts.',
      icon: 'ti-bell',
      confirmText: 'Allow Notifications'
    }
  };
  const cfg = map[kind] || map.notifications;
  const ok = await showAppDialog({
    title: cfg.title,
    message: cfg.message,
    icon: cfg.icon,
    confirmText: cfg.confirmText,
    cancelText: 'Not now',
    variant: 'permission'
  });
  if (!ok) return false;

  try {
    if (kind === 'notifications') {
      if (!('Notification' in window)) return false;
      if (Notification.permission === 'granted') return true;
      if (Notification.permission === 'denied') return false;
      const r = await Notification.requestPermission();
      return r === 'granted';
    }
    if (kind === 'camera' || kind === 'mic') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
      const constraints = kind === 'camera'
        ? { video: { facingMode: { ideal: 'environment' } }, audio: false }
        : { audio: true, video: false };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      // stop immediately — real feature will re-open stream
      stream.getTracks().forEach(function(t) { t.stop(); });
      return true;
    }
  } catch (e) {
    console.warn('Permission denied or failed:', e);
    if (typeof showNotification === 'function') {
      showNotification((kind === 'camera' ? 'Camera' : kind === 'mic' ? 'Mic' : 'Notification') + ' permission nahi mili', 'error');
    }
    return false;
  }
  return false;
}

async function confirmAppAction(title, message, opts) {
  opts = opts || {};
  return showAppDialog({
    title: title || 'Confirm',
    message: message || 'Continue?',
    icon: opts.icon || (opts.danger ? 'ti-alert-triangle' : 'ti-help-circle'),
    confirmText: opts.confirmText || 'Yes',
    cancelText: opts.cancelText || 'Cancel',
    danger: !!opts.danger,
    variant: 'confirm'
  });
}

async function confirmSaveEntry(summary) {
  return showAppDialog({
    title: 'Save entry?',
    message: summary || 'Is entry ko save karna hai?',
    icon: 'ti-device-floppy',
    confirmText: 'Save Entry',
    cancelText: 'Edit more',
    variant: 'save'
  });
}


// ===== UNIFIED POPUP NOTIFICATION SYSTEM =====
// Compact horizontal toast: icon (left) + title/description + close (right).
// Notifications queue one-at-a-time instead of stacking/overlapping.
// showNotification(title, type, description?, opts?)
//   type: 'success' | 'info' | 'warning' | 'error' | 'voice' | 'ai'
//   opts.persist: force-keep visible until manually closed (errors persist by default)

const TOAST_TYPES = {
 success: { icon: 'ti-circle-check',   color: '#3ddc84', bg: 'rgba(61,220,132,.14)'  },
 info:    { icon: 'ti-info-circle',    color: '#5b8cff', bg: 'rgba(91,140,255,.14)'  },
 warning: { icon: 'ti-alert-triangle', color: '#f0a020', bg: 'rgba(240,160,32,.14)'  },
 error:   { icon: 'ti-alert-circle',   color: '#f06464', bg: 'rgba(240,100,100,.14)' },
 voice:   { icon: 'ti-microphone',     color: '#a855f7', bg: 'rgba(168,85,247,.14)'  },
 ai:      { icon: 'ti-sparkles',       color: '#c084fc', bg: 'rgba(192,132,252,.14)' },
};
const TOAST_DURATIONS = { success: 3500, info: 3500, warning: 4500, error: 0, voice: 3500, ai: 3500 };

const __toastQueue = [];
let __toastBusy = false;

function ensureToastStack() {
 let stack = document.getElementById('appToastStack');
 if (!stack) {
  stack = document.createElement('div');
  stack.id = 'appToastStack';
  stack.className = 'app-toast-stack';
  document.body.appendChild(stack);
 }
 return stack;
}

const __toastSuppressedKeywords = [
 'app refreshed',
 'back online',
 'offline mode',
 'offline changes synced',
 'loading pdf library',
 'loading excel library',
 'welcome back',
 'firebase connected',
 'custom firebase config removed',
 'light mode activated',
 'dark mode activated',
 'light mode enabled',
 'dark mode enabled',
 'switched to light mode',
 'switched to dark mode',
 'entry saved successfully',
 'entry updated successfully',
 'entry saved (local)',
 'entry updated (local)',
 'your income or expense entry has been recorded',
 'signed in with google',
 'logged out',
 'see you again soon',
 'notifications enabled',
 'notifications on',
 'notifications off',
 'marked as paid',
 'reminder added',
 'reminder updated',
 'reminder deleted',
 'copied',
 'backup created successfully',
 'thanks for the feedback',
 'chat pinned',
 'chat unpinned',
 'free assistant ready'
];
let __lastToastText = '';
let __lastToastTime = 0;


/** Tiny front-screen "Saved" chip — only for successful entry writes */
function showMiniSaveToast(status) {
  // status: 'saved' | 'synced' | 'local'
  try {
    let el = document.getElementById('miniSaveToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'miniSaveToast';
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
      if (!document.getElementById('miniSaveToastStyle')) {
        const st = document.createElement('style');
        st.id = 'miniSaveToastStyle';
        st.textContent = `
#miniSaveToast{
  position:fixed; left:50%; bottom: calc(78px + env(safe-area-inset-bottom,0px));
  transform: translateX(-50%) translateY(12px);
  z-index: 99999; pointer-events: none;
  padding: 8px 16px; border-radius: 999px;
  background: rgba(20,24,32,.92); color: #e8f8ef;
  font-size: 13px; font-weight: 600; letter-spacing: 0.02em;
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
  opacity: 0; transition: opacity .2s ease, transform .2s ease;
  display: inline-flex; align-items: center; gap: 7px;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  font-family: -apple-system, BlinkMacSystemFont, Inter, sans-serif;
  border: 1px solid rgba(61,220,132,.25);
}
#miniSaveToast.show{ opacity:1; transform: translateX(-50%) translateY(0); }
#miniSaveToast .dot{
  width:8px; height:8px; border-radius:50%; background:#3ddc84;
  box-shadow: 0 0 8px rgba(61,220,132,.7);
}
body.light-theme #miniSaveToast{
  background: rgba(255,255,255,.95); color:#0f172a;
  border-color: rgba(16,185,129,.3);
}
`;
        document.head.appendChild(st);
      }
    }
    const label = status === 'local' ? 'Saved (offline)'
                : status === 'synced' ? 'Saved'
                : 'Saved';
    el.innerHTML = '<span class="dot"></span><span>' + label + '</span>';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(window.__miniSaveToastTimer);
    window.__miniSaveToastTimer = setTimeout(() => {
      el.classList.remove('show');
    }, 1800);
  } catch (e) {}
}

function showNotification(title, type = 'success', description = '', opts = {}) {
 const strTitle = String(title == null ? '' : title).trim();
 const lowerTitle = strTitle.toLowerCase();

 // Only important toasts by default: errors, warnings, or opts.force / opts.important
 if (!opts.force && !opts.important) {
  if (__toastSuppressedKeywords.some(kw => lowerTitle.includes(kw))) {
   return;
  }
  // Auto-hide routine success toasts (mode switch, saved, copied, etc.)
  if (type === 'success' || type === 'info' || type === 'voice' || type === 'ai') {
   // Allow only if explicitly important
   return;
  }
  const now = Date.now();
  if (__lastToastText === lowerTitle && (now - __lastToastTime) < 3000) {
   return;
  }
  __lastToastText = lowerTitle;
  __lastToastTime = now;
 }

 if (!TOAST_TYPES[type]) type = 'success';
 __toastQueue.push({ title: strTitle, type, description, opts: opts || {} });
 __drainToastQueue();
}

function __drainToastQueue() {
 if (__toastBusy || __toastQueue.length === 0) return;
 __toastBusy = true;
 const item = __toastQueue.shift();
 const meta = TOAST_TYPES[item.type];
 const persist = item.opts.persist === true || (item.opts.persist !== false && item.type === 'error');
 const stack = ensureToastStack();

 const card = document.createElement('div');
 card.className = 'app-toast';
 card.innerHTML =
  '<div class="app-toast-icon" style="color:' + meta.color + ';background:' + meta.bg + '"><i class="ti ' + meta.icon + '"></i></div>' +
  '<div class="app-toast-body"><div class="app-toast-title"></div><div class="app-toast-desc" style="display:none"></div></div>' +
  '<button class="app-toast-close" type="button" aria-label="Close"><i class="ti ti-x"></i></button>';

 card.querySelector('.app-toast-title').textContent = item.title;
 if (item.description) {
  const descEl = card.querySelector('.app-toast-desc');
  descEl.textContent = item.description;
  descEl.style.display = '';
 }

 stack.appendChild(card);
 requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('show')));

 let autoTimer = null;
 let dismissed = false;
 function dismiss() {
  if (dismissed) return;
  dismissed = true;
  if (autoTimer) clearTimeout(autoTimer);
  card.classList.remove('show');
  card.classList.add('hide');
  setTimeout(() => {
   card.remove();
   __toastBusy = false;
   __drainToastQueue();
  }, 300);
 }

 card.querySelector('.app-toast-close').addEventListener('click', dismiss);

 if (!persist) {
  const duration = item.opts.duration || TOAST_DURATIONS[item.type] || 3500;
  autoTimer = setTimeout(dismiss, duration);
 }
}

// ═══════════════════════════════════════════════════════════════════════
// ZOOM LOCK — Android WebView/APK me kabhi kabhi viewport meta tag ko
// ignore karke pinch-zoom ya double-tap-zoom ho jata hai jisse app
// zoom-in/zoom-out hote hue "shrink" jaisa dikhta hai. Ye teeno guards
// -har tarah ke zoom gesture ko JS level par bhi block kar dete hain,
// taaki sirf CSS/meta viewport par depend na karna pade.
// ═══════════════════════════════════════════════════════════════════════
(function lockAppZoom() {
 // 1) Pinch-zoom (2+ finger) rokna
 document.addEventListener('touchmove', function (e) {
  if (e.touches && e.touches.length > 1) e.preventDefault();
 }, { passive: false });

 // 2) iOS/some WebViews ka native "gesture" zoom event rokna
 ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (evt) {
  document.addEventListener(evt, function (e) { e.preventDefault(); }, { passive: false });
 });

 // 3) Double-tap-zoom rokna (bina double-tap se normal tap/click todhe)
 let lastTouchEnd = 0;
 document.addEventListener('touchend', function (e) {
  const now = Date.now();
  const _interactive = e.target && e.target.closest && e.target.closest('button, a, input, select, textarea, label, [onclick], .nav-btn, .pin-key, .menu-item');
  if (now - lastTouchEnd <= 300 && !_interactive) e.preventDefault(); // fast taps wale buttons drop nahi hote
  lastTouchEnd = now;
 }, { passive: false });

 // 4) Ctrl/trackpad-wheel zoom rokna (kuch Android WebViews mouse/trackpad bhi bhejte hain)
 document.addEventListener('wheel', function (e) {
  if (e.ctrlKey) e.preventDefault();
 }, { passive: false });
})();

// ═══════════════════════════════════════════════════════════════════════
// GOOGLE CHROME STYLE PULL-TO-REFRESH (RESTRICTED TO DELIBERATE USER ACTION)
// ═══════════════════════════════════════════════════════════════════════
function initPullToRefresh() {
 const ptrCircle = document.getElementById('ptrCircle');
 const ptrIcon = document.getElementById('ptrIcon');
 if (!ptrCircle) return;

 let startY = 0;
 let currentY = 0;
 let isPulling = false;
 let isRefreshing = false;
 const PULL_THRESHOLD = 110;

 const hasActiveOverlay = () => {
  return !!document.querySelector('.modal.active, .bottom-sheet.active, .pin-screen.active, .full-view-panel.active, #aiChatModal.active');
 };

 window.addEventListener('touchstart', (e) => {
  if (isRefreshing || !e.touches || e.touches.length === 0) return;
  if (hasActiveOverlay()) return;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
  if (scrollY <= 0) {
   startY = e.touches[0].clientY;
   currentY = startY;
   isPulling = true;
  }
 }, { passive: true });

 window.addEventListener('touchmove', (e) => {
  if (!isPulling || isRefreshing || !e.touches || e.touches.length === 0) return;
  if (hasActiveOverlay()) {
   isPulling = false;
   ptrCircle.classList.remove('ptr-visible');
   return;
  }
  currentY = e.touches[0].clientY;
  const diff = currentY - startY;

  const scrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
  if (scrollY > 0 || diff < 0) {
   isPulling = false;
   ptrCircle.classList.remove('ptr-visible');
   ptrCircle.style.transform = 'translateY(-65px) scale(0.6)';
   return;
  }

  if (diff > 20) {
   const pullDist = Math.min((diff - 20) * 0.38, 90);
   ptrCircle.classList.add('ptr-visible');
   const scale = Math.min(1.05, 0.6 + (pullDist / 100));
   const rotation = pullDist * 4;
   ptrCircle.style.transform = `translateY(${pullDist + 15}px) scale(${scale})`;
   if (ptrIcon) ptrIcon.style.transform = `rotate(${rotation}deg)`;
  } else {
   ptrCircle.classList.remove('ptr-visible');
   ptrCircle.style.transform = 'translateY(-65px) scale(0.6)';
  }
 }, { passive: true });

 window.addEventListener('touchend', async () => {
  if (!isPulling || isRefreshing) return;
  isPulling = false;
  const diff = currentY - startY;

  // Deliberate user pull requirement
  if (diff > PULL_THRESHOLD * 1.35) {
   isRefreshing = true;
   ptrCircle.classList.add('ptr-visible', 'ptr-spinning');
   ptrCircle.style.transform = 'translateY(48px) scale(1)';

   if (navigator.vibrate) {
    try { navigator.vibrate(25); } catch(e){}
   }

   try {
    if (typeof loadEntriesFromFirebase === 'function' && firebaseReady) {
     await loadEntriesFromFirebase();
     if (typeof dedupeEntries === 'function') dedupeEntries();
    }
    renderWallet();
    renderEntries();
    if (typeof renderAnalytics === 'function') renderAnalytics();
    if (typeof updateGreeting === 'function') updateGreeting();
   } catch(err) {
    console.warn('Pull-to-refresh sync notice:', err);
   }

   setTimeout(() => {
    ptrCircle.classList.remove('ptr-spinning');
    ptrCircle.style.transform = 'translateY(-65px) scale(0.6)';
    setTimeout(() => {
     ptrCircle.classList.remove('ptr-visible');
     isRefreshing = false;
     startY = 0;
     currentY = 0;
    }, 250);
   }, 500);
  } else {
   ptrCircle.style.transform = 'translateY(-65px) scale(0.6)';
   setTimeout(() => {
    ptrCircle.classList.remove('ptr-visible');
   }, 150);
  }
 });
}

// ===== INIT =====

// Initialize Firebase and load data
function initializeApp() {
  if (window.__appInitDone) return;
  window.__appInitDone = true;

  try {
    initPullToRefresh();
    updateFirebaseStatus(firebaseReady);
  } catch(e){}

  // ── STEP 0: Apply saved theme preference (light white dotted theme by default) ──
  try {
    const savedTheme = localStorage.getItem("appTheme");
    const isLight = savedTheme !== "dark";
    if (isLight) {
      document.body.classList.add("light-theme");
      document.documentElement.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
      document.documentElement.classList.remove("light-theme");
    }
    updateThemeToggleIcon(isLight);
  } catch(e){}

  // ── STEP 1: Paint UI from localStorage instantly (0ms) ──
  try {
    loadFromLocalStorage();
    dedupeEntries();
    renderWallet();   // Dashboard — instant
    renderEntries();  // Entries list — instant
    loadRemindersFromLocalStorage();
    updateReminderUnreadDot();
    if (typeof loadGoals === 'function') loadGoals();
    if (typeof renderGoalsList === 'function' && document.getElementById('screen-goals')?.classList.contains('active')) renderGoalsList();
    if (typeof renderList === "function") renderList(); // keep Goals tab live if entries change
    checkAndShowReminderPopup(); // due/overdue payment reminders check (in-app popup + real notification)
    requestNotificationPermission(); // pehli baar permission maango, taaki phone-style notifications kaam karein
    updateNotifStatusLabel(); // "Enable Notifications" menu item ka status turant sahi dikhaye
  } catch(e) {
    console.error('Error during initial UI render:', e);
  }

  // ── STEP 2: Setup UI state ──
  try {
    loadCustomParties();
    syncPaymentMethodDropdowns();
    if (typeof updateNavIndicator === 'function') {
      requestAnimationFrame(() => updateNavIndicator(typeof currentAppScreen !== 'undefined' ? currentAppScreen : 'wallet'));
    }
    const dateInputEl = document.getElementById("dateInput");
    if(dateInputEl) {
      dateInputEl.value = getLocalDateStr();
      updateDateLabel(dateInputEl.value);
    }
    updateGreeting();
    updateDateDisplay();
    updateMonthDisplayToCurrent();
    if (typeof updateBackupIndicatorDisplay === 'function') updateBackupIndicatorDisplay();
    if(pinMode === 'create'){
      const pinTitle = document.getElementById('pinTitleText');
      const pinSub = document.getElementById('pinSubText');
      if(pinTitle) pinTitle.textContent = "Set a PIN";
      if(pinSub) pinSub.textContent = "Create a new 4-digit PIN";
    }
  } catch(e) {
    console.error('Error setting up initial UI state:', e);
  }

  // ── STEP 3: Check session (Google or email login) — show login or go to PIN ──
  try {
    // TEMP testing: skip login + PIN entirely
    if (typeof DEV_SKIP_LOGIN_AND_PIN !== 'undefined' && DEV_SKIP_LOGIN_AND_PIN) {
      // Restore user session so Firebase save/sync still works
      try {
        const savedUser = localStorage.getItem('googleUser') || localStorage.getItem('currentUser');
        if (savedUser) {
          currentUser = JSON.parse(savedUser);
          if (currentUser && currentUser.uid) localStorage.setItem('currentUserUid', currentUser.uid);
        }
      } catch(e){}
      hideLoadingPage();
      const loginPage = document.getElementById('googleLoginPage');
      if (loginPage) { loginPage.classList.add('hidden'); loginPage.style.display = 'none'; }
      const pinScreen = document.getElementById('pinLockScreen');
      if (pinScreen) pinScreen.style.display = 'none';
      const appContainer = document.getElementById('app');
      if (appContainer) appContainer.style.display = 'block';
      document.body.classList.add('dev-skip-auth');
      try { if (typeof updateProfileEmail === 'function') updateProfileEmail(); } catch(e){}
      try { if (typeof renderWallet === 'function') renderWallet(); } catch(e){}
      try { if (typeof renderEntries === 'function') renderEntries(); } catch(e){}
    } else {
      const savedUser = localStorage.getItem('googleUser') || localStorage.getItem('currentUser');
      window.__sessionCheckDone = true;
      if (savedUser) {
        try {
          currentUser = JSON.parse(savedUser);
          updateProfileEmail();
          hideGoogleLoginPage(); // → shows PIN screen → user unlocks → app shows
        } catch(e) {
          showGoogleLoginPage();
        }
      } else {
        showGoogleLoginPage(); // fresh user: login first
      }
      hideLoadingPage();
    }
  } catch(e) {
    console.error('Error during session check:', e);
    hideLoadingPage();
    if (typeof DEV_SKIP_LOGIN_AND_PIN !== 'undefined' && DEV_SKIP_LOGIN_AND_PIN) {
      const appContainer = document.getElementById('app');
      if (appContainer) appContainer.style.display = 'block';
      const pinScreen = document.getElementById('pinLockScreen');
      if (pinScreen) pinScreen.style.display = 'none';
      const loginPage = document.getElementById('googleLoginPage');
      if (loginPage) { loginPage.classList.add('hidden'); loginPage.style.display = 'none'; }
    } else {
      showGoogleLoginPage();
    }
  }

  // ── STEP 4: Init Google Sign-In SDK (async, non-blocking) ──
  const tryInitGoogle = () => {
    if (window.google && window.google.accounts) {
      initGoogleSignIn();
    } else {
      setTimeout(tryInitGoogle, 200); // Retry until GSI script loads
    }
  };
  setTimeout(tryInitGoogle, 0);

  // ── STEP 5: Firebase background sync (after UI is visible, defer further) ──
  const tryFirebaseSync = () => {
    if (typeof firebase !== 'undefined') {
      initFirebase();
    } else {
      setTimeout(tryFirebaseSync, 300); // Wait for deferred firebase script
    }
  };
  setTimeout(tryFirebaseSync, 500); // Give UI 500ms head start before firebase loads
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  setTimeout(initializeApp, 0);
}

// ── SAFETY WATCHDOG: loading page kabhi atke nahi (pehle screen ready, phir loading hatao) ──
setTimeout(() => {
  const lp = document.getElementById('loadingPage');
  if (lp && !lp.classList.contains('hidden')) {
    if (!window.__appInitDone) { try { initializeApp(); } catch(e){} }
    ensureBootView();
    hideLoadingPage(true);
  }
}, 1500);

function initFirebase(overrideConfig) {
 try {
   const cfg = overrideConfig || getActiveFirebaseConfig();
   firebaseConfig = cfg;
   const hasValidKey = cfg && typeof cfg.apiKey === 'string' && cfg.apiKey.trim() && !cfg.apiKey.includes("PASTE_YOUR");

   if (hasValidKey) {
     if (!window.__firebaseInitDone) {
       window.__firebaseInitDone = true;
       if (!firebase.apps || !firebase.apps.length) {
         firebase.initializeApp(cfg);
       }
       db = firebase.firestore();
       db.enablePersistence().catch(err => console.warn('Persistence notice:', err));
     }
     firebaseReady = true;
     
     // 📡 UPDATE INDICATOR: Firebase Connected
     updateFirebaseStatus(true);
     console.log("✅ Firebase connected successfully!");
     logFirebaseEvent('Connected to Firebase (' + (cfg.projectId || 'cloud') + ')', 'success');

     let authStateInitialCheckDone = false;
     if (firebase.auth) {
       firebase.auth().onAuthStateChanged(authUser => {
         if (!authStateInitialCheckDone) {
           authStateInitialCheckDone = true;
           return;
         }
         if (!authUser && currentUser && currentUser.source === 'email') {
           console.warn('⚠ Firebase Auth session lost — forcing re-login');
           logFirebaseEvent('Session lost — please log in again', 'error');
           currentUser = null;
           localStorage.removeItem('currentUser');
           localStorage.removeItem('currentUserUid');
           showNotification('Session expired — please log in again', 'error');
           showGoogleLoginPage();
         }
       });
     }

     // Background sync after brief delay so UI stays fast
     setTimeout(async () => {
       try {
         await loadEntriesFromFirebase();
         dedupeEntries();
         renderWallet();
         renderEntries();
         if (document.getElementById('screen-analytics') && document.getElementById('screen-analytics').classList.contains('active')) renderAnalytics();
         console.log('✓ Firebase sync done:', entries.length, 'entries');
         logFirebaseEvent(`Synced ${entries.length} entries from Firestore`, 'success');

         await syncCustomPartiesFromFirebase();
       } catch(err) {
         console.warn('⚠ Firebase sync failed, using local data:', err);
         logFirebaseEvent('Firestore sync failed — using local data (' + (err.message || err.code || 'unknown error') + ')', 'error');
       }
     }, 800);
   } else {
     firebaseReady = false;
     updateFirebaseStatus(false);
     console.info("ℹ️ Firebase not configured: API key missing in config.js or app settings.");
     logFirebaseEvent('Firebase credentials missing (using local offline storage)', 'warning');
   }
 } catch(err) {
   console.warn('Firebase init failed, local mode:', err);
   firebaseReady = false;
   updateFirebaseStatus(false);
   logFirebaseEvent('Firebase init failed: ' + (err.message || err), 'error');
 }
}

// ═══════════════════════════════════════════════════════════════════════
// FIREBASE CONNECTION STATUS INDICATOR - UPDATE UI
// ═══════════════════════════════════════════════════════════════════════
function updateFirebaseStatus(isConnected) {
 const indicator = document.getElementById('firebaseStatusIndicator');
 if (indicator) indicator.style.display = 'none';

 const bellDot = document.getElementById('bellUnreadDot');
 const bellBtn = document.getElementById('bellIconBtn');
 if (!bellDot) return;

 bellDot.style.display = 'block';
 if (isConnected) {
   bellDot.style.background = '#10b981';
   bellDot.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.8)';
   if (bellBtn) bellBtn.title = "Firebase Cloud Sync: ON (Connected)";
 } else {
   bellDot.style.background = '#ef4444';
   bellDot.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.8)';
   if (bellBtn) bellBtn.title = "Firebase Cloud Sync: Offline / Not Synced";
 }
}

// ═══════════════════════════════════════════════════════════════════════
// FIREBASE SETUP & CREDENTIALS MODAL (Direct in-app configuration)
// ═══════════════════════════════════════════════════════════════════════
function openFirebaseSetupModal() {
  const existing = document.getElementById('firebaseSetupModal');
  if (existing) existing.remove();

  const currentCfg = getActiveFirebaseConfig();
  const isCustom = !!localStorage.getItem('app_firebase_config');
  const hasKey = currentCfg && typeof currentCfg.apiKey === 'string' && currentCfg.apiKey.trim() && !currentCfg.apiKey.includes('PASTE_YOUR');
  const isConnected = !!(window.firebase && firebaseReady);

  const html = `
  <div class="modal-bg active" id="firebaseSetupModal" style="display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);position:fixed;inset:0;padding:16px;">
    <div class="modal" style="max-width:440px;width:100%;background:#11151c;border:1px solid rgba(255,255,255,0.12);border-radius:18px;box-shadow:0 16px 40px rgba(0,0,0,0.6);color:#f1f5f9;font-family:'Inter',sans-serif;max-height:90vh;overflow-y:auto;display:flex;flex-direction:column;">
      <div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(245,179,1,0.15);display:flex;align-items:center;justify-content:center;border:1px solid rgba(245,179,1,0.3);">
            <i class="ti ti-brand-firebase" style="font-size:22px;color:#f5b301;"></i>
          </div>
          <div>
            <div style="font-size:15px;font-weight:700;">Firebase Cloud Sync</div>
            <div style="font-size:11.5px;color:#94a3b8;">Multi-device realtime database</div>
          </div>
        </div>
        <button type="button" onclick="document.getElementById('firebaseSetupModal').remove()" style="background:transparent;border:none;color:#94a3b8;font-size:22px;cursor:pointer;line-height:1;">&times;</button>
      </div>

      <div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px;">
        <!-- Status Banner -->
        <div style="padding:12px 14px;border-radius:12px;background:${isConnected ? 'rgba(61,220,132,0.12)' : 'rgba(240,100,100,0.12)'};border:1px solid ${isConnected ? 'rgba(61,220,132,0.3)' : 'rgba(240,100,100,0.3)'};display:flex;align-items:center;gap:10px;">
          <span style="width:10px;height:10px;border-radius:50%;background:${isConnected ? '#3ddc84' : '#f06464'};box-shadow:0 0 8px ${isConnected ? '#3ddc84' : '#f06464'};flex-shrink:0;"></span>
          <div>
            <div style="font-size:13px;font-weight:700;color:${isConnected ? '#3ddc84' : '#f87171'};">
              ${isConnected ? 'Connected &amp; Syncing' : 'Not Connected (Offline Mode)'}
            </div>
            <div style="font-size:11px;color:#cbd5e1;margin-top:2px;">
              ${isConnected ? 'Project: ' + (currentCfg.projectId || 'Active') : 'Entries are saved locally. Connect Firebase for real-time cloud backup.'}
            </div>
          </div>
        </div>

        <!-- Quick Paste Box -->
        <div>
          <label style="display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px;">
            📋 Quick Paste: Firebase Config Snippet
          </label>
          <textarea id="fbPasteSnippet" placeholder="Paste const firebaseConfig = { apiKey: '...', ... } directly from Firebase Console" rows="3" style="width:100%;box-sizing:border-box;background:#181d28;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:8px 10px;color:#f8fafc;font-size:12px;font-family:monospace;outline:none;resize:vertical;" oninput="autoParseFirebaseSnippet(this.value)"></textarea>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;">
            💡 Firebase Console &gt; Project Settings &gt; General &gt; "Your apps" (Web &lt;/&gt;).
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;">
          <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
          <span style="font-size:11px;color:#64748b;text-transform:uppercase;">Or Edit Fields</span>
          <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
        </div>

        <!-- Fields -->
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:11.5px;color:#94a3b8;margin-bottom:4px;">API Key <span style="color:#f87171;">*</span></label>
            <input id="fbApiKey" type="text" value="${hasKey ? currentCfg.apiKey : ''}" placeholder="AIzaSy..." style="width:100%;box-sizing:border-box;background:#181d28;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;color:#f8fafc;font-size:13px;outline:none;">
          </div>
          <div>
            <label style="display:block;font-size:11.5px;color:#94a3b8;margin-bottom:4px;">Project ID <span style="color:#f87171;">*</span></label>
            <input id="fbProjectId" type="text" value="${hasKey ? currentCfg.projectId : ''}" placeholder="my-wallet-app-123" style="width:100%;box-sizing:border-box;background:#181d28;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;color:#f8fafc;font-size:13px;outline:none;">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label style="display:block;font-size:11.5px;color:#94a3b8;margin-bottom:4px;">Auth Domain</label>
              <input id="fbAuthDomain" type="text" value="${hasKey ? (currentCfg.authDomain || '') : ''}" placeholder="project.firebaseapp.com" style="width:100%;box-sizing:border-box;background:#181d28;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;color:#f8fafc;font-size:12px;outline:none;">
            </div>
            <div>
              <label style="display:block;font-size:11.5px;color:#94a3b8;margin-bottom:4px;">App ID</label>
              <input id="fbAppId" type="text" value="${hasKey ? (currentCfg.appId || '') : ''}" placeholder="1:12345:web:..." style="width:100%;box-sizing:border-box;background:#181d28;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;color:#f8fafc;font-size:12px;outline:none;">
            </div>
          </div>
        </div>

        <div id="fbSetupMsg" style="font-size:12px;min-height:16px;"></div>

        <!-- Buttons -->
        <div style="display:flex;gap:10px;margin-top:6px;">
          <button type="button" onclick="submitFirebaseSetupModal()" style="flex:2;background:#3b82f6;color:#ffffff;border:none;border-radius:10px;padding:11px 16px;font-size:13.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:background 0.2s;">
            <i class="ti ti-plug"></i> Save &amp; Connect Firebase
          </button>
          ${isCustom ? `
          <button type="button" onclick="clearCustomFirebaseConfig()" title="Clear and reset to config.js" style="flex:1;background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:11px 10px;font-size:12px;font-weight:600;cursor:pointer;">
            Reset
          </button>` : ''}
        </div>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}

function autoParseFirebaseSnippet(text) {
  if (!text) return;
  const extract = (key) => {
    const m = text.match(new RegExp(`['"]?${key}['"]?\\s*:\\s*['"]([^'"]+)['"]`, 'i'));
    return m ? m[1].trim() : '';
  };
  const apiKey = extract('apiKey');
  const projectId = extract('projectId');
  const authDomain = extract('authDomain');
  const appId = extract('appId');

  if (apiKey) { const el = document.getElementById('fbApiKey'); if (el) el.value = apiKey; }
  if (projectId) { const el = document.getElementById('fbProjectId'); if (el) el.value = projectId; }
  if (authDomain) { const el = document.getElementById('fbAuthDomain'); if (el) el.value = authDomain; }
  if (appId) { const el = document.getElementById('fbAppId'); if (el) el.value = appId; }

  const msg = document.getElementById('fbSetupMsg');
  if (apiKey && projectId && msg) {
    msg.innerHTML = '<span style="color:#34d399;">✨ Config snippet detected! Click "Save &amp; Connect Firebase".</span>';
  }
}

function submitFirebaseSetupModal() {
  const apiKey = document.getElementById('fbApiKey')?.value.trim();
  const projectId = document.getElementById('fbProjectId')?.value.trim();
  const authDomain = document.getElementById('fbAuthDomain')?.value.trim() || `${projectId}.firebaseapp.com`;
  const appId = document.getElementById('fbAppId')?.value.trim() || '';
  const msg = document.getElementById('fbSetupMsg');

  if (!apiKey || apiKey.includes('PASTE_YOUR') || apiKey.length < 10) {
    if (msg) msg.innerHTML = '<span style="color:#f87171;">⚠️ Valid Firebase API Key daalein.</span>';
    return;
  }
  if (!projectId || projectId.includes('your-project')) {
    if (msg) msg.innerHTML = '<span style="color:#f87171;">⚠️ Valid Firebase Project ID daalein.</span>';
    return;
  }

  const newConfig = {
    apiKey: apiKey,
    authDomain: authDomain,
    projectId: projectId,
    appId: appId,
    databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
    storageBucket: `${projectId}.appspot.com`
  };

  try {
    localStorage.setItem('app_firebase_config', JSON.stringify(newConfig));
    if (msg) msg.innerHTML = '<span style="color:#38bdf8;">Connecting to Firebase...</span>';
    
    window.__firebaseInitDone = false;
    initFirebase(newConfig);

    setTimeout(() => {
      const modal = document.getElementById('firebaseSetupModal');
      if (modal) modal.remove();
      showNotification('✅ Firebase connected successfully!', 'success');
      if (typeof toggleSyncStatusPanel === 'function') {
        const panel = document.getElementById('syncStatusPanel');
        if (panel && panel.style.display === 'block') renderSyncStatusList();
      }
    }, 600);
  } catch(e) {
    if (msg) msg.innerHTML = '<span style="color:#f87171;">⚠️ Error: ' + e.message + '</span>';
  }
}

function clearCustomFirebaseConfig() {
  localStorage.removeItem('app_firebase_config');
  window.__firebaseInitDone = false;
  initFirebase();
  const modal = document.getElementById('firebaseSetupModal');
  if (modal) modal.remove();
  showNotification('Custom Firebase config removed, using default', 'info');
}

// Handle visibility change - just re-render existing data, no reload
document.addEventListener('visibilitychange', () => {
 if (!document.hidden) {
  setTimeout(() => {
   renderWallet();
   const es = document.getElementById('screen-entries');
   if (es && es.classList.contains('active')) renderEntries();
  }, 150);
 }
});

// ===== RENDER ANALYTICS (called from various places) =====
function renderAnalytics() {
 updateMonthDisplayToCurrent();
 renderCharts();
 renderTopCats();
}

// Keeps the "Month" label in Analytics in sync with whichever month is
// currently selected (defaults to the real current month on first load).
function updateMonthDisplayToCurrent() {
 const el = document.getElementById('monthDisplay');
 if (!el) return;
 const d = new Date(selectedAnalyticsYear, selectedAnalyticsMonth, 1);
 el.textContent = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

// ===== PARTY MANAGER =====
function openPartyManager() {
 // Get existing parties from select options
 const sel = document.getElementById('partySel');
 const parties = Array.from(sel.options).map(o => o.value).filter(v => v !== '');

 // Create modal HTML
 const modalHtml = `
 <div class="modal-bg active" id="partyManagerModal">
  <div class="modal" style="max-width:360px;">
   <div class="modal-header">
    <h3 style="font-size:16px;">Manage / Add Party</h3>
    <button class="modal-close" onclick="document.getElementById('partyManagerModal').remove()">&times;</button>
   </div>
   <div class="modal-body">
    <div style="margin-bottom:12px;">
     <div class="flabel" style="margin-bottom:6px;font-size:12px;color:#8b9099;font-weight:600;">ADD NEW PARTY</div>
     <div style="display:flex;gap:8px;">
      <input id="newPartyInput" type="text" placeholder="Enter party name..." 
       style="flex:1;background:#1f2430;border:1px solid #2d3446;border-radius:10px;padding:10px 12px;color:#f5f6f8;font-size:14px;font-family:'Inter',sans-serif;outline:none;">
      <button onclick="addNewParty()" style="padding:10px 14px;border:none;border-radius:10px;background:linear-gradient(135deg,#f0c060,#e8b64c);color:#1a1305;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;">Add</button>
     </div>
    </div>
    <div class="flabel" style="margin-bottom:8px;font-size:12px;color:#8b9099;font-weight:600;">EXISTING PARTIES</div>
    <div id="partyList" style="max-height:280px;overflow-y:auto;">
     ${parties.map(p => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#1f2430;border-radius:10px;margin-bottom:6px;">
       <span style="font-size:14px;font-weight:600;">${p}</span>
       <button onclick="removeParty('${p}')" style="background:rgba(240,100,100,.15);border:none;color:#f06464;font-size:12px;padding:4px 8px;border-radius:6px;cursor:pointer;">Remove</button>
      </div>`).join('')}
    </div>
   </div>
  </div>
 </div>`;

 document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function addNewParty() {
 const input = document.getElementById('newPartyInput');
 const name = (input.value || '').trim();
 if (!name) { showNotification('Please enter a party name!', 'error'); return; }

 // Add to both selects
 ['partySel', 'editPartySel'].forEach(id => {
  const sel = document.getElementById(id);
  if (!Array.from(sel.options).some(o => o.value === name)) {
   const opt = document.createElement('option');
   opt.value = name;
   opt.textContent = name;
   sel.appendChild(opt);
  }
 });

 // Save to localStorage (instant, works even offline)
 const saved = JSON.parse(localStorage.getItem('customParties') || '[]');
 if (!saved.includes(name)) {
  saved.push(name);
  localStorage.setItem('customParties', JSON.stringify(saved));
 }

 // Save to Firestore too (account ke sath permanently jud jaye,
 // taaki refresh ya logout/login ke baad bhi party name na hate)
 savePartiesToFirebase(saved);

 showNotification(`"${name}" party added! ✓`, 'success');
 input.value = '';
 // Refresh the list display
 document.getElementById('partyManagerModal').remove();
 openPartyManager();
}

async function removeParty(name) {
 if (!(await confirmAppAction('Remove party?', `Party "${name}" remove karein?`, { danger: true, confirmText: 'Remove', icon: 'ti-user-minus' }))) return;
 ['partySel', 'editPartySel'].forEach(id => {
  const sel = document.getElementById(id);
  const opt = Array.from(sel.options).find(o => o.value === name);
  if (opt) sel.removeChild(opt);
 });
 const saved = JSON.parse(localStorage.getItem('customParties') || '[]').filter(p => p !== name);
 localStorage.setItem('customParties', JSON.stringify(saved));

 // Firestore se bhi hata do
 savePartiesToFirebase(saved);

 showNotification(`"${name}" removed`, 'success');
 document.getElementById('partyManagerModal').remove();
 openPartyManager();
}

// Load saved custom parties on init (localStorage se turant, phir Firestore se confirm/merge)
function loadCustomParties() {
 const saved = JSON.parse(localStorage.getItem('customParties') || '[]');
 saved.forEach(name => {
  ['partySel', 'editPartySel'].forEach(id => {
   const sel = document.getElementById(id);
   if (sel && !Array.from(sel.options).some(o => o.value === name)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
   }
  });
 });
}

// ── Party list ko Firestore (account) ke sath sync karna, taaki
// refresh ya logout→login ke baad bhi party name gayab na ho ──
async function savePartiesToFirebase(partiesArr) {
 try {
  if (!firebaseReady || !db || !currentUser || !currentUser.uid) return; // offline / not logged in -> localStorage hi kaafi hai abhi
  await db.collection('userSettings').doc(currentUser.uid).set(
   { customParties: partiesArr },
   { merge: true }
  );
 } catch (err) {
  console.warn('⚠ Party list Firestore sync failed (localStorage copy safe hai):', err);
 }
}

// App load hote hi (ya login hote hi) Firestore se saved parties khींch kar
// localStorage aur dropdown dono mein merge kar deta hai.
async function syncCustomPartiesFromFirebase() {
 try {
  if (!firebaseReady || !db || !currentUser || !currentUser.uid) return;
  const docSnap = await db.collection('userSettings').doc(currentUser.uid).get();
  if (!docSnap.exists) return;

  const cloudParties = docSnap.data().customParties || [];
  const localParties = JSON.parse(localStorage.getItem('customParties') || '[]');

  // Dono lists ko merge karo (duplicate hataate hue), taaki kahin se bhi
  // add kiya gaya party name kabhi na khoye
  const merged = Array.from(new Set([...localParties, ...cloudParties]));

  localStorage.setItem('customParties', JSON.stringify(merged));
  loadCustomParties(); // dropdown ko naye merged list se refresh karo

  // Agar cloud mein kuch missing tha jo local mein tha (ya vice versa),
  // to Firestore ko bhi updated merged list ke sath sync kar do
  if (merged.length !== cloudParties.length) {
   savePartiesToFirebase(merged);
  }
 } catch (err) {
  console.warn('⚠ Party list Firestore fetch failed, using local copy:', err);
 }
}

// ===== DARK / LIGHT MODE =====
function isLightMode(){ return document.body.classList.contains("light-theme"); }

// Eye icon on the Total Balance card — purely visual blur toggle, so it
// never fights with renderWallet() re-writing walBalance's textContent.
function toggleBalanceMask(){
 const el = document.getElementById("bc2AmountWrap");
 if (el) el.classList.toggle("masked");
}

function toggleTheme(){
 document.body.classList.toggle("light-theme");
 const isLight = document.body.classList.contains("light-theme");
 document.documentElement.classList.toggle("light-theme", isLight);
 try { localStorage.setItem("appTheme", isLight ? "light" : "dark"); } catch(e){}
 // theme change: no toast
 updateThemeToggleIcon(isLight);
 const metaTheme = document.querySelector('meta[name="theme-color"]');
 if (metaTheme) metaTheme.setAttribute('content', isLight ? '#f6f8fc' : '#07090e');
 // Refresh canvas-based charts so their colors match the new theme (CSS can't reach into canvas)
 if (typeof renderMiniChart === 'function') renderMiniChart();
 if (typeof renderCharts === 'function' && document.getElementById('donutChart')) renderCharts();
 // Keep the Goals tab (now inline, same page) in sync too, in case it's
 // already open — its canvas ring reads its colors from body.light-theme,
 // which CSS can't do for canvas, so it needs a manual repaint.
 if (typeof drawGoalsRing === 'function') {
  const ringTotal = document.getElementById('ringGoalsTotalPct');
  const pct = ringTotal ? parseInt(ringTotal.textContent) || 0 : 0;
  drawGoalsRing(pct);
 }
 if (typeof renderDashboardTotals === 'function') renderDashboardTotals();
 if (typeof renderGoalsList === 'function' && document.getElementById('screen-goals')?.classList.contains('active')) renderGoalsList();
}

// ===== PROFILE EMAIL FROM FIREBASE AUTH =====
function updateProfileEmail() {
 const emailEl = document.getElementById('profileEmail');
 const nameEl = document.getElementById('profileName');
 const avatarImg = document.getElementById('userAvatarImg');
 const avatarContainer = document.getElementById('userAvatarContainer');
 
 if (!emailEl) return;

 // Check if Google user is logged in
 if (currentUser) {
  emailEl.textContent = currentUser.email || 'Loading...';
  if (nameEl) nameEl.textContent = currentUser.name || 'User';
  
  // Show profile picture
  if (avatarImg && currentUser.picture) {
   avatarImg.src = currentUser.picture;
   avatarImg.style.display = 'block';
   if (avatarContainer) avatarContainer.style.display = 'none';
  }
  return;
 }

 // Try Firebase Auth
 try {
  if (firebaseReady && firebase.auth) {
   firebase.auth().onAuthStateChanged(user => {
    if (user) {
     emailEl.textContent = user.email || (currentUser && currentUser.email) || 'user@example.com';
     if (user.displayName) nameEl.textContent = user.displayName;
    } else {
     emailEl.textContent = (currentUser && currentUser.email) || 'user@example.com';
    }
   });
   return;
  }
 } catch(e) {}

 // Fallback
 emailEl.textContent = (currentUser && currentUser.email) || 'user@example.com';
}

// ===== LOGOUT =====
function logoutUser(){
 if(!confirm("Are you sure you want to log out?")) return;
 showNotification("Logged out", "success");
 setTimeout(()=> location.reload(), 800);
}

// ===== BACKUP & RESTORE FUNCTIONS =====
function openPage(id){
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
    if (id === 'screen-backup' && typeof updateBackupIndicatorDisplay === 'function') {
        updateBackupIndicatorDisplay();
    }
}
function closePage(id){
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
}

// ═══════════════════════════════════════════════════════════════════════
// 🛡️ AUTOMATED WEEKLY CLOUD BACKUP ENGINE
// Automatically backs up all data to cloud and local vault every 7 days.
// Runs completely silently in the background whenever internet is connected.
// Zero popups, zero permission prompts required!
// ═══════════════════════════════════════════════════════════════════════
async function runAutomaticWeeklyBackup(force = false) {
  if (!Array.isArray(entries) || entries.length === 0) return;

  const lastBackupStr = localStorage.getItem('lastAutoBackupDate') || localStorage.getItem('lastBackupDate');
  const now = Date.now();

  if (!force && lastBackupStr) {
    const elapsedMs = now - new Date(lastBackupStr).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (elapsedMs < sevenDaysMs) {
      updateAutoBackupDisplay(lastBackupStr);
      return; // Already backed up within the last 7 days
    }
  }

  const curUid = (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid');
  const nowIso = new Date().toISOString();

  const backupPackage = {
    backupDate: nowIso,
    totalEntries: entries.length,
    entries: entries,
    customParties: (typeof customParties !== 'undefined' && Array.isArray(customParties)) ? customParties : [],
    paymentReminders: (typeof paymentReminders !== 'undefined' && Array.isArray(paymentReminders)) ? paymentReminders : [],
    backupType: force ? 'manual_snapshot' : 'weekly_auto_snapshot',
    userId: curUid || null
  };

  // 1. Save to local weekly backup cache & emergency vault
  try {
    localStorage.setItem('wallet_weekly_backup', JSON.stringify(backupPackage));
    localStorage.setItem('wallet_protected_vault', JSON.stringify(entries));
    localStorage.setItem('lastAutoBackupDate', nowIso);
    localStorage.setItem('lastBackupDate', nowIso);
    if (curUid) {
      localStorage.setItem('entries_backup_' + curUid, JSON.stringify(entries));
    }
  } catch(e) {
    console.warn('Local auto-backup store error:', e);
  }

  // 2. Silently upload snapshot to Firebase Cloud if connected
  if (navigator.onLine && firebaseReady && db && curUid) {
    try {
      const backupCol = db.collection('users').doc(curUid).collection('backups');
      await backupCol.doc('weekly_snapshot').set(backupPackage, { merge: true });
      const dateKey = 'backup_' + nowIso.slice(0, 10);
      backupCol.doc(dateKey).set(backupPackage, { merge: true }).catch(() => {});
      console.log('✓ Weekly automatic backup saved to Firebase cloud:', entries.length, 'entries');
      if (typeof logFirebaseEvent === 'function') {
        logFirebaseEvent(`Auto-backup saved to cloud (${entries.length} entries)`, 'success');
      }
    } catch(cloudErr) {
      console.warn('Silent cloud auto-backup warning (saved locally):', cloudErr);
    }
  }

  if (typeof recordBackupMetadata === 'function') {
    recordBackupMetadata(force ? 'Manual Snapshot' : 'Weekly Cloud Snapshot');
  }
  updateAutoBackupDisplay(nowIso);
  if (typeof hideBackupReminder === 'function') hideBackupReminder();

  if (force) {
    showNotification(`Backup created successfully (${entries.length} entries) ✓`, 'success');
  }
}

function updateAutoBackupDisplay(isoDateStr) {
  const el = document.getElementById('lastAutoBackupDateDisplay');
  if (!el) return;
  if (!isoDateStr) {
    el.textContent = 'Last: Checking...';
    return;
  }
  try {
    const d = new Date(isoDateStr);
    el.textContent = 'Last: ' + d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  } catch(e) {
    el.textContent = 'Last: Recently';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 🕒 BACKUP DATE & DATA COVERAGE RANGE CALCULATOR
// Calculates minimum and maximum date in entries and formats the coverage
// e.g. "01 Jan 2026 to 14 Oct 2026 (128 entries)"
// ═══════════════════════════════════════════════════════════════════════
function getEntryCoverageRange(items) {
  const list = items || (typeof entries !== 'undefined' && Array.isArray(entries) ? entries : []);
  if (!Array.isArray(list) || list.length === 0) {
    return {
      fromDate: null,
      toDate: null,
      fromText: null,
      toText: null,
      count: 0,
      text: 'No entries'
    };
  }

  let minDateStr = null;
  let maxDateStr = null;

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e) continue;
    const raw = e.date || e.timestamp || e.created_at;
    const norm = (typeof normalizeDate === 'function') ? normalizeDate(raw) : (raw ? String(raw).slice(0, 10) : null);
    if (!norm) continue;
    if (!minDateStr || norm < minDateStr) minDateStr = norm;
    if (!maxDateStr || norm > maxDateStr) maxDateStr = norm;
  }

  if (!minDateStr || !maxDateStr) {
    return {
      fromDate: null,
      toDate: null,
      fromText: null,
      toText: null,
      count: list.length,
      text: `${list.length} entries`
    };
  }

  const formatYmd = (ymd) => {
    try {
      const parts = ymd.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      }
      return ymd;
    } catch(e) {
      return ymd;
    }
  };

  const fromFormatted = formatYmd(minDateStr);
  const toFormatted = formatYmd(maxDateStr);

  const text = (fromFormatted === toFormatted)
    ? `${fromFormatted} (${list.length} entries)`
    : `${fromFormatted} to ${toFormatted} (${list.length} entries)`;

  return {
    fromDate: minDateStr,
    toDate: maxDateStr,
    fromText: fromFormatted,
    toText: toFormatted,
    count: list.length,
    text: text
  };
}

function recordBackupMetadata(type = 'Manual Backup', sourceEntries = null) {
  try {
    const items = sourceEntries || (typeof entries !== 'undefined' && Array.isArray(entries) ? entries : []);
    const range = getEntryCoverageRange(items);
    const nowIso = new Date().toISOString();
    const meta = {
      takenAt: nowIso,
      fromDate: range.fromDate,
      toDate: range.toDate,
      fromText: range.fromText,
      toText: range.toText,
      count: range.count,
      rangeText: range.text,
      type: type
    };
    localStorage.setItem('wallet_backup_metadata', JSON.stringify(meta));
    localStorage.setItem('lastBackupDate', nowIso);
    updateBackupIndicatorDisplay();
    return meta;
  } catch(e) {
    console.warn('Could not record backup metadata:', e);
  }
}

function updateBackupIndicatorDisplay() {
  const dateEl = document.getElementById('gdriveLastBackupDate');
  const rangeEl = document.getElementById('gdriveBackupRange');
  const typeBadgeEl = document.getElementById('gdriveBackupTypeBadge');
  const typeEl = document.getElementById('gdriveBackupType');

  if (!dateEl || !rangeEl) return;

  let meta = null;
  try {
    const raw = localStorage.getItem('wallet_backup_metadata');
    if (raw) meta = JSON.parse(raw);
  } catch(e){}

  const lastBackupStr = (meta && meta.takenAt) || localStorage.getItem('lastBackupDate') || localStorage.getItem('lastAutoBackupDate');

  if (lastBackupStr) {
    try {
      const dt = new Date(lastBackupStr);
      const dateFormatted = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const timeFormatted = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      dateEl.textContent = `${dateFormatted}, ${timeFormatted}`;
    } catch(e) {
      dateEl.textContent = 'Recently';
    }
  } else {
    dateEl.textContent = 'None yet';
  }

  // Coverage range
  if (meta && meta.rangeText && meta.rangeText !== 'No entries') {
    rangeEl.textContent = meta.rangeText;
  } else {
    const curRange = getEntryCoverageRange(typeof entries !== 'undefined' ? entries : []);
    if (curRange && curRange.count > 0 && curRange.text !== 'No entries') {
      rangeEl.textContent = (lastBackupStr ? '' : 'Current: ') + curRange.text;
    } else {
      rangeEl.textContent = 'No entries';
    }
  }

  // Backup type badge (e.g. Google Drive, Weekly Cloud Snapshot, JSON File)
  if (typeBadgeEl && typeEl) {
    if (meta && meta.type) {
      typeEl.textContent = meta.type;
      typeBadgeEl.style.display = 'flex';
    } else {
      typeBadgeEl.style.display = 'none';
    }
  }

  // Also sync weekly backup card display if present
  if (typeof updateAutoBackupDisplay === 'function' && lastBackupStr) {
    updateAutoBackupDisplay(lastBackupStr);
  }
}

async function restoreWeeklyAutoBackup() {
  let snapshot = null;
  const curUid = (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid');

  if (navigator.onLine && firebaseReady && db && curUid) {
    try {
      const doc = await db.collection('users').doc(curUid).collection('backups').doc('weekly_snapshot').get();
      if (doc.exists && doc.data()) {
        snapshot = doc.data();
      }
    } catch(e){}
  }

  if (!snapshot) {
    try {
      const localSnap = localStorage.getItem('wallet_weekly_backup');
      if (localSnap) snapshot = JSON.parse(localSnap);
    } catch(e){}
  }

  if (!snapshot || !Array.isArray(snapshot.entries) || snapshot.entries.length === 0) {
    showNotification('No weekly backup snapshot found', 'info', '', { force: true });
    return;
  }

  const snapDate = snapshot.backupDate ? new Date(snapshot.backupDate).toLocaleString('en-IN') : 'Recent';
  const confirmed = await confirmAppAction(
    'Restore Weekly Backup?',
    `Restore ${snapshot.entries.length} entries from the weekly snapshot dated ${snapDate}?`,
    { confirmText: 'Restore Now', icon: 'ti-rotate-clockwise' }
  );
  if (!confirmed) return;

  entries = snapshot.entries;
  localStorage.setItem('entries', JSON.stringify(entries));
  if (curUid) localStorage.setItem('entries_user_' + curUid, JSON.stringify(entries));
  localStorage.setItem('wallet_protected_vault', JSON.stringify(entries));

  renderWallet();
  renderEntries();
  if (typeof renderAnalytics === 'function') renderAnalytics();
  if (typeof renderList === 'function') renderList();

  showNotification(`Restored ${entries.length} entries from weekly backup ✓`, 'success', '', { force: true });

  if (typeof loadEntriesFromFirebase === 'function') {
    try { loadEntriesFromFirebase(); } catch(e){}
  }
}

function exportDataAsJSON() {
 const data = {
 entries: entries,
 exportDate: new Date().toISOString()
 };
 const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = `ExpenseBackup_${Date.now()}.json`;
 a.click();
 URL.revokeObjectURL(url);
 showNotification('Backup downloaded!', 'success');
 localStorage.setItem('lastBackupDate', new Date().toISOString());
 if (typeof recordBackupMetadata === 'function') recordBackupMetadata('JSON Download');
 if (typeof hideBackupReminder === 'function') hideBackupReminder();
}

function triggerRestore() {
 document.getElementById('restoreInput').click();
}

// ═══════════════════════════════════════════════════════════════════════
// ONE-TIME FIX: tag old entries (saved before the userId bug was fixed)
// with the current account's uid, so they start showing up on every
// device again. Safe to run more than once — it only touches documents
// that don't already have a userId.
// ═══════════════════════════════════════════════════════════════════════
async function migrateOldEntriesUserId() {
 if (!firebaseReady || !db) {
  showNotification('Firebase not ready yet, try again in a moment', 'error', '', { force: true });
  return;
 }
 const targetUid = (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid');
 if (!targetUid) {
  showNotification('Please log in again first', 'error', '', { force: true });
  return;
 }

 if (!confirm('This will tag and restore all your cloud entries to this account, so they show up on your screen. Continue?')) return;

 showNotification('Syncing cloud entries… please wait', 'info', '', { force: true });

 try {
  // Clear deleted tombstones so older entries aren't filtered out
  localStorage.removeItem('deletedEntryIds');

  const snapshot = await db.collection('entries').get();
  const docsToUpdate = [];
  const validCloudEntries = [];

  snapshot.forEach(doc => {
   const data = doc.data();
   if (!data) return;
   // Match entries that either have no userId or belong to previous session/account
   if (!data.userId || data.userId !== targetUid) {
    docsToUpdate.push(doc.ref);
   }
   validCloudEntries.push({
    id: String(doc.id),
    party: data.party || 'Unknown',
    method: data.method || data.cat || 'Cash',
    amount: parseFloat(data.amount) || 0,
    type: normalizeType(data.type),
    date: normalizeDate(data.date),
    time: data.time || '',
    notes: data.notes || '',
    image: data.image || null,
    timestamp: data.timestamp || new Date().toISOString(),
    updatedAt: data.updatedAt || data.savedAt || new Date().toISOString(),
    userId: targetUid,
    syncedWithCloud: true
   });
  });

  const fixedCount = docsToUpdate.length;

  // Chunk batch updates in slices of 400 (Firestore limit is 500)
  for (let i = 0; i < docsToUpdate.length; i += 400) {
   const chunk = docsToUpdate.slice(i, i + 400);
   const batch = db.batch();
   chunk.forEach(ref => {
    batch.update(ref, { userId: targetUid });
   });
   await batch.commit();
  }

  // Update local memory & storage immediately
  if (validCloudEntries.length > 0) {
   entries = validCloudEntries;
   localStorage.setItem('entries', JSON.stringify(entries));
  }

  showNotification(`Fixed & synced ${fixedCount || validCloudEntries.length} cloud entries ✓`, 'success', '', { force: true });

  // Re-sync UI immediately
  try {
   await loadEntriesFromFirebase();
  } catch(e){}
  dedupeEntries();
  renderWallet();
  renderEntries();
  if (typeof renderAnalytics === 'function') renderAnalytics();
  if (typeof renderList === 'function') renderList();
 } catch (err) {
  console.error('Migration failed:', err);
  if (err && (err.code === 'permission-denied' || (err.message && err.message.toLowerCase().includes('permission')))) {
   showNotification('Firestore Permission Restricted', 'error', 'Your Firebase security rules require matching userId. Sign in with your original Google account or allow read in Firebase Console.', { force: true, persist: true });
  } else {
   showNotification('Fix failed: ' + (err.message || err), 'error', '', { force: true });
  }
 }
}

// 🛡️ EMERGENCY RECOVERY: Restore entries from protected vault & device backups
async function restoreFromProtectedVault() {
 let vaultEntries = [];
 try {
  const rawVault = localStorage.getItem('wallet_protected_vault');
  if (rawVault) {
   const parsed = JSON.parse(rawVault);
   if (Array.isArray(parsed)) vaultEntries = vaultEntries.concat(parsed);
  }
 } catch(e){}

 // Also check all entries_backup_* keys across any accounts previously used on this device
 try {
  for (let i = 0; i < localStorage.length; i++) {
   const key = localStorage.key(i);
   if (key && key.startsWith('entries_backup_')) {
    const raw = localStorage.getItem(key);
    if (raw) {
     const list = JSON.parse(raw);
     if (Array.isArray(list)) vaultEntries = vaultEntries.concat(list);
    }
   }
  }
 } catch(e){}

 // Deduplicate entries by unique ID
 const map = new Map();
 vaultEntries.forEach(e => {
  if (e && e.id) map.set(String(e.id), e);
 });

 const recovered = Array.from(map.values());
 if (recovered.length === 0) {
  showNotification('No entries found in vault to recover', 'info', '', { force: true });
  return;
 }

 if (!(await confirmAppAction('Restore from Vault?', `Found ${recovered.length} entries in the protected security vault. Do you want to restore and sync them to this account?`, { confirmText: 'Restore Now', icon: 'ti-shield-check' }))) {
  return;
 }

 // Clear any accidental tombstones so recovered entries are visible
 localStorage.removeItem('deletedEntryIds');

 const curUid = (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid');
 const nowIso = new Date().toISOString();

 const currentMap = new Map();
 if (Array.isArray(entries)) {
  entries.forEach(e => { if (e && e.id) currentMap.set(String(e.id), e); });
 }
 recovered.forEach(e => {
  if (!currentMap.has(String(e.id))) {
   currentMap.set(String(e.id), {
    ...e,
    userId: curUid || e.userId || null,
    updatedAt: e.updatedAt || nowIso
   });
  }
 });

 entries = Array.from(currentMap.values());
 entries.sort((a, b) => new Date(b.date || b.timestamp || 0) - new Date(a.date || a.timestamp || 0));

 localStorage.setItem('entries', JSON.stringify(entries));
 localStorage.setItem('wallet_protected_vault', JSON.stringify(entries));

 renderWallet();
 renderEntries();
 if (typeof renderAnalytics === 'function') renderAnalytics();
 if (typeof renderList === 'function') renderList();

 showNotification(`Restored ${entries.length} entries! Syncing to cloud...`, 'success', '', { force: true });

 // Upload all to Firebase Firestore
 if (firebaseReady && db && curUid) {
  entries.forEach(e => {
   const toUpload = {
    ...e,
    userId: curUid,
    savedAt: e.savedAt || nowIso,
    updatedAt: e.updatedAt || nowIso
   };
   db.collection('entries').doc(String(e.id)).set(toUpload, { merge: true })
    .then(() => {
     const idx = entries.findIndex(x => String(x.id) === String(e.id));
     if (idx > -1) entries[idx].syncedWithCloud = true;
    })
    .catch(err => console.warn('Cloud restore upload error:', err));
  });
 }
}

function handleFileSelect(event) {
 const file = event.target.files[0];
 if(!file) return;
 const reader = new FileReader();
 reader.onload = async (e) => {
 try {
 const backup = JSON.parse(e.target.result);
 entries = backup.entries || [];
 localStorage.removeItem('deletedEntryIds');

 // Save restored data to localStorage so it survives a refresh
 localStorage.setItem('entries', JSON.stringify(entries));

 showNotification(`Restored ${entries.length} entries! Syncing to cloud...`, 'success');
 renderRecent(); renderEntries();

 // Also push every restored entry to Firestore so it stays after refresh
 if(window.firebase && db) {
  try {
   for (const entry of entries) {
    if (!entry.userId) entry.userId = (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null;
    await db.collection('entries').doc(String(entry.id)).set(entry);
   }
   showNotification('Backup fully restored and synced ✓', 'success');
  } catch(syncErr) {
   console.error('Restore sync error:', syncErr);
   showNotification('Restored locally, but cloud sync failed', 'error');
  }
 }
 } catch(error) {
 showNotification('Error restoring backup!', 'error');
 }
 };
 reader.readAsText(file);
 event.target.value = '';
}

// ===== DELETED ENTRY HISTORY =====

function saveToDeletedHistory(entry) {
 const history = JSON.parse(localStorage.getItem('deletedEntries') || '[]');
 history.unshift({
  ...entry,
  deletedAt: new Date().toISOString()
 });
 localStorage.setItem('deletedEntries', JSON.stringify(history));
}

function openDeletedHistory() {
 const history = JSON.parse(localStorage.getItem('deletedEntries') || '[]');

 const listHtml = history.length === 0
  ? '<div class="empty-state" style="padding:30px 0;"><i class="ti ti-trash-off" style="font-size:28px;color:#1f2430;"></i><br>No deleted entries</div>'
  : history.map((e, idx) => `
   <div style="background:#1f2430;border-radius:12px;padding:12px 14px;margin-bottom:10px;display:flex;align-items:center;gap:10px;">
    <div style="flex:1;min-width:0;">
     <div style="font-size:14px;font-weight:600;">${e.party || 'Unknown'}</div>
     <div style="font-size:12px;color:#8b9099;margin-top:2px;">${e.date || ''} • ${e.method || ''}</div>
     <div style="font-size:11px;color:#5a606c;margin-top:2px;">Deleted: ${new Date(e.deletedAt).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
    </div>
    <div style="text-align:right;flex-shrink:0;">
     <div style="font-size:13px;font-weight:700;${e.type==='expense'?'color:#f06464':'color:#3ddc84'}">${e.type==='expense'?'-':'+'} ₹${Number(e.amount).toLocaleString('en-IN')}</div>
     <div style="display:flex;gap:6px;margin-top:6px;">
      <button onclick="restoreDeletedEntry(${idx})" style="font-size:11px;padding:4px 8px;border:none;border-radius:6px;background:rgba(61,220,132,.2);color:#3ddc84;cursor:pointer;font-family:'Inter',sans-serif;font-weight:600;">Restore</button>
      <button onclick="viewDeletedEntry(${idx})" style="font-size:11px;padding:4px 8px;border:none;border-radius:6px;background:rgba(91,140,255,.2);color:#5b8cff;cursor:pointer;font-family:'Inter',sans-serif;font-weight:600;">View</button>
      <button onclick="permanentDeleteEntry(${idx})" style="font-size:11px;padding:4px 8px;border:none;border-radius:6px;background:rgba(240,100,100,.15);color:#f06464;cursor:pointer;font-family:'Inter',sans-serif;font-weight:600;">Delete</button>
     </div>
    </div>
   </div>`).join('');

 const modalHtml = `
  <div class="modal-bg active" id="deletedHistoryModal">
   <div class="modal" style="max-width:420px;">
    <div class="modal-header">
     <h3 style="font-size:16px;">Deleted Entry History</h3>
     <button class="modal-close" onclick="document.getElementById('deletedHistoryModal').remove()">&times;</button>
    </div>
    <div class="modal-body" style="max-height:65vh;overflow-y:auto;">
     ${listHtml}
    </div>
    ${history.length > 0 ? `
    <div style="padding-top:8px;">
     <button onclick="clearAllDeletedHistory()" style="width:100%;padding:11px;border:1px solid #f06464;border-radius:12px;background:transparent;color:#f06464;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;font-size:13px;">Clear All History</button>
    </div>` : ''}
   </div>
  </div>`;

 document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function viewDeletedEntry(idx) {
 const history = JSON.parse(localStorage.getItem('deletedEntries') || '[]');
 const e = history[idx];
 if (!e) return;

 const viewHtml = `
  <div class="modal-bg active" id="viewDeletedModal">
   <div class="modal" style="max-width:380px;">
    <div class="modal-header">
     <h3 style="font-size:16px;color:#e8b64c;">Entry Details</h3>
     <button class="modal-close" onclick="document.getElementById('viewDeletedModal').remove()">&times;</button>
    </div>
    <div class="modal-body">
     <div class="field-row" style="cursor:default;">
      <div class="ico"><i class="ti ti-user"></i></div>
      <div class="ftext"><div class="flabel">Party Name</div><div class="fval">${e.party || 'Unknown'}</div></div>
     </div>
     <div class="field-row" style="cursor:default;">
      <div class="ico"><i class="ti ti-currency-rupee"></i></div>
      <div class="ftext"><div class="flabel">Amount</div><div class="fval" style="${e.type==='expense'?'color:#f06464':'color:#3ddc84'}">₹ ${Number(e.amount).toLocaleString('en-IN')} (${e.type})</div></div>
     </div>
     <div class="field-row" style="cursor:default;">
      <div class="ico"><i class="ti ti-calendar"></i></div>
      <div class="ftext"><div class="flabel">Date</div><div class="fval">${e.date || 'N/A'}</div></div>
     </div>
     <div class="field-row" style="cursor:default;">
      <div class="ico"><i class="ti ti-credit-card"></i></div>
      <div class="ftext"><div class="flabel">Method</div><div class="fval">${e.method || 'N/A'}</div></div>
     </div>
     ${e.notes ? `<div class="field-row" style="cursor:default;"><div class="ico"><i class="ti ti-note"></i></div><div class="ftext"><div class="flabel">Notes</div><div class="fval">${e.notes}</div></div></div>` : ''}
     <div class="field-row" style="cursor:default;">
      <div class="ico"><i class="ti ti-trash"></i></div>
      <div class="ftext"><div class="flabel">Deleted At</div><div class="fval" style="font-size:12px;">${new Date(e.deletedAt).toLocaleString('en-IN')}</div></div>
     </div>
    </div>
   </div>
  </div>`;

 document.body.insertAdjacentHTML('beforeend', viewHtml);
}

async function permanentDeleteEntry(idx) {
 if (!(await confirmAppAction('Permanent delete?', 'This entry will be permanently deleted. This action cannot be undone.', { danger: true, confirmText: 'Delete forever', icon: 'ti-trash' }))) return;
 const history = JSON.parse(localStorage.getItem('deletedEntries') || '[]');
 history.splice(idx, 1);
 localStorage.setItem('deletedEntries', JSON.stringify(history));
 showNotification('Entry permanently deleted', 'success');
 const modal = document.getElementById('deletedHistoryModal');
 if (modal) modal.remove();
 openDeletedHistory();
}

async function restoreDeletedEntry(idx) {
 const history = JSON.parse(localStorage.getItem('deletedEntries') || '[]');
 const entry = history[idx];
 if (!entry) return;

 const entryId = String(entry.id);
 untrackDeletedEntryId(entryId);

 history.splice(idx, 1);
 localStorage.setItem('deletedEntries', JSON.stringify(history));

 const nowIso = new Date().toISOString();
 const restored = {
  ...entry,
  id: entryId,
  updatedAt: nowIso,
  syncedWithCloud: false
 };
 delete restored.deletedAt;

 entries.unshift(restored);
 localStorage.setItem('entries', JSON.stringify(entries));

 if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
 renderWallet();
 renderEntries();
 renderAnalytics();
 if (typeof renderList === 'function') renderList();

 if (typeof queueOfflineSync === 'function') queueOfflineSync('set', restored);
 if (firebaseReady && db) {
  db.collection('entries').doc(entryId).set(restored, { merge: true }).catch(()=>{});
 }

 showNotification('Entry restored successfully ✓', 'success');
 const modal = document.getElementById('deletedHistoryModal');
 if (modal) modal.remove();
 openDeletedHistory();
}


async function clearAllDeletedHistory() {
 if (!(await confirmAppAction('Clear history?', 'All deleted entries in the Recycle Bin will be permanently cleared.', { danger: true, confirmText: 'Clear all', icon: 'ti-trash' }))) return;
 localStorage.removeItem('deletedEntries');
 showNotification('Deleted history cleared', 'success');
 const modal = document.getElementById('deletedHistoryModal');
 if (modal) modal.remove();
}

// Welcome messages
const welcomeMessagesMorning = [
    "Good morning, have a great day.",
    "Morning! Take a quick look at today's plan.",
    "Awake? Let’s check the budget/accounts now.",
    
];

const welcomeMessagesSunday = [
    "Chill today, but check the budget too.",
    "Relax, there is no rush today.",
    "Check your wallet while sipping your tea.",
    "Weekend vibes—everything is under control."
];

const welcomeMessagesAfternoon = [
    "How is your day going?",
    "Take a break, then keep moving.",
    "Half day done, keep going forward.",
    "Take a quick look at your wallet.",
    "Stop work for a bit, time for tea?"
];
const welcomeMessagesEvening = [
    "How was your day today?",
    "Relax a bit, you worked hard all day.",
    "Did you add all today's entries?",
    "It's evening, a tea break is a must."
];
const welcomeMessagesNight = [
    "Make a plan for tomorrow.",
    "Rest up, tomorrow is a new day.",
    "Did you check today's budget?",
    "Get enough sleep, see you tomorrow."
];

function updateGreeting() {
    const greetingElement = document.getElementById('greetingText');
    if(!greetingElement) {
        console.warn('greetingText element not found');
        return;
    }

    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 मतलब Sunday, 1 मतलब Monday...
    const hour = now.getHours();

    // अभी कौनसा period चल रहा है, वो पता करते हैं
    let periodKey = '';
    if (dayOfWeek === 0) {
        periodKey = 'sunday';
    } else if (hour >= 5 && hour < 12) {
        periodKey = 'morning';
    } else if (hour >= 12 && hour < 17) {
        periodKey = 'afternoon';
    } else if (hour >= 17 && hour < 23) {
        periodKey = 'evening';
    } else {
        periodKey = 'night';
    }

    function getGreetingUserName() {
        if (currentUser && (currentUser.displayName || currentUser.name)) {
            return currentUser.displayName || currentUser.name;
        }
        if (window.APP_CONFIG && window.APP_CONFIG.defaultUserName) {
            return window.APP_CONFIG.defaultUserName;
        }
        return '';
    }
    const gUser = getGreetingUserName();
    const gSuffix = gUser ? ' ' + gUser : '';

    // हर period की base greeting और उसका message pool
    const greetingConfig = {
        sunday:    { base: 'Happy Sunday' + gSuffix + ' ☀️', pool: welcomeMessagesSunday },
        morning:   { base: 'Morning' + gSuffix + ' ☀️',       pool: welcomeMessagesMorning },
        afternoon: { base: 'Afternoon' + gSuffix + ' 🌤️',     pool: welcomeMessagesAfternoon },
        evening:   { base: 'Evening' + gSuffix,          pool: welcomeMessagesEvening },
        night:     { base: 'Good Night' + gSuffix + ' 🌙',    pool: welcomeMessagesNight }
    };

    const config = greetingConfig[periodKey];
    const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

    // localStorage से पिछली state पढ़ते हैं
    let state = {};
    try {
        state = JSON.parse(localStorage.getItem('greetingRotationState')) || {};
    } catch (e) {
        state = {};
    }

    let greetingText;

    if (state.date !== todayStr || state.period !== periodKey) {
        // इस period में आज पहली बार app खुला है -> base greeting दिखाओ
        greetingText = config.base;
        state = { date: todayStr, period: periodKey, lastIndex: -1 };
    } else {
        // इसी period में app पहले भी खुल चुका है -> pool से अगला message दिखाओ (उसी जगह)
        const pool = config.pool;
        let nextIndex = state.lastIndex + 1;
        if (nextIndex >= pool.length) {
            nextIndex = 0;
        }
        greetingText = pool[nextIndex];
        state.lastIndex = nextIndex;
    }

    localStorage.setItem('greetingRotationState', JSON.stringify(state));
    greetingElement.textContent = greetingText;
}

function updateDateDisplay() {
    const dateElement = document.getElementById('todayDate');
    if(!dateElement) {
        console.warn('todayDate element not found');
        return;
    }

    const options = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };

    const today = new Date().toLocaleDateString('en-IN', options);
    dateElement.textContent = today;
}


// ===== 4-DIGIT PIN LOCK & WEBAUTHN BIOMETRIC SECURITY SYSTEM =====
var pinEntered = "";
var pinFirstEntry = "";
var pinMode = localStorage.getItem('appPin') ? 'verify' : 'create';

function pinUpdateDots(){
 const dotsContainer = document.getElementById('pinDots');
 if(!dotsContainer) return;
 const dots = dotsContainer.querySelectorAll('span');
 dots.forEach((d,i)=> d.classList.toggle('filled', i < pinEntered.length));
}

function pinPress(num){
 if(pinEntered.length >= 4) return;
 pinEntered += num;
 pinUpdateDots();
 document.getElementById('pinErrorText').textContent = "";
 if(pinEntered.length === 4) setTimeout(pinSubmit, 150);
}

function pinClear(){
 pinEntered = "";
 pinUpdateDots();
 document.getElementById('pinErrorText').textContent = "";
}

function pinBackspace(){
 pinEntered = pinEntered.slice(0,-1);
 pinUpdateDots();
}

// ===== Native phone keyboard support for the PIN screen =====
function focusPinHiddenInput(){
 const inp = document.getElementById('pinHiddenInput');
 if(inp){ inp.value = ""; inp.focus(); }
}
(function setupPinHiddenInput(){
 const inp = document.getElementById('pinHiddenInput');
 if(!inp) return;
 inp.addEventListener('input', function(){
  const digit = this.value.replace(/[^0-9]/g, '').slice(-1);
  this.value = "";
  if(digit) pinPress(digit);
 });
 inp.addEventListener('keydown', function(e){
  if(e.key === 'Backspace') pinBackspace();
 });
})();

// Web Crypto SHA-256 PIN hashing & verification
async function hashPin(pin) {
  if (!window.crypto || !window.crypto.subtle) {
    let hash = 0;
    for (let i = 0; i < pin.length; i++) hash = ((hash << 5) - hash) + pin.charCodeAt(i) | 0;
    return 'h_' + hash;
  }
  const encoder = new TextEncoder();
  const data = encoder.encode('daytoday_pin_' + pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPin(enteredPin, storedValue) {
  if (!storedValue) return false;
  // If stored value is legacy plaintext 4-digit PIN, compare directly & migrate to hash
  if (/^\d{4}$/.test(storedValue)) {
    if (enteredPin === storedValue) {
      const hashed = await hashPin(enteredPin);
      localStorage.setItem('appPin', hashed);
      return true;
    }
    return false;
  }
  const hashed = await hashPin(enteredPin);
  return hashed === storedValue;
}

async function pinSubmit(){
 const storedPin = localStorage.getItem('appPin');

 if(pinMode === 'create'){
   if(!pinFirstEntry){
     pinFirstEntry = pinEntered;
     pinEntered = "";
     pinUpdateDots();
     document.getElementById('pinTitleText').textContent = "Confirm PIN";
     document.getElementById('pinSubText').textContent = "Re-enter your PIN";
   } else {
     if(pinEntered === pinFirstEntry){
       const hashed = await hashPin(pinEntered);
       localStorage.setItem('appPin', hashed);
       pinUnlockApp();
     } else {
       document.getElementById('pinErrorText').textContent = "PIN didn't match, please try again"; pinShakeDots();
       pinFirstEntry = "";
       pinEntered = "";
       pinUpdateDots();
       document.getElementById('pinTitleText').textContent = "Set a PIN";
       document.getElementById('pinSubText').textContent = "Create a new 4-digit PIN";
     }
   }
 } else {
   const isCorrect = await verifyPin(pinEntered, storedPin);
   if(isCorrect){
     pinUnlockApp();
   } else {
     document.getElementById('pinErrorText').textContent = "Wrong PIN, please try again"; pinShakeDots();
     pinEntered = "";
     pinUpdateDots();
   }
 }
}

function pinUnlockApp(){
  document.getElementById('pinLockScreen').style.display = "none";
  const appContainer = document.getElementById('app');
  if (appContainer) {
    appContainer.style.display = 'block';
    appContainer.classList.remove('app-blurred');
  }
  autoLockPending = false;
  updateProfileEmail();
  checkAndShowReminderPopup();
  syncBiometricSettingsDisplay();
  resetInactivityTimer();
  if (typeof updateNavIndicator === 'function') {
    requestAnimationFrame(() => updateNavIndicator(typeof currentAppScreen !== 'undefined' ? currentAppScreen : 'wallet'));
  }

  if (typeof loadEntriesFromFirebase === 'function') {
    loadEntriesFromFirebase().then(() => {
      if (typeof dedupeEntries === 'function') dedupeEntries();
      renderWallet();
      if (typeof renderEntries === 'function') renderEntries();
      if (document.getElementById('screen-analytics')?.classList.contains('active') && typeof renderAnalytics === 'function') {
        renderAnalytics();
      }
    }).catch(err => console.warn('Post-unlock cloud sync failed:', err));
  }
}

async function resetAppPin(){
 if(!(await confirmAppAction('Reset PIN?', 'Naya PIN next time set karna hoga.', { danger: true, confirmText: 'Reset PIN', icon: 'ti-lock-open' }))) return;
 localStorage.removeItem('appPin');
 showNotification('PIN has been reset', 'success');
}

// ═══════════════════════════════════════════════════════════════════════
// ===== WEBAUTHN FINGERPRINT BIOMETRIC SYSTEM =====
// ═══════════════════════════════════════════════════════════════════════

function isSecureWebAuthnContext() {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  if (location.protocol === 'https:') return true;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return true;
  return false;
}

function webauthnAvailable() {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && isSecureWebAuthnContext();
}

async function platformAuthAvailable() {
  if (!webauthnAvailable()) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch(e) {
    return false;
  }
  return true;
}

async function registerBiometric(userId, userName) {
  if (!isSecureWebAuthnContext()) {
    throw new Error("Biometric WebAuthn requires HTTPS connection or http://localhost server. Please use 4-Digit PIN Lock.");
  }
  if (!webauthnAvailable()) {
    throw new Error("WebAuthn is not supported on this device/browser.");
  }
  const uId = userId || (currentUser && currentUser.uid) || 'user_' + Date.now();
  const uName = userName || (currentUser && currentUser.name) || 'DayToDay User';
  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);

  const rpConfig = { name: "DayToDay Safety Vault" };
  // Only pass id if not an IP address (WebAuthn forbids IP addresses in rp.id)
  if (location.hostname && !/^[0-9.]+$/.test(location.hostname) && location.hostname !== 'localhost') {
    rpConfig.id = location.hostname;
  }

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: challenge,
      rp: rpConfig,
      user: {
        id: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        name: "device_user",
        displayName: "Device User",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 }
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
      },
      timeout: 60000,
    },
  });

  if (!cred) throw new Error("Biometric registration cancelled");
  
  const rawIdB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(cred.rawId)));
  localStorage.setItem('biometricCredId', rawIdB64);
  localStorage.setItem('biometricEnabled', '1');
  syncBiometricSettingsDisplay();
  return rawIdB64;
}

async function handleBiometricAuth() {
  if (navigator.vibrate) navigator.vibrate(50);
  
  const errEl = document.getElementById('pinErrorText');
  if (errEl) errEl.textContent = "";

  if (!isSecureWebAuthnContext()) {
    if (errEl) errEl.textContent = "Fingerprint requires HTTPS or localhost. Please use 4-digit PIN.";
    focusPinHiddenInput();
    return;
  }

  const isEnabled = localStorage.getItem('biometricEnabled') === '1';
  const credId = localStorage.getItem('biometricCredId');

  if (webauthnAvailable() && isEnabled && credId) {
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const rawIdBytes = Uint8Array.from(atob(credId), c => c.charCodeAt(0));

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: challenge,
          allowCredentials: [{ type: "public-key", id: rawIdBytes }],
          userVerification: "preferred",
          timeout: 60000,
        },
      });

      if (assertion) {
        if (navigator.vibrate) navigator.vibrate([40, 60]);
        showNotification("Biometric unlock successful! ✓", "success");
        pinUnlockApp();
        return;
      }
    } catch (e) {
      console.warn("Biometric authentication error/cancelled:", e);
      if (errEl && e.name !== 'NotAllowedError') {
        errEl.textContent = e.message || "Biometric unlock failed";
      }
    }
  }

  if (!credId || !isEnabled) {
    if (await platformAuthAvailable()) {
      try {
        const uId = (currentUser && currentUser.uid) || 'default_user';
        const uName = (currentUser && currentUser.email) || 'User';
        await registerBiometric(uId, uName);
        showNotification("Fingerprint lock enabled! ✓", "success");
        pinUnlockApp();
        return;
      } catch(err) {
        console.warn("Biometric setup prompt error:", err);
        if (errEl) errEl.textContent = err.message || "Fingerprint setup cancelled";
      }
    } else {
      if (errEl) errEl.textContent = "No biometric sensor detected. Enter PIN.";
    }
  }
  
  focusPinHiddenInput();
}

function handleBiometricOrKeypad() {
  handleBiometricAuth();
}

function toggleBiometricLockSettings() {
  const isEnabled = localStorage.getItem('biometricEnabled') === '1';
  if (isEnabled) {
    localStorage.removeItem('biometricEnabled');
    localStorage.removeItem('biometricCredId');
    syncBiometricSettingsDisplay();
    showNotification("Fingerprint lock disabled", "info");
  } else {
    if (!isSecureWebAuthnContext()) {
      showNotification("Fingerprint sensor requires HTTPS or http://localhost server connection. Use 4-Digit PIN Lock below.", "warning");
      return;
    }
    platformAuthAvailable().then(avail => {
      if (!avail) {
        showNotification("Biometric sensor not available on this device", "warning");
        return;
      }
      const uId = (currentUser && currentUser.uid) || 'default_user';
      const uName = (currentUser && currentUser.email) || 'User';
      registerBiometric(uId, uName).then(() => {
        showNotification("Fingerprint lock set up & enabled! ✓", "success");
      }).catch(err => {
        let msg = err.message || "Biometric setup failed";
        if (msg.includes("Public-key credentials") || msg.includes("HTTPS")) {
          msg = "Fingerprint sensor requires HTTPS or http://localhost server. Use 4-Digit PIN Lock below.";
        }
        showNotification(msg, "warning");
      });
    });
  }
}

function syncBiometricSettingsDisplay() {
  const el = document.getElementById('settingsBiometricStatus');
  if (el) {
    const isEnabled = localStorage.getItem('biometricEnabled') === '1';
    el.textContent = isEnabled ? "ON" : "OFF";
    el.style.color = isEnabled ? "#3ddc84" : "#0ea5e9";
  }
}

// ===== INACTIVITY AUTO-LOCK SYSTEM =====
let inactivityTimer = null;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

let _lastInactivityReset = 0;
function resetInactivityTimer() {
  const _n = Date.now();
  if (_n - _lastInactivityReset < 1000) return; // scroll/touchmove par har event pe localStorage read + timer reset band
  _lastInactivityReset = _n;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (typeof DEV_SKIP_LOGIN_AND_PIN !== 'undefined' && DEV_SKIP_LOGIN_AND_PIN) return;
  if (!localStorage.getItem('appPin')) return;
  const appContainer = document.getElementById('app');
  if (appContainer && appContainer.style.display !== 'none') {
    inactivityTimer = setTimeout(() => {
      console.log("Auto-locking due to inactivity...");
      triggerAutoLock();
    }, INACTIVITY_TIMEOUT_MS);
  }
}

['touchstart', 'touchmove', 'mousemove', 'keydown', 'click', 'scroll'].forEach(evt => {
  window.addEventListener(evt, resetInactivityTimer, { passive: true });
});

// ===== AUTO-LOCK ON APP SWITCH =====
let autoLockPending = false;
let _appHiddenTimestamp = 0;

function triggerAutoLock(){
  if (typeof DEV_SKIP_LOGIN_AND_PIN !== 'undefined' && DEV_SKIP_LOGIN_AND_PIN) return;
  const appContainer = document.getElementById('app');
  const pinScreen = document.getElementById('pinLockScreen');
  if (!appContainer || !pinScreen) return;

  // Don't auto-lock while user is picking a file (e.g. QR upload) or auth is in progress
  if (window.__isPickingFile || window.__authInProgress) return;
  if (appContainer.style.display === 'none') return;
  if (!localStorage.getItem('appPin')) return;
  if (pinScreen.style.display === 'flex') return;

  // Close all open modals, chats, sheets so NOTHING leaks or shows around lock screen
  if (typeof closeAiChatModal === 'function') closeAiChatModal();
  if (typeof closeQuickAdd === 'function') closeQuickAdd();
  try { if (typeof stopAiMicRecording === 'function') stopAiMicRecording(false); } catch(e){}
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch(e){}
  try {
    document.querySelectorAll('.modal.show, .custom-modal.active, .sheet-modal.active, #quickAddModal.active').forEach(m => {
      m.classList.remove('show', 'active');
      m.style.display = 'none';
    });
  } catch(e){}

  appContainer.classList.add('app-blurred');

  pinEntered = "";
  pinFirstEntry = "";
  pinMode = 'verify';
  const titleEl = document.getElementById('pinTitleText');
  const subEl = document.getElementById('pinSubText');
  if (titleEl) titleEl.textContent = "Hello Again!";
  if (subEl) subEl.textContent = "Enter your 4-digit PIN to continue";
  const fpinLink = document.getElementById('forgotPinLink');
  if (fpinLink) fpinLink.style.display = '';
  pinUpdateDots();
  const errEl = document.getElementById('pinErrorText');
  if (errEl) errEl.textContent = "";

  pinScreen.style.display = 'flex';
  autoLockPending = false;
  if (localStorage.getItem('biometricEnabled') === '1') {
    setTimeout(() => {
      if (pinScreen && pinScreen.style.display === 'flex') handleBiometricAuth();
    }, 250);
  }
}

function handleAppVisibilityChange(){
  if (window.__isPickingFile || window.__authInProgress) return;
  if (document.hidden) {
    _appHiddenTimestamp = Date.now();
  } else {
    // Only lock if document was hidden for more than 45 seconds
    if (_appHiddenTimestamp && (Date.now() - _appHiddenTimestamp > 45000)) {
      triggerAutoLock();
    }
    _appHiddenTimestamp = 0;
  }
}
document.addEventListener('visibilitychange', handleAppVisibilityChange);


// ===== Monthly Budget Warning Alert System =====
const MONTHLY_BUDGET_KEY = 'monthly_budget_limit';
const DEFAULT_MONTHLY_BUDGET = 20000;
let dismissedBudgetAlertMonth = null;

function syncProfileBudgetLimitDisplay(){
 const amt = '₹' + getMonthlyBudgetLimit().toLocaleString('en-IN');
 ['profileBudgetLimitDisplay', 'settingsBudgetLimitDisplay'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.textContent = amt;
 });
}

function getMonthlyBudgetLimit(){
 try {
  const v = localStorage.getItem(MONTHLY_BUDGET_KEY);
  if (v !== null && !isNaN(v) && Number(v) > 0) return Number(v);
 } catch(e){}
 return DEFAULT_MONTHLY_BUDGET;
}

function setMonthlyBudgetLimit(amount){
 const amt = Number(amount);
 if (!isNaN(amt) && amt > 0) {
  localStorage.setItem(MONTHLY_BUDGET_KEY, String(amt));
  syncProfileBudgetLimitDisplay();
  renderWallet();
  if (typeof showNotification === 'function') showNotification(`Monthly budget ₹${amt.toLocaleString('en-IN')} set!`, 'success');
 }
}

function checkMonthlyBudgetAlert(){
 const banner = document.getElementById('monthlyBudgetAlertBanner');
 if (!banner) return;

 const now = new Date();
 const curYear = now.getFullYear();
 const curMonth = now.getMonth();
 const curMonthKey = `${curYear}-${String(curMonth + 1).padStart(2, '0')}`;

 if (dismissedBudgetAlertMonth === curMonthKey) {
  banner.style.display = 'none';
  return;
 }

 let curMonthExpense = 0;
 if (Array.isArray(entries)) {
  entries.forEach(e => {
   if (e && e.type === 'expense' && e.date) {
    const d = new Date(e.date);
    if (d.getFullYear() === curYear && d.getMonth() === curMonth) {
     curMonthExpense += Number(e.amount) || 0;
    }
   }
  });
 }

 const budgetLimit = getMonthlyBudgetLimit();
 const usedPct = budgetLimit > 0 ? Math.round((curMonthExpense / budgetLimit) * 100) : 0;

 const iconEl = document.getElementById('budgetAlertIcon');
 const titleEl = document.getElementById('budgetAlertTitle');
 const subEl = document.getElementById('budgetAlertSub');
 const fillEl = document.getElementById('budgetAlertProgressFill');
 const spentEl = document.getElementById('budgetAlertSpentText');
 const limitEl = document.getElementById('budgetAlertLimitText');

 if (usedPct >= 80) {
  banner.style.display = 'block';
  if (usedPct >= 100) {
   banner.className = 'budget-alert-card critical';
   if (iconEl) iconEl.textContent = '🚨';
   if (titleEl) titleEl.textContent = 'Budget Limit Exceeded!';
   if (subEl) subEl.textContent = `You have spent ${usedPct}% of your monthly budget limit (₹${budgetLimit.toLocaleString('en-IN')})!`;
   if (fillEl) {
    fillEl.style.width = '100%';
    fillEl.className = 'budget-progress-bar-fill critical';
   }
  } else {
   banner.className = 'budget-alert-card warning';
   if (iconEl) iconEl.textContent = '⚠️';
   if (titleEl) titleEl.textContent = 'Monthly Budget Warning';
   if (subEl) subEl.textContent = `You have spent ${usedPct}% of your monthly budget limit!`;
   if (fillEl) {
    fillEl.style.width = `${Math.min(100, usedPct)}%`;
    fillEl.className = 'budget-progress-bar-fill warning';
   }
  }
  if (spentEl) spentEl.textContent = `Spent: ₹${curMonthExpense.toLocaleString('en-IN')} (${usedPct}%)`;
  if (limitEl) limitEl.textContent = `Limit: ₹${budgetLimit.toLocaleString('en-IN')}`;
 } else {
  banner.style.display = 'none';
 }
}

function dismissMonthlyBudgetAlert(){
 const now = new Date();
 dismissedBudgetAlertMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
 const banner = document.getElementById('monthlyBudgetAlertBanner');
 if (banner) banner.style.display = 'none';
}

function openEditMonthlyBudgetModal(){
 const modal = document.getElementById('editMonthlyBudgetModal');
 const input = document.getElementById('monthlyBudgetInput');
 if (input) input.value = getMonthlyBudgetLimit();
 if (modal) modal.style.display = 'flex';
}

function closeEditMonthlyBudgetModal(){
 const modal = document.getElementById('editMonthlyBudgetModal');
 if (modal) modal.style.display = 'none';
}

function saveMonthlyBudgetLimit(){
 const input = document.getElementById('monthlyBudgetInput');
 if (!input) return;
 const val = parseFloat(input.value);
 if (isNaN(val) || val <= 0) {
  showNotification("Please enter a valid budget amount (e.g. 20000)", "warning");
  return;
 }
 dismissMonthlyBudgetAlert();
 dismissedBudgetAlertMonth = null;
 setMonthlyBudgetLimit(val);
 closeEditMonthlyBudgetModal();
}

function renderWallet() {
    renderDashboardTotals();
    renderRecent();
    renderPaymentMethodWidget();
    renderRtCarousel();
    checkBackupReminder();
    checkMonthlyBudgetAlert();
    syncProfileBudgetLimitDisplay();
}

// ===== Payment Method widget (Wallet/home screen) =====
// Displays ALL configured payment methods (Cash, UPI, SBI 8974, PNB 1907, custom methods).
// Current calendar month's EXPENSE entries only, grouped by method.
const PAYMENT_METHOD_PRESETS = {
  cash: { name: 'Cash', color: '#22c55e', icon: 'ti-wallet' },
  upi:  { name: 'UPI',  color: '#8b5cf6', icon: 'ti-qrcode' },
  'sbi 8974': { name: 'SBI 8974', color: '#0284c7', icon: 'ti-building-bank' },
  'pnb 1907': { name: 'PNB 1907', color: '#f59e0b', icon: 'ti-building-bank' },
  bank: { name: 'Bank', color: '#3b82f6', icon: 'ti-building-bank' },
  card: { name: 'Card', color: '#f43f5e', icon: 'ti-credit-card' }
};

function getPaymentMethodMeta(method) {
  const m = (method || '').trim();
  const lower = m.toLowerCase();

  if (PAYMENT_METHOD_PRESETS[lower]) {
    return { ...PAYMENT_METHOD_PRESETS[lower], name: m };
  }
  if (lower === 'cash') return { name: m, color: '#22c55e', icon: 'ti-wallet' };
  if (lower.includes('upi') || lower.includes('phonepe') || lower.includes('gpay') || lower.includes('paytm')) {
    return { name: m, color: '#8b5cf6', icon: 'ti-qrcode' };
  }
  if (lower.includes('sbi')) return { name: m, color: '#0284c7', icon: 'ti-building-bank' };
  if (lower.includes('pnb')) return { name: m, color: '#f59e0b', icon: 'ti-building-bank' };
  if (lower.includes('hdfc')) return { name: m, color: '#004c8f', icon: 'ti-building-bank' };
  if (lower.includes('icici')) return { name: m, color: '#ea580c', icon: 'ti-building-bank' };
  if (lower.includes('axis')) return { name: m, color: '#9d174d', icon: 'ti-building-bank' };
  if (lower.includes('card')) return { name: m, color: '#f43f5e', icon: 'ti-credit-card' };
  if (lower.includes('bank')) return { name: m, color: '#3b82f6', icon: 'ti-building-bank' };

  // Fallback palette for any custom user methods
  const fallbackColors = ['#10b981', '#06b6d4', '#ec4899', '#14b8a6', '#6366f1', '#eab308', '#84cc16', '#a855f7'];
  let hash = 0;
  for (let i = 0; i < m.length; i++) hash = (hash * 31 + m.charCodeAt(i)) >>> 0;
  const color = fallbackColors[hash % fallbackColors.length];
  return { name: m, color, icon: getPaymentIcon(m) };
}

// Proxy wrapper for backward-compatibility with any PAYMENT_METHOD_META[key] lookups
const PAYMENT_METHOD_META = new Proxy({
  Cash: { color: '#22c55e', icon: 'ti-wallet' },
  UPI:  { color: '#8b5cf6', icon: 'ti-qrcode' },
  'SBI 8974': { color: '#0284c7', icon: 'ti-building-bank' },
  'PNB 1907': { color: '#f59e0b', icon: 'ti-building-bank' },
  Bank: { color: '#3b82f6', icon: 'ti-building-bank' },
  Card: { color: '#f43f5e', icon: 'ti-credit-card' }
}, {
  get(target, prop) {
    if (typeof prop === 'string' && prop in target) return target[prop];
    if (typeof prop === 'string') return getPaymentMethodMeta(prop);
    return target[prop];
  }
});

let pmSelectedMethod = null;

function selectPaymentMethod(encodedMethod){
  const method = decodeURIComponent(encodedMethod);
  pmSelectedMethod = (pmSelectedMethod === method) ? null : method;
  renderPaymentMethodWidget();
}

function renderPaymentMethodWidget(){
  const listEl = document.getElementById('paymentMethodList');
  if (!listEl) return;

  const now = new Date();
  const curMonth = now.getMonth(), curYear = now.getFullYear();
  const allEntries = (typeof entries !== 'undefined' ? entries : []);

  // Fetch all payment methods configured in the app (default + custom + entries)
  const allMethods = getAllPaymentMethods();

  // Calculate totals per payment method for current calendar month's expense entries
  const totals = {};
  allMethods.forEach(m => { totals[m] = 0; });

  allEntries.forEach(e => {
    if (e.type !== 'expense') return;
    const d = new Date(e.date);
    if (d.getFullYear() !== curYear || d.getMonth() !== curMonth) return;
    const m = (e.method || 'Cash').trim();
    if (totals[m] === undefined) {
      totals[m] = 0;
      if (!allMethods.includes(m)) allMethods.push(m);
    }
    totals[m] += Number(e.amount) || 0;
  });

  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

  // Filter ONLY active payment methods that have expenses in current calendar month
  const activeMethods = allMethods.filter(m => (totals[m] || 0) > 0);
  // Sort descending by expense amount
  activeMethods.sort((a, b) => (totals[b] || 0) - (totals[a] || 0));

  const activeSlices = activeMethods.map(m => {
    const amt = totals[m] || 0;
    const pct = grandTotal > 0 ? (amt / grandTotal) * 100 : 0;
    const meta = getPaymentMethodMeta(m);
    return {
      name: m,
      amt: amt,
      pct: pct,
      color: meta.color,
      icon: meta.icon
    };
  });

  // If selected method is not among this month's active methods, clear selection
  if (pmSelectedMethod && !activeSlices.some(s => s.name === pmSelectedMethod)) {
    pmSelectedMethod = null;
  }

  // If no expenses in current calendar month, show clean empty state
  if (activeSlices.length === 0 || grandTotal <= 0) {
    listEl.innerHTML = `
      <div style="text-align:center;padding:16px 10px;color:#94a3b8;font-size:12px;background:rgba(255,255,255,0.02);border-radius:12px;border:1px dashed rgba(255,255,255,0.08);margin-top:6px;">
        <i class="ti ti-credit-card-off" style="font-size:20px;display:block;margin-bottom:5px;opacity:0.6;"></i>
        No payment method expenses recorded this month
      </div>
    `;
    return;
  }

  // Month total amount only (thick stack bar below is the real breakdown)
  const monthTotalHtml = `
    <div class="pm-total-front">
      <div class="pm-total-amt">₹${grandTotal.toLocaleString('en-IN')}</div>
    </div>
  `;

  // Stacked bar (proportional colored segments for methods with spending)
  const barSegsHtml = activeSlices.map(s => `
    <div class="pm-stackbar-seg${pmSelectedMethod && pmSelectedMethod !== s.name ? ' dim' : ''}"
         style="width:${s.pct}%;background:${s.color};"
         title="${escapePartyHtml(s.name)}: ₹${s.amt.toLocaleString('en-IN')} (${s.pct.toFixed(1)}%)"
         onclick="selectPaymentMethod('${encodeURIComponent(s.name)}')"></div>`).join('');

  // Legend rows: ONLY active methods with spending in current month show (other methods do not show)
  const legendHtml = activeSlices.map(s => `
    <div class="pm-legend-row${pmSelectedMethod === s.name ? ' selected' : ''}" onclick="selectPaymentMethod('${encodeURIComponent(s.name)}')">
      <span class="pm-legend-dot" style="background:${s.color};"></span>
      <span class="pm-legend-name">${escapePartyHtml(s.name)}</span>
      <span class="pm-legend-amt">₹${s.amt.toLocaleString('en-IN')}</span>
      <span class="pm-legend-pct">${s.pct.toFixed(1)}%</span>
      <i class="ti ti-chevron-right pm-legend-chev"></i>
    </div>`).join('');

  // Detail panel: short summary + is method ke recent transactions
  let detailHtml = '';
  if (pmSelectedMethod) {
    const sel = activeSlices.find(s => s.name === pmSelectedMethod) || { name: pmSelectedMethod, amt: 0, pct: 0, color: '#38bdf8' };
    const monthTxns = allEntries.filter(e => {
      if (e.type !== 'expense') return false;
      if ((e.method || 'Cash').trim() !== pmSelectedMethod) return false;
      const d = new Date(e.date);
      return d.getFullYear() === curYear && d.getMonth() === curMonth;
    });
    const recentTxns = monthTxns.slice(0, 4);

    const txnsHtml = recentTxns.length
      ? recentTxns.map(e => txnRowHTML(e, false)).join('')
      : '<div class="pm-detail-empty">No transactions found for this payment method this month</div>';

    detailHtml = `
      <div class="pm-detail-panel">
        <div class="pm-detail-summary">
          <span class="pm-detail-dot" style="background:${sel.color};"></span>
          <div style="flex:1;">
            <div class="pm-detail-title">${escapePartyHtml(sel.name)}</div>
            <div class="pm-detail-sub">${sel.pct.toFixed(1)}% of this month's payments · ${monthTxns.length} transaction${monthTxns.length===1?'':'s'}</div>
          </div>
          <div class="pm-detail-amt">₹${sel.amt.toLocaleString('en-IN')}</div>
        </div>
        <div class="pm-detail-heading">Recent ${escapePartyHtml(pmSelectedMethod)} transactions</div>
        ${txnsHtml}
      </div>`;
  }

  listEl.innerHTML = `
    ${monthTotalHtml}
    <div class="pm-stackbar-wrap">
      <div class="pm-stackbar">${barSegsHtml}</div>
    </div>
    <div class="pm-legend-list">${legendHtml}</div>
    ${detailHtml}
  `;
}

// ===== MANAGE PAYMENT METHODS MODAL & SYNC =====
function openManagePaymentMethodsModal() {
  renderManagePaymentMethodsList();
  const modal = document.getElementById('managePaymentMethodsModal');
  if (modal) modal.classList.add('active');
  const inp = document.getElementById('newPaymentMethodInput');
  if (inp) {
    inp.value = '';
    setTimeout(() => inp.focus(), 150);
  }
}

function closeManagePaymentMethodsModal() {
  const modal = document.getElementById('managePaymentMethodsModal');
  if (modal) modal.classList.remove('active');
}

function renderManagePaymentMethodsList() {
  const listEl = document.getElementById('managePaymentMethodsList');
  if (!listEl) return;
  const methods = getAllPaymentMethods();

  let html = '';
  methods.forEach(m => {
    const meta = getPaymentMethodMeta(m);
    const isCore = ['Cash', 'UPI'].includes(m);
    html += `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
          <span style="width:10px;height:10px;border-radius:50%;background:${meta.color};flex-shrink:0;"></span>
          <i class="ti ${meta.icon}" style="font-size:16px;color:#94a3b8;flex-shrink:0;"></i>
          <span style="font-weight:600;font-size:13.5px;color:#f5f6f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapePartyHtml(m)}</span>
          ${isCore ? '<span style="font-size:10px;padding:2px 6px;border-radius:6px;background:rgba(255,255,255,.08);color:#94a3b8;font-weight:600;flex-shrink:0;">Default</span>' : ''}
        </div>
        ${!isCore ? `
          <button type="button" onclick="deleteCustomPaymentMethod('${encodeURIComponent(m)}')" style="background:transparent;border:none;color:#ef4444;font-size:16px;cursor:pointer;padding:4px;flex-shrink:0;" title="Remove method">
            <i class="ti ti-trash"></i>
          </button>
        ` : ''}
      </div>
    `;
  });
  listEl.innerHTML = html;
}

function addNewPaymentMethod() {
  const inp = document.getElementById('newPaymentMethodInput');
  if (!inp) return;
  const name = (inp.value || '').trim();
  if (!name) {
    showNotification('Please enter a payment method name', 'error');
    return;
  }
  const existing = getAllPaymentMethods();
  if (existing.some(m => m.toLowerCase() === name.toLowerCase())) {
    showNotification('This payment method already exists', 'error');
    return;
  }
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem('app_payment_methods') || '[]');
  } catch(e) {}
  if (!Array.isArray(saved) || saved.length === 0) {
    saved = [...DEFAULT_PAYMENT_METHODS];
  }
  saved.push(name);
  localStorage.setItem('app_payment_methods', JSON.stringify(saved));
  inp.value = '';
  renderManagePaymentMethodsList();
  syncPaymentMethodDropdowns();
  renderPaymentMethodWidget();
  showNotification(`Payment method "${name}" added!`, 'success');
}

function deleteCustomPaymentMethod(encodedMethod) {
  const name = decodeURIComponent(encodedMethod);
  if (['Cash', 'UPI'].includes(name)) {
    showNotification('Cannot delete default method', 'error');
    return;
  }
  if (!confirm(`Remove payment method "${name}"?`)) return;

  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem('app_payment_methods') || '[]');
  } catch(e) {}
  if (!Array.isArray(saved) || saved.length === 0) {
    saved = [...DEFAULT_PAYMENT_METHODS];
  }
  saved = saved.filter(m => m.toLowerCase() !== name.toLowerCase());
  localStorage.setItem('app_payment_methods', JSON.stringify(saved));
  renderManagePaymentMethodsList();
  syncPaymentMethodDropdowns();
  renderPaymentMethodWidget();
  showNotification(`Removed "${name}"`, 'success');
}

function syncPaymentMethodDropdowns() {
  const methods = getAllPaymentMethods();

  // Add Entry modal / screen select
  const paySel = document.getElementById('paymentSel');
  if (paySel) {
    const curVal = paySel.value || 'Cash';
    paySel.innerHTML = methods.map(m => `<option value="${escapePartyHtml(m)}">${escapePartyHtml(m)}</option>`).join('');
    if (methods.includes(curVal)) {
      paySel.value = curVal;
    } else {
      paySel.value = 'Cash';
    }
  }

  // Split Bill screen select
  const splitSel = document.getElementById('splitPaymentMethod');
  if (splitSel) {
    const curVal = splitSel.value || 'UPI';
    splitSel.innerHTML = methods.map(m => `<option value="${escapePartyHtml(m)}">${escapePartyHtml(m)}</option>`).join('');
    if (methods.includes(curVal)) {
      splitSel.value = curVal;
    } else {
      splitSel.value = 'UPI';
    }
  }
}

// ===== Swipeable Real-Time Info Carousel (Wallet dashboard) =====
let rtCarouselIndex = 0;
let rtCarouselCount = 0;

function rtBuildGoalCards(){
  if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
  const activeGoals = goals.filter(g => g.status === 'active');
  if (activeGoals.length === 0) {
    return [`
      <div class="rt-card" onclick="goTo('goals');setTimeout(openGoalFormModal,150);" style="cursor:pointer;">
        <div class="rt-goal-icon"><span class="goal-icon glossy" style="width:100%;height:100%;font-size:18px;${glossVars('blue')}"><i class="ti ti-target"></i></span></div>
        <div class="rt-goal-body">
          <div class="rt-goal-top">
            <span class="rt-goal-label">Goal &middot; Naya Goal Banayein</span>
            <span class="rt-goal-amt" style="color:var(--blue);font-weight:700;">+ Create</span>
          </div>
          <div class="rt-entry-meta" style="font-size:11.5px;color:#8b9099;margin-top:2px;">Savings target set karein aur track karein</div>
        </div>
      </div>`];
  }
  return activeGoals.map(g => {
      const pct = pctOfGoal(g);
      const barColor = goalProgressColor(g);
      const photoKey = { food:'Food', medicine:'Medicine', auto:'Auto' }[g.icon];
      const bgUrl = photoKey ? RT_CARD_BACKGROUNDS[photoKey] : null;
      const bgClass = bgUrl ? ' rt-has-bg' : '';
      const bgStyle = bgUrl ? ` style="background-image:url('${bgUrl}');"` : '';
      const iconHtml = bgUrl
        ? iconEmoji(g.icon)
        : `<span class="goal-icon glossy" style="width:100%;height:100%;font-size:18px;${glossVars(g.color)}">${iconBadge(g.icon)}</span>`;
      return `
        <div class="rt-card${bgClass}" onclick="openGoalDetailsModal('${g.id}')"${bgStyle}>
          <div class="rt-goal-icon">${iconHtml}</div>
          <div class="rt-goal-body">
            <div class="rt-goal-top">
              <span class="rt-goal-label">Goal &middot; ${escapeGoalHtml(g.name)}</span>
              <span class="rt-goal-amt">${fmtGoalMoney(g.saved)} / ${fmtGoalMoney(g.target)}</span>
            </div>
            <div class="rt-goal-track"><div class="rt-goal-fill" style="width:${pct}%;background:${barColor};"></div></div>
          </div>
        </div>`;
    });
}

function rtBuildEntryCard(){
  const allEntries = (typeof entries !== 'undefined') ? entries : [];
  const latest = allEntries.length ? allEntries[0] : null;
  const bgUrl = RT_CARD_BACKGROUNDS.entry;
  const bgClass = bgUrl ? ' rt-has-bg' : '';
  const bgStyle = bgUrl ? ` style="background-image:url('${bgUrl}');"` : '';
  if (!latest) {
    return `
      <div class="rt-card${bgClass}"${bgStyle}>
        <div class="rt-entry-icon"><i class="ti ti-receipt-off"></i></div>
        <div class="rt-entry-body">
          <div class="rt-entry-name">No entries yet</div>
          <div class="rt-entry-meta">Add your first transaction</div>
        </div>
      </div>`;
  }
  const icon = getPartyIcon(latest.party);
  const meta = [latest.method, fmtDateLabel(latest.date)].filter(Boolean).join(' &middot; ');
  return `
    <div class="rt-card${bgClass}"${bgStyle}>
      <div class="rt-entry-icon">${icon}</div>
      <div class="rt-entry-body">
        <div class="rt-entry-name">${latest.party || 'Unknown'}</div>
        <div class="rt-entry-meta">${meta}</div>
      </div>
      <div class="rt-entry-amt ${latest.type === 'expense' ? 'neg' : 'pos'}">${fmtAmt(latest)}</div>
    </div>`;
}

function rtBuildQrCard(){
  return `
    <div class="rt-card rt-clickable" onclick="openReceiveQrModal()">
      <div class="rt-qr-icon"><i class="ti ti-qrcode"></i></div>
      <div class="rt-qr-body">
        <div class="rt-qr-title">Receive Money</div>
        <div class="rt-qr-sub">Tap to show your QR code</div>
      </div>
      <i class="ti ti-chevron-right rt-qr-chev"></i>
    </div>`;
}

function renderRtCarousel(){
  const track = document.getElementById('rtTrack');
  const dotsEl = document.getElementById('rtDots');
  const carouselEl = document.getElementById('rtCarousel');
  if (!track || !dotsEl || !carouselEl) return;

  const cards = [...rtBuildGoalCards(), rtBuildEntryCard(), rtBuildQrCard()];
  rtCarouselCount = cards.length;
  if (rtCarouselIndex >= rtCarouselCount || rtCarouselIndex < 0) rtCarouselIndex = 0;

  track.innerHTML = cards.map(c => `<div class="rt-track-item">${c}</div>`).join('');
  dotsEl.innerHTML = cards.map((_, i) => `<span class="rt-dot${i === rtCarouselIndex ? ' active' : ''}"></span>`).join('');

  const multiCard = rtCarouselCount > 1;
  carouselEl.querySelectorAll('.rt-arrow').forEach(btn => { btn.style.display = multiCard ? 'flex' : 'none'; });
  dotsEl.style.display = multiCard ? 'flex' : 'none';

  rtApplyCarouselTransform(false);
  rtCarouselInitSwipe();
  rtStartAutoplay();
}

function rtApplyCarouselTransform(animate){
  const track = document.getElementById('rtTrack');
  if (!track) return;
  track.style.transition = animate ? 'transform .3s cubic-bezier(.22,1,.36,1)' : 'none';
  track.style.transform = `translateX(-${rtCarouselIndex * 100}%)`;
  document.querySelectorAll('#rtDots .rt-dot').forEach((d, i) => d.classList.toggle('active', i === rtCarouselIndex));
}

function rtCarouselMove(dir, isAuto){
  if (rtCarouselCount <= 1) return;
  rtCarouselIndex = (rtCarouselIndex + dir + rtCarouselCount) % rtCarouselCount;
  rtApplyCarouselTransform(true);
  if (!isAuto) rtStartAutoplay();
}

let rtAutoplayTimer = null;
const RT_AUTOPLAY_MS = 4000;

function rtStartAutoplay(){
  rtStopAutoplay();
  if (rtCarouselCount <= 1) return;
  rtAutoplayTimer = setInterval(() => rtCarouselMove(1, true), RT_AUTOPLAY_MS);
}
function rtStopAutoplay(){
  if (rtAutoplayTimer) { clearInterval(rtAutoplayTimer); rtAutoplayTimer = null; }
}

function rtCarouselInitSwipe(){
  const viewport = document.getElementById('rtViewport');
  if (!viewport || (viewport.dataset && viewport.dataset.rtBound)) return;
  if (viewport.dataset) viewport.dataset.rtBound = '1';

  let dragging = false, startX = 0, deltaX = 0;

  function start(x){
    if (rtCarouselCount <= 1) return;
    dragging = true; startX = x; deltaX = 0;
    rtStopAutoplay();
    const track = document.getElementById('rtTrack');
    if (track) track.style.transition = 'none';
  }
  function move(x){
    if (!dragging) return;
    deltaX = x - startX;
    const track = document.getElementById('rtTrack');
    if (!track || !viewport.clientWidth) return;
    const pct = (deltaX / viewport.clientWidth) * 100;
    track.style.transform = `translateX(calc(-${rtCarouselIndex * 100}% + ${pct}%))`;
  }
  function end(){
    if (!dragging) return;
    dragging = false;
    const threshold = viewport.clientWidth * 0.15;
    if (deltaX > threshold) rtCarouselMove(-1);
    else if (deltaX < -threshold) rtCarouselMove(1);
    else { rtApplyCarouselTransform(true); rtStartAutoplay(); }
    deltaX = 0;
  }

  viewport.addEventListener('touchstart', e => start(e.touches[0].clientX), { passive: true });
  viewport.addEventListener('touchmove', e => move(e.touches[0].clientX), { passive: true });
  viewport.addEventListener('touchend', end);
  viewport.addEventListener('touchcancel', end);

  viewport.addEventListener('mousedown', e => { start(e.clientX); e.preventDefault(); });
  window.addEventListener('mousemove', e => move(e.clientX));
  window.addEventListener('mouseup', end);

  viewport.addEventListener('mouseenter', rtStopAutoplay);
  viewport.addEventListener('mouseleave', () => { if (!dragging) rtStartAutoplay(); });
}

function openReceiveQrModal(){
  const name = (currentUser && (currentUser.name || currentUser.email)) || 'Wallet User';
  const payeeId = (currentUser && currentUser.email) ? currentUser.email : 'wallet@upi';
  const upiUri = `upi://pay?pa=${encodeURIComponent(payeeId)}&pn=${encodeURIComponent(name)}&cu=INR`;
  const imgEl = document.getElementById('receiveQrImage');
  const nameEl = document.getElementById('receiveQrName');
  if (imgEl) imgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUri)}`;
  if (nameEl) nameEl.textContent = name;
  const modal = document.getElementById('receiveQrModal');
  if (modal) modal.classList.add('active');
}
function closeReceiveQrModal(){
  const modal = document.getElementById('receiveQrModal');
  if (modal) modal.classList.remove('active');
}

// ===== BACKUP REMINDER & AUTOMATIC WEEKLY BACKUP TRIGGER =====
function checkBackupReminder(){
 const banner = document.getElementById('backupReminderBanner');
 const lastBackupStr = localStorage.getItem('lastAutoBackupDate') || localStorage.getItem('lastBackupDate');

 if (typeof updateAutoBackupDisplay === 'function') {
  updateAutoBackupDisplay(lastBackupStr);
 }

 if (!banner) return;

 const dismissedStr = localStorage.getItem('backupReminderDismissedAt');
 if (dismissedStr) {
   const daysSinceDismiss = Math.floor((Date.now() - new Date(dismissedStr).getTime()) / 86400000);
   if (daysSinceDismiss < 7) { banner.style.display = 'none'; return; }
 }

 let daysSince;
 if (!lastBackupStr) {
   if (!entries || entries.length < 5) { banner.style.display = 'none'; return; }
   daysSince = Infinity;
 } else {
   daysSince = Math.floor((Date.now() - new Date(lastBackupStr).getTime()) / 86400000);
 }

 if (daysSince >= 7) {
   // 🛡️ AUTO-BACKUP: Automatically take weekly cloud backup without requiring any permission!
   if (navigator.onLine && Array.isArray(entries) && entries.length > 0) {
     runAutomaticWeeklyBackup();
     banner.style.display = 'none';
     return;
   }
   document.getElementById('backupReminderText').textContent =
     lastBackupStr ? `⚠️ It's been ${daysSince} days since your last backup` : `⚠️ No backup created yet`;
   banner.style.display = 'flex';
 } else {
   banner.style.display = 'none';
 }
}
function hideBackupReminder(){
 document.getElementById('backupReminderBanner').style.display = 'none';
 localStorage.setItem('backupReminderDismissedAt', new Date().toISOString());
}

// ===== MONTH DROPDOWN FUNCTIONS =====
function openMonthDropdown() {
  const menu = document.getElementById('monthMenu');
  if(menu.style.display === 'none' || menu.innerHTML === '') {
    populateMonthMenu();
    menu.style.display = 'block';
  } else {
    menu.style.display = 'none';
  }
}

function populateMonthMenu() {
  const menu = document.getElementById('monthMenu');
  if(!menu) return;
  
  const months = [];
  const now = new Date();
  
  // Get last 12 months
  for(let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString('en-IN', {month: 'long', year: 'numeric'});
    months.push({label, year: d.getFullYear(), month: d.getMonth()});
  }
  
  menu.innerHTML = '';
  const mMuted = isLightMode() ? '#6b7280' : '#8b9099';
  const mBorder = isLightMode() ? '#e2e8f2' : '#232838';
  const mHover = isLightMode() ? '#eef1f7' : '#232838';
  months.forEach(m => {
    const div = document.createElement('div');
    div.style.padding = '10px 12px';
    div.style.cursor = 'pointer';
    div.style.borderBottom = '1px solid ' + mBorder;
    div.style.color = mMuted;
    div.style.fontSize = '13px';
    div.style.fontFamily = "'Poppins',sans-serif";
    div.textContent = m.label;
    div.onmouseover = () => div.style.backgroundColor = mHover;
    div.onmouseout = () => div.style.backgroundColor = 'transparent';
    div.onclick = () => selectMonth(m.label, m.year, m.month);
    menu.appendChild(div);
  });
}

function selectMonth(label, year, month) {
  selectedAnalyticsYear = year;
  selectedAnalyticsMonth = month;
  document.getElementById('monthDisplay').textContent = label;
  document.getElementById('monthMenu').style.display = 'none';
  // Re-render analytics for the selected month (not the real current month)
  renderCharts();
  renderTopCats();
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  const dropdown = document.getElementById('monthDropdownBtn');
  const menu = document.getElementById('monthMenu');
  if(dropdown && menu && !dropdown.contains(e.target)) {
    menu.style.display = 'none';
  }
});

// ===== PARTY ICON MAPPING (Crisp Vector Icons) =====
function getPartyIcon(partyName) {
  if(!partyName) return '<i class="ti ti-receipt"></i>';
  
  const name = partyName.toLowerCase().trim();
  
  // High-priority exact & keyword mappings with modern Tabler vector icons
  if (name === 'salary' || name.includes('salary') || name.includes('income') || name.includes('stipend')) {
    return '<i class="ti ti-cash"></i>';
  }
  if (name === 'ghar' || name === 'home' || name.includes('rent') || name.includes('flat') || name.includes('room')) {
    return '<i class="ti ti-home"></i>';
  }
  if (name.includes('mutual fund') || name.includes('groww') || name.includes('stock') || name.includes('dividend') || name.includes('invest')) {
    return '<i class="ti ti-chart-line"></i>';
  }
  if (name.includes('emi') || name.includes('loan') || name.includes('apj')) {
    return '<i class="ti ti-receipt-2"></i>';
  }
  if (name.includes('bank') || name.includes('sbi') || name.includes('pnb') || name.includes('hdfc') || name.includes('icici') || name.includes('charge') || name.includes('intt')) {
    return '<i class="ti ti-building-bank"></i>';
  }
  if (name.includes('office') || name.includes('work')) {
    return '<i class="ti ti-briefcase"></i>';
  }
  if (name.includes('food') || name.includes('restaurant') || name.includes('swiggy') || name.includes('zomato') || name.includes('snack') || name.includes('coffee') || name.includes('tea') || name.includes('chai')) {
    return '<i class="ti ti-tools-kitchen-2"></i>';
  }
  if (name.includes('grocery') || name.includes('groceries') || name.includes('shopping') || name.includes('mart') || name.includes('mall') || name.includes('blinkit') || name.includes('zepto')) {
    return '<i class="ti ti-shopping-cart"></i>';
  }
  if (name.includes('medicine') || name.includes('doctor') || name.includes('medical') || name.includes('hospital') || name.includes('pharma') || name.includes('clinic')) {
    return '<i class="ti ti-first-aid-kit"></i>';
  }
  if (name.includes('auto') || name.includes('uber') || name.includes('ola') || name.includes('petrol') || name.includes('diesel') || name.includes('fuel') || name.includes('taxi') || name.includes('travel') || name.includes('bus') || name.includes('train')) {
    return '<i class="ti ti-car"></i>';
  }
  if (name.includes('mobile') || name.includes('recharge') || name.includes('wifi') || name.includes('internet') || name.includes('broadband')) {
    return '<i class="ti ti-device-mobile"></i>';
  }
  if (name.includes('movie') || name.includes('cinema') || name.includes('netflix') || name.includes('prime') || name.includes('hotstar') || name.includes('entertainment')) {
    return '<i class="ti ti-movie"></i>';
  }
  if (name.includes('electricity') || name.includes('bijli') || name.includes('power')) {
    return '<i class="ti ti-bolt"></i>';
  }
  if (name.includes('water') || name.includes('pani')) {
    return '<i class="ti ti-droplet"></i>';
  }
  if (name.includes('gym') || name.includes('fitness')) {
    return '<i class="ti ti-barbell"></i>';
  }
  if (name.includes('book') || name.includes('school') || name.includes('college') || name.includes('education') || name.includes('fee')) {
    return '<i class="ti ti-school"></i>';
  }
  if (name.includes('gift')) {
    return '<i class="ti ti-gift"></i>';
  }
  if (name.includes('goal')) {
    return '<i class="ti ti-target"></i>';
  }
  // People / Contacts: Sagar, Ritesh, Adarsh, Ritik, Mahi, Anjali, Mammi, Self, etc.
  if (name === 'self' || name === 'sagar' || name === 'ritesh' || name === 'adarsh' || name === 'ritik' || name === 'mahi' || name === 'anjali' || name === 'mammi' || name.includes('bhaiya') || name.includes('sir') || name.includes('friend') || name.includes('family')) {
    return '<i class="ti ti-user"></i>';
  }

  // Default clean vector icon
  return '<i class="ti ti-receipt"></i>';
}

// ===== NEW AUTH SYSTEM FUNCTIONS =====

// ---- Password visibility toggle ----
function togglePwVis(inputId, icon) {
 const inp = document.getElementById(inputId);
 if (!inp) return;
 if (inp.type === 'password') {
  inp.type = 'text';
  icon.classList.remove('ti-eye');
  icon.classList.add('ti-eye-off');
 } else {
  inp.type = 'password';
  icon.classList.remove('ti-eye-off');
  icon.classList.add('ti-eye');
 }
}

// ---- Allowed accounts (whitelist from APP_CONFIG; if empty, any authenticated user can access) ----
const ALLOWED_EMAILS = (window.APP_CONFIG && Array.isArray(window.APP_CONFIG.allowedEmails))
  ? window.APP_CONFIG.allowedEmails.map(e => String(e).trim().toLowerCase())
  : [];

// ---- Email login — real Firebase Authentication, restricted to allowed emails ----
function handleEmailLogin() {
 const emailInp = document.getElementById('loginEmail');
 const passInp  = document.getElementById('loginPassword');
 const errSpan  = document.getElementById('loginError');
 const email    = (emailInp?.value || '').trim().toLowerCase();
 const password = passInp?.value || '';

 if (errSpan) { errSpan.style.display = 'none'; errSpan.textContent = ''; }
 emailInp?.classList.remove('error');
 passInp?.classList.remove('error');

 if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  emailInp?.classList.add('error');
  if (errSpan) { errSpan.textContent = 'Please enter a valid email'; errSpan.style.display = ''; }
  return;
 }
 if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(email)) {
  emailInp?.classList.add('error');
  if (errSpan) { errSpan.textContent = 'This email is not authorized to use this app'; errSpan.style.display = ''; }
  return;
 }
 if (!password || password.length < 6) {
  passInp?.classList.add('error');
  if (errSpan) { errSpan.textContent = 'Password must be at least 6 characters'; errSpan.style.display = ''; }
  return;
 }
 if (!firebase || !firebase.auth) {
  if (errSpan) { errSpan.textContent = 'Connecting... please try again in a moment'; errSpan.style.display = ''; }
  return;
 }

 const btn = document.querySelector('#loginPanel .auth-btn');
 if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Signing in...'; }
 const resetBtn = () => { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-arrow-right"></i> Continue'; } };

 firebase.auth().signInWithEmailAndPassword(email, password)
  .then((userCredential) => {
   const user = userCredential.user;
   // 🔒 Save uid from Firebase authentication
   currentUser = { 
    uid: user.uid, // Firebase UID
    name: email.split('@')[0], 
    email, 
    picture: '', 
    source: 'email' 
   };
   localStorage.setItem('currentUser', JSON.stringify(currentUser));
   localStorage.setItem('currentUserUid', user.uid); // Separate storage
   localStorage.setItem('lastLoginEmail', email);
   console.log('✅ Email login successful, uid:', user.uid);
   showNotification('Welcome back! ✓', 'success');
   resetBtn();
   hideGoogleLoginPage();
  })
  .catch((err) => {
   if (err.code === 'auth/user-not-found') {
    // First time this allowed email logs in — create the account automatically
    firebase.auth().createUserWithEmailAndPassword(email, password)
     .then((userCredential) => {
      const user = userCredential.user;
      // 🔒 Save uid from Firebase authentication
      currentUser = { 
       uid: user.uid, // Firebase UID
       name: email.split('@')[0], 
       email, 
       picture: '', 
       source: 'email' 
      };
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      localStorage.setItem('currentUserUid', user.uid); // Separate storage
      localStorage.setItem('lastLoginEmail', email);
      console.log('✅ Account created, uid:', user.uid);
      showNotification('Account created! Welcome 🎉', 'success');
      resetBtn();
      hideGoogleLoginPage();
     })
     .catch((err2) => {
      resetBtn();
      passInp?.classList.add('error');
      if (errSpan) { errSpan.textContent = err2.message; errSpan.style.display = ''; }
     });
   } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
    resetBtn();
    passInp?.classList.add('error');
    if (errSpan) { errSpan.textContent = 'Wrong password. Please try again.'; errSpan.style.display = ''; }
   } else if (err.code === 'auth/too-many-requests') {
    resetBtn();
    if (errSpan) { errSpan.textContent = 'Too many attempts. Please wait and try again.'; errSpan.style.display = ''; }
   } else {
    resetBtn();
    if (errSpan) { errSpan.textContent = err.message || 'Login failed. Please try again.'; errSpan.style.display = ''; }
   }
  });
}

function continueAsLoggedIn() {
 hideGoogleLoginPage();
}

// ---- Login Page ----
function showLoginPage() {
 const lp = document.getElementById('googleLoginPage');
 if (lp) {
   lp.classList.remove('hidden');
   lp.style.display = 'flex';
 }
 const fp = document.getElementById('forgotPasswordPage');
 if (fp) { fp.classList.add('hidden'); fp.style.display = 'none'; }
 const fpin = document.getElementById('forgotPinPage');
 if (fpin) { fpin.classList.add('hidden'); fpin.style.display = 'none'; }
 if (typeof hideLoadingPage === 'function') hideLoadingPage(true);
}

// Update login page to show user info if already logged in
function updateLoginPageUserInfo() {
 // Pre-fill last used email
 const lastEmail = localStorage.getItem('lastLoginEmail');
 if (lastEmail) {
  const li = document.getElementById('loginEmail');
  if (li && !li.value) li.value = lastEmail;
 }

 if (!currentUser) return;
 const userInfoDiv = document.getElementById('userInfoContainer');
 const signInBtn = document.getElementById('googleSignInBtn');
 if (userInfoDiv) userInfoDiv.style.display = 'block';
 if (signInBtn) signInBtn.style.display = 'none';

 const photo = document.getElementById('userPhoto');
 const fallback = document.getElementById('userAvatarFallback');
 if (currentUser.picture && photo) {
  photo.src = currentUser.picture;
  photo.style.display = 'block';
  if (fallback) fallback.style.display = 'none';
 } else if (fallback) {
  fallback.textContent = (currentUser.name || 'U').charAt(0).toUpperCase();
 }
 const nameEl = document.getElementById('userName');
 const emailEl = document.getElementById('userEmail');
 if (nameEl) nameEl.textContent = currentUser.name || 'User';
 if (emailEl) emailEl.textContent = currentUser.email || '';
}

// Helper: Send password reset email via Google Identity Toolkit REST API (bypasses SDK domain/network constraints)
async function firebaseSendPasswordResetEmail(email) {
 const apiKey = (typeof firebaseConfig !== 'undefined' && firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('PASTE_YOUR'))
   ? firebaseConfig.apiKey
   : null;

 if (!apiKey) {
   if (window.firebase && firebase.auth) {
     return await firebase.auth().sendPasswordResetEmail(email);
   }
   throw new Error('Firebase is not configured. Please update config.js with valid Firebase credentials.');
 }

 try {
  const resp = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=' + encodeURIComponent(apiKey), {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: email })
  });
  const data = await resp.json();
  if (!resp.ok || data.error) {
   const errCode = data?.error?.message || 'FAILED_TO_SEND';
   const err = new Error(errCode);
   err.code = errCode;
   throw err;
  }
  return data;
 } catch (restErr) {
  // If fetch failed completely (e.g. offline) or returned error, try SDK if available
  if (window.firebase && firebase.auth && !restErr.code) {
   return await firebase.auth().sendPasswordResetEmail(email);
  }
  throw restErr;
 }
}

// Helper: Verify user password via Google Identity Toolkit REST API
async function firebaseVerifyCredentials(email, password) {
 const apiKey = (typeof firebaseConfig !== 'undefined' && firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('PASTE_YOUR'))
   ? firebaseConfig.apiKey
   : null;

 if (!apiKey) {
   if (window.firebase && firebase.auth) {
     return await firebase.auth().signInWithEmailAndPassword(email, password);
   }
   throw new Error('Firebase is not configured. Please update config.js with valid Firebase credentials.');
 }

 try {
  const resp = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(apiKey), {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
  });
  const data = await resp.json();
  if (!resp.ok || data.error) {
   const errCode = data?.error?.message || 'FAILED_TO_SIGNIN';
   const err = new Error(errCode);
   err.code = errCode;
   throw err;
  }
  return data;
 } catch (restErr) {
  if (window.firebase && firebase.auth && !restErr.code) {
   return await firebase.auth().signInWithEmailAndPassword(email, password);
  }
  throw restErr;
 }
}

// ---- Forgot Password ----
function showForgotPassword() {
 const glp = document.getElementById('googleLoginPage');
 if (glp) { glp.classList.add('hidden'); glp.style.display = 'none'; }
 const fpp = document.getElementById('forgotPasswordPage');
 if (fpp) { fpp.classList.remove('hidden'); fpp.style.display = 'flex'; }
 const s1 = document.getElementById('fpStep1');
 const s2 = document.getElementById('fpStep2');
 if (s1) s1.style.display = 'block';
 if (s2) s2.style.display = 'none';
 const inp = document.getElementById('fpEmail');
 if (inp) {
  // Pre-fill with user email or last login email
  const prefill = (typeof currentUser !== 'undefined' && currentUser?.email) || localStorage.getItem('lastLoginEmail') || '';
  inp.value = prefill;
  inp.classList.remove('error');
 }
 const errDiv = document.getElementById('fpEmailError');
 if (errDiv) errDiv.style.display = 'none';
}

function fpClearError() {
 const errDiv = document.getElementById('fpEmailError');
 if (errDiv) errDiv.style.display = 'none';
 const inp = document.getElementById('fpEmail');
 if (inp) inp.classList.remove('error');
}

async function fpSubmitEmail() {
 const inp = document.getElementById('fpEmail');
 const email = (inp?.value || '').trim();
 const errDiv = document.getElementById('fpEmailError');
 const errSpan = errDiv?.querySelector('span');

 if (errDiv) errDiv.style.display = 'none';
 if (inp) inp.classList.remove('error');

 if (!email) {
  if (inp) inp.classList.add('error');
  if (errDiv && errSpan) { errSpan.textContent = 'Please enter your registered email address.'; errDiv.style.display = 'flex'; }
  return;
 }
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  if (inp) inp.classList.add('error');
  if (errDiv && errSpan) { errSpan.textContent = 'Please enter a valid email address.'; errDiv.style.display = 'flex'; }
  return;
 }

 const btn = document.getElementById('fpSubmitBtn');
 if (btn) {
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Sending link...';
 }
 const resetBtn = () => {
  if (btn) {
   btn.disabled = false;
   btn.innerHTML = 'Submit';
  }
 };

 try {
  await firebaseSendPasswordResetEmail(email);
  resetBtn();
  const sentEmailEl = document.getElementById('fpSentEmail');
  if (sentEmailEl) sentEmailEl.textContent = email;
  const s1 = document.getElementById('fpStep1');
  const s2 = document.getElementById('fpStep2');
  if (s1) s1.style.display = 'none';
  if (s2) s2.style.display = 'block';
  showNotification('Password reset link sent to ' + email + ' ✓', 'success');
 } catch (err) {
  resetBtn();
  if (inp) inp.classList.add('error');
  let msg = 'Failed to send reset link. Please try again.';
  const errCode = String(err.code || err.message || '').toUpperCase();
  if (errCode.includes('EMAIL_NOT_FOUND') || errCode.includes('USER-NOT-FOUND')) {
   msg = 'No account found with this email address.';
  } else if (errCode.includes('INVALID_EMAIL') || errCode.includes('INVALID-EMAIL')) {
   msg = 'Invalid email address format.';
  } else if (errCode.includes('TOO_MANY_ATTEMPTS') || errCode.includes('TOO-MANY-REQUESTS')) {
   msg = 'Too many requests. Please wait a bit before trying again.';
  } else if (errCode.includes('NETWORK') || errCode.includes('FETCH')) {
   msg = 'Network connection error. Please check your internet connection.';
  } else if (err.message) {
   msg = err.message;
  }
  if (errDiv && errSpan) {
   errSpan.textContent = msg;
   errDiv.style.display = 'flex';
  }
 }
}

async function fpResend() {
 const sentEmail = document.getElementById('fpSentEmail')?.textContent?.trim();
 if (sentEmail) {
  showNotification('Resending reset email...', 'info');
  try {
   await firebaseSendPasswordResetEmail(sentEmail);
   showNotification('Password reset link resent to ' + sentEmail + ' ✓', 'success');
  } catch (err) {
   showNotification(err.message || 'Failed to resend email.', 'error');
  }
 } else {
  const s1 = document.getElementById('fpStep1');
  const s2 = document.getElementById('fpStep2');
  if (s2) s2.style.display = 'none';
  if (s1) s1.style.display = 'block';
 }
}

// ---- Forgot PIN ----
let fpinOTPCode = '';
let fpinNewPin = '';
let fpinConfirmPin = '';

function openForgotPinPage() {
 const page = document.getElementById('forgotPinPage');
 if (!page) return;
 page.classList.remove('hidden');

 const photo = document.getElementById('fpinUserPhoto');
 const fallback = document.getElementById('fpinAvatarFallback');
 const nameEl = document.getElementById('fpinUserName');
 const emailEl = document.getElementById('fpinUserEmail');
 const emailInp = document.getElementById('fpinLoginEmail');
 const passInp = document.getElementById('fpinLoginPassword');
 const errDiv = document.getElementById('fpinLoginError');

 const activeUser = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : (window.firebase && firebase.auth && firebase.auth().currentUser ? firebase.auth().currentUser : null);

 if (activeUser) {
  const displayName = activeUser.displayName || activeUser.name || 'User';
  const email = activeUser.email || '';
  const photoUrl = activeUser.photoURL || activeUser.picture || '';

  if (photoUrl && photo) {
   photo.src = photoUrl;
   photo.style.display = 'block';
   if (fallback) fallback.style.display = 'none';
  } else if (fallback) {
   if (photo) photo.style.display = 'none';
   fallback.textContent = displayName.charAt(0).toUpperCase();
   fallback.style.display = 'flex';
  }
  if (nameEl) nameEl.textContent = displayName;
  if (emailEl) emailEl.textContent = email || 'Registered User';
  if (emailInp && email) emailInp.value = email;
 } else {
  const lastEmail = localStorage.getItem('lastLoginEmail') || '';
  if (nameEl) nameEl.textContent = 'Account Verification';
  if (emailEl) emailEl.textContent = lastEmail || 'Enter your registered email';
  if (emailInp) emailInp.value = lastEmail;
  if (fallback) { fallback.textContent = 'U'; fallback.style.display = 'flex'; }
  if (photo) photo.style.display = 'none';
 }

 // Reset steps
 const s1 = document.getElementById('fpinStep1');
 const s3 = document.getElementById('fpinStep3');
 const s4 = document.getElementById('fpinStep4');
 if (s1) s1.style.display = 'block';
 if (s3) s3.style.display = 'none';
 if (s4) s4.style.display = 'none';

 fpinNewPin = '';
 fpinConfirmPin = '';

 if (passInp) { passInp.value = ''; passInp.classList.remove('error'); }
 if (emailInp) emailInp.classList.remove('error');
 if (errDiv) errDiv.style.display = 'none';
}

function closeForgotPinPage() {
 const page = document.getElementById('forgotPinPage');
 if (page) page.classList.add('hidden');
}

async function fpinVerifyLogin() {
 const emailInp = document.getElementById('fpinLoginEmail');
 const passInp  = document.getElementById('fpinLoginPassword');
 const errDiv   = document.getElementById('fpinLoginError');
 const email    = (emailInp?.value || '').trim().toLowerCase();
 const password = passInp?.value || '';

 if (errDiv) errDiv.style.display = 'none';
 if (emailInp) emailInp.classList.remove('error');
 if (passInp) passInp.classList.remove('error');

 if (!email || !password) {
  if (errDiv) {
   const span = errDiv.querySelector('span');
   if (span) span.textContent = 'Please enter your registered email and password';
   errDiv.style.display = 'flex';
  }
  return;
 }

 const activeUser = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : (window.firebase && firebase.auth && firebase.auth().currentUser ? firebase.auth().currentUser : null);
 if (activeUser && activeUser.email && email !== activeUser.email.toLowerCase()) {
  if (errDiv) {
   const span = errDiv.querySelector('span');
   if (span) span.textContent = 'Please use your registered email: ' + activeUser.email;
   errDiv.style.display = 'flex';
  }
  if (emailInp) emailInp.classList.add('error');
  return;
 }

 const btn = document.getElementById('fpinLoginBtn');
 if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Verifying...'; }
 const resetBtn = () => { if (btn) { btn.disabled = false; btn.innerHTML = 'Verify &amp; Continue'; } };

 try {
  await firebaseVerifyCredentials(email, password);
  resetBtn();
  const s1 = document.getElementById('fpinStep1');
  const s3 = document.getElementById('fpinStep3');
  if (s1) s1.style.display = 'none';
  if (s3) s3.style.display = 'block';
  fpinNewPin = '';
  fpinUpdateNewPinDots();
  showNotification('Identity verified ✓ Now set your new PIN', 'success');
 } catch (err) {
  resetBtn();
  if (passInp) passInp.classList.add('error');
  let msg = 'Authentication failed. Please try again.';
  const code = String(err.code || err.message || '').toUpperCase();
  if (code.includes('INVALID_PASSWORD') || code.includes('INVALID_LOGIN_CREDENTIALS') || code.includes('WRONG-PASSWORD')) {
   msg = 'Incorrect password. Please try again.';
  } else if (code.includes('EMAIL_NOT_FOUND') || code.includes('USER-NOT-FOUND')) {
   msg = 'No account found with this email.';
  } else if (code.includes('TOO_MANY_ATTEMPTS') || code.includes('TOO-MANY-REQUESTS')) {
   msg = 'Too many attempts. Please wait a bit and try again.';
  } else if (code.includes('NETWORK') || code.includes('FETCH')) {
   msg = 'Network connection error. Please check your internet connection.';
  } else if (err.message) {
   msg = err.message;
  }
  if (errDiv) {
   const span = errDiv.querySelector('span');
   if (span) span.textContent = msg;
   errDiv.style.display = 'flex';
  }
 }
}

// New PIN pad
function fpinUpdateNewPinDots() {
 const dotsWrap = document.getElementById('fpinNewPinDots');
 if (!dotsWrap) return;
 const dots = dotsWrap.querySelectorAll('span');
 dots.forEach((d, i) => d.classList.toggle('filled', i < fpinNewPin.length));
}

function fpinPinPress(num) {
 if (fpinNewPin.length >= 4) return;
 fpinNewPin += num;
 fpinUpdateNewPinDots();
 const err = document.getElementById('fpinNewPinError');
 if (err) err.textContent = '';
 if (fpinNewPin.length === 4) {
  setTimeout(() => {
   const s3 = document.getElementById('fpinStep3');
   const s4 = document.getElementById('fpinStep4');
   if (s3) s3.style.display = 'none';
   if (s4) s4.style.display = 'block';
   fpinConfirmPin = '';
   fpinUpdateConfirmPinDots();
  }, 200);
 }
}

function fpinPinClear() {
 fpinNewPin = '';
 fpinUpdateNewPinDots();
 const err = document.getElementById('fpinNewPinError');
 if (err) err.textContent = '';
}

function fpinPinBackspace() {
 fpinNewPin = fpinNewPin.slice(0, -1);
 fpinUpdateNewPinDots();
}

// Confirm PIN pad
function fpinUpdateConfirmPinDots() {
 const dotsWrap = document.getElementById('fpinConfirmPinDots');
 if (!dotsWrap) return;
 const dots = dotsWrap.querySelectorAll('span');
 dots.forEach((d, i) => d.classList.toggle('filled', i < fpinConfirmPin.length));
}

function fpinConfirmPinPress(num) {
 if (fpinConfirmPin.length >= 4) return;
 fpinConfirmPin += num;
 fpinUpdateConfirmPinDots();
 const err = document.getElementById('fpinConfirmPinError');
 if (err) err.textContent = '';
 if (fpinConfirmPin.length === 4) {
  setTimeout(async () => {
   if (fpinConfirmPin === fpinNewPin) {
    const hashed = await hashPin(fpinNewPin);
    localStorage.setItem('appPin', hashed);
    showNotification('PIN reset successfully! ✓', 'success');
    closeForgotPinPage();
    // Unlock app directly since identity was already authenticated
    if (typeof pinUnlockApp === 'function') {
     pinUnlockApp();
    } else {
     const pinScreen = document.getElementById('pinLockScreen');
     if (pinScreen) pinScreen.style.display = 'none';
    }
   } else {
    const errEl = document.getElementById('fpinConfirmPinError');
    if (errEl) errEl.textContent = "PIN didn't match. Please try again.";
    fpinConfirmPin = '';
    fpinUpdateConfirmPinDots();
   }
  }, 180);
 }
}

function fpinConfirmPinClear() {
 fpinConfirmPin = '';
 fpinUpdateConfirmPinDots();
 const err = document.getElementById('fpinConfirmPinError');
 if (err) err.textContent = '';
}

function fpinConfirmPinBackspace() {
 fpinConfirmPin = fpinConfirmPin.slice(0, -1);
 fpinUpdateConfirmPinDots();
}

// ---- Logout Modal ----
function openLogoutModal() {
 document.getElementById('logoutConfirmModal').classList.add('active');
}

function closeLogoutModal() {
 document.getElementById('logoutConfirmModal').classList.remove('active');
}

function confirmLogout() {
 closeLogoutModal();
 handleGoogleSignOut();
}

// ===== END NEW AUTH SYSTEM FUNCTIONS =====

// ===== GLOBAL ERROR HANDLER =====
window.addEventListener('error', (event) => {
  console.error('❌ Application Error:', event.error || event.message);
  if (event.filename && !event.filename.includes('script.js') && !event.filename.includes('index.html')) return;
});

window.addEventListener('unhandledrejection', (event) => {
  console.warn('⚠️ Background Promise Notice:', event.reason);
  const msg = event.reason?.message || String(event.reason || '');
  if (msg.includes('aborted') || msg.includes('cancel') || msg.includes('AbortError') || msg.includes('popup_closed_by_user') || msg.includes('speech')) {
    return;
  }
});

// ===== NETWORK STATUS MONITORING =====
let onlineSyncDebounceTimer = null;
window.addEventListener('online', () => {
  console.log('✓ Internet connected');
  showNotification('Back online - syncing data...', 'info');
  updateFirebaseStatus(firebaseReady);

  clearTimeout(onlineSyncDebounceTimer);
  onlineSyncDebounceTimer = setTimeout(async () => {
    try {
      if (typeof processOfflineSyncQueue === 'function') {
        await processOfflineSyncQueue();
      }
      if (typeof loadEntriesFromFirebase === 'function' && firebaseReady && currentUser) {
        await loadEntriesFromFirebase();
        if (typeof dedupeEntries === 'function') dedupeEntries();
        renderWallet();
        renderEntries();
        if (typeof renderAnalytics === 'function' && document.getElementById('screen-analytics')?.classList.contains('active')) {
          renderAnalytics();
        }
      }
    } catch(err) {
      console.warn('Online sync failed:', err);
    }
  }, 600);
});

window.addEventListener('offline', () => {
  console.warn('⚠ Internet disconnected');
  showNotification('Offline Mode - all entries saved locally', 'info');
  updateFirebaseStatus(false);
});

// ═══════════════════════════════════════════════════════════════════════
// SWIPE BETWEEN BOTTOM-NAV SCREENS — swipe left/right anywhere on the main
// tabs (Wallet / Analytics / Entries / Goals) to move to the next/previous
// tab, same order as the bottom nav bar.
// ═══════════════════════════════════════════════════════════════════════
(function() {
 const swipeOrder = ['wallet', 'analytics', 'entries', 'goals'];
 const appEl = document.getElementById('app');
 if (!appEl) return;

 let touchStartX = 0, touchStartY = 0, touchActive = false;

 appEl.addEventListener('touchstart', function(e) {
  if (e.touches.length !== 1) return;
  // Sirf tab screens ke beech swipe kaam kare — Add Entry, Backup, Profile
  // jaisi sub-screens par swipe se accidental navigation na ho.
  if (swipeOrder.indexOf(currentAppScreen) === -1) { touchActive = false; return; }
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchActive = true;
 }, { passive: true });

 appEl.addEventListener('touchend', function(e) {
  if (!touchActive) return;
  touchActive = false;
  const touch = e.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  const THRESHOLD = 60;
  // Horizontal swipe hi count ho, vertical scroll se confuse na ho
  if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.3) return;

  const idx = swipeOrder.indexOf(currentAppScreen);
  if (idx === -1) return;
  if (dx < 0 && idx < swipeOrder.length - 1) {
   goTo(swipeOrder[idx + 1]);   // swipe left -> next tab
  } else if (dx > 0 && idx > 0) {
   goTo(swipeOrder[idx - 1]);   // swipe right -> previous tab
  }
 }, { passive: true });
})();


// Wraps the existing open/close functions for every modal & panel so that
// opening one pushes a history entry, and popping that entry (back button)
// closes the topmost open modal/panel instead of exiting the whole app.
// If nothing is open, back instead switches to the Wallet tab; only when
// already on Wallet with nothing open does back behave normally (exit).
// ═══════════════════════════════════════════════════════════════════════
(function() {
 let overlayStack = [];
 let handlingPop = false;

 function isOpen(elId, mode) {
  const el = document.getElementById(elId);
  if (!el) return false;
  return mode === 'class' ? el.classList.contains('active') : el.style.display === 'block';
 }

 // For toggle-style functions (same function opens AND closes)
 function wrapToggle(fnName, elId, mode) {
  const original = window[fnName];
  if (typeof original !== 'function') return;
  window[fnName] = function(...args) {
   const wasOpen = isOpen(elId, mode);
   original.apply(this, args);
   const nowOpen = isOpen(elId, mode);
   if (!wasOpen && nowOpen) {
    overlayStack.push(fnName);
    if (!handlingPop) history.pushState({ overlay: fnName }, '');
   } else if (wasOpen && !nowOpen) {
    const idx = overlayStack.lastIndexOf(fnName);
    if (idx > -1) overlayStack.splice(idx, 1);
    if (!handlingPop) history.back();
   }
  };
 }

 // For separate open()/close() function pairs
 function wrapOpenClose(openName, closeName) {
  const openOriginal = window[openName];
  const closeOriginal = window[closeName];
  if (typeof openOriginal === 'function') {
   window[openName] = function(...args) {
    openOriginal.apply(this, args);
    overlayStack.push(closeName);
    if (!handlingPop) history.pushState({ overlay: closeName }, '');
   };
  }
  if (typeof closeOriginal === 'function') {
   window[closeName] = function(...args) {
    closeOriginal.apply(this, args);
    const idx = overlayStack.lastIndexOf(closeName);
    if (idx > -1) overlayStack.splice(idx, 1);
    if (!handlingPop) history.back();
   };
  }
 }

 wrapToggle('toggleEventLogPanel', 'eventLogPanel', 'display');
 wrapToggle('toggleSyncStatusPanel', 'syncStatusPanel', 'display');
 wrapToggle('toggleRemindersPanel', 'remindersPanel', 'display');
 wrapOpenClose('openEditModal', 'closeEditModal');
 wrapOpenClose('openFilterModal', 'closeFilterModal');
 wrapOpenClose('openLogoutModal', 'closeLogoutModal');
 wrapOpenClose('openQuickAdd', 'closeQuickAdd');
 wrapOpenClose('openAiChatModal', 'closeAiChatModal');
 wrapOpenClose('openAiVoiceFullscreen', 'closeAiVoiceFullscreen');
 wrapOpenClose('openForgotPinPage', 'closeForgotPinPage');
 wrapOpenClose('openEditMonthlyBudgetModal', 'closeEditMonthlyBudgetModal');
 wrapOpenClose('openAiSettingsModal', 'closeAiSettingsModal');
 wrapOpenClose('openGoalFormModal', 'closeGoalFormModal');
 wrapOpenClose('openGoalDetailsModal', 'closeGoalDetailsModal');
 wrapOpenClose('openAddMoneyModal', 'closeAddMoneyModal');
 wrapOpenClose('openGoalSuccessModal', 'closeGoalSuccessModal');
 wrapOpenClose('askDeleteGoal', 'closeDeleteGoalModal');

 let rootBackPressCount = 0;
 let rootBackPressTimer = null;

 function handleRootBackPress() {
  try {
   history.pushState({ screen: 'wallet', rootGuard: true }, '');
  } catch(e){}

  rootBackPressCount++;
  if (rootBackPressTimer) clearTimeout(rootBackPressTimer);

  if (rootBackPressCount === 1) {
   rootBackPressTimer = setTimeout(() => {
    rootBackPressCount = 0;
   }, 3000);
  } else if (rootBackPressCount === 2) {
   if (typeof showNotification === 'function') {
    showNotification('Press back once more to exit & lock app 🔒', 'warning', '', { force: true, duration: 2500 });
   }
   rootBackPressTimer = setTimeout(() => {
    rootBackPressCount = 0;
   }, 3000);
  } else if (rootBackPressCount >= 3) {
   rootBackPressCount = 0;
   if (typeof triggerAutoLock === 'function') {
    triggerAutoLock();
   }
   const pinScreen = document.getElementById('pinLockScreen');
   const appContainer = document.getElementById('app');
   if (pinScreen) pinScreen.style.display = 'flex';
   if (appContainer) {
    appContainer.style.display = 'none';
    appContainer.classList.add('app-blurred');
   }
   try {
    if (window.navigator && window.navigator.app && typeof window.navigator.app.exitApp === 'function') {
     window.navigator.app.exitApp();
    }
   } catch(e){}
   try {
    window.close();
   } catch(e){}
  }
 }

 window.addEventListener('popstate', function() {
  handlingPop = true;
  if (overlayStack.length > 0) {
   rootBackPressCount = 0;
   const fnName = overlayStack.pop();
   const fn = window[fnName];
   if (typeof fn === 'function') fn();
  } else if (screenHistoryStack.length > 0) {
   rootBackPressCount = 0;
   const prevScreen = screenHistoryStack.pop();
   goTo(prevScreen, true);
  } else if (typeof currentAppScreen !== 'undefined' && currentAppScreen !== 'wallet') {
   rootBackPressCount = 0;
   goTo('wallet', true);
  } else {
   handleRootBackPress();
  }
  handlingPop = false;
 });

 // Base history entry to return to
 history.replaceState({ screen: 'wallet' }, '');
 try {
  history.pushState({ screen: 'wallet', rootGuard: true }, '');
 } catch(e){}
 // Initial paint: Wallet is the default active screen (see .screen.active
 // on #screen-wallet in the HTML) but goTo() hasn't run yet at this point,
 // so the home-chat bubble needs one manual sync here or it stays hidden
 // until the user switches tabs and back.
 if (typeof syncHomeChatFabVisibility === 'function') syncHomeChatFabVisibility();
})();

// GOALS-MODULE init — placed here (end of script) rather than up near the
// rest of the GOALS-MODULE code, so that everything it touches — including
// RT_CARD_BACKGROUNDS and the carousel's rtCarouselCount/renderRtCarousel,
// which are declared further down the file — is already initialized by the
// time this runs (avoids a temporal-dead-zone ReferenceError on load).
loadGoals();
renderGoalsList();

/* ===== Inline script block 4 (originally at char offset 3639023) ===== */
// Result bar ko dikhana/chhupana — qaLiveCaption me kabhi bhi kuch value
// aaye (voice se ya manual edit se), bar fade-in ho jaata hai; khaali ho
// to wapas fade-out. openQuickAdd() qaLiveCaption khaali karta hai, isliye
// har naye session me bar apne aap hidden state se shuru hota hai.
function syncAivResultVisibility(){
 const wrap = document.getElementById('aivResultWrap');
 const val = document.getElementById('qaLiveCaption').value.trim();
 if (!wrap) return;
 wrap.classList.toggle('show', !!val);
}

/* ===== Inline script block 5 (originally at char offset 3643178) ===== */
(function(){
 function applyHeaderPad(headerEl){
  // Headers are sticky in natural document flow; no manual padding needed.
 }
 function initFixedHeaderSync(){
  // Sticky headers manage their own layout in natural flow.
 }
 if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFixedHeaderSync);
 } else {
  initFixedHeaderSync();
 }
})();

// ===== OFFLINE DATA STORAGE & SYNC ENGINE =====
// Ensures all entries, totals, and balances work 100% offline with zero lag.
// Automatically syncs local changes with Firebase when network reconnects.

function getOfflineQueue() {
 try {
  return JSON.parse(localStorage.getItem('offlineSyncQueue') || '[]');
 } catch(e) {
  return [];
 }
}

function saveOfflineQueue(queue) {
 try {
  localStorage.setItem('offlineSyncQueue', JSON.stringify(queue));
 } catch(e){}
}

function queueOfflineSync(action, data) {
 try {
  const queue = getOfflineQueue();
  queue.push({ action, data, timestamp: Date.now() });
  saveOfflineQueue(queue);
 } catch(e){}
}

let isProcessingOfflineQueue = false;
async function processOfflineSyncQueue() {
 if (isProcessingOfflineQueue) return;
 if (!navigator.onLine || typeof firebaseReady === 'undefined' || !firebaseReady || typeof db === 'undefined' || !db) return;
 const queue = getOfflineQueue();
 if (!queue || queue.length === 0) return;

 isProcessingOfflineQueue = true;
 console.log('Syncing offline queue:', queue.length, 'operations');
 const remaining = [];
 const curUid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || localStorage.getItem('currentUserUid');

 for (const item of queue) {
  try {
   if (item.action === 'set' && item.data && item.data.id) {
    const toSave = {
     ...item.data,
     userId: item.data.userId || curUid || null,
     updatedAt: item.data.updatedAt || new Date().toISOString()
    };
    // Prefer isolated user collection; also mirror to legacy root
    const userCol = (typeof getUserEntriesCollection === 'function') ? getUserEntriesCollection(curUid) : null;
    if (userCol) {
     await userCol.doc(String(item.data.id)).set(toSave, { merge: true });
    }
    await db.collection('entries').doc(String(item.data.id)).set(toSave, { merge: true }).catch(() => {});
    // Mark synced in local entries — NEVER remove the entry
    const localIdx = entries.findIndex(e => String(e.id) === String(item.data.id));
    if (localIdx > -1) {
     entries[localIdx].syncedWithCloud = true;
     if (typeof persistAllEntries === 'function') persistAllEntries('offline_queue_set');
     else localStorage.setItem('entries', JSON.stringify(entries));
    }
   } else if (item.action === 'delete' && item.data) {
    // Explicit user-delete only: remove from CLOUD. Local already removed at delete time.
    // Do NOT re-filter / wipe local entries here (prevents accidental data loss if queue is stale).
    const id = String(typeof item.data === 'object' ? item.data.id : item.data);
    const stillTombstoned = (typeof getDeletedEntryIdsSet === 'function') && getDeletedEntryIdsSet().has(id);
    // Only delete from cloud if this id was explicitly marked deleted by the user
    if (stillTombstoned || !Array.isArray(entries) || !entries.some(e => String(e.id) === id)) {
     if (typeof trackDeletedEntryId === 'function') trackDeletedEntryId(id);
     const userCol = (typeof getUserEntriesCollection === 'function') ? getUserEntriesCollection(curUid) : null;
     if (userCol) await userCol.doc(id).delete().catch(() => {});
     await db.collection('entries').doc(id).delete().catch(() => {});
    } else {
     // Entry still exists locally and was never tombstoned → skip false delete
     console.warn('🛡️ Skipped stale offline delete for entry still present locally:', id);
    }
   }

  } catch (err) {
   console.warn('Offline item sync error (will retry):', err);
   remaining.push(item);
  }
 }

 saveOfflineQueue(remaining);
 isProcessingOfflineQueue = false;
 if (remaining.length === 0 && queue.length > 0) {
  showNotification('Offline changes synced with cloud ✓', 'success');
 }
}


// Run sync check on startup
setTimeout(processOfflineSyncQueue, 1500);

// ===== 🧠 SHIVA AI SMART INSIGHTS SYSTEM =====
function renderAiInsights() {
  const container = document.getElementById('aiInsightsList');
  if (!container) return;

  const allEntries = (typeof entries !== 'undefined' ? entries : []);
  if (allEntries.length === 0) {
    container.innerHTML = `
      <div class="ai-insight-item">
        <i class="ti ti-bulb"></i>
        <div class="ai-insight-text">Add your first transaction to unlock smart AI financial insights!</div>
      </div>`;
    return;
  }

  const todayStr = getLocalDateStr();
  const now = new Date();
  const curMonth = now.getMonth(), curYear = now.getFullYear();

  let todayExpense = 0, todayIncome = 0;
  let last7DaysExpense = 0;
  let monthExpense = 0, monthIncome = 0;
  const partyExpenses = {};

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(now.getDate() - 7);
  const sevenDaysAgoStr = getLocalDateStr(sevenDaysAgo);

  allEntries.forEach(e => {
    const amt = Number(e.amount) || 0;
    const normDate = normalizeDate(e.date);
    const isExp = isExpenseType(e.type);
    const isInc = isIncomeType(e.type);

    if (normDate === todayStr) {
      if (isExp) todayExpense += amt;
      if (isInc) todayIncome += amt;
    }

    if (normDate >= sevenDaysAgoStr && normDate <= todayStr) {
      if (isExp) last7DaysExpense += amt;
    }

    const d = new Date(normDate);
    if (d.getFullYear() === curYear && d.getMonth() === curMonth) {
      if (isExp) {
        monthExpense += amt;
        const p = (e.party || 'Other').trim();
        partyExpenses[p] = (partyExpenses[p] || 0) + amt;
      }
      if (isInc) monthIncome += amt;
    }
  });

  // Find top spending party this month
  let topParty = '', topPartyAmt = 0;
  for (const [p, amt] of Object.entries(partyExpenses)) {
    if (amt > topPartyAmt) {
      topPartyAmt = amt;
      topParty = p;
    }
  }

  const dailyAvg7 = Math.round(last7DaysExpense / 7);

  const insights = [];

  // Insight 1: Today / Recent Velocity
  if (todayExpense > 0) {
    insights.push({
      icon: 'ti-trending-up',
      color: '#f06464',
      text: `Today's total expense is <b>₹${todayExpense.toLocaleString('en-IN')}</b> (${todayExpense > dailyAvg7 ? 'higher than' : 'within'} your 7-day average of ₹${dailyAvg7.toLocaleString('en-IN')}/day).`
    });
  } else if (todayIncome > 0) {
    insights.push({
      icon: 'ti-sparkles',
      color: '#3ddc84',
      text: `Great day! You received <b>₹${todayIncome.toLocaleString('en-IN')}</b> today with zero expenses recorded.`
    });
  } else {
    insights.push({
      icon: 'ti-calendar-check',
      color: '#38bdf8',
      text: `No expenses recorded today yet. Your 7-day daily spending average is <b>₹${dailyAvg7.toLocaleString('en-IN')}</b>.`
    });
  }

  // Insight 2: Top Expense Party / Area
  if (topParty && topPartyAmt > 0) {
    const pct = monthExpense > 0 ? Math.round((topPartyAmt / monthExpense) * 100) : 0;
    insights.push({
      icon: 'ti-chart-pie',
      color: '#f5b301',
      text: `Top spending this month: <b>${escapePartyHtml(topParty)}</b> (₹${topPartyAmt.toLocaleString('en-IN')}, approx ${pct}% of monthly expenses).`
    });
  }

  // Insight 3: Financial Health / Savings Ratio
  if (monthIncome > 0) {
    const savingsRatio = Math.round(((monthIncome - monthExpense) / monthIncome) * 100);
    if (savingsRatio >= 20) {
      insights.push({
        icon: 'ti-shield-check',
        color: '#3ddc84',
        text: `Strong financial health! You are saving <b>${savingsRatio}%</b> of this month's received income.`
      });
    } else if (savingsRatio > 0) {
      insights.push({
        icon: 'ti-alert-circle',
        color: '#f59e0b',
        text: `You have saved <b>${savingsRatio}%</b> of this month's income. Tip: Try keeping monthly expenses below 80%.`
      });
    } else {
      insights.push({
        icon: 'ti-alert-triangle',
        color: '#f06464',
        text: `Attention: Monthly expenses (₹${monthExpense.toLocaleString('en-IN')}) exceed income. Review discretionary spends.`
      });
    }
  } else {
    insights.push({
      icon: 'ti-bulb',
      color: '#a78bfa',
      text: `Tip: Split group bills with friends easily using the <b>Split Bill</b> tool below!`
    });
  }

  let html = '';
  insights.slice(0, 3).forEach(item => {
    html += `
      <div class="ai-insight-item">
        <i class="ti ${item.icon}" style="color:${item.color};"></i>
        <div class="ai-insight-text">${item.text}</div>
      </div>`;
  });
  container.innerHTML = html;
}

// ===== 👥 SPLIT BILL / KHATA CALCULATOR SYSTEM =====
let splitMembers = ['Self'];

function openSplitFromAddEntry() {
  const currentAmt = (typeof currentAmountStr !== 'undefined' && currentAmountStr && currentAmountStr !== '0')
    ? parseFloat(currentAmountStr)
    : parseFloat(document.getElementById('hiddenAmountInput')?.value || 0);
  const partyName = (document.getElementById('partyInput')?.value || '').trim();
  const notes = (document.getElementById('notesInput')?.value || '').trim();
  const method = (document.getElementById('paymentInput')?.value || document.getElementById('paymentSel')?.value || 'UPI').trim();

  openSplitBillModal();

  if (currentAmt > 0) {
    const totalInp = document.getElementById('splitTotalAmount');
    if (totalInp) totalInp.value = currentAmt;
  }
  if (notes || partyName) {
    const descInp = document.getElementById('splitDescription');
    if (descInp) descInp.value = notes || partyName || 'Split Bill';
  }
  if (method) {
    const methodSel = document.getElementById('splitPaymentMethod');
    if (methodSel) methodSel.value = method;
  }
  if (partyName && partyName.toLowerCase() !== 'self') {
    addSplitMember(partyName);
  }
  recalcSplitBill();
}

function openSplitBillModal() {
  splitMembers = ['Self'];
  const totalInp = document.getElementById('splitTotalAmount');
  if (totalInp) totalInp.value = '';
  const descInp = document.getElementById('splitDescription');
  if (descInp) descInp.value = '';
  const memberInp = document.getElementById('splitNewMemberInput');
  if (memberInp) memberInp.value = '';

  renderSplitChips();
  renderSplitMembers();
  recalcSplitBill();

  const modal = document.getElementById('splitBillModal');
  if (modal) modal.classList.add('active');
}

function closeSplitBillModal() {
  const modal = document.getElementById('splitBillModal');
  if (modal) modal.classList.remove('active');
}

function renderSplitChips() {
  const chipsWrap = document.getElementById('splitQuickChips');
  if (!chipsWrap) return;

  const allParties = (typeof getAllPartyNames === 'function' ? getAllPartyNames() : ['Sagar', 'Ritesh', 'Ghar', 'Mahi', 'Adarsh']);
  const available = allParties.filter(p => !splitMembers.some(m => m.toLowerCase() === p.toLowerCase()) && p.toLowerCase() !== 'self');

  let html = '';
  available.slice(0, 6).forEach(p => {
    html += `<div class="split-chip" onclick="addSplitMember('${escapePartyHtml(p)}')">+ ${escapePartyHtml(p)}</div>`;
  });
  chipsWrap.innerHTML = html;
}

function addSplitMember(nameParam) {
  let name = nameParam;
  if (!name) {
    const inp = document.getElementById('splitNewMemberInput');
    name = (inp ? inp.value : '').trim();
    if (inp) inp.value = '';
  }
  if (!name) return;

  if (splitMembers.some(m => m.toLowerCase() === name.toLowerCase())) {
    if (typeof showNotification === 'function') showNotification('Member already in split', 'warning');
    return;
  }

  splitMembers.push(name);
  renderSplitChips();
  renderSplitMembers();
  recalcSplitBill();
}

function removeSplitMember(idx) {
  if (splitMembers[idx] === 'Self') {
    if (typeof showNotification === 'function') showNotification('Cannot remove yourself', 'warning');
    return;
  }
  splitMembers.splice(idx, 1);
  renderSplitChips();
  renderSplitMembers();
  recalcSplitBill();
}

function recalcSplitBill() {
  const totalAmt = parseFloat(document.getElementById('splitTotalAmount')?.value || 0);
  const count = splitMembers.length || 1;
  const perPerson = totalAmt > 0 ? (totalAmt / count) : 0;

  const perPersonLabel = document.getElementById('splitPerPersonLabel');
  if (perPersonLabel) perPersonLabel.textContent = `₹${Math.round(perPerson).toLocaleString('en-IN')} / person`;

  const totalLabel = document.getElementById('splitSumTotal');
  if (totalLabel) totalLabel.textContent = `₹${totalAmt.toLocaleString('en-IN')}`;

  const myShareLabel = document.getElementById('splitSumMyShare');
  if (myShareLabel) myShareLabel.textContent = `₹${Math.round(perPerson).toLocaleString('en-IN')}`;

  const othersShare = totalAmt > 0 ? (totalAmt - perPerson) : 0;
  const othersShareLabel = document.getElementById('splitSumOthersShare');
  if (othersShareLabel) othersShareLabel.textContent = `₹${Math.round(othersShare).toLocaleString('en-IN')}`;

  renderSplitMembers(perPerson);
}

function renderSplitMembers(perPersonAmt) {
  const listEl = document.getElementById('splitMembersList');
  if (!listEl) return;

  const totalAmt = parseFloat(document.getElementById('splitTotalAmount')?.value || 0);
  const count = splitMembers.length || 1;
  const share = perPersonAmt !== undefined ? perPersonAmt : (totalAmt > 0 ? (totalAmt / count) : 0);

  let html = '';
  splitMembers.forEach((m, idx) => {
    const isSelf = m.toLowerCase() === 'self';
    const delBtn = isSelf ? '' : `<i class="ti ti-trash split-member-del" onclick="removeSplitMember(${idx})" title="Remove"></i>`;
    html += `
      <div class="split-member-row">
        <div class="split-member-name">
          <i class="ti ti-user" style="color:#38bdf8;"></i>
          <span>${escapePartyHtml(m)} ${isSelf ? '(You)' : ''}</span>
        </div>
        <div style="display:flex;align-items:center;">
          <span class="split-member-amt">₹${Math.round(share).toLocaleString('en-IN')}</span>
          ${delBtn}
        </div>
      </div>`;
  });
  listEl.innerHTML = html;
}

function saveSplitBillToEntries() {
  const totalAmt = parseFloat(document.getElementById('splitTotalAmount')?.value || 0);
  if (!totalAmt || totalAmt <= 0) {
    if (typeof showNotification === 'function') showNotification('Please enter bill amount', 'warning');
    return;
  }
  if (splitMembers.length <= 1) {
    if (typeof showNotification === 'function') showNotification('Add at least one friend to split with', 'warning');
    return;
  }

  const desc = (document.getElementById('splitDescription')?.value || 'Split Bill').trim();
  const method = document.getElementById('splitPaymentMethod')?.value || 'UPI';
  const count = splitMembers.length;
  const sharePerPerson = Math.round(totalAmt / count);
  const dateStr = getLocalDateStr();

  const nowIso = new Date().toISOString();

  // 1. Record total bill payment expense
  const mainExpense = {
    id: generateEntryId() + '_exp',
    party: 'Split: ' + desc,
    method: method,
    amount: totalAmt,
    type: 'expense',
    date: dateStr,
    time: new Date().toLocaleTimeString("en-IN", {hour:'2-digit', minute:'2-digit'}),
    notes: `Total bill split with ${splitMembers.filter(m=>m!=='Self').join(', ')}`,
    timestamp: nowIso,
    updatedAt: nowIso,
    syncedWithCloud: false,
    image: null,
    userId: (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null
  };
  entries.unshift(mainExpense);
  if (typeof queueOfflineSync === 'function') queueOfflineSync('set', mainExpense);
  if (firebaseReady && db) db.collection('entries').doc(mainExpense.id).set(mainExpense, { merge: true }).catch(()=>{});

  // 2. Record pending receive amount for each friend
  splitMembers.filter(m => m.toLowerCase() !== 'self').forEach((friend, i) => {
    const friendEntry = {
      id: generateEntryId() + '_inc_' + i,
      party: friend,
      method: method,
      amount: sharePerPerson,
      type: 'income',
      date: dateStr,
      time: new Date().toLocaleTimeString("en-IN", {hour:'2-digit', minute:'2-digit'}),
      notes: `To receive for ${desc} (Bill ₹${totalAmt})`,
      timestamp: nowIso,
      updatedAt: nowIso,
      syncedWithCloud: false,
      image: null,
      userId: (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null
    };
    entries.unshift(friendEntry);
    if (typeof queueOfflineSync === 'function') queueOfflineSync('set', friendEntry);
    if (firebaseReady && db) db.collection('entries').doc(friendEntry.id).set(friendEntry, { merge: true }).catch(()=>{});
  });

  localStorage.setItem('entries', JSON.stringify(entries));
  if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
  closeSplitBillModal();

  renderWallet();
  renderEntries();
  renderAnalytics();
  if (typeof showNotification === 'function') {
    showNotification('Split entries recorded!', 'success', `Total bill ₹${totalAmt} split among ${count} people.`);
  }
}

function shareSplitOnWhatsApp() {
  const totalAmt = parseFloat(document.getElementById('splitTotalAmount')?.value || 0);
  if (!totalAmt || totalAmt <= 0) {
    if (typeof showNotification === 'function') showNotification('Enter bill amount first', 'warning');
    return;
  }
  const desc = (document.getElementById('splitDescription')?.value || 'Expense').trim();
  const method = document.getElementById('splitPaymentMethod')?.value || 'UPI';
  const count = splitMembers.length;
  const sharePerPerson = Math.round(totalAmt / count);

  let msg = `🧾 *DayToDay Split Bill Summary*\n\n`;
  msg += `📌 *Item:* ${desc}\n`;
  msg += `💰 *Total Bill:* ₹${totalAmt.toLocaleString('en-IN')}\n`;
  msg += `👥 *Members (${count}):* ${splitMembers.join(', ')}\n`;
  msg += `👉 *Per Person Share:* ₹${sharePerPerson.toLocaleString('en-IN')}\n\n`;
  msg += `💳 *Payable via:* ${method}\n`;
  msg += `_Sent via DayToDay Expense Tracker_`;

  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

// 🛡️ Global Protection: Prevent auto-locking when user is picking a file (QR image or backup restore)
document.addEventListener('click', function(e) {
  if (e.target && (e.target.matches('input[type="file"]') || e.target.closest('input[type="file"]'))) {
    window.__isPickingFile = true;
    setTimeout(function() { window.__isPickingFile = false; }, 60000);
  }
}, true);

document.addEventListener('change', function(e) {
  if (e.target && e.target.matches('input[type="file"]')) {
    window.__isPickingFile = false;
  }
}, true);

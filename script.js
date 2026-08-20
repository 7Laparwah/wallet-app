/* ===== Inline script block 1 ===== */
function handleBiometricOrKeypad(){
 if(navigator.vibrate) navigator.vibrate(50);
 focusPinHiddenInput();
}

function pinShakeDots(){
 const dots = document.getElementById('pinDots');
 if(!dots) return;
 dots.classList.remove('pin-shake');
 void dots.offsetWidth;
 dots.classList.add('pin-shake');
 if(navigator.vibrate) navigator.vibrate([80, 50, 80]);
}

/* ===== Inline script block 2 (originally at char offset 3077136) ===== */
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
 if (st) st.textContent = 'Camera start ho raha hai...';
 
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
  
  const stream = await navigator.mediaDevices.getUserMedia({
   video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }
  });
  
  qrCameraStream = stream;
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play();
  
  if (st) st.textContent = 'QR Code ko frame ke andar laayein';
  startQrFrameLoop();
 } catch(err) {
  console.warn('Camera stream failed:', err);
  if (st) st.textContent = 'Camera access nahi mila — "Upload Image" se QR chunein';
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
      st.textContent = 'QR detect nahi hua — saaf image upload karein ya UPI ID manually likhein';
     }
    }, () => {
     if (st) {
      st.style.color = '#f06464';
      st.textContent = 'QR reader load nahi hua, UPI ID manually likhein';
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
  id: 'e_' + Date.now(),
  party: payeeName,
  method: 'UPI',
  amount: amount,
  type: 'expense',
  date: (typeof getLocalDateStr === 'function') ? getLocalDateStr() : new Date().toISOString().slice(0,10),
  time: new Date().toLocaleTimeString("en-IN", {hour:'2-digit', minute:'2-digit'}),
  notes: note,
  timestamp: new Date().toISOString(),
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
  alert('Copy nahi ho paaya, manually likh lo:\n\n' + text);
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
  // Ab hi entry create/save hoti hai — successful confirm hone par.
  entries.unshift(pendingUpiPayment);
  localStorage.setItem('entries', JSON.stringify(entries));
  if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
  if (typeof saveEntryToFirebase === 'function') saveEntryToFirebase(pendingUpiPayment);
  if (typeof renderWallet === 'function') renderWallet();
  if (typeof renderEntries === 'function') renderEntries();
  if (typeof renderAnalytics === 'function') renderAnalytics();
  if (typeof showNotification === 'function') showNotification('Entry saved ✓', 'success');
 } else {
  // Fail/Cancelled — kuch save nahi hota, data discard.
  if (typeof showNotification === 'function') showNotification('Payment cancelled — entry save nahi hui', 'error');
 }
 pendingUpiPayment = null;
 document.getElementById('payConfirmModal').classList.remove('active');
}

/* ===== Inline script block 3 (originally at char offset 3087352) ===== */
// ===== FIREBASE CONFIGURATION =====
// IMPORTANT: Paste your real Firebase project config here
// Firebase Console -> Project Settings -> General -> Your apps -> Web app config
// ===== FIREBASE CONFIG (initialized lazily after UI paints) =====
const firebaseConfig = {
  apiKey: "AIzaSyBneDVwogH0WiEmAAvLHu_Tq862DmDOwmI",
  authDomain: "daytoday-e6646.firebaseapp.com",
  databaseURL: "https://daytoday-e6646-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "daytoday-e6646",
  storageBucket: "daytoday-e6646.firebasestorage.app",
  messagingSenderId: "125507121584",
  appId: "1:125507121584:web:87dec9292e70d7a919e675",
  measurementId: "G-SK7GX8RVEH"
};


// 🔴 REPLACE THE VALUES ABOVE WITH YOUR REAL FIREBASE CONFIG
// (Firebase Console → Project Settings → General → Your apps → Web app)
// Without your real values here, cloud sync/login won't work, but the
// app will at least OPEN instead of failing to load entirely.
let firebaseReady = false;

// ── Activity tracking for Bell icon & Manage Accounts panel ──
let firebaseEventLog = [];   // {time, message, type}
let entrySyncLog = [];       // {time, message, type, entryLabel}

function logFirebaseEvent(message, type = 'info') {
 firebaseEventLog.unshift({ time: new Date(), message, type });
 if (firebaseEventLog.length > 30) firebaseEventLog.pop();
 const dot = document.getElementById('bellUnreadDot');
 if (dot) dot.style.display = '';
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
  const signedInEmail = realAuthUser ? realAuthUser.email : (currentUser ? currentUser.email + ' (unverified session)' : 'Not signed in');
  const isConnected = !!(window.firebase && firebaseReady);
  const statusColor = isConnected && realAuthUser ? '#3ddc84' : '#f06464';
  const statusText = isConnected && realAuthUser ? 'Active' : 'Inactive';

  accountInfo.innerHTML = `
   <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
    <span style="color:#8b9099;font-size:12.5px;">Firebase Project</span>
    <span style="color:#e8eaf0;font-size:12.5px;font-weight:600;">${projectId}</span>
   </div>
   <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
    <span style="color:#8b9099;font-size:12.5px;">Signed in as</span>
    <span style="color:#e8eaf0;font-size:12.5px;font-weight:600;">${signedInEmail}</span>
   </div>
   <div style="display:flex;justify-content:space-between;">
    <span style="color:#8b9099;font-size:12.5px;">Session Status</span>
    <span style="color:${statusColor};font-size:12.5px;font-weight:600;">${statusText}</span>
   </div>
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

function loadRemindersFromLocalStorage() {
 try {
  const saved = localStorage.getItem('paymentReminders');
  paymentReminders = saved ? JSON.parse(saved) : [];
 } catch (err) {
  console.warn('Failed to load reminders:', err);
  paymentReminders = [];
 }
}

function saveRemindersToLocalStorage() {
 localStorage.setItem('paymentReminders', JSON.stringify(paymentReminders));
}

function toggleRemindersPanel() {
 const overlay = document.getElementById('remindersOverlay');
 const panel = document.getElementById('remindersPanel');
 const isOpen = panel.style.display === 'block';
 overlay.style.display = isOpen ? 'none' : 'block';
 panel.style.display = isOpen ? 'none' : 'block';
 if (!isOpen) {
  renderRemindersList();
 } else {
  closeAddReminderForm();
 }
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

function deleteReminder(reminderId) {
 if (!confirm('Delete this reminder?')) return;
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
 updateReminderUnreadDot();
 const list = document.getElementById('remindersList');
 if (!list) return;

 const today = getLocalDateStr();
 const showPaid = document.getElementById('reminderShowPaidToggle')?.checked;

 let visible = paymentReminders.filter(r => showPaid || !r.paid);
 // Soonest due date first for unpaid; paid ones (if shown) go to the bottom
 visible.sort((a, b) => {
  if (a.paid !== b.paid) return a.paid ? 1 : -1;
  return a.dueDate.localeCompare(b.dueDate);
 });

 if (visible.length === 0) {
  list.innerHTML = '<div class="empty-state" style="padding:30px 0;"><i class="ti ti-calendar-due"></i><br>No reminders yet</div>';
  return;
 }

 list.innerHTML = visible.map(r => {
  const isOverdue = !r.paid && r.dueDate < today;
  const isDueToday = !r.paid && r.dueDate === today;
  const color = r.direction === 'incoming' ? '#3ddc84' : '#f06464';
  const icon = r.direction === 'incoming' ? 'ti-arrow-down-left' : 'ti-arrow-up-right';
  const dueLabel = new Date(r.dueDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  let statusTag = '';
  if (r.paid) {
   statusTag = `<span style="color:#3ddc84;font-size:11px;font-weight:600;">Paid</span>`;
  } else if (isOverdue) {
   statusTag = `<span style="color:#f06464;font-size:11px;font-weight:700;">Overdue</span>`;
  } else if (isDueToday) {
   statusTag = `<span style="color:#f6b042;font-size:11px;font-weight:700;">Due today</span>`;
  }

  return `<div style="padding:12px 0;border-bottom:1px solid #1c212b;${isOverdue ? 'background:rgba(240,100,100,.05);' : ''}">
   <div style="display:flex;align-items:flex-start;gap:10px;">
    <div style="width:32px;height:32px;border-radius:50%;background:${color}1f;color:${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ti ${icon}"></i></div>
    <div style="flex:1;min-width:0;">
     <div style="display:flex;justify-content:space-between;gap:8px;">
      <div style="color:#e8eaf0;font-size:13.5px;font-weight:600;">${r.title}</div>
      <div style="color:${color};font-size:13.5px;font-weight:700;white-space:nowrap;">₹${Number(r.amount).toLocaleString('en-IN')}</div>
     </div>
     <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;">
      <div style="color:#8b9099;font-size:11.5px;">Due ${dueLabel}</div>
      ${statusTag}
     </div>
     ${r.notes ? `<div style="color:#6b7280;font-size:11.5px;margin-top:4px;">${r.notes}</div>` : ''}
     <div style="display:flex;gap:14px;margin-top:8px;">
      ${r.paid
       ? `<span style="color:#8b9099;font-size:12px;cursor:pointer;" onclick="markReminderUnpaid('${r.id}')">Undo</span>`
       : `<span style="color:#e8b64c;font-size:12px;cursor:pointer;font-weight:600;" onclick="markReminderPaid('${r.id}')">Mark as paid</span>`}
      <span style="color:#8b9099;font-size:12px;cursor:pointer;" onclick="openAddReminderForm('${r.id}')">Edit</span>
      <span style="color:#8b9099;font-size:12px;cursor:pointer;" onclick="deleteReminder('${r.id}')">Delete</span>
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
 if (!('Notification' in window)) return; // is browser mein support hi nahi hai
 if (Notification.permission === 'default') {
  Notification.requestPermission().catch(() => {});
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
   showNotification('Notifications ON ho gaye ✓', 'success');
   sendAppNotification('Test Notification 🔔', 'Ab se payment reminders aur goals ke notifications yahan aayenge.', 'test-notif');
  } else if (Notification.permission === 'denied') {
   showNotification('Notifications ON — lekin phone/browser settings me bhi allow karna hoga', 'warning');
  } else {
   Notification.requestPermission().then(result => {
    if (result === 'granted') {
     showNotification('Notifications ON ho gaye ✓', 'success');
     sendAppNotification('Test Notification 🔔', 'Ab se payment reminders aur goals ke notifications yahan aayenge.', 'test-notif');
    } else {
     showNotification('Notifications ON — lekin permission allow nahi ki gayi', 'warning');
    }
   }).catch(() => {});
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
 const el = document.getElementById('notifToggleSwitch');
 if (!el) return;
 const userDisabled = localStorage.getItem('notificationsUserDisabled') === '1';
 el.classList.toggle('is-off', userDisabled);
}

// Backward-compat alias — purane code (jaise DOMContentLoaded init) me
// updateNotifStatusLabel() ko call kiya gaya tha, ab wahi switch update karta hai.
function updateNotifStatusLabel() {
 renderNotifToggleSwitch();
}

function sendAppNotification(title, body, tag) {
 try {
  if (localStorage.getItem('notificationsUserDisabled') === '1') return; // user ne "Turn Off Notifications" se band kiya hai
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = {
   body: body,
   icon: 'icon-192.png',
   badge: 'icon-192.png',
   tag: tag || undefined // same tag wali purani notification replace ho jayegi, dher nahi lagegi
  };
  // Agar koi service worker ABHI is page ko actively control kar raha hai
  // (navigator.serviceWorker.controller sirf tabhi non-null hota hai jab SW
  // already active ho) — usi ke through bhejo, mobile PWA pe zyada reliable hota hai.
  // Warna seedha Notification API use karo, taaki agar service worker register/ready
  // nahi hua (ya abhi pending hai), notification atka na rahe aur turant dikhe.
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
const GOOGLE_CLIENT_ID = "125507121584-qm6r6c8ooh5jg8i5lgu5n4o09u9pthrb.apps.googleusercontent.com";
let currentUser = null;

// Initialize Google Sign-In
function initGoogleSignIn() {
  if (window.google && window.google.accounts) {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleSignInResponse
    });
    checkUserSession();
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
const DEV_SKIP_LOGIN_AND_PIN = false;

// Check if user already logged in (Google OR email)
function checkUserSession() {
  if (DEV_SKIP_LOGIN_AND_PIN) {
    // Testing mode: login aur PIN dono skip, seedha app dikhao.
    hideLoadingPage();
    const loginPage = document.getElementById('googleLoginPage');
    if (loginPage) loginPage.classList.add('hidden');
    const pinScreen = document.getElementById('pinLockScreen');
    if (pinScreen) pinScreen.style.display = 'none';
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.style.display = 'block';
    return;
  }

  const savedGoogle = localStorage.getItem('googleUser');
  const savedEmail  = localStorage.getItem('currentUser');

  const raw = savedGoogle || savedEmail;
  if (raw) {
    try {
      currentUser = JSON.parse(raw);
      console.log('✅ User session restored:', currentUser.email);
      updateLoginPageUserInfo();
      hideGoogleLoginPage();
    } catch(err) {
      console.warn('Failed to restore session:', err);
      showGoogleLoginPage();
    }
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
    window.google.accounts.id.disableAutoSelect();
  }
  if (window.firebase && firebase.auth) {
    firebase.auth().signOut().catch(() => {});
  }
  currentUser = null;
  localStorage.removeItem('googleUser');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('appPin'); // clear PIN too on logout for security

  // Restore email/password fields visibility for next login
  const loginFields = document.querySelectorAll('#loginPanel .auth-field');
  loginFields.forEach(f => f.style.display = '');
  const forgotRow = document.querySelector('#loginPanel [style*="justify-content:space-between"]');
  if (forgotRow) forgotRow.style.display = '';

  // Hide everything, show login
  document.getElementById('pinLockScreen').style.display = 'none';
  const appContainer = document.getElementById('app');
  if (appContainer) appContainer.style.display = 'none';

  console.log('👋 User logged out');
  showNotification('Logged out. See you again soon!', 'success');
  showGoogleLoginPage();
}

// Show Google Login Page
function showGoogleLoginPage() {
  const loginPage = document.getElementById('googleLoginPage');
  const userInfo = document.getElementById('userInfoContainer');
  const signInBtn = document.getElementById('googleSignInBtn');
  if (loginPage) {
    loginPage.classList.remove('hidden');
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
    if (el) el.classList.add('hidden');
  });
  const appContainer = document.getElementById('app');
  if (appContainer) appContainer.style.display = 'none';
}

// Hide Google Login Page — show PIN lock next (correct order: Login → PIN → App)
function hideGoogleLoginPage() {
  const loginPage = document.getElementById('googleLoginPage');
  if (loginPage) loginPage.classList.add('hidden');
  hideLoadingPage();

  // Now show PIN screen (after login, not before)
  const pinScreen = document.getElementById('pinLockScreen');
  const appContainer = document.getElementById('app');

  if (pinScreen && appContainer) {
    // Reset PIN state fresh each login
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

    appContainer.style.display = 'none';  // keep app hidden
    pinScreen.style.display = 'flex';     // show PIN screen
    setTimeout(focusPinHiddenInput, 150); // open phone's native numeric keyboard
  } else {
    // fallback: go straight to app
    if (appContainer) appContainer.style.display = 'block';
  }
}

// Loading Page Functions — fast fade, no artificial delay
function showLoadingPage() {
  const loadingPage = document.getElementById('loadingPage');
  if (loadingPage) { loadingPage.classList.remove('hidden','fading'); }
}

function hideLoadingPage() {
  const loadingPage = document.getElementById('loadingPage');
  if (!loadingPage) return;
  loadingPage.classList.add('fading');
  setTimeout(() => loadingPage.classList.add('hidden'), 250);
}

// ===== PWA: Service Worker (offline support) =====
if ('serviceWorker' in navigator) {
 navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
 }


// ===== GOOGLE DRIVE BACKUP =====
const GOOGLE_DRIVE_CLIENT_ID = "324706776796-fc1gd4t4m02csmav6kb491nihejah0ik.apps.googleusercontent.com";
const GOOGLE_DRIVE_FOLDER_ID = "1vS-zpGlYHhoUmC9S69G-BCshpirqtsMo";
let gDriveTokenClient = null;
let gDriveAccessToken = null;

function initGoogleDrive(){
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

 // group by METHOD (Cash/UPI/Bank) — used by the Payment/Receive Method bar chart
 const methodTotals = { Cash: 0, UPI: 0, Bank: 0 };
 monthEntries.forEach(e=>{
  const m = ["Cash","UPI","Bank"].includes(e.method) ? e.method : "Cash";
  methodTotals[m] += Number(e.amount||0);
 });

 return { total, catArr, trendLabels, trendData, methodTotals };
}

// ===== FUNCTIONS =====

// Load from localStorage and normalize data
async function dedupeEntries(){
 const seen = new Map();
 const toDelete = [];

 entries.forEach(e => {
const key = [e.party, e.type, Number(e.amount), normalizeDate(e.date)].join('|');
 if(seen.has(key)){
 const existing = seen.get(key);
 if(new Date(e.timestamp) > new Date(existing.timestamp)){
 toDelete.push(existing.id);
 seen.set(key, e);
 } else {
 toDelete.push(e.id);
 }
 } else {
 seen.set(key, e);
 }
 });

 entries = Array.from(seen.values());
 localStorage.setItem('entries', JSON.stringify(entries));

 if(firebaseReady && db && toDelete.length){
 for(const id of toDelete){
 try { await db.collection('entries').doc(String(id)).delete(); } catch(err){}
 }
 console.log('🧹 Removed', toDelete.length, 'duplicate entries from Firebase');
 }
}

function loadFromLocalStorage() {
 try {
 const saved = localStorage.getItem('entries');
 if(saved) {
 entries = JSON.parse(saved);
 
 // Normalize all entries (handle old and new formats)
 entries = entries.map(e => {
 return {
 id: e.id || Date.now(),
 party: e.party || 'Unknown',
 method: e.method || e.cat || 'Cash',
 amount: parseFloat(e.amount) || 0,
 type: normalizeType(e.type), // Convert "Payment"→"expense", "Received"→"income"
 date: normalizeDate(e.date), // Convert to YYYY-MM-DD
 time: e.time || new Date().toLocaleTimeString("en-IN"),
 notes: e.notes || '',
 timestamp: e.timestamp || new Date().toISOString()
 };
 });
 
 console.log('✓ Loaded from localStorage:', entries.length, 'entries');
 } else {
 entries = [];
 }
 } catch(err) {
 console.error('Error loading from localStorage:', err);
 entries = [];
 }
}

// Normalize type: "Payment"→"expense", "Received"→"income"
function normalizeType(type) {
 if(type === 'Payment' || type === 'expense') return 'expense';
 if(type === 'Received' || type === 'income') return 'income';
 return type || 'expense';
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
 
 // If already YYYY-MM-DD format
 if(date.includes('-')) return date;
 
 // If DD/MM/YYYY format
 if(date.includes('/')) {
 const [d, m, y] = date.split('/');
 return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 }
 
 return getLocalDateStr();
}

async function saveEntryToFirebase(entryData) {
 if (!firebaseReady || !currentUser) {
 showNotification(editingEntryId ? 'Entry updated (local)' : 'Entry saved (local)', 'success');
 logEntrySync('Saved locally (Firebase not ready)', 'warning', entryData.title || entryData.party || '');
 return;
 }

 // 🔒 SAFETY CHECK: make sure the real Firebase Auth session is still alive.
 // Browsers (privacy/tracking-prevention) can sometimes wipe Firebase Auth's
 // storage even though our own localStorage "currentUser" still looks logged in.
 // If that happens, Firestore Rules will reject every write with
 // "Missing or insufficient permissions" even though the app thinks it's logged in.
 const realAuthUser = firebase.auth ? firebase.auth().currentUser : null;
 if (!realAuthUser) {
 console.warn('⚠ Firebase Auth session missing — re-login required before saving');
 logEntrySync('Save failed — session expired, please log in again', 'error', entryData.title || entryData.party || '');
 showNotification('Session expired — please log in again to save data', 'error');
 return;
 }

 try {
 // 🔒 ADD userId FOR SECURITY - entries can only be read by their owner
 const userId = currentUser.uid || localStorage.getItem('currentUserUid');
 const entryWithUserId = {
  ...entryData,
  userId: userId,
  savedAt: new Date().toISOString()
 };

 if (editingEntryId) {
  // Verify user owns this entry before updating (security check)
  const docSnapshot = await db.collection('entries').doc(String(editingEntryId)).get();
  if (docSnapshot.exists && docSnapshot.data().userId !== userId) {
   throw new Error('Unauthorized: Cannot update another user\'s entry');
  }
  await db.collection('entries').doc(String(editingEntryId)).update(entryWithUserId);
  console.log('✓ Entry updated in Firebase (userId verified)');
  logEntrySync('Entry updated in Firestore', 'success', entryData.title || entryData.party || '');
 } else {
  await db.collection('entries').doc(String(entryData.id)).set(entryWithUserId);
  console.log('✓ Entry saved to Firebase with userId:', userId);
  logEntrySync('Entry saved to Firestore', 'success', entryData.title || entryData.party || '');
 }
 showNotification(editingEntryId ? 'Entry updated' : 'Entry saved', 'success');
 } catch (error) {
 console.error('❌ Error saving entry to Firebase:', error);
 const reason = error.code === 'permission-denied' ? 'Permission denied — check Firestore rules' : (error.message || 'unknown error');
 logEntrySync('Save failed — ' + reason, 'error', entryData.title || entryData.party || '');
 showNotification('Firebase save error — saved locally instead', 'error');
 }
}

async function deleteEntryFromFirebase(entryId) {
 if (!firebaseReady) {
 entries = entries.filter(e => e.id !== entryId);
 showNotification('Entry deleted (local)', 'success');
 return;
 }
 try {
 await db.collection('entries').doc(String(entryId)).delete();
 entries = entries.filter(e => e.id !== entryId);
 console.log('Entry deleted from Firebase');
 showNotification('Entry deleted', 'success');
 } catch (error) {
 console.error('Error deleting entry:', error);
 showNotification('Error deleting entry', 'error');
 }
}

async function loadEntriesFromFirebase() {
 if (!firebaseReady || !db || !currentUser) return;
 if (!navigator.onLine) { throw new Error('Offline — skipping Firebase fetch'); }

 // 🔒 Make sure the REAL Firebase Auth session is actually ready before
 // querying Firestore. Some browsers (Edge "Tracking Prevention", Safari
 // ITP, etc.) can block the storage Firebase Auth needs to persist its
 // session, so firebase.auth().currentUser may still be null right after
 // a page reload even though our app's own localStorage says "logged in".
 // Wait briefly for Firebase Auth to confirm the real session before giving up.
 const realAuthUser = await new Promise(resolve => {
  if (firebase.auth().currentUser) { resolve(firebase.auth().currentUser); return; }
  const unsub = firebase.auth().onAuthStateChanged(u => { unsub(); resolve(u); });
  setTimeout(() => resolve(firebase.auth().currentUser), 5000); // generous fallback timeout
 });

 if (!realAuthUser) {
  // Don't force a full logout just because Firebase Auth hasn't finished
  // restoring its session yet (slow network/device, first load, etc.) —
  // that was logging people out even though they were still legitimately
  // signed in. Just skip this cloud-sync cycle and keep using local data;
  // the next periodic sync (or app reopen) will pick things up once the
  // session is confirmed either way.
  logFirebaseEvent('Firebase session not confirmed yet — using local data for now', 'warning');
  return;
 }

 try {
 const userId = currentUser.uid || localStorage.getItem('currentUserUid');
 // 🔒 SECURE: Only load entries that belong to current user
 const snapshot = await db.collection('entries')
  .where('userId', '==', userId)
  .get();

 const cloudEntries = [];
 snapshot.forEach(doc => {
  const data = doc.data();
  cloudEntries.push({
   id: doc.id,
   party: data.party || 'Unknown',
   method: data.method || data.cat || 'Cash',
   amount: parseFloat(data.amount) || 0,
   type: normalizeType(data.type),
   date: normalizeDate(data.date),
   time: data.time || '',
   notes: data.notes || '',
   timestamp: data.timestamp || new Date().toISOString(),
   userId: data.userId // Keep userId for reference
  });
 });
 
 // Newest first
 cloudEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

 if (cloudEntries.length === 0 && entries.length > 0) {
  console.warn('⚠ Firebase returned 0 entries (might be first sync) — keeping local data');
  return;
 }

 entries = cloudEntries;
 localStorage.setItem('entries', JSON.stringify(entries));
 console.log('✓ Loaded from Firebase:', entries.length, 'entries for user:', userId);
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
 return (e.type==="expense" ? "- ₹" : "+ ₹") + Number(e.amount).toLocaleString("en-IN");
}

function fmtDateLabel(d){
 const today = getLocalDateStr();
 const yest = getLocalDateStr(Date.now() - 24 * 60 * 60 * 1000);
 if(d===today) return "Today, " + new Date().toLocaleDateString("en-IN", {weekday: 'short', month: 'short', day: 'numeric'});
 if(d===yest) return "Yesterday, " + new Date().toLocaleDateString("en-IN", {weekday: 'short', month: 'short', day: 'numeric'});
 return new Date(d).toLocaleDateString("en-IN", {day:'numeric', month:'short', year:'numeric'});
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

// ---- Goals list render ----
function renderGoalsList(){
  const listEl = document.getElementById('goalsList');
  if (!listEl) return;

  if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();

  const totalSaved = goals.reduce((s,g) => s + (Number(g.saved) || 0), 0);
  const totalTarget = goals.reduce((s,g) => s + (Number(g.target) || 0), 0);
  const totalPct = totalTarget > 0 ? Math.min(100, Math.round((totalSaved / totalTarget) * 100)) : 0;
  const activeCount = goals.filter(g => g.status !== 'completed').length;
  const completedCount = goals.filter(g => g.status === 'completed').length;

  setGoalText('goalsTotalSavedText', fmtGoalMoney(totalSaved));
  setGoalText('goalsTotalTargetText', fmtGoalMoney(totalTarget));
  setGoalText('ringGoalsTotalPct', totalPct + '%');
  setGoalText('goalsActiveCountText', activeCount);
  setGoalText('goalsCompletedCountText', completedCount);
  drawGoalsRing(totalPct);

  if (goals.length === 0){
    listEl.innerHTML = `
      <div class="empty-goals">
        <i class="ti ti-target"></i>
        <p>No goals yet. Tap the + button above to<br>create your first goal.</p>
      </div>`;
  } else {
    listEl.innerHTML = goals.map(g => {
      const pct = pctOfGoal(g);
      const barColor = goalProgressColor(g);
      const safeId = g.id;
      return `
      <div class="goal-card" onclick="openGoalDetailsFromCard(event,'${safeId}')">
        <div class="goal-top">
          <div class="goal-icon glossy" style="${glossVars(g.color)}">${iconBadge(g.icon)}</div>
          <div class="goal-info">
            <div style="min-width:0;flex:1;overflow:hidden;">
              <div class="goal-name">${escapeGoalHtml(g.name)}</div>
              <div class="goal-sub">${fmtGoalMoney(g.saved)} / ${fmtGoalMoney(g.target)}</div>
            </div>
          </div>
          <span class="goal-pct-badge" style="color:${barColor};">${pct}%</span>
          <div style="position:relative;">
            <button class="goal-kebab" onclick="toggleGoalCardMenu(event,'${safeId}')">&#8942;</button>
            <div class="goal-menu-pop" id="goalCardMenu-${safeId}" style="display:none;">
              <button onclick="event.stopPropagation();closeAllGoalMenus();openGoalDetailsModal('${safeId}')"><i class="ti ti-eye"></i>View</button>
              <button onclick="event.stopPropagation();editGoalOpen('${safeId}')"><i class="ti ti-pencil"></i>Edit</button>
              <button class="danger" onclick="event.stopPropagation();askDeleteGoal('${safeId}')"><i class="ti ti-trash"></i>Delete</button>
            </div>
          </div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${barColor};"></div></div>
      </div>`;
    }).join('');
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

  if (editingGoalId){
    const g = getGoal(editingGoalId);
    if (g){
      g.name = name; g.target = amount; g.targetDate = date; g.description = desc;
      g.icon = goalFormIcon; g.color = goalFormColor;
      g.status = (g.saved >= g.target) ? 'completed' : 'active';
      saveGoalsToStorage();
      closeGoalFormModal();
      renderGoalsList();
      openGoalDetailsModal(g.id);
      if (typeof showNotification === 'function') showNotification('Goal updated ✓', 'success');
    }
  } else {
    const g = {
      id: uidGoal(), name, target: amount, saved: 0,
      startDate: new Date().toISOString().slice(0,10), targetDate: date,
      description: desc, icon: goalFormIcon, color: goalFormColor, status: 'active',
      contributions: []
    };
    goals.unshift(g);
    saveGoalsToStorage();
    closeGoalFormModal();
    renderGoalsList();
    openGoalDetailsModal(g.id);
    if (typeof showNotification === 'function') showNotification('Goal created ✓', 'success');
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
          <h3>${escapeGoalHtml(g.name)}<span class="goal-badge ${g.status==='completed'?'completed':'active'}">${g.status==='completed'?'Completed':'Active'}</span></h3>
          <div class="tg">Target: ${fmtGoalMoney(g.target)}</div>
          <div class="dt"><i class="ti ti-calendar" style="margin-right:4px;"></i>Target Date: ${fmtGoalDate(g.targetDate)}</div>
        </div>
      </div>
    </div>

    <div class="gl-card">
      <div class="gl-progress-head">
        <h4>Progress</h4>
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="add-money-btn" onclick="openAddMoneyModal()">+ Add Money</button>
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
    if (typeof sendAppNotification === 'function') sendAppNotification('Goal Achieved 🎉', `Aapne "${g.name}" goal achieve kar liya hai!`, 'goal-' + g.id);
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

function goalNameKey(name){ return (name || '').trim().toLowerCase(); }

// All expense entries whose Party Name matches this goal, expressed as
// pseudo-contributions (used for the "Recent Contributions" list).
function getAutoContribsForGoal(g){
  const list = (typeof entries !== 'undefined' && Array.isArray(entries)) ? entries : [];
  const key = goalNameKey(g.name);
  if (!key) return [];
  return list
    .filter(e => e.type === 'expense' && goalNameKey(e.party) === key)
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
  goals.forEach(g => {
    const newSaved = computeGoalSaved(g);
    if (newSaved !== (Number(g.saved) || 0)){ g.saved = newSaved; changed = true; }
    const wasCompleted = g.status === 'completed';
    const isCompleted = g.target > 0 && newSaved >= g.target;
    if (isCompleted && !wasCompleted){
      g.status = 'completed'; changed = true;
      lastCompletedGoalId = g.id;
      if (typeof sendAppNotification === 'function') sendAppNotification('Goal Achieved 🎉', `Aapne "${g.name}" goal achieve kar liya hai!`, 'goal-' + g.id);
    } else if (!isCompleted && wasCompleted){
      g.status = 'active'; changed = true;
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

// ---- Alerts: target date passed but not completed ----
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
    if (isNaN(target) || target >= today) return;
    const remaining = Math.max(0, g.target - g.saved);
    bannerHtml += `<div class="goal-alert-banner"><span class="baIcon">⏰</span><span>"<b>${escapeGoalHtml(g.name)}</b>" ki target date nikal chuki hai — ${fmtGoalMoney(remaining)} abhi bhi saved karna baaki hai.</span></div>`;
    const key = g.id + '-' + g.targetDate;
    if (!notifiedMap[key]){
      if (typeof sendAppNotification === 'function') sendAppNotification('Goal Reminder ⏰', `"${g.name}" ki target date nikal chuki hai. ${fmtGoalMoney(remaining)} abhi bhi baaki hai.`, 'goal-deadline-' + g.id);
      notifiedMap[key] = true;
      changed = true;
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
  Food: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHCAkIBgoJCAkMCwoMDxoRDw4ODx8WGBMaJSEnJiQhJCMpLjsyKSw4LCMkM0Y0OD0/QkNCKDFITUhATTtBQj//2wBDAQsMDA8NDx4RER4/KiQqPz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz//wAARCAEUAeADASIAAhEBAxEB/8QAGwAAAgMBAQEAAAAAAAAAAAAABAUAAwYCAQf/xABEEAACAQMCBAMFBwEHAwMDBQABAgMABBEFIRIxQVETYXEGIjKBoRQjQpGxwdFSFSQzYnLh8ENTkhaC8Qc0ojVEY4OT/8QAGwEAAgMBAQEAAAAAAAAAAAAAAwQBAgUGAAf/xAA0EQABAwMCAwYGAgIDAQEAAAABAAIDBBEhEjEFQVETImFxgfAUMqGxwdGR4SPxFTNCQ1L/2gAMAwEAAhEDEQA/APpGm3/hAQzH3Pwsen+1OQQRkbispRlnfyW2FbLx/wBPUelclw7i3ZARTbcj0/paM1Nq7zN1oKlVQTxzpxRMCOo7VbXVNc17Q5puFnkEGxUqVK4LEnhTn1PQVZQveLLlR05ms5rmm+CxuoF+6Y++o/Ce/pWjACLj6msXrmtyX14LWwfFtEcu/SQ/x+tIV8LJoS12/LzTVK17n931Q9eVAQRtUrinNLTYrRR1vNxrwsfeH1q2lqsVYMvMUwjcSIGFCcLKQh7i/jgZg6vhTgkDaqv7UjLFRHISBk8uVC6qvvXIP9KsKDVxHK5P4oyox6itCOnjcwOKzX1EokLW9UybV1wpWIkMcA8VcHVZSX4YlHCATuTz/wDig7G2M8sULkDJAA/k1fPYPBcNAUd3AwWRjvRRTxgXDU0IKl3zOAPReHVZiF99V4hkAAVTJe3DJIRM2V5YPlVMtv8AZ41XhLKee26/OiLnRpY9MW+iYPAy5K595RyzV2RtN9LdlaSidpH+TJ/hcyzTR+HIJSwIJxxHmCKfW8nixcRO9ZVZCzBHOSQRn5U+0iTjgA7rS1WwaA4Jam1xyOjfumNSvKlZy0F7UzXhIUEnkBmsius6td3bGxjZ1A4hCkHHgdOI86PDTvmvp5Jaoqo6e2rmtfSrXdWGmQJw4M8uQgbkO5NMPZm9tNXEkNyJIL6H/Et2227jO5H6VzBptvee217cSxhoNOSOKNW3HiEcRPyzWlBwqXD5LW80tPWB0dojk81n9L9oZWv47a+5TbK/BwFT2I7GtPVntfpUepaHNJGgF3bIZYXA323x6HFMLCC1vtLtbnwypmhRzwsRzGaPNwl0rv8ACQEOmqXR3ZKb9ClealNZNJQ/4UpHk4oKaxuIRlo+Je671mzcOqoMuZjwytFs0b9ih6leVKRRV7vXvC3p6mr7aBpZOEbY+Ju1MVs4AuODPmTvXTUnAtbA+dxF+Q/KSkqrGzQlKwyuMohYeVKPaq41PSdNhms7XxWlk8MnBYxkjbYd61tooSNox+ByDSfVpmn1AQBsImxx361aq4bS0DO1dd3QFeinfK6ywNp7O32qXH2rWp5Czb+EGy3zPIegrXWGmW9nCsUMSoo/Cg6+fc0aqqowoAHlVrM8LCKEDxyMsx38MeXnWOZpao2Js0cht6BNbKxLRgB4jLEOgPP8q6FrGeU//wCG1BN9nDHxpWkfqSTXSLaucRNwt0wSDRGxQjGkHzOfooId1+iJktZUXiA417rVABJAGST2q6OeW2ILsXj/AKuo9f5q65iVk8eEYI3YD9arLSMLS+O+Nx+lUPcDZyD9a7l8MOBESQAMk9TXplDSs0qA8XPGx9RVcskMNrPI+WKrlRy+dJhoN2tIz13x+1e53K7Cx+FnxDx/08P71IgrSASMVU/i7Gklv9svQxaYomd8bDPYUh1HUruO9ltdBE93OoxI8aFgn8mmo6bW8NFrjfe3qVUusMrWXuoWlgpa7uY4x5tzpV/6rsHVmtorq4RfieKBmUfOlfs57JyXpOo+0InDiTKwS7cQHVuuM9PKvoEYWBRbxIicKcQRVAwvpTjaCFuHEkqhlPJZNfavTwf7wl1bjvLAygfOm1nfWl7Hx2lwkq/5TmmjpbX0EkEqccPDh1kXPF22pNqHs1pkha6gJsbp2/xrc8JDY6ryI+VVfQwkXabfULwlPNHVKS2t/dWN6mna0FEr/wCBcoPcmH7N5U56VlSwvhdpcjhwcML2mGmr7jt3OKXUw08t4MgBA94c6a4bb4kX8fshzfIjqlV8LE4MjZ8hipwkNgSNXT3PRJ2VlcysEidjyCk/SucyL2b02NBavccFjwqCDIeHft1qksojYXHkpDbmyz9X2n+P8jVFE2anjZugGK5E7J5FVKlShKy7ikeKQPGxVh1FObPUklwk2Ek6HoaR1KdpK6akd3DjpyQpImyDK1JBY/Fhew2Ne+6i9AoGewFJLPUXgXglBdANt9xSTXLjUb6QpJII7PokfX/V3/Suqh4rTytFj3jySbaR7n6TsrfaDXjeFrDTWzGdpZR+Idh5efWlcMSwxhV9Se9exRJEvCgwP1rqqveXm5WtHE2Julq9Bwc1ZnNVV6Dg1n1dKJhqb8yl7NWQrKthlMb/AOU86qHKpWARbBS651VeJ3I5GHP5Gg7KNJpBJJ8IwB+W5qy8kZWA5gxkY+eap0SMTRs4bfkCelaMN+yCBTMHxD3Hl+UdICbjixw8Hw4otL6QXJmkAZzGY+3Sh7rxEYSFRw494g75r1S8rBSeflRA5zThaFtTQXBDPAwRsksrDcdOX61dpNxJ9geDxhwPzUjl5iqTcp4brhiMkZ5AHv51xpYUKwIySuMVAcWnCs+5YdQ2XOrxLGqMPiDbHrVuivjA88UHqpkBQN8IOAM7k0TpQxKw7PihzZiKz6iwqWdbftPaqlureFwk1xFGx6O4B+tXVkNB0j+29euYLqVk8IFpiAOJjxYxk0pS03xDiLoNXUug0houStrZ2v24lVYeER7zA5FB+wMAtdFulcffpdvHJ393AA/KrIfZX+zH8TQ9TuLWTqkhEkT+TLtXOl3E1p7ST2uoQC2k1AeIOE5jeVRglG7MuDg7gg10VLSspmWHzcys6aZ0r2ucLW/KY6xpYvWS7s+GHU7Y8UE3f/K3dTyqn2enW5i1K64TG0t4WdG5oQigqfQgim5bh3YgEd6x/tBrUegzX0qrxJdsjIinBMoBDZ+QU0w94YF5kRe8aU51LVCheOIcWRgiu/Zy+tk06CwLFHtkEYDnJYDlWLi12KTTRezDwkYdTnhOcb/Olune0MUl3MC6xEN7jk7OM/Q1nQ1NU2UyWwOS3PgYtAaTZ3I++S+xDflXoOOVZ3RNWW6hVS44sdD/AM2p2sxHxDNdJFI2Vge3ZY8kbo3Frt1J7SCfJkTDf1LsaV3OnSw++n3qDqOY+VOVYMNjXXKkqrhsFTkizuo95V453s8kq04kBvdJVjkMP3o7pXNxZrKS8RMUvddgfWlFwbyJzHJNKp8jz9K9PxB1KP8AOwnxG39KWxCQ90oy5uItPhZi3FK+4BO7GkkCsztNJ8THO9diFeLiYl2PVjmrK5fiHEXVrhiwHJPwwiIeKstwDMC3wrliPIDNVeMYrfxmHFJM3Eaug3kZBzeNwPyqiSMzWEZTdlGcVWAEQ3bvn8e/VFxqyhZrh5hhwvqBVQ714+Qp4Rk9qAjHvP4rkTsCuAoPAcb7jYZGDvQLF9ySmMDATuO8biUSbpjDefnTDTn4XkgY5Vdh/pNIYWR4UaNuKMj3T3FNdOcyXYI5+GAfWmqaV3aAHqgTMGk2V0rgScDR+7H7oAOPnQd/H49rKkS8JYbAn50TOeK4kYf1HH515I/iYJUcXUjrSj39452OMe/0qgYCx+r6pdWemNY2sMhu5WKpwKS2PxHA/wCb049kdDl0nQnLvIt5dASSA/gONl9d9660JpLr2t1SZnUW8EaWw/qDfFn0/wBqeTXqxgBSGKHYDvW0zSyLOL5KASS7C6jQm1EV0VM7ICwjPI964CSrc8QhYLw58cvvnt6VdHJJLKLmNk8Ncjg+H19TUlikbxAbhmicgnuB29KKWgtuPfiq3zlVsftKKW4uOPAfAIU/PrXDpDHc8AjMsp2CMTvRn3fgiESA8CfGWxw9s0FbQ25uiruZ2A4gAeQ/cGoezI8efu6gHBQ2r2drqFmbG5CqCMq8Zz4TDkwPcUp0K9mKSWd9gXVq/hSdiejDyI3p6qrAJpGKe98OBj5YrP6nELX2isZ0+G8tjE/mybg/kSPlSkze1jc08shEadJT2jdP+B/9S0uhfjiBPPkaY6f8EvqtI8PxUt9fsUWX5Ed/1PlU/wCp6CvSPfFeD4z8q6lJKfjJ7CkWtTGS4SPOyDPzO/6Yp2zBY2ZtgTk+n/BWWmkMszyHmxzWXxGXTGGdUaIXN1XR9svDCvc70Ei8ThR1OKYjbYVz7k0FKlSu40aRwqjnXo43SODGi5K8SGi5XNThPY0xtrQNtGobu55fKj109Me+xY/lW5DwYvFyb/Qf3/CVdU2Kz526V4e1aCTTYmG2R86VXlk9uc81PUUKq4RLC0vZkD372Ux1LXGxSie0/FF81/ig6cULdwcQMiD3hzHeq0dcbiOU+RTzX8igalSpW2jL1Wxy5VYNxtQxXwveT4PxKOnmP4q6M77cjWfW07XsLxuEJ7bi6F1MERxuNiGx+YpZpl0bPi2JQsQcdCDtTi/Xis3/AMuDSKaNg10oHxNxJ55GaUpu9HZZUkhgn1jmtbYvYajpzLJIIrlCT77YJ6j1FBPfJG7CTi4gOH4efzpXPEPHTwfhZeL0PavUF4FZVB3/AKtx60Z5uBi1k6yppzdxJ8rbJpdTJfNHYxLFBFGCzdhjfn1J2qiO4WyRgygOeRoWO0uVlDqxGxOT0NWppjv8ZLHOc86G6Ru7ivGrGm0bCfNCuZLxpWP4AcD0GaZaWrCTiYYEhDL5irYNOdHdxkFxwnOBtRttpjRRiRVwi9RQJJWvYWsyk2RymXtZESaWOraRrqazbozwuOC8jUZPD/WB1xgflTRcFhxHA6nFWKvhXCBiD7wIIOxGaVpnvieHtTE8TZW6T5hOIpI5ollicSRSDiR1OQQeoofU4be5sWiuzhAeJXBwyMOTA9CDXp01rKZ5NLZY0diz2z/4bE8yuN0Ppse1IdXupLi5kjkXwhARlOLI4u+3MCurq3mmZqIWdTwmd2g+qkuq3MlsI5pkMqjDSIMZ88dKzeo6JLrEonuL5bawgP3rvyDH+nufKiRfRS36WUF0vj8QUqQFOSdvXnVepP8A2te3mn+CDp9nJ4MSk44mX43PmTWVEX3NRLy/Pv3ut1kLIwI2c/x1XcMXs9a2KwrqE8cUYx40iKVPmQN+dKdeddLkNlc2Qkadco0WOCVTyKnma4l9l7JiyQ3DLLtsSCB6d6e6rAq6Lo8UqESR+MkeN2EYAAwfXFNMfBMHG2QL9PfmrXkaQAcHHVBaYwsIYBGSvgqAQTk+hrYpq6tYq8XvSMPdJ6etYjTNHjskZpXkCOQSGILH+KYPOWVVQcCr0WlW1UkWpsR35/nzV5aZtQWkjZMm1C4tbgTiZi2fh7jzrV2GoJdwK45/iHY185mu1+0hJnAZl4gSQBzxij9NvnsLkOu6HZ17iiUVS+mcNZu07/tDqaESs7vzD3ZfRRvuK4mijnjKSrxD6ihbW5WWFJYm4o3GRRasGXINdMQ2RtjkFc9lp6EJFd2j2r7+9GeTUNWmdVkQo6hlPMGkl9ZtbPkbxt8J/Y1yPEuGGn/yRfL9v6WjBPr7rt0BJMbeaGUfhaiWKwSbf4Ep4o26DuKDvFJiBAJCn3gO1cWt4Io/CmUS27d+lJ00ga3SUyW3Fwu7ti2zw8DZ2bPOhc0zEHGhFrOkkZ/6cpwRVH9m3ed0UDuXGKtJBK43Av5f0rNkaBYmyD50ysMWtsbhyA0hxGD1NUmCC23uJRK/SKM/qaGuJ3uJOJ8YAwqjko7CqtHYd4/Ny8PE/pVe7WLDZHV7QUNwye6+Sv1FFqwZeIHIpEghSkHsldwp7Ra3YyErPJP4q+agYP5c/nWkubaM3g5qrrxKSeZ/50rA6s13o/t1FdWQi4roYAmbhRs7EE9Om9b6Q3MjqgiD8IDYxkA8zg10TtLo2utuAlMhxRkcRhtzxIiknYjr6DpXKWcDM08aDxR8TE+X0ql5HuY1dZMZYhgDgIvb186rt7YWksyJcgeM/FxlsH1ompt7AXCgXsc2KNaIfajI/CYY1AK4+vnXseH+9jPBGdnLDB+VVt4UM/DJITM2yBm3bua9ntgLJzI7nK8Ry3LHYUUXzYbX9/0qdFRMsM2LaMonA+fTvvSb2njVLvRlQg8Ny2MdvDOacaXNDdQhrdgwTYhhg/lSL2huPF9obZFHGtrEXbAx7z7D090H86XOWF/VEsQ7SjrM+6486mo6w2i6dJcJAJmZlUAtgA+dVadOknGo2fY8J7Uu9smxoqjvMv6Gsmk1R1TcJnSHCxSyT231p3yjW8Y/pWHP60Rae3moxuPtdvBOnXhBQ/xWSqcq6lXMMZ5L6vLrFtqGjRzWjH77YqwwyY5g0robTIvA0y3jxuEBPqdzRQGSAOZ2rmKubtpSeQwhNaG4CvtEy5Y/hoyuIo/DjC8+5rukCblEXlMLOHiCqOb8z2FAU60wAnJ6KB+tbXB4g97r+A9Mk/ZK1LiAEegSJQgGBivCxPlXhOTmhHmmRFcgAA4blgAdc5xjHSuxw0LNAujFIHMn5VJo0miZTuCMGq4pBLErr1Gcdquj5E1KhZeVDHKyHmpxXFG6kgFwzjkWI+goKvn1fCIKl7Btf75WxC7VGClUy8EzL2O1cUTfLiYN/UKGroKd/aRNd4J0G4UrmH3JCh5Dceh/3rqvBGz3MYQZJytFcA5pB5qTtlXEBgQRkHoa4EUY5RoP/aKocXljCsl3H7jyFQpPvDr+VXQzRzLlGzjmDzFc7NBJDnl1SpYN90XAkLABhhu2cZogQxj8AoCrorhkwG95f0pQgrwRixrnCoM+QrtCocFxlQdwOtcxuDh0PLkR0q4lZBJI5CuTsq9+9eY2+b5Hv31UErk8U0/uqOJjsBXLDhdlyDg8xXRVYiGd1K9eB9xXLzw8HhB0bhOVYHBx50Qx3aS7f3/efsovnC5qelQEEZBqUurrTRuJYY3H4lBrH6zCYNYnLgeHJ94pJxua0mky8dqY/wAUZ+hrjWdPF9bDhA8WPdfMdq7OdprqFr277/tIQPFPOQ7Y4XzvWOAPDLcCOKRJFaKXb3WByMnttimUlrLe3T6hpo8ezusu8MaAmNzuQcb88nPWlWsW1x4xgiijeJsh1mO2P1zV1hbrFLxRp4UjLlvDYjfHcVlxyRtg0Sbb45Lccwk628h/KYyaYtnAs+pTGBWPuwhczSeSr3+grgSNLP8AaZ1SJwvBHEWyIIxyXzPUnvRUkSw21qQgEjjikc7s2ByJ5nnS/UzfLBx2ngbn3kk2LDyPerVbmxn4eIWuBcnc87JaG8nffne38ru4LTsqQgO7bDh3P5ULB7N64NTWS9eEwqh4A0qxkMf8uaL06+az0SO8cC2ub12RSzbxopwceZOfkKrkdEZl8Mux+JpN81XSylGhwuT9PVH1F3yGwH1+oQOraPfR6nbSXcHDbQguhGDxv2B5dq4k1C2ivI7V5PvnIAUDlnvT/S5YJ2/s+Z3NtdfdtE34SeRU9CDSW4sx4wAWIzK3AWZcseE42Pepd2bmB4vba3Q7+qlspa4g7/f9LR+zN9wTG0kbZ908jTG61loZeG0QOAdyRzrLWcTWnHJcMPEO6qp5Dpnzqx7tmiK8IDHmR2qorpmxCKM890F9GyWYyWwt1puoQ6hBxxkBxs6Z3Bot0WSMo4yrDcV80t9YGkXMMjTKnE2AG/F3FfRLC8ivrVZ4TkHmOx7VuUdT8QzRKM/ce91l1lKad927fZJ7u3a2nKHdeat3FLprU5LQFQTuVPI/xWsu7cXMBjOzDdT2NZ4gqxVhhlOCOxrmuI0Ro5Ls+U7fpHp5tY8QlZEiNjh4COnFXRdyMFj+dHSxLIN9iORrLe0GtDS2NvCqvc4yc/CgPInuT2pOJrpnaWbpprXyO0tTmpWCjvPaDU8vatdyrnHFHhE+XIUVbanrWkyK2qQXD2xPveIOLHow/enXUDhgOBPS6Kae2A4X6LZ13HI0bZU/LvVMMsc8KTQsGjcBlYdRXdZ5FsFK7Ib2hsBqunq8Kobq3bxI1cZBI6HuDTaw1C5vrCzurVI2Zjw3CkFTG42IA6YP7UGpKkEHBFewmW3mkuLEL4j7ywMcLJ5jsadpqgNb2bjjkeio5ubrQG24eJgg4nO45/ShxF4LOhaIZXAVlDHi6AeVLpPaWyKCC5Z7KZeHDTjCsSfhBHPB6+dM4r23l+5ingeYDLCNwSR5gZ2rUIZe4S+ea5nhmkjglmWNmQgqo2I8watU3XiKvjqVGd3XJHp3oNby30y3lh1G/i8QAzMZH4Sq554O+Kob2kt4rpLe3t5rkyRcZdFwI8gFQSeRI/KvNFjquQOas7puvNRvWtUe4ZAAGyicOCx/CPn/ADSuzSRI3nu2DXMzeJMw2Gew8gNh6V3cJLfS+PeN7wGI0X4Yx+57muorG54kYOvCNxxb/Q1nSyscC3V5orWkZXtpGUv4m4SpcOSPLbHpQPts+NPtk/qmJ/If70/hgEe7MWbuayftrPxXttAD/hxlj6k/wKrTETVbS3YIzAs1XUY4pEU8iwH1rmoCQQRzHKujRl9DxjYdNqtthmdfLehLK4F1ZxTr+Nd/I9frRtp/jH0rjngtJB3S6Mr2pUoKsvKa6XJ7xU9RSqrIpWicMp3BzWjw2qFNNd2x9/tBnjL24WjIyCMkZ7HFVfZowQRx5AAyXJyB3zzrm3u45kHvBWPQ/tRGK7oFrwHDKycjC9ULjc4HaupXWKIsThQM1W8scS5dgD5/xQ0shkYNICFByqHmT3Pb0qSoS/VHEVvGZNmZyW8iRn+KBBBGQedW65JtFGTlsljSuKVoztuO1cVxcaqt1vD7LUpsRhXX65iVv6TQFNMpcRMoPMcu1ASW8iZyuR3FG4dO0R9m42ITzHC1lSzKuOJgM8s11VE1uJAQAAerHc/KrYERIyk0yRoq+7IwOc55GtUmyITZFx3SS4S8RZ0Q5BYZwcV1c2Wnizm1CJZYWjX4IWHPyFDy2UtrLiVdicLjcGuL7S1ubXHGyzIMqynGDQzHe+n+EBzA4XY6y5hn4o4y/DiQZjdfhf8Ag+VXUQjQXNn4NvHa3ZiOOJUKoZAu4HahIpFlTiXbfBHY1iVUDWHU1CaSRndWrIYsuGwBzzypWdeudUvXsNAjjeVF4pJZHAVRkAkd+dK9VlvNb1QaPpYbwwQLiUA8K+pHID68q1Oh6K/s/p0kMU32kvJxBjCFK7bjzG1HhpWMZ2koueiG55vYLuz06yS8Fte3El7dnctMCFA8lGw+tF3ugaV4K8dipdWJCxgqMkY3I50SJzKimG3YsMcbNyA8qta6CMFLcQAwV5/QU41zQLIbs7LP/wDpuaA20mm39zbqGAljmYyBh1wTyP0Nd3WorpuoRWmoOoE+fAmyBx45gjoadt4k8IjWUcUkZMZJ3XPQjyND3Olw3WlC0vuGdzGUZygyuRjIPQ/xQ5IWS/MPXmpa4gbq/T7gQXKvn3G2b0p/1rAQPNpmoNYSxyvaKieDcMDhiV3Ge+QT862Wl3Int+Bjl0Gx7ij8KlNPIaZ5wchCqW6hrCE1rSI7xTMigS9emax0lq1jcSEqwLZ5554x8q+kEZGDSzUdPiukKSDfHuvTtZw8S3fFg8xyP9q9LWmLuPy37JNKkd9pfiR78IVgB5cxSK8kRULSjgY8n4tsfOiVnm0a+8GRWMbtwk/hB6ZqahDBqdqTblwD8UZzG6+o5is2pLai0uzhhw/P76J6nvA7Ru05BQ1vBJqHs7b+JAJJ7MvHOgXi90niVwOoNG6RZpdSOJkD8AAVe2aT2aHS7hBYeLbSDOGTJA8jnbB7VpbW51bgmnRdMbhDFpGidGOB14TimqcQ1EzXncDIIwbC1/6XqkyRRFg5nB59VdFpVpaXK3kvHDFbffNlvdwKSwn7jx5AUllYyNxDlxEnHlzqy9ury+hRtQm4ox74t7aPhXI3yc5LY89qULq0N0ZDDJJxYJMJBD4/0mlq2WKYCOnHdBuTZTTQvBvK7KF1XUmsUJFvI/RXPwA9Mmj04vDXjILY3I5ZqxYRKmZOERnnx9flXYh48mFuMdjs35UiXtsBZaQcA43KQe0FtPdm3it4ONskl+ijsT/zlT72KvLzSiIrzHATw4D5yOn5UDc2NxeWzQzcUJ4s/dZzjsa6sY0tkt7YmRhyHGuCQD17Uy2csYNJyEB8LZC7VsQvq6MGQMpyCMilWswcHDdqNjhZP2P7Vbocwl05RnPDsPSj5I1lieKTdXBBroKiFtZTaTzFx+FzLXGKTyWSvrlbOwnunGRChfHfAr5fFG2q63b29yxLXEw8VupJ3P02r6VqllJc6de6cWAl4SgJ+h+grHeyujXR18z3K8Asn98E78eNh9c1y9HaGOVxw4ex9V0dPUQxRuDj3nbLUTRPA1va2yIviN4ceR7qgDP6DlVU0klrc/ZZws0jqGi8NceICcYweuabzQpPFwPnYghlOCpHIg9DSqbSmWZrl7qeafIKzOQTHg5AAxjG+/elYpIS2z90FpZazlXCBZSpZvaG18QM8YBDI3VgCOR64oqqpIpJ7qK4upRI0IIjVUCKCeZx3q2qzaC67EJ9r49/ypVkGfHTHeq6JtE94yHlyFAOyqrLi1iuFIdAc88jOaXwaRFZztNZRCCRhws0PukjzxTapUMmkZhpUkApEdFtWn8WS18WX+uT3z+Zo6O1ZRhUCD8qPriaTwomcjOOQ71cyySkNJuosGi6qEUUC8crD1PKro5FlXiTOM43FJ3leRuOVskfCKZ2KlbRM8zk/nRp6fsow5xyhMk1usNlfXz32lkMntBdZ/CQg+QFfQqwXtVbPBrkrkHgnAdT36H60fhRAmN+n6TLd0mqVKldGiJ37N33g3BtJD7kpymejf71qkbgcN2r5yjA+8jZ32INbbSL4X1irsfvU91x59/nWJxGnse1HPdCeOYWhBBAI5GvaFtJP+mflRVYhFioXlSpUqF5dxyNGcry6gjIPyo6K6tyv3qCM+TMB+tLq4llSIZdseXWn6OuqKY6YzcdEKSFsm+6dJPAN4WhX/MG3/PnQd9qkFohPGGkPLNZe9u85Novujmeg+dK1M1058NWmPVuSD510P8AyMjmXc3T6oTaIA3ccJjeapJPIzR7sfxHpV9nOLm1STrybyI2NCRaZne7k4/8ibL/AL0wRFjQIihVHIAYrAqJI3fLk9U0dIFmroEqcg4NFw3AbZ9m79DQdSkyLqqPeGOT4lGe42oaWxB3RgewavYZymz7r+lGAgjIOQaJHUzQ4a7CuHEIRmR4DDqkbyogHhY5qe/F5VJ7S4FiPsF2Lli6jEiAEL1ycjJovGRg7iqvAQNxITG3dDitGPiYPzix8FHiMfZUXMMGhWdwbBZAk594GbPA3QgH8qWanJ/Zuhy3QGAE4hxHfiPf50yu1gtIBIYkkk4sKXGSSeuaQ6/fvHa2s+oW4msxcIzIBjjAJJH7/Kp7T4pzQBi/8+io46WnqtLoFjHomhwRuRIx+8lcf9RzuT/FFfaFuHIkkKxqcIg2288URBNHe2Ec8b8cUiqU2x7pG23SqILVoLgCSXwwRnHcUzJrJxsUsLc0ReR8cfHA+ONRnbnw8t6Cs9Qh1AN4eIjE4XiVveB5ZNHXM8cRV5w3h54WZRkDz9KxVzGlnrskOnEjjO3Nio67HmDz+W1XflxIPv8ACG52gDC1epXFvYmMzMxupH4VKJjiPbHKuzI8Ck3AlOdyxH0ry6to7qxFvcKs/FiRBuG5c6KnuilkvgjxJgnuIxxk4x7w/apLGkkk29/VWBOAAhNZ4LrTnt+L7zw+ONsdean89qT6ZrQh8OUK3IHb6imqQT3KRyvbmBsgFQ2QB+1Z3SkzYmOYAlZXQ48mI2pSod/9HDYix9+SMwAd1fQrW5iu7ZJ4GDI30ParGUMuDWV0S7FlMUGOCTIZB1ZdifXGK1asroHRuJW5GuipKps7dJ+Ye7pCWIsPgsp7UWau2HjDiRORGxIpXpenXEVsnE/GwbKyP8WOxPXbat1c20V1FwTLxAHIxtigFshBKAMeGOQpV3DtdQ57j3TnG90y2sLYQwDP4SDUNPDjjiG45eVe6DcIwnsLg8LyghCeueY/etFceCsWZ2WNAR7zEKATsNzWZ9oNPkh+9t28OTGVYDIJHcVSopxRu7eLbmPP36IsE3bt7GTfkfFDMXizEzqkvEclh2/es9ePaLqokuZBHcRoSrk7MD188fvTm3u21T7S0p+9BGQVClTgbHufPrmkV2XtGae+eJrfiKqhjLMM9Af2rGhaBI4D+1rtPdud+aK0i6jv0eGGWSYrJhWdQCCeXyrQP7P3QjEkUiMPM8NLtCaCRrJreMIs0hZU4eE4VSd/KttHCzqDIfTIBP8AArWo6OKdrnPB3ws6rqXxPAaVmI7TUY0KG3aQY2KOCRXsGnajMQssIX/O43FapoFOM4bH9Sg/XnQxvGi1qGxY8SzQs6kncFSPz50wOEU4N8pb46Qg2AROnQizhSMcgMUypTqF7BYQeJPKkZZgkYcn3nPIbAn8hTKEu0EZkCh+EcQU5APXB61qAAYCzzc5KS65H4OoRTjZZV4W9RSx7e2+3pNxcFwRj3X4fEA6EdRT32hj4tNV+qSD67VlpbWabVbS7QAoBhzn4cVx3EohHVusbXF/fqn43XiGL2KInvzHqMNokfGz7sc44RXepXRs9Onulj8QxLngHXehr26itLzEEIlvJQBjPTpSrX4ZVvJLm2s5osR/fXHiARsO3D17UjHE17m3Fh90zEdTiCUzF3aXF5Hb2zEzPH4pAGyjGdz0NWtFIpwUPyFZzQo5pNS8KO8ks3dBIAIw3ip5E1rprmG3TM0qoB/UcV6ePs3hrcojgAVRHbsxy/ur9aMAAUADAFJJvarR4WIN0rEf071zF7W6PIwH2kLn+oYqhppyL6Cq6m9U9r0AscKCT2Aoa2vba6Tit5kceRqNqFxBdzwpcrbJGeHZQSx71MFPrcQ+4A8P9IU0wiF0SyspwwKnzGKou42kg4VGTkGu7bWrlZDHdr9rhPJ1TNFXCI9qLu0jdoScMuN1/wBqbdRGMdrC7VbNtiP6QmVLZe6cLLSS5BVAcjbJGK7t7qW2GI5VK8+FuXypnJHa3Te+OF88wcE12lhbRsCIskb+8Sal1ZE5tntUiF4OCrLadbiIOoI7isr7e3whitbZY0d2YyMTzVeW3bP7Vr+mK+We1Q4Pai/DO+fEB4j0GBgY7VXhsbZKm/IZsmbkBUxyLIvEpyP0rs8sUvQmKYOMY5NjlTCukIsitddLrZzHOB0Y4IrS+zs7xaqkY+GUFWH1B+lZyZfDvAehYNWo9mIePUWlI2iQ/mdv5oFYW9i4noqNwCCtWCQQRzFMInDoG/Ol1F2WeBu2a5JygIipUr0DJAAJz0FDUrlgSpAOCRse1JBaXU8jBkLYOC0nur+XM1rbfTGYBrhig/pHP/ajksraPlEp823reouHVmkkANB6/r9pd1YyPAyslDpkS4M7eMw5A7KPlVs1uAOKIAAfhA/StYYISMGGP/wFBXNjGMsq4H+U8qLLwWqPe1gn+EP41jtwstUpleWDAF49++KXEEHBGKxpYZIXaJBYphrmvF2leVKlShqyldpdR22DPKkcZ6uwAH51l9Z9ozHI1tpuHkBw0uMgH/KOvrSn+zLu5WK71G4McUpP3snvH5DOSM7bbVoRUDnt1PNh9VYNJW7b2h0dGwdQhz5En9qItdTsLs4tryCQ9lcZ/Kvn2laXazXZ+0tO8KqSRCmST05bih00tS5Bu41ODwZB2PQE42oh4dDbDiidm5fQ9ZR2jiIUlVJ4vLI2pT7XILz2TMkYyYSrMB0xsaSWOt6nozRpdH7VaPyy2duvC37GtNHbW+q2fjWE4+zyjDI2du4P8VTsjTFpecA4P48CgPaRcFM9GkuE9ndMEIjuHMKAyI2FA/8Aj6inTqrSo8oLxruoxyPX1r5j7JzT6J7Wtpd3ctFbvxKEc+67H4SOxPevo83GqtNxO5LBeDPStF3dyMg5SxzhDayupCFGtLqOBA5UHGwUrtt/zlVxs4pUS3ZopZWiDyZjGWI5MfLNdR2jQxeEqmONSWLSNxFT0oO/02G6aS88aSK54AjzRSEBsVJO+oe+aGW2N25QmqXWqXerpY2EAtwkZPERuAdi2emNwKb3EARopYkDMFAwTzAGNvOuLOZVtDNKxM8YALcI94d64uHc2aJF8Mh5H4jncChueCy555/Ss1hDroyWVLa0klmwoQcbhuwGc1idNa5TT42KH70GTlyLHJ/Wm3tNeNcJDo0TEyXADTY/BCDv/wCRGB86kKZdUAwP2parlDWhtro0bdyrNOt3jXxZhhyOFV7DOd/Mn9qb2d49q2PijPNf486FqVlNqJGS9q02KM5gc3SVpo5EljEkTBkPWvWUMMHes9bXMtrJxxHIPxIeTf707tbqK7TiiOGHxIea12VDxGOrbY4d0/Sy5YHRnwWd9pNI1y5bi0fUoLaLILRPDnj82Jzn0xiiNSguDY8UsnjshUkJFjfGCf3rQ1U8IbJXY05NA2aMsPNQyZzSD0WMsNLiQvKRh2OCwGCa61PREu7N8x+ImMEEZPr51o1tfCl4mOR0BFX0mOGQ9np/9f8A65+/BHNbL2mu/ovnX38d7ALJkju7fJVX2Vw22M/LnT1faqW2QJqej3kMo2zGAyn0NXe0eix3CLdwZjlibPu9uvyNcaFrkckMlvegq1u3AxYZx2z5Y61Slm+FPw83oeWff84TM5FQ3tWtv1HNBT+2zyHw9N0i4llPLxOX5KP3q/2ctLvULy41bVpw87K0ASNsCEfiXbkf070w155rezivbC/trYI24mAMco7Z7+lYi2vWW9KP4zWb3JuZYLbcu2c49M09LUiNwbbdBjj7RhLBb7r6ZHbQxmEqgLQIUjdiWZQcZ3O++BR8X+EtAWdx9sto5xFLF4m4SZOFh6imKjCgdqOMjCQN75QOt/8A6RNnuv60gtDmH0Jpz7QyBNOWPrI4/Ib0ls/8Js965Djbgaiw5AflaNKO4rfCj8XxOBfExjixvih5TZ6hBNbM6Sow4XUHpVepcUypaxOQ8h94D+nzPSs37QyvphS2tmD3EoCwhRjBPMkeX70hDTF5AJs7l+0cuDconWtfWGdbHSoUlulGAcDEYx36DFK7TTTeg3GqzNdOx91SSEX0HWiYLG30weCfedohJNI3ORjvj08qKt9O1DULRrpCI4PeEYzjiZd+EfLP5YrVijDRpiHrzWXLUOkNhsubO3sY1bgtlHCxXIx0o6TTrSSMyGFFKr75cZBJ5LjvXmmxpboWLkJGvMc2J6CvZZpblgMZHRVoZJulrlZ4aXA16Tp8j2r4yGhOwPYqa1NveaXfRwpq12tnqRUIZCeGOYjbiBOwPLIODQpjis42uLpeHfIQfE5/ilOIdSW4iulGJW4go6HuPOmI5rfMLjxV9ZOHbLbQ6UkcOH1VBAP+3jP570bDqthp0AgtEklAJJYnGT3yawXs9fTW11Lpd2/FJEMxsf8AqJ0rTLAsi8SMR3B6UvNXPpnaY2hvjv8AdaEdNGRfdODrOnzf/cWR9Sqmu1u9Fk5r4fqpH6UmW0X8TE+gqwQRAfAPnSx4m93zta7zCN2AGxI9U7SDSpj93OvoJP5pPrXsHpWs3IuWnuIpeEKWiKkNjlnIqs28R/Dj0ND3unm4s3hiuZYGbGGRiCCN+lMQcSp2PBMQHiFUwv5PQr//AEttQPc1WcbYHFEprJa/o0mhaobGSTxQEVkk4eHjB8vXIprcTe1Wjguuo3UkS/jD+KvzDAkUm1XX7/U57Z9SaObwsgSJEFbfoccxW720MzLxosTZWO7xuEp1CJhGrlSMHGa2XsvDwaX45G87ZHoNv5pXHp0mo8MRSRYmILSFSMDyz1rVxRJDCkUShY0UKqjoBWNxCoBjEQ3R5AA7C6o+3XhhUd96CjQu4UdaYjasFyoFKdWFmIEEkg+9I/8AH/egdMhEtzxMMrGMn16UXqeq29gOB2VpyMrHnf1PlXQcIpY2tNVNsNv3+kjVykdwIqe4SEb7t0UUFc3rxQtNPIsES7k0hsdZV9RYTOSZNiz8lPQ+Q6UN7U3UpmtoDtwp4jLjYtuOvpW66uZ2JkbySlPF20gYrpfavhkxBHI693kAJ+WDTPSvaSG8lWCT3JW2VXx73of2NZWWe8SWe3SbCxhuIhVXYc9wKVXg4Y7WaFz7wYgj8LK2P4NZrK+fXcm48gtZ1FCW2AsfNfVXiDDxIfmtKL+zVgZEGD18qI0XUBd2UM2cyGNTIAOpFNJYUlXPLI59xWpV0sdZDY78j0981kse6F6x0kbRthh86zvtVqbWtstpA2JZh7xHNV/3raTRlJZIZACVbBHftXyzWXN97Q3bJsiycAPZRsP0NcjRRXmIePl+62WjURZX2FkbG0+1zoj3E4At4GXiOOrle3YHnnypzd20kNzbXeqkXbSrwrEBjhIGwwOg7CqYLKeHTU1ZJ0YgZ4WBO3LGe/lR00s1tcRXNu5ui0WACMhM4wVA5dq03yFxR3EMBcUNaWl/BNJf2pjtFyVDnAKg7EgdMVaI7XTtb4pi99xQlpG4Q5Vs8z6irr9uCxnW4S4nFw4CKVwoJGceuc59KveC6ma4MS28CrGBwj3vexy2x6VTUbZUagSs7Zwm8+2Myp9jXMkiM2OHtw+f/wAVToeoPourAkn7FM3DIO3Y+o/Si9Tt7GKwikjkBvXYeJGo4Qm244emKXeC0tjLJ7rKh4WGdxkbHHbzohAe0tOxVyA4WK2XtHoS6rEk9uwjvYcGOTv1A/SjtG9o7e6VLTUcWeqD3Wic4Eh7qeoP+1Dey12bvQbdnOXReAnvjai9R0yz1KLw7uBX7NyI9DWVFVGnJhkyB9Ek6PVkJ0YIi7cRbhdSSpOwPpVUniWyqzHMLbHiO4/2rJnSdVsHjOnaxP4UQISKf7xBkdRVqXftII1RrjT2IGDI0LZPmRnFO9tC4XDghaXBaWSESWpSLDgsWjJGCueYpLqeuLbzra2Spd36jAjQ5SM/1O3T050BLbalejh1LVpnjPOK3URKfXG5/OirKyhtYhFZwqi9lFCkqYm5GT9FYMKqsbRrfxJbiQzXc7cU0x5sf2A6Cm1tEVUsw3PL0qQ2/CeJ8E9B0FFIjvngUnHPy9aynvfM/qSjABoXFVSXUEc3hSTIsnAX4Sd+EczVc+p6XbMVuNUtEYc1EnGf/wAc1QNW0K4JX+07Niw4TxhlyO2SKM2iqNywqdQRDX1qphBnT784jOdmogcSuJI2KSLyZedC2tiq8U0ZgmtUI+z+EqssQ6+8M86KoMjXQvAFwR6KTpdsmdpq6kiO9AjfpIPhP8U1G4BBBB5Ecqy7AMMMMipBNc2Zzaye51jbcVuUnGnN7s4v480lJSg5YtORkYqtoVPwnFL7bW4JPduUMD98ZWmcbpKvFE6uvdTmuihqYZxeN10k5jmfMELPbs0LoRkMpG1fPLzTr6bW4JrKVYQq4kPDksexHWvp9Ay6bbvKZUXgkJySP4paspHVD2uabWwfIpinqOxDgRus9a6VHLKDd2kc6oeKNZF4gh6nsOlcaf7JNAtlcfaWF/DP40kij3Xyd09Mda18aCONUXkowK7piOmjjYGjNkN1RISTfdVxxhd+tWDevCQqlmIVRzJ2xSLVdYDo0FofdOzSd/IfzUVNVHTM1PPp1VI43SGwQetXYur3EZzFH7qnv3NcwLwQDvjNCwR+I+/wjmaOrhaiZ00he7crWY0NFgkWkzwwhpbiQKSuxY8yTnFJ9PifV/aK/vThhbkRR5OOHuadz6Y0Ubt4imNPeUY3wN8VldHuJI9N8KDKvcSM8jdScnFakOh2qRpybBKVTi1llpryzhvrqFOMGVV4WcHAOKcaVf2WmWTwGRpQmDGnMA75xnrnrWdFwLBrLmxLEuSeg2x9aP1EQsyNEQS494CjRyuhcHNWZslDSPdXskcZxCMluEdO2abWLCOK4IIUiPC0vtmXSdTV5FPgzRZHbB/+Kse6t5rlvs4PDzxjYVR2V5KiJ7u4KkljnGegoqbT+BR4fEsg/q2zROhJG08XjHhjkmHGfLNbPWZbf/07KIFYx+LwRs54s77kE7450zHFra517WUhfM9SZhFa6om0trIFk81Jwa2NnMMo2fdcVlpFDaFeh/hKP+lONHk4tGtXcgZiXc+lIVbdUYPQ2WjRuNiFoalcxOHjVgc7b154sf3n3i/d/Hv8PXesaxT6srzIyBnc0t1PUbaPS/EF34Pjp9zMqk78weVIV1mSS8s7uVTLJDGycEZwruds/lTMdM+QXUhpK2FcNDE3ONc9wADVdlJPLapJdQiCVtzGG4uH51fS5u02UIZ7Y59xsjsTXItXPxECi6le1FRZVwwiIHfJPWra8r2o3Upnp8ch02bwXEcrkhWIzjasXeLMkzLccQuQxEzE9c+f/N63OknNkR2c0r9p9NNziWBQZgnLGeICuvjpjLQxuZyCxaj/ALSsoGGR7w97p/Fe6rHcXdnFdorM9qvBIR1TOQfkcg/KjYLMcLSylVRBlmbZVHmaHf2otbFDLa2s00YfwzKx4FZsZ4eRx3ocEBIu/DSjU0cjX6mjKQy3c0vi8TbTPxN575x6fxXlvHNdNHax7+8WGeS52JJ6DYU5i1L2Zvr9Ir22W0llIw8U3FESehIxg/LFF63DbafcraW0axRhAzd2J7nrUyQ9kztL3HgtZkup4j0kHxTayvrKwItzdo0SoqgLEdiBjJbr+1aWzlSa2V4nV16MpyDXy8uFJ4feY7gVofZG9kgvxaOwZJwTgdGA6UxS8Rc+QRvFgdkrU0LQwvabkb7J1qo4NUQ/9yMH5g4r49HHJLqN3AoJJLs2OgUkk19g1ts6nbqOYj/Umvl+s272HtbKFyqXDZUjqr8/3pC7RWzNHPKJSnuNWi06z01rNPsjNLDAC0iuxwWIzuOXSuIIYRercWVzFJG2GljQD3R2wOXWgrVrKz06YtJJJds5QwKxHEAeWBzBHWnCXAkiN3p8EZjaPgLbKBjlnHPGeVVddMSMB9F7JAhc/bAXTi4kVFOI+wz386Be9LEiC2aNI2++lkUliM8vry50QkN/pwhgsXF2hJaTjIBXyBzyP0qm4W81AMOOGLik+HJPLz+VQhvuTZu/vF0Hq8VjDqywBOAXCjxppMkpk5yPPoaEmtbeLUhaWFx40cyhWY78O+eY9KsnsJLzU5LX7XF/dYsmSQkbc/z3pdA/gWFzOvxhQqkdOL/4+tGF7BHZkXK0vsUCmmlc5HiyY+n8VpqS+zlqbTTreFhhlj4m9Tuf1p1XPVLg6ZxHVACleFFb4lB+Ve1KAvLkRRjki/lXQ2G2wqVVd3UNhYz3tyMxQLnhzjjY7KvzNEjjdK8MbuVBNghtY1a10a2WW5zJNIMw26nBfzJ6L59elYrVNR1TVx/erkRw81t48rGvy6+pzQs0s+o3cmoXzGSSU5wOXkB5DoK748RHiYKT1Jro442UzdEW/M9VewZYkXP2Q8VpEIz4hyc8wcAVZ9liXJ4SwPduVEJbxSWxkikZl5ceMDPYfWvIXFmWkZgp2AbbAHXY89qnW481YTNLtF8qq2aexkNxp1zLbyr/AEHGfI961ns/7URam62uoBILxjhJV91JT2I/C30PlWUkvLUNII29xm4gCMttyGaEm4bmAzIhBU4I7irENlbolFx9l5zWv819XIKkhgQRsQeleUm9ldXbVtNaK4fivLQAMx5yR8g3qOR+VOq52qpzTyFh9PJCHQrl0VxhgDVIheNuK3lZG8jj61fUoDXFpuF4gFepqmowfE3iAf1rn61entDL+O2jPoxFD16sJmzhA2BkkjYep6VoRcQqwdLXE/VBdDHuQij7RbbWg/8A9P8AaqZPaC5YfdRRp57mgZZ9MhyC5nYdIBt/5Hb8s0O2p2y/4enp/wD2Ssf0xT3xFc8d59v4/ASpfTNO11dc3dxdN9/Kz9l6D5V5Hbu+7e6PrUh1KVziPTYCPLiH1zRn2mFYWkurcxY/7cnF9D/NIywyONy8E+v6R45mkYabLxVCKAowK9rqEw3P/wBpOsrf0H3X/I8/lXhBBIIII5ikpInxnvBHZI14u0qudeO3kXuprAaOvgW9yW+K2kZAD3zt+tfQqwPtBbnSvaAzfDaXgAc9Aeh/550/w919UfXKXqmFzMLSaLpUWq6RdTXbBTHFiOQ9HPI/T60rezuEkaGa4DIhwfDbIPzriz1W/s4zb2zsjHb3T+3717apP4bvxNxk5cSA4z3zWm9zOzAAyslMI/DkijtJ0V4OMYB2KZ22PSm9zpNjBoTXNrbSwOrDi42JB3wefP1rMxrdG5Bl2QZ+E7GtNc6k8ujGCJpJQCPEd0xj03JO/WphcwNcH9MeakJJfmDT4IYdvHKszqv4c/CD9fzqmTV76SwSGZXZVxwDhwvlVVtZGWbxJQXkds8PbfrTFLaYzNEUYMjYcY+HfrQdRaMKEp1NRbezFyW+IqI182aibS3mhtUDIBGiKoJO+w7dqo1Zor/WrXS7Y5t7RvFnYnZn6CnFwyBOFj7qkcWPoPU1R7i3S0bnPotKlZZlyrdLdoop41UyeGx4VBxnkcb+tZ/Vrhmu5na2lspbiPw5o3YHjA5Hb0xWn0uF44mklADyMWI7ZNC3+gQXEF0YWZbqchjM54iN+XkPSkY5Y2TOJ9+90+w23QmiSXV5p06R3VsQkfhxW4T/AAz0Zs71Wns4Y722WbFzA6MLhvhw3MEfpWghs7aCQyRQoshHCXCgE+tX0J1SQ4mPAKm/RCpFHp2ncERcpEvu8bFyPLvigodSlUZkUSL/AFLv/vTehp7G3mbiKcD/ANabGqxSxi4kF781II5r2C9gmHuuAaIBBGQcik8+mzIeJOGcDr8D/n1qiOea3fh42Rv6JRg/n1o/w0UuYnK2kHZP69pbHqRUDx4yo/qHL86OgmSdOONsrnHzpWSCSL5gqEEJppEuJXiP4xkeo/2o+5QvGGXdkORSFHaN1dDhlOQaf2063EIdNj+IdjXT8Dqw6PsHHI28lmVcRB1hYX29n8G1sbRZPCS7mJkkPJQMfuc/Ks7oVj9ot/7w/i20UreEn4WOd2x+XrW69uPZ6TWdHBssfard/EjQnAbb3l+f6ivl8Oq32lLJZODbnPKWPDIeuM07WskLrtTlC5vZaeaa6pHc3E99c2dos9tbQm3mPCCFyMk457UfaNdXWiafezhnDwCMyc90JXf5YpFZWt7qE7WWhT3JtZgvjyOCi53ySR035da+saTp62OmQWUCkxxIE36jz/51ocVH20RacDCmeq7F4IyfwsDw8TeJwgtyAPajtHill1W1NonvrICWA5DrmtM3snaNNxCaURncxg7emeeKK1KaHT7RbW2VVkK42/CtJ/BmmBlmdYN6c1L61jxoiFyd0vuZvtWrSyrui7L6DYUl9qdIbUrJZbYf3u3yY8fiHVf4ptCPCjHFnjboOdWxpLLnhC7ep/isJr5Xzds3e6jU2MAXXzfSdQ1BXeC2ZjO/3bLwjiZe3cdRWltZ3v70QW1slokG06nmTyxgdsVdquhpdXhu7GcWmopuJE+GTbmfUdfzrLXVtqWnzs17BMjPnM0ZLK2ee4rWErJsbHp739Eyx7X5TeA/3DUbhr+RZUZyI4D8O/PuQfypdHLZLYELJIbsAkqchRnA28+uR2qm01NLaG4iEgKTrwsA4X9qpDG6ZRFGHOMYgjOTRdNhlXIF7lE2/wBhtbfivLWS5lnVjjxSpj5cLZ653+VE6NZm8dOIf3WFw8hxtI45KPIdasstDuJihvmMUQGBGGy5HbPID/m1aqzs0ijRQgSJBhUGwpOpq2tbpZuhuduAr7VCqFjzb9Ktd1jRnkYKqjJY7ACvJX8OJn4GfhGeFBkn0FYu91AzJe2ytP8AZbhuMRzLwtHvkgZ6HtWXDAZyqtbfC2wOQCORqUo0K9ur8PI/2dbZQFRYzxPn/Mc7U3oUjDG7SVC9rMe29yB/ZunkZSQmeQd9+Ffy941p+tYz2zyfaOM/0WUfCfma0eGAa3O6BeGXBCjwjcL46usGPcWMAe7nbGf1og2NhLbySxJIzniwXwMY6HHOl0cnFEqsq8QyeLqQf2prYb2TDzP6U864ys6rlcJ8HZX24tzptvHAFZAgZsD8RG9DXGno4PhYGfwtuKVvmwiEn3vFgCThGApPIZ65G9EQ61FLcG3kUypnAlQYB88HerFjtwhTQPD3EZCBm0xFmHEGjGfeXoaNuITBIHtwCqqFaMoQACNs9N6PmlzEfuGuEIyCmNvlzFAuBJZSTIzBVPvxOckEbCvaid0SCWRhDzkbbqzSvD0n2nsHik4re4PhSMrcS4f3SM+RwflW5UnGG+JSVPqK+bzswtrDmWNwWB9CoFfSJD/f7te0pP1pbiLdULXncEhab8PHkvalSozxQwSXFyxWCFeJyOZ7AeZO1YzGOkcGt3Ko5waLleTSw2tv490SEJwiL8Uh7D+elK5LifUJFW5HhwHeOBGwnzP4j5mh+KbUtQ8a42Ztgg5RJ/SP+bmmWqWH2jTWEb8EqEGMA4Na7WNhGhnqff2SALpyXHYcuq4WxQjaFfm5P6ValsEGVEa+iZ/Wl2ja0/AbebaT4Se/+9PY3CqrDgcHOBQyDezim4xGRqYAqIeMXQjLBgVyOIYFK/ae6KWcEMSmN3bfB3OKZSDFzEe4IrP6rIJ9eSPHEkIGR9T+1TDvZVqnaYyeuF3EpVkR34CMZY9POnFtqi5WG9k8VeQnA95PXuPrS2FJ7riitoC4DZJHJfIsdqJOkXpGS1sCBy8Q/wAYp5lNNK3DbgrLbdmWpvIhQjcEEZVlOQw7ilus6bFqlg9vKNyPdPY1ZZST2OLTUY2jgkbEUvxKrHsRtg9qM6kdRWTUQSUkgcMLUhk7VtjuvnUCy21z/Zmo+5Mu0E52DgdDTuyuGtGH2qVQwPLOSVp5qWmWupW5iuYww6HG4rM3Ojaxpr8dncLdQjkk+5HkG507HURzjJsfeyVmpTe7FNRu55bwTlXSMHEYxgYFNluWNp4CKMNvxDmaQ3GpXrRcF5pNy7f5X4h8jVVlqmppKqppc3AvwniIYfM7Ux2ZI/sJXsZOi3sE8Npa+JaW3gTuPfkmOeDuFHMjrWP1jX5nuJNP0filupm+9nPMfx+1etFrWpf4zrZxHnhuOTHryHypjpul2unRcNug4jzc7k/OqS1TWizje2wG3qmIqZxN3oXTtH+w2yhiZHPvyEYy79yTTewsyZPEm34SSq5yFz+p86uiiaQ9l70aqhFCqMAVlyVEsvd5laIaAvalTmM1KTItgq6lSpUry8pUqVcltM8TSqh4FGc96uyN8hswXUEgboW4iM0DxCR4iwxxocMvpQE1w8K3S3sCSwQqDHgh3ccskdPWmlViCJbgziNRMy8JfqR2rzHhu6sCl62EcsKT2ckkHGoYKRkb+R3FHWkC21rHCpLcAwWPU9T+dXVKs+Z7xpJwvEkryrIJpIJA8Zweo6Gq6lUa5zHBzTYhVIBFinlvfwSgB2Eb9m5fI1ZNaW84BliRx0yARWfqKXQ5ikkjP+RiK6Cn489o0zNv4jCSfRgm7TZaGO2hiA4I1GOW3KrXZY1LOwRR1Y4FZtp70jH22XHrVDwtI3FLM7nzOaafx+O3cYfVDFEb5KZ32txoDHZ++/LjI2HoOtKkjZnaadiWPvHi/U1akaJ8I379akilo2A5kYrBqa2Wrd3zj6BORxNjHdXsEDTkkY4jzBOMDpRkkkdtEEUHBH/lQwu0hQquF4jxN4nun09KEmuQxJU8ZySBvwj59flRiNIx/PJKWc4qqdvvRjYhBnHqT+hFEwP4sR4tyNj50FuSSSSScknrR1vGUiGeZ3pKUhxuE7G3S2yrextnbJiTPfhFeraRrsCQOwwKrv8AUrawTM75bog3JNZ269oNQuWK2iCBO5GWrUpuEzzN1SHSPHf+EQNLtgtWkCp8KY8zVnCTWAkXUZzmW8mJP+bFcfZrlG2vZFb1amzwuhb80pv5j9FFEEi+gkEcxSDUtAe7F5P9pLXUpzDxDCxgch/vSq3utftk8SCY3UYGSAePHqOYpppvtRbXLCK9T7PLnHF+En9qp/xTmDXSyX8D7/SoWuZumtnYW1q3ixQRxzuoEjIMcR/+aKr3mAQQQeRHI15WBK2Rry2TcdVW91KzHtrbEzWV0OUkTQk/5lOR9G+laeqL+zXUdPltDgOxDxMeSyDl8jkj501QSBktj/6Fv19VF7EFfOomAu5eI8lVRvTvTj/dpMdD+1Z65sXinIUtHIHIdJNiD1FNdOuRFbyw4Yyn4FAzxbdK2JBjCTqqZzna280Dd6dNJHbyv7kTg8JPXB3Iq7TNPUTkAlgeZ7DtTC6lMcUdtJ4UwiTgideYGeo70TZw+DCBj3m3NVc8gWQ6yV4cWEYXF5hUHAWjOxJjxxAZxsM774pWxeOC6hn2maQcRxnPfflTG5jgZjPcMyj4VI7Cl2pBIUjW2YuzANk8gOhqGdFWlc64aG4vv5KaSsmpa5ptnIoEcU2Wx0Rfebf5Gt5A5lnmlPN24vzOaz/sxY/ZNPN9ID4tyhSHPPw85Z//AHEYHkK0VsnDFn+relOJSCzYhy39ff1WkTqddW0q16fiu4rBT7luBLNjrIRsPkP1p1bqHuEDfDnJ9BuaztgrXss19KOLx5mcD+o52HoKBRgNY6Q+X7/CTqdTyI280ZZQmOPbaSQZJP4VosSmP3J1HF+GTpVkcfB8fNty2Of+1dz+Gc+5wpjkasbm7k0xoY0NCzOt2gtrwXABEMx98j8Dd6M0u8YyfZ5297Gx6MO4o25thLaPCQXiYbDqvpSKKPjf7Gw8OeLHC5fn5jNEaRI2x3CVkDoJNbditJOBGiP0Ug7Gs3pEDalqkzFiqsSzuOarnp5nYCjra8Z4Z7W492bgOB325ir/AGOjxYzuB77Og+hI+tOcOhEk2lypUyBzWkbIf2g9poNET7FYQRvNEMEE4ji8v8zf8NZFvbH2gkkHBdhT/SkSj9qS3kkst4/2gkuGYnJ/ESc/WqxwCEDfxC2/bFa75nuODYLqabh1PEwAtDjzJzlfSfZP2tj1eb+zNYijSaUcKyBcLKf6WXlnzp3ewSWdy1oZGCyJmGXmQOW/cjl+VfGUdkmV0Yh1YYbO/lX2VrptV9mtHv5BiaXIbzPC2fqoNCqW/E0zmu3GQsmupG00gkjw04I8UFotpc2cc0dzJxLx/d75GO4plzGK4hfjiVupG9d1xj3F7i4oTGhjdIVDW8Tk8JAIODjfBqs2jA7Mv5V7HZLFfvcxMV8UfeJ0J7+tFVJNtivC53CEFq3Vlq1LZF55Y+dXV0qs5wilj2AzUXc7AU4XPpVwIjgI5tIPyFWLYXDKSyhABzY0sku2uoJXsIxcNlkiAfAcrsd+m4IrWoqaSNxe9pHS6E9wdgFF2sLSWvGvME4HcVzIwiheaTZE59yegHnQvs4uom0canKRcSOXaIYxCvJVXHTbNGFRc6mkKj7i199h3fp/NNS0ccjw8/7VdZbhE21ky2PHOfvXPE3+U9h5DlXcGnNKTxSKAO25rq7kKmKEKWJPEQOtW2rPFuxHESSQOVNijpXyASNx/CCXyBp0lXxadBGMkFz3b+KJXb3CBt0r1WDKCORqMM79RW7FTxQDTG0BJOe5xu4pFfQfZ7ggfA26/wAUNT6+g+0WxwPfXdaQ1xHFKT4Wc6flOR+lqQSdozO4Ur2vK9rMR15QepTXkEKNY24ncthh2FGVMZ51LTY3IupBslzy38mowm28FrQDEx4wcHqO+eVMaptLWGziMdunCpYsd85JrT2lnCLZCVDFgDmtKko/jnlrTYN8P7QZ5hGBhZ6pWkewt25pVTaVbN3HpTj+AzD5Xg/yP2gCrbzCQUt1HXLDT38OaXjm/wC3H7zD17fOtVcaDb3ELRtLMitzMb8J/OlK/wD0/wBCXOI5ySckmViTV4eBPveVw9P9K3xcfis4Pa6xzjwLgD0X+a9HtHpMh95Z4z38P+K0bexHs9H8asP9U5H70i9orD2V0a0BhgW6uX2jjE7EDzYg7D9aadwaEC97ev8ASu2ojebNBXVvq+jswIvFB6eICv7V1qmsRQW4Nsyys+ylTkfmKSWFjp/jQveiAQM4MjnIQLzON+1aZZ/YaGFAkkJQ7qFV2HryqlFQwCTthkDr/pHl/wARAIJv0WMBe4uS8vEzHmx2+Q8q9KSyv4VtHlicDYkn0ArewS+yksZeKBWU9TCwz+dMdPudCifhtRFCT3Thz86ckb277PkFugVjVOY3uxlYzTvZbVbvh8WNIF6lyc/lWks/YqCMZuLqV26hAFH71qJ5ore2eaRgsSLxE9hWL1b24kDmPSbZcdZbjI/JR+9FMFLAO/nzSbairqD3MD3zR0vsZaIeO0vJ4JvwkkEZ/Wsrrlmn2p7TVlWO7UDguox8Q6Fh+IfUedAXmoanfzia7vmZhyAUAL6DpQ7NM5y8xY92UGkn1DA68I0n3yWhDFIB/ldf31Rul6lc6JdLZ6j71q4yjA8QA6Mp6itgCGAZCGVhkEdawtyjz2a25xgnjTP4G647A9abeyOoNJG+nzk8cW8eeeO1eqoWcRgL2jvt+vh+vFVljLDdaSpUqVySGl2s6NHqqmWMrHeYwS2yygcgezef51kWhudOunguo3iYqUbKe8Aeo339e2a39SVUnh8G4ijnjHJZF4senUfKtSCuFtMv8/v9/deBLcDZYC0u40vDNdoGL5JwoGD3A5Uzu723ktJPBlBmIwo4Cp38sU3n0HTZDkW88flFLxD8mH71wmk2MOQv2zfbbgQ/mFJpztoHZ1j6/pBkjikeHkG/osusT26eHPeiBX28MksT5Y7+VOLXQI/FWfUFdbcYKWz7PN2Lj8K+XM02s7O3snLafYpDKR/jHLyf+bcvliiUtizcUrZzuRnc/OhS1scf/Xk9eXvzRb3+UW+65VXuZi8nLyGB5AUXUAAGAMCpWM95ebleAsvSxS3unHNbeQj/AMTSK11COCyhKwOcIAABkKMU/jTxRJF/3InT81NZbTPvLNI+FcsoHE3NcVpU4DqfPU/YJKaR7JRp5hHS6+zhQIJsKMDKZrk61I5GYZtv/wCPP71ebeNyvw4U/COI7dq5WxGc8cp/0p/NXJYd1N6kbALhtcHBwiCUH/Rmg7y9huwpNtMJV+F1j3H8jypmLWCMAvDKRnGWNMYoIUVuAohAzjHOoBbfuq5bM4Wfa38rKYNwn3kckUi7gkYIPcU19mZDbytayEAygcB7sucfmCfype14bu8uGx7qthTnmKKs7cSN4km0aEH1PQCnYZzA8SLOa0uk0NyiD7N6e2q31x4IlN1vwFc+Hke9j575r5fqNs1jqM9rL8UTkZI/I/MV9ignLSFCxhfc5O+arjt9ES6e81WC348ALNKueXSr08/az9421fRdFFVvp2kuu7A+i+W6Lot7rF5HBawMwc4MnCeBB1Ynyr6hqEkNnqOjaHaHKWy4b/wIA9eZ+dean7YWtvAYNIj42xgSMvCi+g60m9m4pZdbF7dMzOA8hLcyeE7mtCWSOIaGm5O6za2vfVkAiwHLf+UdZzXhvjF4K/ZQSTJ15fzTShLVSySAEjK4yOnnVdnaXdo0afavGgAIKuuGHnnrXHOs7wt9UYXaet0fUqUDq6XklnwWRw5OGwcHHkelUa3U4C9ldx0i9k+0yO3m8QOoeRCNieh8qZqQoxGgUdgKzvs3A1jIsckhkklJMjnqf+CtIeFFLMcAbk9hXacHMZp7tAuDYm26zKjVqzzQOqTeFB4fF778/IVmGnh0nTuKOMKvD4cMY7dv3NX61qsK2st6WEkXQRkHIzgAHzJpSVOre0sduf8AAg2I9Of12oVRKZXkjbkmI2aG2T3TS1no5ubk5nmPiN+w9MUdpNuVtQ8nxSHxHPryH5YoPUj417bWg+FiMjy5n6CjLi4dnW2hPCTzPaqtsDnkvG6STJrcvt3FPbO39kBCs3Ey8PLkBzznG9aIMOPg/FjOKpDwWqpE8qKzZwCd274FAS6sLORC4CG4l4RI3JR51YuHNQSn9u5VuBtqLrGLrMie3UmnTS/cyWy+GDy4+Z+ZH6Vr4n8SMHO/Wtanl1tsdwlpYywg9V0Oo7Uk1GDwbkkD3X94fvTs7HNC6lD4toSB7ye8P3pPi1N8RTG27cj8qad+h/mkde1KlcItZeVKlSvLylXw3dxCvDHKQvbmKoqVZkj4zqYbHwUEB2CgvaX2i1HTrBGt5cPK/CGKj3ds1jD7Va/M3EdVuAo2AXC589hWj9sI+PRA/wD25VP55H71hq6fh0z3wXc4k36lS2JnQJi+u6zMcNqd4xO2BKaZR6Lf3RDalqdwE/7UcrE/Mk/pSnSJbaDUElu88CDK4Gfe6E1rE1KxdOJbuLHm2KpW1E7CGx3815zQMAIK40vSLG0eea0WUIOcpLlj0G5rJM4aZisaIGOQsa4A9AKaa1qZv5uCPIt0Pug/iPc0T7Jael1qjXEi5S3HFjoXPL+amHVTwmWYkn3hWaNIuhdR0+TT9HHjycMs5C8H9Od8eveuLLiEjOOQXhWivbG48XU7dAfcWU/M7DNdW+0PGEywTIWmqpxFPH4i5+iPTjUbprp0vHGYZWEbFuKNjyz1B7Z2q+XEQbjAQrs2TgD50m0wvqEzox8MtgKOmfnR82mvCrQSM8ZzlsnH0rNLeqvLJp+XJO3vou09oJYoJrVbgywN7pjb9u1Wxq0ltC9xCCZU4lyAc0AdNwhAkBPQEYoOW3aBweHhbOQymrE6hYlLh72uL3ADGw3JRV0sY4lWFomU9RsR5GhwFVeOU8Kfr5UVY3n2m2ZZmY4OAc4Hzo1ZVmnIZY8hcIqqAAo2wKocI0TjfSb9drJPC7rd/aCFY9EcZXHTIruafwdetNRjUItzhnVdgDnDfWiptOkEcs0ZUxxjLDOCB6UvvgP7Ft3/ABpPIB6ZB/WtCgeRLbkVaQAhb4MGGR61KEtJMiLP4ox9KLrm62MR1D2ja5SQ2UrmWWOJOKRwi9ycUs13W4NItyznilbZEHMmsRqj6reXCnU0liEoDRQYIBB5etEp6N0o1ONh9/JRfNgtfd+1ek2zFfH8Rh0QZoT/ANbWJP8AgT8PfgNV6N7MRooa5h8aUbmIEBU9T1NaIWcsEeI7aFUHRSNvlRHNpWYDSfVeseZQNj7S6deozI7KqkBiynC55ZPSmySJInFGwYdwa5gtrNLL7MsaGF+Lx0YD388yR1rC3/2z2X1P+4SvJZP70cUjZ27Z8qo2ninJEeDyvzUAuG4W6uZGitpJETjZFJC96H065mnsBLNCyy5I4ccOd9sZpTZ38mrhLzS7kRygBJIJOXXc1ohnAzzpeRnZDS4ZVQS51+S4tbnE0bErxhiQqnOwO9IbmFrHVbu2jJXhkMkRH9LbinscKRFio3YnJ688/vQmuWxmtEvYhmW1HDIBzaI9f/afpTVG9pLo+uR797JaqY4tD+YXmlamkjeHdj71PiXv5jypioQkncA9Rviss6CQK6NwuN0cdKZ6ZqLMvgS+6wxxAfqPKjPbp22Vqeo7Tuu3TG+VRC4jJKgg5ND6vdGDTZJduLg4U26miZFZonVsbg4xSHXZfGe0tA2zYZj/AM+dUZ3npiZ2iMlU6Vas1uPwr8Tsen+9aC3hACgLjhHup28/WqIHt40RQyhV+FRvjzPnRUt5b5Hh7bb8O9S9+vJQ4IREOpK7uLdSFBYE4yGHSg7qI3NpJbT7Mw91uhPT51e91CxAQldueM1Td3+n2qpHd3UcZk2QMefnVbXd3UyGlwta6SW/s/f4Ege3UkZHEeL9qcabZ3VrDdG48NpHjCJ4ZPIn3v0ruSWe1QeEyPGPwkZIo20nFxAH5NyYdjWzFHFMy43+yTFKxpBCBhlEXFxKSTV63MZ55X1ru7tww402bqO9AsrIcMCD5isGppHwOsduqZumNSg4J+D3X+H9KLVlYZUgjypIiysrYG4J427MDTnUj/cpF6MCD6UipzdnxdPVu6Zro+BydyWPwv8AdJVQ7zSslY6ZbWGnG0C+LBbjiAkGcnPF+uPyqr2NXiurmZt2KZz6tTCfaC8/0E//AI0q9nrqO00q8mkdlOERSgy2SSBgetHGXBXyU6jcSe0uTyEbhflgUHc6uLX2hjheJvBZ+F58+6jHcL+X6ir5C0GpRXLcllKscdOTfzRs1jChz4DXDtcGULsBxFcb52wBVm81UmwXupztbASQac93MPhKqPd+fOiwBPAvjxAcQBaNgGwe3yrtc8I4hg45c6EkuLkaxDbpBm3aNmeTselW2Q9slDy6HZy62NVcOblUCoCfdUgYDAd6bafO5I8QABuRHI1w2TsG4fShra4gYSC3lEqxSFJcHJRhzBosbyxwcFZw1ixT6vCMjB5VXBJxxjPMVZufKtsEOFwkdlnJo/CneM/hOK4o/V4uGZZRyYYPqKA6185rIPh6h0fQ/TktiN2tgK8qVKlLIilSpUry8l3tDH4ug3i43CcQ+RzXzqvqF6niWNwhHxRMPoa+XDkPSt/hLv8AG5virtXtSpUrYV1K2Ps3GYNHzjDTsXJ645D9KylpbvdXUcEfxOcZ7Dqa3iIscaxoMKoCgeQrJ4nLZgj65Q3nksh7WoVuI5AOUn6gH9q6tCqw5jdixPwkcjTfXbA3kOVGSBxfNdx+dItMkCykHrTzz21DHIOX+kamNimcBkR88KgE5IomeVL4AvKeNWB48ZzXiXMQCQ3UeIgcrLEo4h69xS68hK26+BKXbOcID16H0pADxV5omvkF28jff0T87gEgeoOKWahIs+UEp4owWK45/wC9TTpWhtFWeX3s7KTkgdqtFxFBdjx7ckMwMgBxketQBYpWoOru6Ta4B5fx5IPRxHKZIGyoGSCNjv8AvTBLHw7lJTPKypnAONs9+9BXqxicvECFZi4XiJC9hXq6hOq4GD671529wmqcvfGNQt90ZfSkQmJSS7DceXrSzUYiLGzhGCzsc47lq4e6lkm8OEDxG5nGwq+yjNzqcWfeWEcZPfGw+v6U/wAPjPa6jsFeQgNWkaX7NCsnCW8NeQG5oGXU7q2U3FxJhSC5Uj3Qo54olpvFnFooIBZQ7Z5jtSn23keY2emW496dhsO3/MVlu0S1BJF9Vz5BZhJsh/ZexfX9ck1fUBxQQnKI3LPQfua1+tPA1m1wsaTz2mZY89Djff0oHQ2tLPS7WxRwZBkyJyJbrTSezt3tZntYYI5JEK+JwDYHn9M0vNLrl6AbeS8BpsUp0XVGn05ZWYRtI7EhRsN8c6Pe7diUDNJkYIHKhbfTLGLTpLWIiI4JBZt2JGM7/KgrHWWtZxbNahpM499gvD237edUMesks2UvkY02O6Yw2l5FAfs6+MOIcKSyY4R1Abr5Z/OhrmGecB7mxPBFkHYPjuadI8d9CYpOeAXEbkD0zsa8kkFh4apbgWmMZiG6HzHUeYqgP8r2t11881N/7D1yG+sgFilUGVF5EZxkVu7W5jurVLiMgo68W1Zn2k0eO41B5LVjh0LcB+HzA7f7157DXbfZJLSQ/wCC/CM9uYpqdrZqcPBuW/ZW2NxzTvTrq+ubqQz2xityPuyRjr57mjw00VwJIjxA4BVscIHU9zttirK8rNMne1NFlUM7tibpLqWnixY3FspNg5yRzMBPQ/5exoJ1J4WRuGRd1YdP9q1KuyElTzGCCMgjsR1FLLjSo2bisWWFj/8At5Gwh/0N09DWpDO2YWOHff30WdNTOjOpmy80/UjOPCmwsi/EPPv5ilEy8WtXBPKIcIru6t5YJAJke2nX4S64+vIiqoXeS4neVOF2Kk9jtjIogjLHFRLUdpFpO6vqV3IuCD4ivsMEHpXPCQnFkYzjGd/yqbpUghQEjqaX6ppY1PwwH4JlIVWIzsTywKe2lpezRDgzFAP+pJ7qj+flRcXgWI/umZJuRnYYx/pHT151OoRd92E1TGVkgfEbEK63sFt9Nis8mQwx8AeQb/7UHYOYL7wjyfbB79KYWUheHDZODzPWqr20d5knhwWUjI778604iJbTM5jPvwWqCSTfmjSMjFclFZOFxxDHWu6lMkAixVUomTw5WTsdq4VipypwaL1BPeRx12NB1ydVF2Uzm8lKYxtxoG706tT4mmKDvwnhNZ+zbKMvY5p5pDApLEfUU3waQR1ek/8AoEfn8IFSLx36LORWbWdtNbNPJPlHw0mMjnt8qX+yE4jvvCblKCu/cbitDrMEqlmhYI5GzHkD1rIxq+m6wy4x4cgdfMZ/itOVpjeQeRVWnWL9VqNShlAkkYDwnbPD1Bxj60bpVwLrToZTu2OFvUbGrriJbmHh4iF+IY67bfrSvR/7vcS252EhyB2Yc/pU7OUbhKtStfaPR5JtQ0+/+3w5Z5LadScDywenl+Rq32N1/U9bF5NqFvbw28JCoYyQeL5ncY61poZVkJBPCynDDtQstjpttp89oqLHFPktHCvCSTzNGBuF5z7jIylOow6tPrUkOn66IWCca2phA6ZAB5HNB+x+le0NjrGoy6vbokFwoYssgbikzzGPInt0p9FO0snhW/BAkKrt/SMYGT16ij1uGS3aR5leMKSXA2wPSvBzbEFRrfa2F3FJ4HABnh5Z7UxRw65HPrSaCeG9tfEt3DxttkdP4q+0nYLvzGzU1TVGnuO2QJGau81FahF4to4A95feFIhWlVg65HKs/dReDcvH0B29Kx+P09nNnHPB/CNSP3aqalSpXNJ5SvGJVSQCSBnA617XMkiRRtJIwVFGWY8gK8N15ZybUNSbTbiVjCokjIRPhK57Hv5VjiMHBGMU31HWBe3THw+CEMTHjnjzo+GHTp9L43EZJX3nPxBv1ruooIS28QDSdwibBZmoASQAMk7ADrRsOnSTyCOJ14sZPFsKc6FZQ29w6zLm8XuNlHl5+dCqNcEZeW3spJsr9C002cRmmGJ5By/pHb1ptUoqCA7O/wAhXJzSukcXuQd17HBm3IbZm3z27ViNcsHsL0zRriNm/wDFu3zrf0NfWcd3CyOoORgg8jWhwyubCTFL8jvorNOk3WJguRJGACM4wVNRniHMsh7EZA+YrzUNKuNPmaSAM8Q643X1H715DPDIgxLwPjcNsK06ikMfeZlpT0cmsJpZSRyRrGIITvkzKSW26eVE3EaGCY7ElefXagrIi3k8RoYpewbOD+VFC9BJMlhAeoHiOFHyzSWDzV3NPRCwXDw3JKkDCnmM5BGD9KXsyiNnQ8SjkR17UVIytMZJJFyTnCChIY1E3Bbq7uTkLzx8v3NMw0ssuwx9F57gMruOMwpwAcU0nx4/StBplp9mg97HGxyx8+3yqrTtP8D7yXeQ9uQ/53pjU11SyliNPEbuO59+wkJZNWBsgZy0N94inBYBlPmNqVlpbj2pt3uG4nW2kbOMczjl6VsIYQsQDqCTucjNZL2tklsNdtL2LHvo0ZyNj5fSsqml7Q9mBmxF0AjZM4RK96skYj4VyOIqxJ704tPFlu5MN9z4eAAdix5k/QULYxh9PthjBZFbboTv+9HTWUENi3iyNxAkmQnfJPL08qASCbHyUyFzRjKzXtBNLHqDWp4G9wEYXJA756etHaHEbm9a3uVNzbQRKFaZNlbsAem/Wvf7AvgMxXFueIc2Vg3pkZrhYNU0+MxfaLOCJeRdzj6imS5hZpaQkbOc/UWm6ayWUemwvLYxHxsjGOZUsPdPcDJxmq55342Vg3ifhzyPpQSvrTKPDS3uI3wco2M/mBR1rcy3OoNBfWEsTFOY95fzB2yKXc125N/VNMkA3BBS534rrC7rEoTPc8zWa0WY2msanwkABl58huRT3Xp4NFnSKEmTxELrGT8O/U9qTeycf2i4vruUBuKQYyOo/wBzTcQ0xPe4YsiOyAtLZ38z3SCRw8Uh4c4GxPLFN6RheK8jC9bhMY8sk08pCpa0FpaLXClqleMoYYYZB6GioLKefBRcL/U2wo6PSowPvZWY9lGBRIOHVM4uxuOpwhvnjZuUl+/jQpFJxR/9uQBl/I7UM62+czabDnqY+JP0OK1K6faD/pk+rGvWsLQ/9Ij0c1rM4XXsFg4eV/6SrpoHHIWU/uI5WC585mNdLdLF/wDbWtvCe6pxH8zmtDLpMLf4blT2YZFBT6fNAMlAyf1JStRDXwC7m46i34yrxince6lTm4uXDSF3PdjyqyO2AOZDnyFEVKyHPc7JTgAC6QhSMbCraoqxG6H5VrcLqgw9i7Y7ea8QrKleV7XRKqpuk47dgOY3pVTo0pnj8KZl6Z29Kw+KxZbIPJeXtu3DMOx2pvYyiG7RicKfdPzpH6UxjfjjDdxvWOyR0UjZG7heIDgQU+v7cTRn/mDWL9oLYrGk5GJIDwt5of4rbWU3j2qkjJA4WobUdNS7hdGHxAgkV28sQqo2yx8ws1j+zcWuWb0qX+1NLuNMuHYYjwrg78P+xx8qJvrSW3jimjkLyIFy56sOp9f3pCkd9od4rSxleE4WTGUcds1p7a5XU7ctbzlDjDxMobh/2rNFx3Hbpq/MbL1gLuFbm3G5HvL1B6j1FCaZHPJeypfSwZA9yFT75GfiI546V7ifSp/EI8SB/wDEC8/Igd/1o62tbGS7bU4I42nmQKZhuSo6VYZ3VSOaX6ne6VNpl080QmiiJgZJMxB+uATjI26dqE0zRbP2fkuNU/tKddPliybWQ5jTiwfUnoOu9aKVsNxPbCYJurEjbbfHahLwadqtt9mv7ZjDxBiOIkZHLON6IPNevbHJAT6npF3plvqsV80dpbXAy8Ixl8cPCwxnG4zRwnZbRLi3lW6Dx8QZcASHG3Llmh5/Zn2fu7eKERwxxxfAIXMeM89qYpZWlpp8dpZYEcQ9xQ2cf/Nec3Fwp1NsAEH7Ke0H9tWDTmA28sUnhyxk5w2M/wDM0z1WMMsc6/6T+1K9HtLuG7upZrxZoJTmOPwgrJ6kc+1OJpIltZIpW5jYczmrTgT0j2vNhyJ69EM2ZKC1KKlSpXFrQXtY/wBq9X8Vzp9u33aH71h1P9Pypp7SauNPtvBgb+9SjbH4F7+vasIdzk1tcNpLntn+n7V2jmpU5HPWpRFhave3kcCbcW7H+kdTW45waNR2Cun3s3DK8MlxKRwt7qHG5xzPpTaK0SO5efJaR9t+gq2KNIoljiHCijCjyq2KPxHA6czXPT8Qnlu3V3TyQS4kq62iBw7cugoqpjAAG3agtOuLmdpxdReGY34VwhAI7+dZti4E9FUuAIHVG0DBqkE+oPaIrlkzhwMqcc6OY4UnBOByHWkujXcEt7LELNLafB5DBIzyPnV42BzXEi9lR7yHNF90zubcSe8o94fWkV3otpcMSY+B+rJsfmOVaWqZEjkbhJHHjO3OmaXiFRTYacdCibLHt7PzIf7vdlR2ZSP0qDRL0n3rtMf6Sa1L20gPu4YflVZjkHNG/KtUccfzYLq2tyRQ6CuczzyyeQ90U0t7WC2j4IY1QdgOf80SEc8kb8q7W2kPPCjzpWfi1RKLA6R4ftVJJVNEwRqjgyEBjuqmro4Ej35t3NCamPfjYjbBBrNib2smi+6o86W3R9JfavTTqOkOIx99H7yetX2128TCOX3k753H+1MzgjuDVix9JKHLzXCQJJ7N6gl7pEDqQJYQI5UPNWG29NLm6tdQ4rPxgGV1Ei5wVOQRWR9oNJu9Nvm1PR2dC3+IiH4v59K89nbq3voJTI/FeNIWk4j7x7U2+Fpb2zDj7eas3vGx3W0muJhDxLIsEan7yRoi+Bnnz2rm9aNwIwfGlHJiAeDzzSe4M5gYfaZio5qzkjFMo7Ga1iWJWi4VGAC1KmwCkNDXZS2/u76wMMNndJx3MioiOueE53OO1M4klX43aSYjDvjHF8hypNrkAs57LVJ5ELQTrlAd2XPTvj96N1b2r0+ysjcWs63U8gxDEucg/wCbtRuzc9rQwXuvOcBkBK/bie1gsobMRrLqUrApj4kH+/aq9IibTtM8JQOBB7z93647+Q8qF0TS7i4vn1bViXuZDxKrfh/526Vqba2SSQSNGDwn3dutGkljhZ2O9t/NDGp2SvdKtXJ8VkPiOOFE5lV/k9a01pp6RYecB5P6ei/zXdhaC2jDOPvmG/8AlHai62aDho/76gXcdh0SM9QflZsoTmpQlxeBCViwzd+g/mk+ramljDx3chZ2+CIcz8q3XOaxt3YCST8zRA4Mi59agniblIv51lbOyv8AUSs2pO9tb5ytrEeFm/1kb/KrD7Q6St7NbSOUaJ+AsU90nrv67VQSttd2B4qQCQSOS1IORtXuSOVLkAXeNiud9jRMU5+GTHqKKoVd3YRzgtGBHL9GpNIjRuUkUqw5g1paGvbUXUWwxKo909/KsDiXCmytMsIs7p1/tOwVJadLtkhr2oQQxBGCOYryuP2WmrFffBruqK9M8cSZmdUXOOJmAFb3D64uIilPkfwoIV1LtauLazs/tNzIEVWC575PL96X6v7W6bYoywOLufosZ90erfxXz/V9XvNXufFu32X4I12VB5CtaZrJGFjuacp6KSU3dgL6OCGAKkEHcEdaut5fDJDfCfpWK9mNZMIWzu2xCTiJyfhPb0/StfXL1EDoXaSgzwugfpK0mjyYkePOzDIpvWT0q58K7iDHC8WM+tauup4HKX05Yf8Ayfoc/tY9U2z79VXNCkqFWUHPMEZB9azOpaRLa3H2zShwSr8UI5MPIftWpLAeZ8q5ZS4wV2861pYWSts5AY8sNws9ZS2upoZzEonCeHID8SjOcemaoNhd2czS6e4YH4o25N6jv5im95o8U0v2hGaG4H/VjOD8+h+dLJpNRtjhZra6A6FSjfTasaoj7AXkIt1um2P17KyLVIdkvEa1k6iQe6fRuVF2723CFjmiC9+MGlyasT7l5ZSIDzK4cflXslppVyvEoiQnsAPoaXbMw5DgVctKaNBbSn44mPrXgsraMcRGW6bmsveaZHGT4MieRRtvmKHtxfxNhLl41HZ8j8qh1TGz5gP5UiMnYp/fXc8F14YYCLAOFAGa8B4gCDnNLmeRyDNI0j4xxNzNF2gcRniGB0rBqpTM8uJJHK6OxukWV1BatqMWm2TTybtyRP6j2om5nitbd552CxoMsTXzvV9Sl1O9Mz5VBtGn9I/nvV6KkNQ+5+Ub/pFAuhrm4lurl5524pHOSaqqVK6gAAWCKpWt9nrH7PZ+O4xLPvv0Xp/NINHsvtt+iMPuk95/Tt862tZPEp7Dsh6obzyUo+3j8OPf4juaGto+OTJ5LRtYTjyVAgNQkmF9YxQzGMSOePAByAM0fXmBxcWBnGM+Ve1BNwB0UBtiT1UqpreCSQStFGzjk/CM/nUuo3mtnijcozjHGOYqWtvHa20cEXwoMb9fOvDAuDleOTa2FY4LIwVuEkYBxyrMWcOoHV2iYsCuA8jAgFVP74HrWor350SOUxgi26pJFrIN9l5UqVKCir2vKlSvLyourpLddwWc8kHP/alF1dzzNlgAi/gGB+tOZ7eKcYlQHz6j50E2kx59yZl7ZANP00lPGLuGUvK2R22yDjZH91SOLt19MU9jGI1B/pFD21nFbkMo4nAxxH9u1E1SqqGzEBowFaKMs3XMiLIhVhkGsxqvs3DNP40LNbz5yJI9s+tamoQCMHcdjQYpnwm7SikXWJI9orReArb3qcst7rfOgpbj2leQmOOeLOwVJsKPrW8e1Q/CStVG1cHYqacbWNGdAVbO6rCQ6HrV3KXu5VUnm0h42/586e6ZoFrZMJXzNP8A1v09O1PxauebKKtS2Rd294+fKqyV0jxYYHgvaeqHhhMhHRR1p5pFsrS+IR7kXIdzQO3yp/Yx+FZRjG7DiPqaPwmD4ipBds3P6Qal+iPHNEUFe3BB8GP4j8RH6Vfc3MdtHxOwB/CvUnyFIriK7vInWL7lXBDOxw2/YV2j5A0GwuegWQg9Q1yKy+7tk8aYnhDAZAPYD8R9KVwSyafrMcuqW/j30y+ImZRiIb+Xxbc+nSryltoizyQ5vdQiQgyMv3cA7eR8udJ57yW/cRGQGSZuKaTHxHoB5ADlWTPO5veee905D9lO01I6V/ewN07uddvLqOaK18K3KnHiKeI/LoPWstARHfw+IhIWRcq3X3hmj7S0ube5yxjMZUg4J37V5qLxGe3jkUt74yF+LHakHTvleC83WvJStEZbEB681sLyDWIriaayu45kZiRBMmMeQNC6d7RJLcG11GL7LcA8OT8JPY55fpUuteis4oIYYpRI7hR9qJAVepLb5rnXrSxuxb6g2JYEfgmeJuaHYHI7H6VtuecuhdtuDssqMBx7OZluhAsb/YrUQSb8DfLNEUl062ls4TC9wZ41P3TMPeC9ievlTeNuNAfzp0EkXIskXAA2BulurwcLrOo2fZvWltaK6j8a1ljxuVyPUVna4njNMIajU3Z2fXmtWlfrZY8lKH1Czjv7Ca1l+GVcZ7HofkaIqVkAlpuE2CQbhfG57eWC5kt5FIkjYqw7EVzwKvxn/wBoO9an2807wb2O/jX3Jxwv/qH8j9KyVdZDKJYw8c108MgljDwumYsfIcgOQrYezOt+Mq2N2/3o2icn4vI+fasbXqkqwIJBG4I6VE0LZmaXKJ4Gzs0lfV+RyK1tlKJ4lLHfhBz3r5r7Oa0NQiFvcMPtSDn/ANwd/XvWgM0pVVMjcK8hnlSFHVnhznte291ydVTO1aHYIWtlvbeHbjDHsu9BS6q52iQKO7bmlUEokTsw5irKFPxmqlw06R4ftDZTRt3yrZZ5Zv8AEkZvLpVXpUrmSNJUKSKGU9DWS57nu1PN0wAALBVRJM0PBO7FyDxMAAAenCf5oF7aeC4XieaaFuZQAsvy601qUVs5a6+keVlGnCES2JmBy3hY341Csfy5Vd9ni/p+tSKBImJUsSc5y2c1bVZH6nXCkBcrGi/CoFd15XtCUrH+208ov47MMfBRA/D3Y53NZkCpUrraMAQNsrs2XuK8xUqU0rrW+zcSJpYkA96RzxH02FNsVKlctVZnd5oDt01tbdPs6HJ3GTV3gL3P0qVKDYKingL3P0qeAvc/SpUqdI6L11PAXufpU8Be5+lSpXtI6KVPAXufpU8Be5+lSpXtI6KLqeAvc/Sp4C9z9KlSvaR0XrqeAvc/Sp4C9z9KlSvaR0XrqeAvc/Sp4C9zUqVGkdF66ngL3P0qeAvc/SpUqdI6L11PAXufpU8Be5+lSpXtI6L11PAXufpU8Be5+lSpXtI6L11PAXufpU8Be5+lSpXtI6L1154CdzT8jGw5AAVKldFwIAGT0/KRqzshNQ/wF9f2oO6doNMmkjOGSJmU9jipUroj8pSbfmC+dXV1LcKsbnEackXYevmaGGxBB3qVK5Nxu7K7BoARIv7hEKlg+OrDJr20maFprkAPPwjhdxkrk9KlSpZgqHBUTSSSuXldnbuTTj2Ukb+1hbk5hnRlkQ7hsDPKpUo1MT27fNCqgOwf5FbpVCqqqMKAAB2om1PusPOpUrqFyavHMUieBfEYZOxP61Klc5x0Ahnr+E9Sc154C9z9KngL3P0qVK5vSOieuk/tVZxS+zV7x5Phx+IvLYjlXyYjepUrZ4f/ANR81vcMJ7N3mpipipUrQWmu4ZHglWWJyjocqR0NfS7CVrjT7eeTHHJGGbGwzUqVl8SA0tKyeJgWaUSrFGDKcEU4WFSM5NSpWQACsUrrwF7n6VPAXufpUqVbSOii6ngL3P0qeAvc/SpUr2kdF66ngL3P0qeAvc/SpUr2kdF66ngL3P0qeAueZ+lSpXtI6L11/9k=",
  Medicine: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHCAkIBgoJCAkMCwoMDxoRDw4ODx8WGBMaJSEnJiQhJCMpLjsyKSw4LCMkM0Y0OD0/QkNCKDFITUhATTtBQj//2wBDAQsMDA8NDx4RER4/KiQqPz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz8/Pz//wAARCAF7AeADASIAAhEBAxEB/8QAGwABAAIDAQEAAAAAAAAAAAAAAAMEAQIFBgf/xAA+EAACAgEBBgMECQMDBAIDAAAAAQIDEQQFEiExQVETYXEGIjKBFCNCUpGhscHRM2LhJDRyFUNT8IKSRGPx/8QAGwEBAAIDAQEAAAAAAAAAAAAAAAMEAgUGAQf/xAAyEQACAgIBAgQDCAIDAQEAAAAAAQIDBBExEiEFE0FRImFxBjKBkaGx0fAUwTNCUuHx/9oADAMBAAIRAxEAPwDuY4jA6g2pygwMAADAwAAMAAAxgYMgAxgzgAAxgzgAAYGAABgAAAYAAMYM4AAGAAAMDAAAwMAADAwAAMDAAAwMAADAAAAwAAYM4AAGDGDIAGBgAAYGAABgYAAGBgAAYGAABgAADAwAAMGMGQAMGGjIAAHUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMBgADqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAwB1AAABhvBq5pAG4NFNGyaYBkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMBgA1nLdRsyDcnqdQqa+GeLfZdwepNvSIpWTss3KYSnLtFEq2brZrMnXDylL+D0+zNkRhSuHh1v8A+0/NnS0tNMZWV+DBTrlzazlPk+JDK7XBsK8Na+I8JPZ+urWUoWeUZcfzIoXyjY4WRcZLnGSw0fR5U1SWJVQf/wAUcramwtPraWoe5Yvhfb0/gRu/9CzC7bgzzMJKSNipCNum1Vmm1C3bK3hr9GWyY17TT0wAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMBgCXU6ns1o42ynbNZTeX6LkvxyctnqPZatPZzS577T/9+ZFa9RLeHFStOqV7/qr67/s/BP0fJ/J/qWrIbksEdkI2VyhNZjJYZVTNu1o2BDpZylTuzf1lb3JebXX5rDJgDy/tjpFF6XXwWJb3hWeafGP5p/icmPwo9N7UpS2FNdfFrx67yPMrgi1U9wNRmRSt7eqMgAlKgAAAAAAAAAAGQADVySI5WpAE2TGUVLNTGCzKSS82V/8AqNOcbz/BmLnFcsPSOoCtp9TC34ZJlkyTT4AAAAAAAAAAAAAAAAAAAAAAAAAMN4DeEVb71HqegsOaRjxEcmetWeBota88mZquTMHNI7akmbHJq1sXzeH5l2q9S6mLi1yZJplkGE8mTE9AAAAAfBADJo5pdSC67D3Yptvkl1JK9nau7jY40p9JcX+A7LkyjCU/uoz4q7mymmbPYdzWY6hv1reCrfo9XpE5Sj4kFzlDjj1QTi+GZSpsittFtMFWi9TS4lpPKBGAwGAHzPQey+pULLdO3ze/Hz6P9jz75m9Ns6bo21S3ZxeUzCceqOiamzyrFI+h2w34ZXNcitxTw+ZU2XtinUxUZNQs6wb/AEOo51yXHHzKPeHZm+Uo2rqizmz+q1cZ/Zt9yX/Lp+6/Askd9SuqnBcM8n2fRnN1e2a6KEoJT1LjxinlQfm/2M0nLginOMFuTKvtLqIy8LSxeWn4k/Lt/JwjayydtkrLJOU5PLb6mpchHpjo0t1nmzcgADIiAAAAAAAyHwIbLMAEkppEM7Uupc0mx9frsONfhVP7dvD8FzZ39D7OaLTNTvzqbF1n8K+X8kcrIxLNeNOffWjxN2rhD4pcexRt1s5fAt3zZ6n292aktPtGmCSS8G1JY/4v9V+B4wqWXzfZdivkRlVNwMyblLMm2+7MGTBWb2VTauyVc1ODxJHodHetRp42Lg+TXZnArpttU3VXOe4t6W7HOF3OlsNt13LplNFjGm1Lp9ySG0dUAGwJQYbSRlvCK78S+5U0rMn+CXdgJN9kZsvUepD9Jzy4nc0WxoKDslFT3fiss+FeiO3XsiMViVv/ANY8CN2xRdhhykttnioalN4yTwmpdT1Op2DRfFpuMn/dH90eb2lsq/ZkvEw5UdXz3fn2PY2Rl2I7MWda3yjANKp70TczKwAAAAAAAABpa8QbKK03jS3rW93pFdfU6E1mDRd8CtbE8TcW+1vb3XmS1tJ7ZhJOW0vqciOnpisKqP4GJ6Sia41R+XAmBbKZzb9m4WaJf/GX8lSu2yie7LKxzTOtqbJLdqrf1tnBP7q6s1u0dVlEa0t1wWIy6o8aT7M9UmjbS6hTiuJcTyjgUynptQ4T4NPiduie9BFScOlluEupEoAIzMEV892DJRRV42upg1lZzjvgcHsY9TSOjsXZMpPxJJeK/ik/sLsvM77oq0kYWQinGMsWOSy8Phn5Ms0UqimNa6c33ZtOKnCUZLMZLDRSlNyZva641x0jbkRW01XLFkE/Pqvma6ST8J1zeZ1Pcb79n81gnMeCTk8V7RbG+gP6bplmlv6yKXw+ZTpnvQTPe3Uw1FFlFqzXZFxkvJnz7TVyplZTP4qpyg/k8FqqbktP0NVmVKElKPqWAwCUpB8wGAAWK9dq644r1NkV23iuDxpPk9UnHhk1ur1NyxbfZNdnLgQgHqWuA23yAADwAyk3yN5ae5Vue41FdXF4IpXVwemy5TgZN0eqEO399yMFa6dtLzOPu/eXFCrUKa5kkZRktxeyC2mymXTZFp/MsgwnkyekRrJSlKMIJylJ4SXVnq9l7Ho0UIztjGzUvi5NZUfJfycfYNSs2vXKSzuRlJev/rPWFe2T30o2WHUtdbAAIDYFbaGjhtDZ9+kt+G2Djns+j+TwfI7a50XWU3R3bK5OMl2a4M+yni/ar2ev1O2YarSRjGvUR+tlJ4UZLhn5rH4EU16lDOodkVKK7o8WWtHoNVrp401UpLrLlFfM9LTsPZ2zqvH2hbGeOtj3Y/JdTazbTlHw9mabMVwVlq3YL0jzf5GCi29I16x1HvY9fIk01dHs5sqdts1K2Ty8fbljhFeRydmaeVGkzYsWWPeku3kSeBO7ULUay532r4crEY+iLBdppcX1SFklLSS0kAAWjA0teIM6/s7s7xK/FsXx+9N+XRfucbU/0Jeh7jZlSr0FaiviWeH4L8iK2Wol3DgpTbfoWN2Ph7m6tzGMdMEOlbjGVE3mVTwn3j0f/vYsFbU/VThqFyh7s/OL/jn+JVRtSyaW1wurlXZFShJYafU3AB4HVaR7P2ndpG24xxKDfWL5fx8jJ1/autLW6O1LjKE4P5NNfqzkF2EuqKZo74KFjigADIhAAAAAAD5HS2e46jZ9mnbw1mPyfI5ptTbLT3q2HHpJd0ZLutBPpe3wQzhKucoTWJReGiOyca65Tm8RistnY2hCjUaT6VXJKUV+Pk/M4Ev9RqNznVU8y/ul0Xy5lyE+pbKltfRLXobaaEnvX2rFlnR/Zj0ROAZEZR2pTvVK5L3ocH6E+zpOVKb7G2qx9Euzy3H+hjZtbjpYt82iC7hE9JcABWLALeyMf9Y02eTbX5FQ3psdN9dsfihJSXyPJLa0Z1y6Zpnv/CXhby54yREujvhfRGcHmMllehrZW4vKWUa9PvpnRNJpNFS36rVQt+zZ9XP1+y/2+ZYNLq1bVKuXKSx6GunsdtKcvji92a81zMiMlPDatJ7U1s48pXzf5nsddqo6PSTulzSxFd5dDxXHOW8t8W/MnpXLKGdJaUQACwa0o6jbNVm0r5RoVemlP6tR5pef6lyuyFsFOuSlF9UeZl8T9Tem+yie9VLD6rozSU584PVndH0LP+zlN0erH+GX6P8Ag9KClpNoV6hqEvcsfTo/Qum4rsjZHqi9o4XJxbsWzy7o6YABmVwbQhKc1GKy28JI1OrsimP1l8se7wT7d2V8ixwjpcs2vhmKsi1ymvhj+vsiaqinQ1eJc059+fyRW1G0ZW1yrhBRjJYbby8EGrveovc/srhFdkQmpbO3hUuzlyYlFSTUuTOTfW6Ld6PBZxJfudcp6uClNp/aiS02OueyPNxI5dEq2u/p9TFE95Fg5+jk3FZL65G6Z83L2yNRHTbSqnN4i8xk+2T2CWeB4I7WzNuPTwjXqU5xjwjNcWl59yvbBvui/i3xh8EuD0m7LPJmVXJ8+BTW29C45+kRXk08lLWe0dUU46WDsl958F/LIFGb9DYSupituR3MQrWZPl3OHtza1E9Fbp9Lb9e/gnGKkoPv2OFq9fqtW/r7W4/cXBfgViWNC/7FK3O2nGCK600ZW+LfOd9v37Xl/LsT4MgsRiorSNaAAegAAAxKKlFxfJrB7b2evV2ydPJ/EobsvVcGeKOvsDaC0lzpteK7HlP7siG6PVHsXMO1V2d+GepujieejI2k001lPg0WoyjbHDwaSo4cJfiVFL3N0477oo6VuKlRJ5lU8Lzj0/j5Fgr6n6uUNQvscJ+cXz/Dma6/XVaGjfm1KbXuQT4y/wAGet8ELkorbOH7S2qzX1Vr/tQefWX+Ecg3tsndbO2x5nN5bNC5GPTFI0ds/Mm5AAGRGACbT6a7UPFUJSxzxy/EwnZGC3IsUY1uRLprRCC7ds3UUVOyyC3VzalnBTlHHIihk1yeuC5b4Tk1Q69Jpez2YABYNWRWwk4S3GlLHDJHVUqa1BdOb7ssjBNG1rsyKVSfBCCXdRhRXYk85EfksinV40NyXwP4vNdiZLCwjIIJScnsnjFRWkAAYGQAAB09k7VloX4c8ypbzhc4vyPVaXaGn1ME67Iz9Hx/A8EE8PK4MhnSpdy5TmTqXTyj6DdJSawuXU5Wp12n0WosnKyMt+OXXB5e8v5X6HlXZY1hzm15yZr6GMadcslnnOXCLe0Ndbrrt+z3YR+CC5L/ACVACdJJaRQlJye2AwD0xPLy5v1MG90J1WyhZFxnF8YtYaNDkj7Un2B3tnah36b3nmcHuy8+zOCdTYieb3091fPiXsCbjcorhnP/AGjohZgub5jrX4vR1QAb8+amVyeHh44ECt2hTFxcKr4PnuScG/k+H5k8eaJDWZj+NfQ7L7PxSx5P3f8ApFP/AKhVB41ELdO//wBkOH4rKLVdldsd6qyNi7xeTOCvZodNZLelTFT+9D3X+KKZ0JZKuof10fRGPo2or/oayePu2pTX48yK2b4zm02lxa5ZPV3ekepqCcnwiHR91yyzoR5FPSQ3Youo3x8sk9tsAAHgAAAAAABvVVZdaq6oOc3ySOrV7O3zjm6+Fb7Jbxi5KPJJCqdn3UcfIOpqPZ3V1wctPdC7H2Wt1v8AY4spTqslXbGUJx4OMlhoKSlwJ1Tr+8iYGkZpm+TIjAAAL+j2tqtIlGMlOtfZn09GdNe0vuYnp5Z8pnnQRuuL7tFiGTbBaTOzqPaC6cHGmmFaaxmXvP8Ag5Flk7ZudknKT6tmoMoxUeCOds7PvMAAyIwAdTRbKnNQvvbjGL3lXy3+HXyIbblWvmXsTCnky3xH1f8AfU02ds2WpastzGn85ehe1e0KtJHwNJGLlHh/bH+WVdVteGorlXoZ/VpuEprg8rg0uxzzVzsc3tnZ4uFCqCilpe38lm3Xam6uULLW4y5rCRWAIjYKKj2SK8pbtzg+T4o3INS83xx0x+5NF5SNxjzc602cH4vRGjLkocPT/MyACc1QAAABjKMgAAAAAAAAAAAAAA1lNIA2BA7VnmVr9p11e7WvEn5cl8yOy2Fa3J6LWNiX5U+imO2dnxNmbbXg3x8PUx4bsvdsj6Pqis/ZSG+8auaj5wXAh1Glp1CStgm1yfVfMgehzHcep1Dh912cDWWYU99lv9DrMbx2jo7ycH7a2vwOK4vxHCPvPOFu9TvaHT/RtMoP4296XqZ0+kp0/wDThh93xZYLGLieS+qXJrfGfG/86KpqWofPlgAF85synjiSERvF8CllVOSUl6HReCZkKZOqx6T4+psDGTSdkYeb7I1p2C78GL7Nyt4+J8Ec+z3pKtesje25zn7uJT8uSN6KccXxb5svYtD31yOe8Z8ShCt41T23y/ZexLVHEUSmFwQckjYnHGQaeIjKmmAbAZAAAMrGVnlkBHrNj6KOk0cZNfXWLMn27I6BtGClXlP0NSg31PZ0MYKEUkCntDZul2hXu6iHvJe7ZHhKPzLgC7cBpNaZ4XaWydXsxucvrdP0tiuXquhVhamuZ9CnKEK5ysajXFNycuSXXJ8t1m0qrtp326alVaaU/q4R4cO/z54JP8qMNKbIY+E3ZClKhb16fwdVSTNihRqIzWU8luE0y0mmto084ShJxktNEgCB6YAAAAJZBf2PXGzaEN5ZUU5Y80RXT8uGy5hY6yLlB8cv8C7oNnQoh9J1eE4rKT5R835lbaG0JaluurMafzl6mdsaidmrlTlqut4x3fVlA1EpOT7nd42PGEU9fRexTvrnRc9Vp4uWf61a+2u6/uX5lmqyFtUbK5KUJLKa6m5RsT0Nsr4pvTTebYr7D+8vLuvmYF3kvEdligu7fJGLrVDhHjL9Ck5Ocnh57skrrlY9RK2Tk1YlfmWv6L1Zuszsy/mWY8iOuGESm4rgq4qKPn2XkyyrpWy9QAazeI5MyqYnNRKs9Uk8Z49ixptJPWS35txpz05yOrTo6ao4rgoryX7mlzfGqMWThFdUl+X5m4xPCLciPXJ9K/X8jz71LXNNLzRLXqFLqd50xxzZQ1Oz6bXLdShNfah09UU6ftFXKWrYaXunstW+AzUd1T2/ZrRDGSaNimvE09/hXc+aa5Nd0W4vKOkhONkVOD2mc/OEq5OMlpoyADIxAAABhvBiUsIirhdqblVpq5WWPpFf+4B6k2+wnbgq6i2denV8oS8KUt1SxwbxnGT1ezfZmEGrdoyVs+aqi/dXq+p1tp7Op2hsuzRTioQkvcaXwSXJorW2tJ9HJtMTEi7Iu/7vrrk+V26iy3Kb3Y9kRJEmops02osovju21ScZLs0aLmc/Oc5y3N9z6dj0U0VqNKSXyPUPmADqT44AAAAAAAAAayipLr8mQy00Zc5Sa7NlgHnTHe9EqutUelSevbZHCmEFwRJyBrN4R6RGlliiildq1HqR6zUNPC5mtGgdi39Q2s/ZXMmhX1d2Rzn0kb1vHhk2hrlnjlFmqqqGpnV4cMbqlHh8n+xPPT0zWJVR/Am8qJD5rMUahTxxLSeUcuzSSpe/pm2lzg/2LmjuVtaaZXnDpJ4TUiyACMzPXbC2hHUaWNU5fW1rDT6rozpzh1ieArsnVNTrk4yXJp8j0Ozdv8q9Zw6KxcvmVJ1NPcTbY+XGSUJ8naBInXdBSi00+TRztt6+OyNl26ua3nH3a4/ek+S9CFySW2bCFcpyUY92zzftxtjdgtlaeXvSSlqGui6R+fN/I8UbWW2X3Tuum522ScpyfVs1NPZY7JbO7xMaONUq1+P1NoTlCWYvDOhpdapNRn7svyZzQS0ZM6X249irn+FY+fH41qXuuf8A6ekrmmSnL2fe5wxJ5lHgdOPI6GuasgpL1PmOVjzxbpUz5RkAGZWBJVOUJZhJxknlNPiRmVzIbq/Mg0XvD8lYuQrHxw/oSyk5ScpNuTeW31MEatjvbreGZdkEuMkadpp6Z9CrlGyKlB7TNyvdfupxg+PWXY1uvzHEXiPV9yqlKx8sR7E1VMrX8ipm59WDDcu8vRfz8hl2PEfh6vuWaq8IzXXhEqWDawhGtaicJlZVuVY7LHthLAAMyqDEaXfbGvOIvjJ+RkvbKgpajj1lFfmUfELpUY05w54X49i5g0xuyIwlx/Hc7mj01em0ylOKXDL4cl2OfNxc5OKxFvgux0NpyapjFcpS4nNOCzGotVr0O4pTa6maXWKquU3xxyXd9Ea0VOFfv8Zye9J+Zp/W1X9lL/GX+CyVH2Wiw+y0c3amm39O3Fe/D3ofuvwKWmlvVJ9zt3LMGcPSx3aUuiOw+zt0p1TqfC01+O/4OV8eqipwsXL2n+H/AOk4AOmOdAfBAxLkAT7M2fPaercMuNMONk1+i8z2Gk0lGjp8LTVKEeuOb9X1KPs3Sq9jVyS962Upt/PC/Q6pUsk29G5xqowgn6sAAiLJ43262VmEdqUR4xxC9Lt0l+34HjEfY7KIaiqdNsFOuyLjOL5NPmePnsfZ/s/OU9XYpyTzCVnVdMLqyhkU/F1I6fwzxDVPlTW2uP78ioADfnzYAHoNkbCdiV+shiL4xrfXzf8ABjKSitskqqnbLpicBJvkm/RGD6DHSxhDdhuxS6JYRzdfsyjWVv3VC77NiXXz7ohV6bLk8CUV2fc8gDe6qyi6VV0d2cXho0LBr2mnpgAAAi1DxWyUivWangA52jq8XUTtmsqDxH1OgWPZrTVXKSuipYTlh984Nto0x0+unXBYhwcV5MuQmt9BWnXLp8z02c3U+5ZTd92W7L0lw/XBYNL6/FonX95YXr0MaezxaIWdZLivPqSkJIQwh4eszH4bFnHn1JjMY5nF9iOxfCzOt6kSgApFwAAAuaHaOo0UvqpZh1hLl/gl1ntFG7VOvXUeHpGsQs+KPnvLpxOcYaymmsp9CvdQrF27M2OFnyxZ7kupf3gbR9na7Y+PsyUVlZ8PPuv/AIs81bXOmyVdsJQnHnGSw0ego+kaCTls+S8N8Zaeb9x+n3WX/H2ZtqPgaqHhamPDcse7OPo+qNLdjyg9Na/Y7zC8UhdHcX1L9V9V/fqeNB6p+ylW88auxR84LgeXlBq11w997zit3jvcehWcHHk29d9dm+l8FzZUXKyeOSwdpciroNN9HpxL43xkWzo8WDrpjF8ny/xfJhk5s7IcfwtAAFg1YAABpbWpxw+fcquq1P42XRgxcYvlE1eRbUtQk19GVIUPOZNt+ZYjBI3wDLgjlKUnuT2AADEAAAFrZ9nh6hfJr5FUym1JNcGuRVzKP8miVXv+/oWMW7yLo2ex6zXRjbo/Ei+EfeRxdRY66/c4zk92K8xTqfFr3d5rH2cmlX11zu+xH3Yfuz59l9XmtWR01yd7jOEq+qL2iWitVVRguOOb7slMGHLCKfdslbItVPconLy4HKhHdil2LOqv8WW7H4F+bIDvPBcKWLQ5TWpS/b0OM8Xy45FqjDiP7+oABuzUAAAHp/Z2+M9m+Dn3qZNY8nxX7nWPE6PVWaPUK2p8eTT5Ndj1Gi21o7Y+/NVSfOM+H5lSyDT2jb418ZRUZPTReSb5IkjX1kVrNq6OuOZaiv5Sz+hw9o+0Flua9HmEfvtcfkuhhGEpcIsTuqqW29nc1+09NoYYnLM+kI8WzyO1dY9p6mu22qEXUmq+GWk+fH5FaTcpOUm5SfFtvLZgsQpjHnuay3Msn2i9IPmZjGU5KME5SbwkubN6abNRdGqmDnOT4JHrtlbFq0le/diy6S4y6LyRlZYoIjox5XPtwV9i7DVO7qNWlK3nGPNR/wAnastUfdhzIbNUvGdCzF4yn95dcGCm25vcjdQjCqPTAy5Nvi2YAPRs5HtDpFbo1qIr62rr3XY8wnlZR7Da1sYaTcb4yeceS4s8bV8C9CzS306NXmxSkmvU3ABMUQYayjIAM7Lt+ha5OXCttp+j/hnX2vo5aiEbqVvTgsNLqjjSSa4l7Q7Slp4qq5Oda5Nc0Z921KPKPYuOnCfDOY8p4aw10ZBp/cuvq6KW/H0l/nJ3tpavR6jSNV+9a2se7ho4NicdXVYlwknCX6r9C3CTkttaKdkFCWk9k5vBdTEY55khDbNa0jOqDXdgAFcsAAAAAAAh1Gmp1MUroKWOT6r5kwMZRUlpokrsnVJSg9NexSehW7ufSNRufd8R4JdPpadP/Tgk+74ssAjhRVB7jHuW7vEsu+HRZY2gACYoAB8DRzSANxkglakQvV1p4dkU/U8bS5BdBDVdGa4NP0ZMegAAAAAAAxKSissjc3jO7LHfDAS2SghjanyZIpJgGybTynhk9eqnXFR3YtLl0IAVr8SjJWrYplinKuo/45NFp62WPgX4kFl1lvCT4dkaAhp8OxKJdVcFv8/3Jbc/Juj0zn2/vsAAXykADWUlFAG2TGStO9LqRfSo55o90C/kFSOoT6k0bEzwEoCeQAAAAe62Zs2nQU+7xm1703zZPZY5cFyM3yzhJ8CI13L2zpNKC6Y8Ed1SthjLjJcYyXNPuaUWuTddqUbYfEl1815E5DfS7N2db3bYfDL9n5GSMSYr6rVQ00ePGb5RINRr/CqSUMXNcYv7PqeX120ZWWShTNyk/is/gzjByZDZbGtbZPtTXO2Uob29ZLhJrlFdijFYRHXDCJS3GKitI1FtjsltgAHpEAAAAAAYwhgyD3bPNIAA8PQAWdHpJamfDhFc5diOy2Na2y3iYlmVPpjwuX7FfDfQ0nLcXvcDuuGi0mFNJy8/ef4HM1Mq7L5uuG7B8lgpf5kk+DoI+BUzjpSe/ftr8v8A6U1bF9TdNMq6qh1y3quvHHcae7fS4l2q2Nsdo0Obg2YVnTPh8P3LYMJ5MkhSAAbwADWUkjSdmEaUVajWXeDpapWT7LkvV9BwZKLb0hO3HUp6jWRhwby+yJfaHQ6zZVtNd0ouNsMqcOWeq+XD8ThlWzIS7RMLG630tdyW7UWXPi8R7IiBkpyk5PbIG2zeq2dM1KuWH+p39HqI6mhTXBrhJdmeehCdk1GuMpSfJRWWzobFbjqba3lZjlp9Gn/kmx5tS6fRmcG0dkAGwJQb1VzutjVXHenJ4SNDs+zVSnq7bGsuuGF8zGUulbJKoeZNROnoNkafSxUpwjbd1nJZx6I6PTHQNNcwUm2+7N5GEYLUUcvaWxNJrouUYqi/pZBfqup5PXaLV7Ns3dTD3G/dsjxjL5/sfQDWyuFtcq7YRnCXBxkspkkLHEhtxoWd+GfPYWprmTKWS/t3YVeh09ut0tqhTDjKqb5f8X+xxKb1JLiWYzUuDVWVSrl0yLoNIzybmREAAAGUr5ylNQgsyfJFx8UTbP0Mr9+UMb3Vvt0RFdb5Ud+pf8PxP8q7pfaK7v6HPr0LazPEn5/wSfRGlwUPwLjWG0+gNTKycnts76mimiPTXFJHOs0+78daXmiPcnDjBuS7PmdQpQ/1FlzqilXCW7GWfja5/Lp+JlC+cOGRZGBi5S1OGn7rsxTcpFhPKKU4PLklia5ruWKLN6KNpVarY7Rw/iGBZg29Mu6fD9yYAMlNee8Rk4ey9swcFTrJYmuEZvr6+Z1Xq9MlnxofiUXFp6ZvoWRmtonObr9oKqMoUyWV8U2+ESDaG04+E1CXh1dZPm/JHl9VqbNXLdw41J8I9/NkkK2yK69Vr5m+s1stS3XS2q38Uus/8EVdeEZhXglLKSXBqZzc3thAA9MA3gljo9bZHeq0l0o9909JsnZcNNVG26KlqJLPHjueS8zqEErtPsbCrC2tzZ8/uV2nlu31Tqb5KcWjEbEz311Vd9TquhGyD5xkso8vtT2ctpzds1uyHN0t+8vR9T2NqfZmNuHKPePc5ieTJUha1JxkmpJ4aaw0WIzTJilo3ATAPAAADeqt2WRhHjKTwjsaiyOg0ka6vjfCL/VnC+lz0mohNUWyiuO/CO8l5NczeW06dbdvePDfxjcfutfJmovs6rH8juvDMTy8aHz7v8eP0JG222223zbABXNwRahZpb7PJzV9XqWlyl7yOnd/Rl6HNt/3Ffo/1LeHJqzXuajxypTwnJ8xa/gvVvgbkdXIkNocICKcm5KMU3JvCSWWzebxE9P7P7Njp9NHVWxzqLVlZ+xHokYTmorZNTU7ZaRy9nezl1+LNfJ01/8Ajj8T9ex6bTaajSUqrTVRrgukVz9e5MCrKblybeumFa+E5u3tmR2tsqzTPCtXvVSf2ZLl+PI+VzjKuyULIuM4txlF801zR9mPC+3OyfC1Edp0R+rtajcl0l0fz/UhmvUp59HXHzFyv2PJAvbO2VqtoS+phu19bJcIr+T0tOi2bsKpXaialc+U5LMm/wC2JEayuiU+77Ir+zWzLNIrNbql4cpQxCMuDjHm2+xTonHVbU1uvgsV2zxDzXf8ifW6rU7UXhyi9No2+MM+/Z69l5G0IRhCMIJRjFYSRboqe+pk03HpUI8I2ABdIwdj2bvjVr5Vyf8AVjw9Vx/k45mMpQkpRbUovKa6GMo9S0SVT8ual7H0GxbyTREcvZe3K7VGrVNQs5Z6S/g7MoqazEotOL0zfRnG1dUGRAy04vicH2q2x/0vZrjTL/VXpxr/ALV1l8v1DekYzmq4uUvQ837abY+maz6Bp5Z0+nfvtfbn/C5fiecqunU/dfDsRgh6mntHN22ysm5s62m1cZ8M4fZnQrnlHmU8PKOhodW95QseW+TLlWR1dpHsZ77M7YNK5ZRuWjMHV2NJfWR9GcosaK/wL1J8uvoVcqLcNr0N14PbGFzg/wDsv1FsXC6cXzUmaHT2hpvFitRT73D3kuq7nJushTVKyx4hBZbNW+x2sJdSINXZN7unpeLbftL7Eesv2XmyequFVUa61uwisJEOjrn719yxddxa+5HpH5fq2WTwkIdRXvQ3l8S/NFOt7l+Oklk6Rz7I41cYro3+xaxJNWpe5qfGq42YUm+YtNfnr/ZbXIBcgzanBCSzlGm/qIcIXzS7ZybvmBo9UmuGQuM7Jb1k5TfeTybxhg3ADbfIAAPAWtmQVm09NCSynYs/qVSXTWujVVXLj4clLB4+DKDSkmz3Li0svkzBvVOF1EZQknGSymuxpJOLwygjomvVAAAxObtXZGj18JWXfU2xWfGjwaXn3R4GrUwc5RhPfSbSeMZXfB6L232x4VK2Zp5fWWLeua6R6R+f6ep4ZNp5TPVc4PXoafNtj5nTFccno67U0TJ5ODp9Y4vFnLudSm5SSaeUXIWRmuxVTT4LYMReUZMwSR+FGltNV0cW1wmv7o5N4cYmTRWLU2mfSsWSlRCS9l+xUWghD/b23UeUJ5X4PKH+ur5Sp1C804S/gtgxLOynK+c65RsonU+HxNNP0aK7W9dHyX6ljUTUrMZ92PX9SOiOW5Nc3kuYcNz6vY0f2gvUMZVesn+iLMFhGxhLCMmzOIMNKWE+TfE99hJYXJcEeC6HsNl6yOs0UJZ+sglGa8+5BcuGbDBkk3Eug2UG1lGyq+8yttGz02RpNvgL9HTqdNZRqoKyqxYlF8jOo1VGjqc7ZxjHz6nm9obfuvzDS5qh977T/g9jCU+CO22upfF+RS2prdRpdVZoNFQq3V7runH3Vwyt1dTmQoStd1spXXy52TeX/gmbbbbbbfNsFmFMYd+WaSyxzfyAA5ExGARysSInqF3PTwsgrq9PqSxmmeHpudLZ2179HiMm7Kvut8V6M5oPJRUlpmcLJVvcWe3o2npL9LK7xYxhFZnvvG76nifafZer12us11MnamklS+cIrou/f5mk4RsrlCcVKMlhp8mNNqdXs7CqzqdKv+zJ+9D/AIv9mUraZLvHgtWZKvj0WI8u002mmmuDT6GD2d2l2bt+mVtUty+PBySxOL7SR53W7H1ujk96p2Q6WVrK/wAFUo2Y8od13Rzhlp5XNcSSyq2uMZWVzhGXwuUWsmKq5W2Rrgvem8IL5EGmmej0/GuL7rJKYjFRiorklgybhFgDkAGtnqbT2i9o9fKiO6478eizyOVOX03XNf8AYolmWOUrO3ov19CfJmO7FYUUlnPDga+3FfMPyOpwPGoJdORz7/ySA1Ul3G8u5U8qz/yzerOxWt+YvzRllSteJfO7Hu8o+a7liUsrC5dTUvY1Dg+qXJzXi/icL4+TS9r1fuZADLpzoAAABvVXK2ajBNt8kjpVbL4Zsmk+0Vn8ytZkRg9Luza43hdt8euT6U/f1/A5QJ9VRGF064yyovhJHNunZRN7/GPcV5MJvXDMsrwjIx4eYvij8v4LYIq7VJEpZNQdLZe1rNFiuSc6c8usfQ9VpNXp9bVvVTUu66o8GSUX2UWqymbhJdUQzqUu65LtGXKv4Zd0e8nW1y4o5219o1bL2dZqreLjwhH70nyRBs3b0LcV6vFc+Sl9l/wczbcdH7Sw/wBPqeGnk1FxfBPk8x+RUnuHZl+d0ZVuVb7ng9RfZqdRZffJztsk5Sl3ZGW9fs/U6Czd1EMRfwzXGMvmVSA5ySkn8XJglovlTLMXldURA9TcXtHibR6HTWqyCafBlo5myMun0bR0zawl1RTLG9rZtF4ZvkiNJqec1zcX2xlMq343W+qPJ0Hhvi6xoeVatx9PkWCC63CcYfF1fYik9Q+DcceRqqZN+++HZFeOJY337G3s8dxYR3Dcn7cEaTm8L4f1LUI7qEYKKNzYwgq49KORysqzLtdtj7/sAAZlYE2m1NultVlM3GX5P1IQGtnqbT2j0NHtHiCV1Dz3g+H5muo9pJSg1p6XF95vl8kcAEflQ9iz/l3a1skvvt1Fjsum5y7voRgEnBWbbe2AADwEN9qri22TPkc2yH0rUuMn9VD4vN9jOEep6MZS6Vsryuv1E2qINruaz0uojHfnYkvU6sYxjFRikorkkQ6v/bv1j+qLagkVXNtlCVGrq443kuzyS6bV5e7Lgzo9ytqtIrlvQxG1cn38meSrUj2NjXJbqnvIkOfs+1yjiXBrg12Z0Cm1p6LSewADw9IbKFKxXVTlTfH4bIcH8+6J69s7Q0/u6nSx1GP+5U91v1RgEM6Yz7mUZyj91lTa+t1O16aqIaOVUIT325y5vGP3MaHQx0q3pPetaxnovQuA8hRGD2YyblLqlyAATgAGMoAyDXeRsAAAAAAAAAwAzKWWY6kmluqr1kN+UW4+84ZWfXBDfZ5cG0bDw3G/ychRfC7v8Dr0116DSOyxfWPn69kc67UW3ybnJ46RXJEmu1P0i1bqarjyT/UrGnbO8qr0tvkEGqinWm1nHB+aZOR3/wBGR4Tru9HMpbrudeeCfD0OhB5RzruGqg+8f3L9XI3lcuuCkz5xn0rHyp1x4TJAAZlMEM6Grlfp7JUXr7cOvk11RMDGUVJaYJ6Nq12x+i7XqhW58N/Gap/wyntH2Zabs2dJOL4+FN/ozecIzi4zipRfNNEVL1uh4aHUfVf+G33or07FOeO13j3JnZGa1Yt/P1OXZsfaFVVlk9LNQrW9J5XBdzn8+R6fUbQ2rqdPOh1UVqyLjKUW84fMq6PZ0NPJTse/YuXZEcaZyfBXnCG10Eugoen0sIyWJvjJebLIBsYrpWkZIAA9AAAAAAABmMXKSUVlna2fshyirL/dzxWUUsrNhjLWtyfCX97IuYuHZkvt2XucXDxnD/Aweos0ukjBrxmpJfeOVbp4Wx4rEvvI1C8eUJqN0NJ+qe9G0l4I3Buue381o5gMzi67HCfxIwdFCcZxUovaZoZwlCTjJaaAAMjEAAAPkXdgaSqdNk7YRm89Vni+LKR1NgzW7fX1TUv2PdtQejKtJ2RTOVqoxhq7o1rEFNpIp6v/AG79Y/qjobRrdWvtT5OW8vRnP1f+3frH9UXYvcUUZrU2vmTgdQZEZWjDc2lLHKyKl8+TL5XjDe1O/wDdjj8ywU7PvMu1/dQABGZgAAAAN4ABhtI0lYkVrb0uoPUmyedqXUrW6qMFmTSRQu1jbxDj5lSTc3mTyyhfnQr7Q7v9DpfD/s9fk6nd8Mf1f4en4nQe0ln3YyZY0u0K5yUZPdb78DjjmUF4hcnt6Ohn9msKUOmO0/fZ6kHN2VqZWRlTN5lBZi+6OkbqqxWwU0cHm4k8O+VM+V+oABIVAGAwB1MW6ai9J3Uwm+jceP4mepJH4UUsz7qOj+z+vOn76/2VPoTr/wBvqbqv7XLfj+DM72ur+KFN67xbhL8HlFsGtOw2VPp9ceF9dtD/AL4cPxWUbzuqtobqsjNcPheSwU741xsxXCMZP4mljIMorbKti3tRDyj+5dqWEValv2uXTki6lhG7qj01pM+ceI2q7LsmuN/t2MgAkKIAAAAAABrKSRG7kuoBMCBXLuSRmn1ANwEAAAAAZjFyeF+ZJp6J6ixQri22+x6PSaKjQU+JdhzXzw/5NZmZ8aNwh3l+i+v8GzwsCV7U59o/v9P5I9n7Or00PG1GN7nh9PX+DGq1krm41txh+bKuo1tlmp8Kz3a3/T8/XzCOKysuU21F88v1Z19OPGqKWvogkDJhmvLBztrLFMLVzg8N+TK0XlZLO1ZJ6WUe+F+ZUq+FHdfZ+UpYjT4Tev0OQ8bhGOSmuWu/6m4AN8aQAAAG+mvlpdTG6KyuUl3RoD1PR580d62nTbTojJS5cpLnH1PKazhRJZz7y4//ACRcw0nutrPPD5kGoplZU4xazlc/UnqaimtmF7djT6e5t1GMm24bpJGcrUl2IY1N8iKSRkAqclpAAAAAMAw3ghstwSV1Xaq9U6eDnZLkl+rPRbO9nKKGrda1fbzUPsR/kwlNR5J6qJW8HA2fsrWbTkpVx8OjrbPl8u5v7U+z0dDsyrU6Wc7I1vF+91zyl5LPD5nuVwSS4JckYtrhdVOq2KlXOLjKL6p8ync3bFx4N5gxhiWxs1to+NgvbZ2dPZW07dLPLiverk/tQfJ/t8iiaJpp6Z9FhONkVOPDBNpdPZq9TCilJzm8LLwjWii3UWqqiuVk3yUUeq2VsyvZFM9ZrrIqxR4vpBdl3ZlGLkyK++NUfn6I4VGlv0O246e5JSUW3uvKaa4M7BVqslrdoX7QnFxjZ7tUXzUUWje4MHCrv6s+deP5CvzO3MUk/r6/voAAumhAYDAHU3g+hownxIra/Mj0lzCyniXKxfj9CUGm/wCRHO9rlB/M1cqLIvWjt6fEsS2O1NL69iS2xVwy+fRFCbcm1zlLm+xu/EslnDz3ZJXUo+pZoxnvqmavxLxmtVurGe2+X7fQU17sSYA2ByAAAAAAANZy3UbGlWns1uur0tWczfF9l1YPUnJ6RHRRfrZtVLdgnhzfL/LOvR7O5jmddlj7ylur8D0ei0NOipjCuCyljOOXoWitK5vg21eJCK+Luzylvs/BcPAknjPuT4nM1OzrtPmVLc0ucGsSX8nt172vk/uVJfi/8GdRpq9RHE48eklzR4rZLk9njVyXZHgaLVNE5LtrQy0Wq8VLCk8SxyeeT+f6kMXmKZZTUltGqsg65dLMklFTutUV1Iy/spxhqFOXKMk2UvEL3RjSnHn+XrZZwaVdkRhLj+DuVVU7N0ybxvtYeObfZFG66d896b4LlFckSa62N16cHmMY4RXOByr3KThF9v3+Z3FVaitvk0trjZBwlyf5eZFTZJS8K341yf3l3LDIr61ZHniS4xl2ZUT9GWE/RkuSG21RTw1w5vsRWX7lObJKOF7z6HKuvnqZYS3aui7+pscDw63NnqPaK5f99SlmZleHHcu79Eb32/SLVu/BHk+77m8VhGsIbqNpcEd/j0QxqlVXwjh8i+eRY7J8sxKWCKVyXUhsnOy1V1Rc5y5JF2nYWosSldOS/trjn8ydtLkjhXOz7qK6vXc3jan1LUth1xXvSuj6/wD8ILNk2w403KflJYPOuLJHj2L0Mp5MlRysps3LoOEuzLEJqSPSDWuzNwAAAAAAAAAYckuoUk+QBk1n8JsYmswa7oA9T7PaOOm2dG5r629b0n2XRHVINFJS0OnlHk6o4/AnKMm29m/hFRikgAZjFy5GJmjge1uyXtLZni0xzqdNmUMc5R6x/f5Hktmez9+pUbNU3RU+KWPekv2PqOIVrek1w6s8P7QXWX7QnVo9SoaNrMvC4Sb6rPb0K1mP5ktxWzb43if+LU67JaXv/pGlms0OyYvS6CnxdR1rrfH1lLoc66N+usVm0LFPdeY0w4Qj/L82SU010w3KoqMfLqSlyrDjHvPv+xpMvxqyxtUfCvf1f8fh+ZhLCwjIyaSsSLpoeTcEPjLubRtT6gaJAzCaZkAAAADAAABhvBHKxIAkyjG+iGLsus3KouUvLoXqtmNrN1rz2h/JSys/HxP+WXf29S5j4N+T/wAce3v6ECkmZLL2ZBfBbNPzwyCyqymW7Yl5NcmR4vieNly6a5d/Z9jLI8PyMZdU1290agA2JRHQ7Xsjp1LV6rUSXFbtcf1f7HFPR+yUkoaiHXxFL5NY/Yiu+4y3hpO5bPQ6jG6l5kBPqFwT7EC5opx4N1Pkg0/G7Uz/AL1H8Ev5JyDR8dPv/fnKX5k5kyNHK9pKFdsW+WPeri2v/fVI8pTxqT8j2G3pqGw9W39qG6vV8F+p5GEd2KXYs0/dZrM7XWvoZJtNZ4dyy+EuDIQeZFEciqVUuGV6LZUWKyPKOxkycyGrlVH3k5R8uaJVtHTNf1YJ9m8Hz7J8Nycebi4tr3XdHb4+dRkQ6lJJ+zZdbSXEqarUwqg5TeF0S5tle7aVWMVvxH0UeX4lBqy6zxLXl9F0XoXvD/BrciXVanGP6v6fyV8zxSrHjqt9Uv0QnOzUz3p8Ir4Y9v8AJNCGEZjHBudtVVCmChBaSOPttndNzm9tg0t4QZuS6WMZ6yiMuTsjn8SR9iNLb0d/YOx4aLS+NqIKWpt4yyvgXRHZJ/8A8d+hAUHJze2dCq1VFRRh8Vx4+pVv0FF3FLw5d4/wWyvqJSlKNFbxKfGTX2Y9X+wR4+5wdZooyr3bYqdUm1Ga5ZXbscG+iejuUZPerl8Mu/l6n0B1Vyp8JxXh4xunn9q7P92VEuMZrMJdmT12a7FW+hTW1ycSLyjYr6eT4xlwlF4a8ywWDUAA2hHemo93gxlJRTk/Q9jFyekSUaeVvFvEe5cjpaksbufNlzT6Xe07nvbsYp4XoRLkcBn+JZORLe9RfCXt8zt8PAox48bl6sq26Kqa+BfgczUaeembnFtwXNPnH/B3WQ6iCcctZXKS7oiwvEb8WxNPa9UTZODTkwcWtP0ZyK5pokKu69PqJUyeUuMX3XQsxeUfQ65xsgpx4fc4WyuVc3CXKPQbA2hFVrSXSSaf1bf6HoYQUlls+fl6jautoiowu3orpNbxHOpt7Rcoy1BdM0e03IR4tlLaG19Pok4t79nSEef+DzN22NdbFxdqgn9yOH+JQeW228t9WYxo/wDRJZnLWq0XdftPU61tWS3a/uR5fPuUgCwkktI1spym9yYANbHiJ6YkN1qimWdHsjVavEpqUIvlFLMv8F32b2V9O1EtVcs1VvEF96XV/I9f4fhJQUVFdkQTt09I2OPi9UeuXB5aPs2lHjTKT/us4lbU7DVSzu21PvneR7Egp+s1F9j4pNVr5c/zf5EaskW3RW+2jwlld2lmlcsxbwprkyVPKyep2lsyuyicq4Zi179ffzXmeUUJU2zpk87r4PuujJ4T6jXZFHlva4N3zAMN4JCoZNJTSNJ2YLWz9k6zaTUoLwqOts1wfoup42l3ZnCEpvSRRna28LLb5JFrTbNstalqG4R+6ub/AIPWaHY2j0VUoxhvzksSsnxk/Tt8jnW1SoulXPnF8+67nPeMZ+RRBKnsn6+pv/DvDqpvdvdr09CKqmFUFCqCjHsjcyDi5SlN9UntnTpKK0l2MM0thGytwl1/I3ZZv0ng6SNrk954zF+ZnUrE+uH/AF7mE+mS6ZevY87xTafNcGDNjzbNrrJmD6jBuUU2fO5pRk0gXdk6z6FrVZL+nJbs/Tv8ikD1ra0xCThJSR9FqshdWmmmmunUq3tVwsknlRTf5Hk9n7Uv0SUF9ZV9x9PRnVntnSajSzhvSrnJYxNfjxRT8qUWbmOXXYu/ZnV08dzTVR7QRuUJ7Y2fHLV+95Ri2czXbenZFw0kXWnzm/i+XY9UJN8CV9cFyPaPVxtnDSVvKrlvWNfe6L5HFHXILUY9K0ai2x2zcmAAZEYIZ0xk84JgARRpSJFFIyAAAAAZi3GSkuDTyjAAR77Z+phq9JCyPKazjt3QnFxlhnldi7S+hXeHY34M3x/tfc9c7K7aVJNPKymihOLhL5G/puV1e/VFe2yNVUrJ8or8TTT1yjGU7f6tjzLy7L5Gq+v1Gf8AtVPh/dL/AAWAZgra+lXaSfD3oLeiWTWeFXLLwt15/AcDk8DdHd2pqEuTal+KRuauXi6i25cpy930Swv0Ni8uDQWNOb0DeuSjZGT6NGgMbIKcHF+p5CThJSXoeopW/s3djz3WigjfYup3oOqT49DfVVeFe8fDLij53mUSr+F8x7M77GtjaupcPuQmGsrDEpKKbk0kurK7vna8aeG8vvy4L/Jr0my2k2UNqUPw1bH4qufnEr0TzFHXlVJVZslvv7XDozieG9NqZUvkuMX5dDsfAMzrg8eT7ruvp6nMeOYvTJXx9ez+pbBhPKMnTHNgAAAAAAjv4Vt+RIazWYP0B6j3uxtLHSbOopS+CCT82+L/ADJbZb035cDbRWKzTwnHlKKkvmiOxYskvM13Mns6TSUEkR22KqqdkuUE2zXTVurTVwl8WMy9Xxf5s01K33TT/wCSeZf8Y8X+y+ZYfMyMAeS2/p1RtFOKwpJ49Of7s9aea9pZJ62qK5qvj+JJV98r5WvKezjsje9ZZGuuLlOTxGK5tm0up0fZiEZ7YnKSTcKm4+TykWpPpWzVVQ65qJ09m+z9FCjbrMXXc937Ef5O30MApOTl3Zu4VxgtRRkpbT0/iU+LFe/Xz80XDKK2RRHIqdcvUnqm65KSPN5NoQlZLdhFyfZGboqOqsilhKbSR2aK4V0xUIqOVx8ziqMV2zcW+Dezt6YppclWjRwpXi6iS4ccdEc3a+0Fa/Drfurl5+ZjbN9vv++8RlhLscXLfFvizovDcCGRHq4gnx6tr3+Ro/EM6VHwL7zXPt9DYGAdUcuZBgAGQYMAGwMAAyDAAMgwADIMAAyDAAMgwADIMAAyXtDtK7SRdablU/s9vQoGDxpPkzhOUHuLPX6HaGjtrjCuxQkl8M+DL64rgeCJI3W1r3LZx9JNELp9mXoZj18SPcyaisyaSXNvgcDbe1K7KZaXTS3lLhZNcsdkcSdtln9Syc/+UmyM9jUk9swty5SXTFaNgYBMUTIMAAm01rpvjNPHHiegvm9Zo97TxzNLKb5J9UeaXM9DsWcpaR5ecYZznjFEeqNn/rs/3T/vyOi8HvepV+3df7OfHTKUlO+Tsl0T5L5E6wiXUpR1NiSwt4iOMltNpnUdTkthrKOVtKnNasXxVfnE6pX1KTXFc00yxiXyx742R9GQ5FUb6ZVy9Ucup5iSFfTf0o+hOfTj54zIMAHhkGAAZBgwAeo9m9oLwlpbH78Pgz1j2+R27pRljd5nz6EpQkpRbUlxTXQ9pobJ26KmdjzKUU2+5UtrSfUbjEvc49D9Dav39bbPpXFVr1fF/sTlfRcdO31lOTfn7zJ2RstI1tshVVKyySjCKy2zxmt1MtXq7L5cN58F2XRHR9pLrPpVdG+/C3d7d8zilmqGl1Gry7XKXQuEf//Z",
  Auto: "data:image/jpeg;base64,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",
  entry: "data:image/jpeg;base64,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",
};


// Screen navigation history — jab bhi ek NAYE screen par jaate hain, purana
// screen is stack mein push ho jaata hai. Back button dabane par (goBack ya
// hardware/browser back) hamesha sirf EK step peeche jaata hai — jahan pehle
// the wahi wapas aata hai, seedha Wallet/home pe nahi kudta.
let screenHistoryStack = [];

function goTo(name, fromPopState){
 if (!fromPopState && typeof currentAppScreen !== 'undefined' && currentAppScreen && currentAppScreen !== name) {
   screenHistoryStack.push(currentAppScreen);
 }
 document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
 document.getElementById("screen-"+name).classList.add("active");
 document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
 const map={wallet:"navWallet",analytics:"navAnalytics",entries:"navEntries",goals:"navGoals"};
 if(map[name]) document.getElementById(map[name]).classList.add("active");
 if(name==="analytics") { setTimeout(renderAnalytics, 30); }
 if(name==="entries") renderEntries();
 if(name==="wallet") renderRecent();
 if(name==="goals") {
   // Goals tab (id="screen-goals" for historical reasons — bottom-nav
   // button/id kept as-is, only its contents were replaced). Re-read
   // fresh from localStorage every time the tab opens, so it's always
   // showing the latest saved goals/contributions.
   if (typeof loadGoals === 'function') loadGoals();
   if (typeof renderGoalsList === 'function') renderGoalsList();
 }
 currentAppScreen = name;
 if (!fromPopState) history.pushState({ screen: name }, '');
 // Same for the home-screen floating chat bubble — only visible on Wallet.
 if (typeof syncHomeChatFabVisibility === 'function') syncHomeChatFabVisibility();
}
// Toggles the "show" class on the floating home-screen chat bubble
// (#homeChatFabBtn) so it's only visible while the Wallet/home tab is the
// active top-level screen (it lives outside #screen-wallet at body level
// so position:fixed behaves reliably on mobile — see its CSS comment).
function syncHomeChatFabVisibility(){
 const fabBtn = document.getElementById('homeChatFabBtn');
 if (fabBtn) {
  const walletTabActive = document.getElementById('screen-wallet')?.classList.contains('active');
  fabBtn.classList.toggle('show', !!walletTabActive);
 }
 const goalsFabBtn = document.getElementById('goalsAddFabBtn');
 if (goalsFabBtn) {
  const goalsTabActive = document.getElementById('screen-goals')?.classList.contains('active');
  goalsFabBtn.classList.toggle('show', !!goalsTabActive);
 }
}

// Ek step peeche — jis screen se aaye the wahi khulta hai. Sabhi on-screen
// "back" arrows aur hardware/browser back button dono isi se hoke guzarte hain.
function goBack(){
 history.back();
}

// ===== RENDER FUNCTIONS =====

function renderRecent(){
 const list = entries.slice(0,4);
 if(list.length===0){
 document.getElementById("recentTxnList").innerHTML = '<div class="empty-state"><i class="ti ti-receipt-off"></i><br>No entries yet</div>';
 } else {
 document.getElementById("recentTxnList").innerHTML = list.map(e=>txnRowHTML(e,false)).join("");
 }
 renderDashboardTotals();
 renderMiniChart();
}

// ===== DASHBOARD TOTALS (real calculation from entries) =====
// Parties treated as investments/savings — payments TO these increase Savings,
// money received/withdrawn FROM these decreases Savings. All other parties
// only affect the normal Payment/Received totals, not Savings.
const SAVINGS_PARTIES = ["Groww stock market", "APJ EMI", "Mutual fund", "other investment"];
function isSavingsParty(party) {
 const p = (party || '').trim().toLowerCase();
 if (!p) return false;
 // Keyword match instead of exact match, so name variations still count
 // e.g. "Groww App", "APJ EMI Bank A/c", "Mutual Funds SIP" all match.
 // IMPORTANT: keywords must be lowercase too since `p` is lowercased above —
 // this was the bug causing only "investment" to ever match.
 return p.includes("groww") || p.includes("apj emi") || p.includes("mutual fund") || p.includes("investment");
}

// ===== AI Chat: "kis party ka kitna balance hai" jaise sawaal =====
// Privacy/speed ke liye poori entries history AI ko nahi bhejte — sirf
// party-wise totals (kitna diya, kitna liya, net balance) local calculate
// karke ek chhota summary AI ko bhejte hain, saath me user ka sawaal. AI
// sirf isi summary ke base par jawaab deta hai.
function buildAllPartyBalances(){
 const map = {};
 entries.forEach(e => {
  const party = (e.party || 'Unknown').trim();
  if (!party) return;
  if (!map[party]) map[party] = { party, paid: 0, received: 0 };
  const amt = Number(e.amount) || 0;
  if (e.type === 'expense') map[party].paid += amt;       // maine inko diya
  else if (e.type === 'income') map[party].received += amt; // maine inse liya
 });
 return Object.values(map).map(p => ({
  party: p.party,
  paid: p.paid,
  received: p.received,
  net: p.paid - p.received   // +ve: inse lena hai, -ve: inko dena hai
 })).sort((a,b) => Math.abs(b.net) - Math.abs(a.net));
}
function buildBalanceSummaryText(maxParties){
 const rows = buildAllPartyBalances();
 if (rows.length === 0) return "Abhi koi entry hi nahi hai.";
 const totalPaid = rows.reduce((s,r)=>s+r.paid,0);
 const totalReceived = rows.reduce((s,r)=>s+r.received,0);
 const netBalance = totalReceived - totalPaid;
 const rowsToShow = maxParties ? rows.slice(0, maxParties) : rows;
 const lines = rowsToShow.map(r => {
  const status = r.net === 0 ? "settled/barabar" : (r.net > 0 ? `inse ₹${Math.abs(r.net).toLocaleString('en-IN')} lena hai (take)` : `inko ₹${Math.abs(r.net).toLocaleString('en-IN')} dena hai (give)`);
  return `- Party "${r.party}": total paid/given ₹${r.paid.toLocaleString('en-IN')}, total received/taken ₹${r.received.toLocaleString('en-IN')} → Status: ${status}`;
 });
 const omittedNote = (maxParties && rows.length > rowsToShow.length) ? `\n(+${rows.length - rowsToShow.length} aur parties)` : "";
 return `Overall Summary: Total Paid ₹${totalPaid.toLocaleString('en-IN')}, Total Received ₹${totalReceived.toLocaleString('en-IN')}, Net Balance ₹${Math.abs(netBalance).toLocaleString('en-IN')} (${netBalance >= 0 ? 'Surplus / Lena hai' : 'Deficit / Dena hai'}).\n\nParty-wise Balances:\n` + lines.join("\n") + omittedNote;
}

// ===== Full app context for "Ask Balance" voice/text questions =====
function buildAiContextText(compact){
 const now = new Date();
 const curMonth = now.getMonth(), curYear = now.getFullYear();
 const toINR = n => `₹${(Number(n)||0).toLocaleString('en-IN')}`;

 // ---- 1) Party-wise balance (all-time) ----
 const balanceSection = buildBalanceSummaryText(compact ? 40 : undefined);

 // ---- 2) Date-wise totals: aaj / kal / is week / last week / is mahina / last mahina / is saal ----
 function sumRange(fromDate, toDate){
  let exp = 0, inc = 0, count = 0;
  entries.forEach(e => {
   const d = new Date(e.date);
   if (isNaN(d)) return;
   if (d >= fromDate && d <= toDate) {
    count++;
    if (e.type === 'expense') exp += Number(e.amount) || 0; else inc += Number(e.amount) || 0;
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
 const lastWeekEnd = new Date(weekStart); lastWeekEnd.setMilliseconds(-1);
 const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(lastWeekStart.getDate()-7);
 const monthStart = new Date(curYear, curMonth, 1);
 const monthEnd = endOfDay(now);
 const lastMonthStart = new Date(curYear, curMonth-1, 1);
 const lastMonthEnd = new Date(curYear, curMonth, 0, 23,59,59,999);
 const yearStart = new Date(curYear, 0, 1);
 const yearEnd = endOfDay(now);

 const todayR = sumRange(today0, today1);
 const yestR = sumRange(yest0, yest1);
 const weekR = sumRange(weekStart, weekEnd);
 const lastWeekR = sumRange(lastWeekStart, lastWeekEnd);
 const monthR = sumRange(monthStart, monthEnd);
 const lastMonthR = sumRange(lastMonthStart, lastMonthEnd);
 const yearR = sumRange(yearStart, yearEnd);
 const monthName = now.toLocaleDateString('en-IN', { month:'long', year:'numeric' });
 const lastMonthName = lastMonthStart.toLocaleDateString('en-IN', { month:'long', year:'numeric' });

 const dateWiseSection =
`Aaj (${now.toISOString().slice(0,10)}): expense ${toINR(todayR.exp)}, income ${toINR(todayR.inc)} (${todayR.count} entries)
Kal (${yesterday.toISOString().slice(0,10)}): expense ${toINR(yestR.exp)}, income ${toINR(yestR.inc)} (${yestR.count} entries)
Is week: expense ${toINR(weekR.exp)}, income ${toINR(weekR.inc)}
Last week: expense ${toINR(lastWeekR.exp)}, income ${toINR(lastWeekR.inc)}
Is mahina (${monthName}): expense ${toINR(monthR.exp)}, income ${toINR(monthR.inc)}
Last mahina (${lastMonthName}): expense ${toINR(lastMonthR.exp)}, income ${toINR(lastMonthR.inc)}
Is saal (${curYear}): expense ${toINR(yearR.exp)}, income ${toINR(yearR.inc)}`;

 // ---- 3) This month ka top parties ----
 const monthEntries = entries.filter(e => {
  const d = new Date(e.date);
  return d.getFullYear() === curYear && d.getMonth() === curMonth;
 });
 const monthByParty = {};
 monthEntries.forEach(e => {
  if (e.type !== 'expense') return;
  const p = (e.party || 'Unknown').trim();
  monthByParty[p] = (monthByParty[p]||0) + (Number(e.amount)||0);
 });
 const topMonthParties = Object.entries(monthByParty).sort((a,b)=>b[1]-a[1]).slice(0,5)
  .map(([p,amt]) => `${p}: ${toINR(amt)}`).join(", ") || "koi expense nahi";
 const analysisSection = `Top payees/parties is mahine: ${topMonthParties}.`;

 // ---- 4) All-time totals ----
 const allExpense = entries.filter(e=>e.type==='expense').reduce((s,e)=>s+(Number(e.amount)||0),0);
 const allIncome = entries.filter(e=>e.type==='income').reduce((s,e)=>s+(Number(e.amount)||0),0);
 const totalsSection = `All-time: total payment ${toINR(allExpense)}, total receive ${toINR(allIncome)}, total entries: ${entries.length}.`;

 // ---- 5) Payment method wise (all-time + is mahina) ----
 function methodBreakup(list){
  const m = {};
  list.filter(e=>e.type==='expense').forEach(e => {
   const k = e.method || 'Cash';
   m[k] = (m[k]||0) + (Number(e.amount)||0);
  });
  return Object.entries(m).map(([k,v]) => `${k}: ${toINR(v)}`).join(", ") || "koi expense nahi";
 }
 const paymentMethodSection = `All-time (payment side): ${methodBreakup(entries)}\nIs mahine: ${methodBreakup(monthEntries)}`;

 // ---- 6) Analytics: top 5 single biggest expenses + daily average ----
 const top5Expenses = entries.filter(e=>e.type==='expense')
  .slice().sort((a,b)=>(Number(b.amount)||0)-(Number(a.amount)||0)).slice(0,5)
  .map(e => `${e.date}: ${toINR(e.amount)} — ${e.party||'Unknown'}${e.notes ? ' ('+e.notes+')' : ''}`)
  .join("\n") || "koi expense nahi";
 const daysElapsed = now.getDate();
 const dailyAvg = daysElapsed > 0 ? monthR.exp / daysElapsed : 0;
 const analyticsSection = `Top 5 sabse bade single expenses (all-time):\n${top5Expenses}\nIs mahine daily average expense: ${toINR(dailyAvg)}/din (${daysElapsed} din ka data).\nWeekly trend: is week ${toINR(weekR.exp)} vs last week ${toINR(lastWeekR.exp)}.`;

 // ---- 7) Search-friendly entries list ----
 const searchCap = compact ? 40 : 80;
 const recentSection = entries.slice(0, searchCap).map(e => {
  const typeWord = e.type === 'income' ? 'received' : 'paid';
  return `- ${e.date}: ${toINR(e.amount)} ${typeWord} ${e.type==='income'?'from':'to'} ${e.party||'Unknown'} (${e.method||'Cash'})${e.notes ? ' — ' + e.notes : ''}`;
 }).join("\n") || "Abhi koi entry hi nahi hai.";

 // ---- 8) Goals (savings targets) ----
 let goalsSection = "Koi goal set nahi hai.";
 try {
  if (typeof loadGoals === 'function') loadGoals();
  if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
  const activeGoals = (typeof goals !== 'undefined' ? goals : []);
  if (activeGoals.length > 0) {
   goalsSection = activeGoals.map(g => {
    const saved = Number(g.saved) || 0;
    const target = Number(g.target) || 0;
    const remaining = Math.max(0, target - saved);
    const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
    const statusWord = g.status === 'completed' ? 'complete ho gaya' : `target date: ${g.targetDate || 'not set'}, bacha hua: ${toINR(remaining)}`;
    return `- Goal "${g.name}": Saved ${toINR(saved)} of Target ${toINR(target)} (${pct}% completed). Status: ${statusWord}`;
   }).join("\n");
  }
 } catch(err) { /* goals load fallback */ }

 return `TODAY'S DATE: ${now.toISOString().slice(0,10)}\n\nBALANCE (party-wise, all-time):\n${balanceSection}\n\nDATE-WISE TOTALS:\n${dateWiseSection}\n\n${analysisSection}\n${totalsSection}\n\nPAYMENT METHOD WISE:\n${paymentMethodSection}\n\nANALYTICS:\n${analyticsSection}\n\nRECENT ENTRIES (latest ${searchCap}):\n${recentSection}\n\nGOALS & SAVINGS TARGETS:\n${goalsSection}`;
}

let aiChatMessages = []; // session-only: [{role:'user'|'ai', text}]

// ===== Chat: Balance se poochho — ab poori screen par khulta hai (pehle
// chhota center modal tha), aur text ke sath-sath ek mic button bhi hai
// jisse bol ke bhi poochh sakte ho (Web Speech API se) — koi extra key ya
// cost nahi lagta, sirf jawaab ke liye Gemini use hota hai jaisa pehle se
// hota tha. closeAiChatModal() se history/back button bhi isse close karta
// hai, baaki modals ki tarah hi.
function openAiChatModal(){
 const existing = document.getElementById('aiChatModal');
 if (existing) existing.remove();
 const html = `
 <div id="aiChatModal" style="position:fixed;inset:0;width:100%;height:100%;background:#0b0e14;z-index:2000;display:flex;flex-direction:column;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:calc(14px + env(safe-area-inset-top,0px)) 16px 14px;border-bottom:1px solid #1f2430;flex-shrink:0;">
   <h3 style="font-size:16.5px;display:flex;align-items:center;gap:8px;margin:0;color:#e8b64c;"><i class="ti ti-message-circle"></i>Ask Balance</h3>
   <button class="modal-close" onclick="closeAiChatModal()" style="font-size:26px;">&times;</button>
  </div>
  <div id="aiChatList" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;"></div>
  <div style="padding:10px 14px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid #1f2430;flex-shrink:0;">
   <div id="aiChatMsg" style="font-size:11.5px;color:#8b9099;margin-bottom:6px;min-height:14px;"></div>
   <div style="display:flex;gap:8px;">
    <button onclick="toggleAiChatMic()" id="aiChatMicBtn" title="Voice se poochho" style="width:42px;height:42px;flex-shrink:0;border:none;border-radius:50%;background:#232838;color:#e8eaf0;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s,transform .2s;"><i class="ti ti-microphone" id="aiChatMicIcon"></i></button>
    <input id="aiChatInput" type="text" placeholder="Ask me anythink?" onkeydown="if(event.key==='Enter')sendAiChatMessage();"
     style="flex:1;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid #232838;background:#0d1117;color:#e8eaf0;font-size:13.5px;min-width:0;">
    <button onclick="sendAiChatMessage()" id="aiChatSendBtn" style="padding:0 16px;border:none;border-radius:10px;background:linear-gradient(135deg,#f0c060,#e8b64c);color:#1a1305;font-weight:700;cursor:pointer;flex-shrink:0;"><i class="ti ti-send"></i></button>
   </div>
  </div>
 </div>`;
 document.body.insertAdjacentHTML('beforeend', html);
 renderAiChatMessages();
 if (!getGeminiKey()) {
  document.getElementById('aiChatMsg').innerHTML = `⚠️ First, enter your free AI key. — <a href="#" onclick="closeAiChatModal();openAiSettingsModal();return false;" style="color:#e8b64c;">yahan se</a>.`;
 }
}
function closeAiChatModal(){
 stopAiChatMic();
 const el = document.getElementById('aiChatModal');
 if (el) el.remove();
 if ('speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch(e){} }
}

// ===== Chat mic (Web Speech API, text-input ko fill karta hai) =====
let aiChatRecognition = null;
function stopAiChatMic(){
 if (aiChatRecognition) { try { aiChatRecognition.stop(); } catch(e){} aiChatRecognition = null; }
 const micBtn = document.getElementById('aiChatMicBtn');
 if (micBtn) { micBtn.style.background = '#232838'; micBtn.style.transform = 'scale(1)'; }
}
function toggleAiChatMic(){
 const micBtn = document.getElementById('aiChatMicBtn');
 const inputEl = document.getElementById('aiChatInput');
 const msgEl = document.getElementById('aiChatMsg');
 const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
 if (!SR) { if (msgEl) msgEl.textContent = "⚠️ Ye browser voice input support nahi karta."; return; }
 if (!window.isSecureContext) { if (msgEl) msgEl.textContent = "⚠️ Voice sirf HTTPS pe chalta hai."; return; }

 // Already listening — tap dabana matlab ab jo bhi bola hai wahi final maano.
 if (aiChatRecognition) { stopAiChatMic(); return; }

 const rec = new SR();
 aiChatRecognition = rec;
 rec.lang = 'en-IN';
 rec.interimResults = true;
 rec.continuous = false;
 micBtn.style.background = 'linear-gradient(135deg,#ff3b3b,#ff6b6b)';
 micBtn.style.transform = 'scale(1.08)';
 if (msgEl) msgEl.textContent = "🔴 Sun raha hoon...";

 rec.onresult = (e) => {
  let text = '';
  for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
  inputEl.value = text;
 };
 rec.onerror = (e) => {
  if (msgEl) msgEl.textContent = e.error === 'not-allowed'
   ? "⚠️ Mic permission allow karo."
   : "⚠️ Voice error: " + e.error;
 };
 rec.onend = () => {
  aiChatRecognition = null;
  stopAiChatMic();
  if (msgEl && msgEl.textContent === "🔴 Sun raha hoon...") msgEl.textContent = "";
  if (inputEl.value.trim()) sendAiChatMessage();
 };
 try { rec.start(); } catch(e){ if (msgEl) msgEl.textContent = "⚠️ Voice shuru nahi ho paaya: " + e.message; }
}
function renderAiChatMessages(){
 const listEl = document.getElementById('aiChatList');
 if (!listEl) return;
 if (aiChatMessages.length === 0){
  listEl.innerHTML = `<div style="font-size:12.5px;color:#8b9099;text-align:center;margin-top:20px;line-height:1.6;">Ask anything about your money — balance, this month's spending, recent entries, or goals. e.g.<br>"What is XYZ balance?"<br>"Is mahine kitna kharch hua?"<br>"Mera savings goal kitna complete hua?"</div>`;
  return;
 }
 listEl.innerHTML = aiChatMessages.map(m => `
  <div style="align-self:${m.role==='user'?'flex-end':'flex-start'};max-width:85%;">
   <div style="background:${m.role==='user'?'linear-gradient(135deg,#f0c060,#e8b64c)':'#1f2430'};color:${m.role==='user'?'#1a1305':'#e8eaf0'};padding:10px 13px;border-radius:14px;${m.role==='user'?'border-bottom-right-radius:4px;':'border-bottom-left-radius:4px;'}font-size:13.5px;line-height:1.5;white-space:pre-wrap;">${m.text}</div>
  </div>`).join('');
 listEl.scrollTop = listEl.scrollHeight;
}
async function sendAiChatMessage(){
 const apiKey = getGeminiKey();
 const inputEl = document.getElementById('aiChatInput');
 const msgEl = document.getElementById('aiChatMsg');
 const sendBtn = document.getElementById('aiChatSendBtn');
 const question = inputEl.value.trim();
 if (!question) return;
 if (!apiKey) { openAiSettingsModal(); return; }

 aiChatMessages.push({ role: 'user', text: question });
 inputEl.value = "";
 renderAiChatMessages();
 msgEl.textContent = "";
 sendBtn.disabled = true;
 const thinkingIdx = aiChatMessages.length;
 aiChatMessages.push({ role: 'ai', text: '💭...' });
 renderAiChatMessages();

 try {
  const summary = buildAiContextText();
  const prompt = `Tum ek personal finance app ("DayToDay") ke andar ek smart financial assistant ho. User apne paise ke baare me kuch bhi poochh sakta hai — party balance, is mahine ka analysis, recent entries, savings goals/targets, etc.
NEECHE diye REAL DATA ke base par seedha aur exact answer do.

RULES:
- SEEDHA aur SIRF asli jawaab do. Pehle hi shabd se direct fact/number/answer shuru karo.
- KABHI bhi "Maine samjha", "Mene samjha", "Theek hai", "Chaliye batata hoon", "Samajh gaya" jaise filler shuru me mat likho.
- Chhota, clear, friendly Hinglish me jawaab do (2-3 lines).
- Rupee amounts ko ₹ ke saath likho.

REAL DATA:
${summary}

User ka sawaal: "${question}"`;
  const reply = await callGeminiText(prompt);
  aiChatMessages[thinkingIdx] = { role: 'ai', text: reply || "Maaf karo, jawaab nahi mil paya." };
  speakText(reply || "Maaf karo, jawaab nahi mil paya.");
 } catch (err) {
  aiChatMessages[thinkingIdx] = { role: 'ai', text: "⚠️ AI se jawaab nahi mila: " + err.message };
 } finally {
  sendBtn.disabled = false;
  renderAiChatMessages();
 }
}

function renderDashboardTotals(){
 const now = new Date();
 const curMonth = now.getMonth(), curYear = now.getFullYear();
 const prevDate = new Date(curYear, curMonth-1, 1);
 const prevMonth = prevDate.getMonth(), prevYear = prevDate.getFullYear();

 let income=0, expense=0;
 let savings=0; // Investment-aware: only Groww/APJ EMI Bank/Mutual Fund/Other Investment affect this
 let totalBalance = 0; // Cumulative balance across all time
 // Growth badge ke liye alag se sirf "Receive" ka is-mahine-vs-pichle-
 // mahine comparison chahiye — BUGFIX: pehle ye poore all-time `income`
 // (jo abhi cumulative hai) ko sirf pichle mahine ke income se compare
 // kar raha tha, jisse number hamesha bahut bada/galat dikhta tha. Ab
 // "is mahine" ka income alag track hota hai, sirf isi comparison ke liye.
 let curMonthIncome = 0, prevIncome = 0;

 entries.forEach(e=>{
 const d = new Date(e.date);
 const amt = Number(e.amount)||0;
 const toSavingsParty = isSavingsParty(e.party);

 // Lifetime balance calculation
 if(e.type==='income') totalBalance+=amt;
 else if(e.type==='expense') totalBalance-=amt;

 // Continue/lifetime totals for the Receive, Payment, Savings boxes —
 // ab yeh sirf current month tak limited nahi, balki HAR entry (all-time,
 // shuru se ab tak) count/sum hoti hai.
 if(e.type==='income') {
  income+=amt;
  if(toSavingsParty) savings -= amt; // withdrawing from an investment reduces savings
 } else if(e.type==='expense') {
  expense+=amt;
  if(toSavingsParty) savings += amt; // paying into an investment grows savings
 }

 // Sirf growth badge ke liye month-wise Receive tracking
 if(d.getFullYear()===curYear && d.getMonth()===curMonth){
  if(e.type==='income') curMonthIncome+=amt;
 } else if(d.getFullYear()===prevYear && d.getMonth()===prevMonth){
  if(e.type==='income') prevIncome+=amt;
 }
 });

 savings = savings > 0 ? savings : 0;

 document.getElementById("walBalance").textContent = (totalBalance<0?'-':'') + Math.abs(totalBalance).toLocaleString("en-IN");
 document.getElementById("statIncome").textContent = "₹"+income.toLocaleString("en-IN");
 document.getElementById("statExpense").textContent = "₹"+expense.toLocaleString("en-IN");
 document.getElementById("statSavings").textContent = "₹"+savings.toLocaleString("en-IN");

 

 // Growth % = sirf "Receive" (income) ka is mahine vs pichle mahine
 // comparison hai — na expense, na savings, na total balance is number me
 // count hote. Label me ab saaf "Receive" likha hai taaki confusion na ho
 // ki ye kis cheez ka % hai.
 let growthPct = 0;
 if(prevIncome > 0){
 growthPct = ((curMonthIncome - prevIncome) / prevIncome) * 100;
 } else if(curMonthIncome > 0){
 growthPct = 100;
 }
 const growthEl = document.getElementById("growthLabel");
 const sign = growthPct >= 0 ? "+" : "";
 growthEl.innerHTML = `<i class="ti ti-trending-${growthPct>=0?'up':'down'}"></i> Receive ${sign}${growthPct.toFixed(1)}% vs last month`;
 growthEl.title = "Sirf 'Receive' (income) ka is mahine vs pichle mahine comparison — expense/savings/balance isme count nahi hote.";
 growthEl.style.color = growthPct >= 0 ? "#3ddc84" : "#f06464";

 // Balance card amount color (+ / -)
 const balEl = document.getElementById("walBalance").parentElement;
 balEl.style.color = totalBalance < 0 ? "#f06464" : (isLightMode() ? "#1a2340" : "#f5f6f8");
}

// Render mini chart with last 7 days trend
let miniChartObj = null;
let miniChartDayEntries = []; // parallel array: entries per day, for tooltip

function renderMiniChart(){
 try {
 const canvas = document.getElementById("miniChart");
 if(!canvas) return;
 
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
 borderColor: '#e8b64c',
 backgroundColor: 'rgba(232, 182, 76, 0.15)',
 fill: true,
 tension: 0.4,
 pointRadius: 3,
 pointHoverRadius: 5,
 pointBackgroundColor: '#e8b64c',
 borderWidth: 2
 }]
 },
 options: {
 responsive: true,
 maintainAspectRatio: false,
 interaction: { mode: 'nearest', intersect: false },
 plugins: { 
 legend: { display: false }, 
 tooltip: {
  enabled: true,
  backgroundColor: '#232838',
  titleColor: '#e8eaf0',
  bodyColor: '#e8eaf0',
  titleFont: { size: 11, weight: '600' },
  bodyFont: { size: 10.5 },
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
 });
 } catch(e) {
 console.warn('Chart error:', e);
 }
}

function txnRowHTML(e, showEdit){
 const editBtn = showEdit ? `<div style="cursor:pointer;color:#e8b64c;font-size:13px;margin-left:8px;" onclick="openEditModal('${e.id}')"><i class="ti ti-edit"></i></div>` : "";
 const imgBtn = e.image ? `<div style="cursor:pointer;color:#8b9099;font-size:13px;margin-left:8px;" onclick="viewEntryImage('${e.image}')"><i class="ti ti-camera"></i></div>` : "";
 const partyIcon = getPartyIcon(e.party);
 return `
 <div class="txn">
 <div class="txn-icon" style="background:#60a5fa22;color:#60a5fa;font-size:18px;">${partyIcon}</div>
 <div class="txn-info">
 <div class="name">${e.party || 'Unknown'}</div>
 <div class="cat">${e.method || ''}${e.notes ? ' • '+e.notes : ''}</div>
 </div>
 <div class="txn-right">
 <div class="amt ${e.type==='expense'?'neg':'pos'}">${fmtAmt(e)}</div>
 <div class="time">${e.time||''}</div>
 </div>
 ${imgBtn}
 ${editBtn}
 </div>`;
}

function renderEntries(){
 let list = entries.slice();
 if(currentFilter!=="all") list = list.filter(e=>e.type===currentFilter);
 const searchVal = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
 if(searchVal){
 list = list.filter(e=>
 (e.party||"").toLowerCase().includes(searchVal) ||
 (e.method||"").toLowerCase().includes(searchVal) ||
 (e.notes||"").toLowerCase().includes(searchVal)
 );
 }
 if(dateRangeFilter){
 list = list.filter(e=>{
 const d = normalizeDate(e.date);
 return d >= dateRangeFilter.from && d <= dateRangeFilter.to;
 });
 }
 updatePartyTotalBar(list, searchVal);
 if(list.length===0){
 document.getElementById("entriesContainer").innerHTML = '<div class="empty-state"><i class="ti ti-receipt-off"></i><br>No entries found</div>';
 return;
 }
 const groups = {};
 list.forEach(e=>{ (groups[e.date] = groups[e.date]||[]).push(e); });
 const dates = Object.keys(groups).sort((a,b)=> new Date(b)-new Date(a));
 let html="";
 dates.forEach(d=>{
 html += `<div class="date-divider">${fmtDateLabel(d)}</div><div class="txn-list">`;
 html += groups[d].map(e=>txnRowHTML(e,true)).join("");
 html += `</div>`;
 });
 document.getElementById("entriesContainer").innerHTML = html;
}

// ===== PARTY TOTAL BAR =====
// Jab search box mein kisi ek party ka naam search ho, entries list ke end mein
// us party ka "Total Dena" (expense) aur "Total Lena" (income) ka total dikhata hai.
// Agar search khaali ho ya multiple alag parties match ho rahi ho, toh bar hide ho jaata hai.
function updatePartyTotalBar(list, searchVal){
 const bar = document.getElementById("partyTotalBar");
 if(!bar) return;
 if(!searchVal){ bar.style.display = "none"; return; }

 const uniqueParties = [...new Set(list.map(e => (e.party||"Unknown").trim()).filter(Boolean))];
 const matchedParty = uniqueParties.length === 1 ? uniqueParties[0] : null;

 if(!matchedParty || !matchedParty.toLowerCase().includes(searchVal)){
 bar.style.display = "none";
 return;
 }

 let totalGive = 0, totalTake = 0;
 list.forEach(e=>{
 if(e.type === "expense") totalGive += Number(e.amount||0);
 else if(e.type === "income") totalTake += Number(e.amount||0);
 });

 document.getElementById("ptbPartyName").textContent = matchedParty;
 document.getElementById("ptbGiveAmt").textContent = "₹" + totalGive.toLocaleString("en-IN");
 document.getElementById("ptbTakeAmt").textContent = "₹" + totalTake.toLocaleString("en-IN");

 const msgEl = document.getElementById("ptbStatusMsg");
 if(msgEl){
  const diff = totalGive - totalTake;
  msgEl.classList.remove("status-settled","status-pay","status-receive");
  if(diff === 0){
   msgEl.textContent = "Everything is paid.";
   msgEl.classList.add("status-settled");
  } else if(diff > 0){
   // totalGive (To Pay) is higher, totalTake (To Receive) is lower
   msgEl.textContent = "Have to receive this amount... ₹" + diff.toLocaleString("en-IN");
   msgEl.classList.add("status-receive");
  } else {
   // totalGive (To Pay) is lower, totalTake (To Receive) is higher
   msgEl.textContent = "Have to pay this amount... ₹" + Math.abs(diff).toLocaleString("en-IN");
   msgEl.classList.add("status-pay");
  }
 }

 bar.style.display = "block";
}

let dateRangeFilter = null;

function toggleCalendarPanel(){
 const panel = document.getElementById("calendarPanel");
 panel.style.display = panel.style.display === "none" ? "block" : "none";
}

function applyDateRangeFilter(){
 const from = document.getElementById("dateFrom").value;
 const to = document.getElementById("dateTo").value;
 if(!from || !to){ alert("Please select both dates"); return; }
 dateRangeFilter = { from, to };
 document.getElementById("calendarFilterBtn").classList.add("active-filter");
 document.getElementById("calendarPanel").style.display = "none";
 renderEntries();
}

function clearDateRangeFilter(){
 dateRangeFilter = null;
 document.getElementById("dateFrom").value = "";
 document.getElementById("dateTo").value = "";
 document.getElementById("calendarFilterBtn").classList.remove("active-filter");
 document.getElementById("calendarPanel").style.display = "none";
 renderEntries();
}

document.addEventListener("click", function(e){
 const panel = document.getElementById("calendarPanel");
 const btn = document.getElementById("calendarFilterBtn");
 if(panel && btn && panel.style.display !== "none" && !panel.contains(e.target) && !btn.contains(e.target)){
 panel.style.display = "none";
 }
});
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

function viewEntryImage(url) {
 if (!url) return;
 const overlay = document.createElement('div');
 overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
 overlay.onclick = () => overlay.remove();
 overlay.innerHTML = `<img src="${url}" style="max-width:100%;max-height:100%;border-radius:12px;">`;
 document.body.appendChild(overlay);
}

async function saveEntry(evt){
 // LOCK — prevent duplicate saves on double-tap
 if (isSaving) return;
 isSaving = true;

 const btn = evt.target.closest('.save-btn');
 btn.disabled = true;
 btn.textContent = 'Saving...';

 const amt = parseFloat(document.getElementById("hiddenAmountInput").value || 0);
 const party = document.getElementById("partySel").value;
 const method = document.getElementById("paymentSel").value;
 const notes = document.getElementById("notesInput").value;

 if (!amt) {
  alert("Enter amount");
  btn.disabled = false; btn.textContent = 'Save Entry'; isSaving = false; return;
 }
 if (!party) {
  alert("Please select a party");
  btn.disabled = false; btn.textContent = 'Save Entry'; isSaving = false; return;
 }

 const date = document.getElementById("dateInput").value || getLocalDateStr();

 const entryData = {
  id: 'e_' + Date.now(),
  party: party,
  method: method,
  amount: parseFloat(amt),
  type: entryType,
  date: date,
  time: new Date().toLocaleTimeString("en-IN", {hour:'2-digit', minute:'2-digit'}),
  notes: notes,
  timestamp: new Date().toISOString(),
  image: pendingEntryImage || null,
  userId: (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null
 };

 // Add to memory ONCE
 entries.unshift(entryData);
 // Save to localStorage
 localStorage.setItem('entries', JSON.stringify(entries));
 // Keep any Goal whose name matches this Party Name in sync
 if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();

 // Reset form + navigate immediately — the local save above is instant,
 // so the UI must never wait on the network. (BUGFIX: this used to `await`
 // the Firebase write before resetting/navigating, so a slow or offline
 // connection left the button stuck on "Saving..." and the old values
 // sitting in the form forever, even though the entry actually saved.)
 document.getElementById("hiddenAmountInput").value = "";
 document.getElementById("amountDisplay").textContent = "0.00";
 document.getElementById("partySel").value = "";
 document.getElementById("notesInput").value = "";
 document.getElementById("dateInput").value = getLocalDateStr();
 updateDateLabel(document.getElementById("dateInput").value);
 removeEntryImage();

 // Re-render from memory (no reload)
 renderWallet();
 renderEntries();
 renderAnalytics();
 goTo('entries');
 setEntryFilter('all');
 showNotification('Entry saved ✓', 'success');
 if (typeof renderList === "function") renderList(); // keep Goals tab live if entries change

 // Unlock right away — local save already succeeded, no need to wait.
 btn.disabled = false;
 btn.textContent = 'Save Entry';
 isSaving = false;

 // Sync to Firebase in the background (non-blocking, fire-and-forget) —
 // same pattern as updateEntry(); never blocks the UI above.
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
 const stored = localStorage.getItem('geminiApiKeyEnc');
 if (!stored) return '';
 return _aiKeyDeobfuscate(stored).trim();
}
function setGeminiKey(k){
 if (k && k.trim()) localStorage.setItem('geminiApiKeyEnc', _aiKeyObfuscate(k.trim()));
 else localStorage.removeItem('geminiApiKeyEnc');
 // Purana plaintext format (agar pehle se bacha ho) hamesha ke liye hata do
 localStorage.removeItem('geminiApiKey');
}

// prompt bhejta hai, JSON mode me structured response maangta hai (schema
// diya ho to usi shape me), aur parsed JS object/array/value wapas karta
// hai. Agar key hi na ho to turant null (koi network call nahi).
//
// MODEL NOTE: "gemini-flash-lite-latest" ek Google ka official ALIAS hai
// (hardcoded version number jaisa "gemini-2.0-flash" nahi) — ye hamesha
// khud-ba-khud current/latest Flash-Lite model ki taraf point karta rehta
// hai. Pehle yahan "gemini-2.0-flash" tha jo Google ne deprecate kar diya
// (isiliye "quota limit: 0" error aa raha tha) — alias use karne se ab
// aisa dobara nahi hoga, Google jab bhi model retire/upgrade karega, alias
// khud naye model par shift ho jaayega. Fir bhi, agar kabhi Google is
// alias ko bhi hata de, neeche ek fallback model try hota hai — taaki
// dono AI features ek hi jagah break na ho.
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest"];

async function _geminiRawFetch(body, signal){
 const apiKey = getGeminiKey();
 if (!apiKey) return null;
 let lastErr = null;
 for (const model of GEMINI_MODELS) {
  try {
   const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body), signal }
   );
   if (!resp.ok) {
    let msg = "AI request failed (" + resp.status + ")";
    try { const errBody = await resp.json(); if (errBody?.error?.message) msg = errBody.error.message; } catch(e){}
    lastErr = new Error(msg);
    continue; // try next model in the fallback list
   }
   const data = await resp.json();
   const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
   if (!textOut) { lastErr = new Error("AI se koi jawab nahi mila"); continue; }
   return textOut;
  } catch (err) {
   lastErr = err;
   if (err && err.name === 'AbortError') break; // user ne cancel kiya — dusra model try mat karo
  }
 }
 throw lastErr || new Error("AI request failed");
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
 return JSON.parse(textOut);
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
 const masked = currentKey ? (currentKey.slice(0,4) + '••••••••' + currentKey.slice(-4)) : '';
 const html = `
 <div class="modal-bg active" id="aiSettingsModal">
  <div class="modal" style="max-width:380px;">
   <div class="modal-header">
    <h3 style="font-size:16px;"><i class="ti ti-sparkles"></i> AI Voice Parsing (Free)</h3>
    <button class="modal-close" onclick="document.getElementById('aiSettingsModal').remove()">&times;</button>
   </div>
   <div class="modal-body">
    <div style="font-size:12.5px;color:#8b9099;line-height:1.6;margin-bottom:12px;">
     This uses Google's Gemini AI — to understand voice entries and for 'chat with balance'. Your own <b>free</b> API key chahiye (credit card nahi lagta). Free key 1 minute me yahan se milti hai:
     <br><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:#e8b64c;">aistudio.google.com/apikey →</a>
    </div>
    ${currentKey ? `<div style="font-size:12px;color:#3ddc84;margin-bottom:10px;">✅ Key connected: ${masked}</div>` : `<div style="font-size:12px;color:#f0a860;margin-bottom:10px;">⚠️ Abhi koi key nahi daali hai — AI features off rahenge, app normal (local) parsing use karta rahega.</div>`}
    <div style="position:relative;margin-bottom:10px;">
     <input id="aiKeyInput" type="password" placeholder="Paste Gemini API key here" value="" autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:11px 40px 11px 12px;border-radius:10px;border:1px solid #232838;background:#0d1117;color:#e8eaf0;font-size:13.5px;font-family:monospace;">
     <i class="ti ti-eye" id="aiKeyToggleIcon" onclick="toggleAiKeyVisibility()" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#8b9099;cursor:pointer;font-size:16px;"></i>
    </div>
    <div style="font-size:11px;color:#6b7280;margin-bottom:10px;line-height:1.5;">🔒 This key is never saved in this repository — it is only stored in your local browser (mildly obfuscated).</div>
    <div style="display:flex;gap:8px;">
     <button onclick="saveAiSettingsKey()" style="flex:1;padding:11px 0;border:none;border-radius:10px;background:linear-gradient(135deg,#f0c060,#e8b64c);color:#1a1305;font-weight:700;font-size:13.5px;cursor:pointer;">Save Key</button>
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
function saveAiSettingsKey(){
 const val = document.getElementById('aiKeyInput').value.trim();
 const msgEl = document.getElementById('aiSettingsMsg');
 if (!val) { msgEl.textContent = "Pehle key paste karo."; msgEl.style.color = "#f06464"; return; }
 setGeminiKey(val);
 msgEl.textContent = "✅ Saved! AI features ab on hain.";
 msgEl.style.color = "#3ddc84";
 setTimeout(() => { const m = document.getElementById('aiSettingsModal'); if (m) m.remove(); }, 900);
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
 if (!window.isSecureContext) {
  statusEl.textContent = "⚠️ Voice sirf HTTPS pe chalta hai (file:// ya http:// pe nahi). App ko https:// se kholo.";
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
function parseVoiceToQuickAddLine(said){
 const raw = said.trim();
 const lower = raw.toLowerCase();

 const amtMatch = raw.match(/(\d+(\.\d+)?)/);
 const amount = amtMatch ? amtMatch[1] : "";

 let method = "Cash";
 if (/\b(upi|opi|o\.p\.i|u\.p\.i|yupi|you\s*pee\s*eye|gpay|phonepe|paytm|bhim)\b/i.test(lower)) method = "UPI";
 else if (/\b(bank|online|neft|imps|transfer|account)\b/i.test(lower)) method = "Bank";
 else if (/\b(cash|nakad|nakd)\b/i.test(lower)) method = "Cash";

 // "recd/received/mila/mile" -> paisa aaya (income); "pay/paid/diye/de diye" -> paisa gaya (expense)
 if (/\b(recd|received|mila|mile|receive)\b/.test(lower)) quickAddVoiceType = "income";
 else if (/\b(pay|paid|diye|de diye|dede|kharch)\b/.test(lower)) quickAddVoiceType = "expense";
 else quickAddVoiceType = null;

 // Amount aur jaane-pehchane filler/keyword words hata ke jo bacha usme se
 // pehla shabd hi party ka naam hone ka best guess hai.
 let stripped = raw
  .replace(amtMatch ? amtMatch[0] : "", "")
  .replace(/₹|rs\.?|rupaye|rupees/gi, "")
  .replace(/\b(cash|upi|opi|bank|online|ke|liye|diye|de|do|pay|paid|recd|received|mila|mile|kiye|kiya|kar|karo|hai|the|ka|ki|ko|se|aur|and|for)\b/gi, "")
  .trim();
 const partyGuess = stripped.split(/\s+/).filter(Boolean)[0] || "";
 const matchedParty = matchPartyName(partyGuess) || partyGuess;

 // Notes extraction: sirf DO trigger words — "se" aur "for"
 let notes = "";
 let noteMatch = raw.match(/\bse\b\s+(.+)$/i);
 if (noteMatch) {
  notes = noteMatch[1].trim();
 } else {
  noteMatch = raw.match(/\bfor\b\s+(.+)$/i);
  if (noteMatch) notes = noteMatch[1].trim();
 }

 return `${amount},${matchedParty},,${method},${notes || raw}`;
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
  if (!auto) statusEl.textContent = "Pehle kuch bolo ya likho, phir AI se try karo.";
  return;
 }

 const sel = document.getElementById('partySel');
 const partyNames = sel ? Array.from(sel.options).map(o => o.value).filter(Boolean) : [];
 const prevBtnHtml = btn ? btn.innerHTML : '';
 if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> AI samajh raha hai...'; }
 if (auto) statusEl.textContent = "✨ AI se entry process ho rahi hai...";

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
   - party: existing party names se match kare to exact wahi do: ${JSON.stringify(partyNames)}
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
   const answer = (result.answer || "Maaf karo, jawaab nahi mil paya.").trim();
   document.getElementById('qaLine').value = "";
   statusEl.textContent = `💬 ${answer}`;
   if (stateTextEl) { stateTextEl.textContent = "🔊 AI bol raha hai..."; stateTextEl.style.color = "#a855f7"; }
   speakText(answer, () => {
    if (stateTextEl) { stateTextEl.textContent = "AI Mic band hai — entry bolo ya sawaal poochho"; stateTextEl.style.color = "#888"; }
   });
   return;
  }

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
function speakText(text, onEnd){
 try {
  if (!text || !('speechSynthesis' in window)) { if (onEnd) onEnd(); return; }
  window.speechSynthesis.cancel(); // pichli koi speech chal rahi ho to rok do
  let clean = String(text || '').trim();
  // Strip introductory filler words like "Maine samjha", "Mene samjha", "Theek hai", "Samajh gaya"
  clean = clean.replace(/^(maine\s+samjha|mene\s+samjha|mai\s+samajh\s+gaya|main\s+samajh\s+gaya|samajh\s+gaya|theek\s+hai|ji\s+samajh\s+gaya|chaliye\s+batata\s+hoon)[\s,:\.\-–—]*/i, '');
  // Fix Hindi TTS pronunciation of UPI so it doesn't sound like "opi" / "upi"
  clean = clean.replace(/\bUPI\b/gi, 'यू पी आई');
  clean = clean.replace(/₹\s*(\d+)/g, '$1 rupaye');
  clean = clean.trim();
  if (!clean) { if (onEnd) onEnd(); return; }

  const utter = new SpeechSynthesisUtterance(clean);
  const hv = _pickHindiVoice();
  utter.lang = hv ? hv.lang : 'hi-IN';
  if (hv) utter.voice = hv;
  utter.rate = 1.05;
  utter.pitch = 1;
  let done = false;
  const finish = () => { if (!done) { done = true; if (onEnd) onEnd(); } };
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

   function animate(){
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
   animate();
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
 if (!getGeminiKey()) { openAiSettingsModal(); return; }
 aiMicKeepListening = false;
 startAiMicRecording();
}
function closeAiVoiceFullscreen(){
 const overlay = document.getElementById('aiVoiceFullscreen');
 if (overlay) overlay.classList.remove('active');
 qaUserStopped = true;
 if (aiMicRecorder && aiMicRecorder.state === 'recording') { try { aiMicRecorder.stop(); } catch(e){} }
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
 try { if (aiMicRecorder && aiMicRecorder.state === 'recording') aiMicRecorder.stop(); } catch(e){}
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAiVoiceEverything(); });
window.addEventListener('pagehide', stopAiVoiceEverything);

let aiMicRecorder = null;
let aiMicChunks = [];
let aiMicActive = false;
// Cross (X) button ka istemaal karte hue in-flight Gemini request ko
// cancel karne ke liye — taaki band karne ke baad bhi background me
// response na aaye ya AI bolna shuru na kar de.
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
 const notes = (rawNotes || "").trim();
 if (notes) return notes; // AI ne diya hai, jaisa hai waisa use karo — koi truncation nahi

 const t = (transcript || "").trim();
 let m = t.match(/\bse\b\s+(.+)$/i);
 if (m) return m[1].trim();
 m = t.match(/\bfor\b\s+(.+)$/i);
 if (m) return m[1].trim();
 return "";
}

// AI kabhi-kabhi method "upi"/"bank" chhote letters me ya extra space ke
// saath bhejta hai — plain .includes() check case-sensitive hone ki wajah
// se aisa response chup-chaap "Cash" pe fallback ho jaata tha (bug: user
// UPI bole aur Cash save ho jaaye). Ab case/whitespace normalize karke
// match karte hain taaki asli method hi save ho.
function normalizeVoiceMethod(rawMethod){
 const m = String(rawMethod || "").trim().toLowerCase();
 if (m === "upi") return "UPI";
 if (m === "bank") return "Bank";
 if (m === "cash") return "Cash";
 return "Cash"; // sach me kuch bola hi nahi gaya ho tabhi ye default lagta hai
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
 if (!entries || entries.length === 0) {
  return "Koi entry hai hi nahi jise delete/edit kiya jaaye.";
 }
 const target = entries[0]; // sabse recent entry

 if (result.actionType === "delete_last_entry") {
  try { if (typeof saveToDeletedHistory === 'function') saveToDeletedHistory(target); } catch(e){}
  entries = entries.filter(e => e !== target);
  localStorage.setItem('entries', JSON.stringify(entries));
  try { renderWallet(); } catch(e){}
  try { renderEntries(); } catch(e){}
  try { renderAnalytics(); } catch(e){}
  try { if (typeof renderList === 'function') renderList(); } catch(e){}
  if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof db !== 'undefined' && db) {
   setTimeout(() => { db.collection("entries").doc(String(target.id)).delete().catch(()=>{}); }, 50);
  }
  return (result.answer && result.answer.trim()) || `Aakhri entry (₹${Number(target.amount)||0}, ${target.party||'Unknown'}) delete kar di gayi.`;
 }

 if (result.actionType === "update_last_entry") {
  if (result.amount !== undefined && result.amount !== null && !isNaN(result.amount) && result.amount !== 0) target.amount = Number(result.amount);
  if (result.party) target.party = matchPartyName(result.party) || result.party;
  if (result.method) target.method = detectMethodFromTranscript(result.transcript) || normalizeVoiceMethod(result.method);
  if (result.type === "income" || result.type === "expense") target.type = result.type;
  if (result.notes !== undefined && result.notes !== null && result.notes !== "") target.notes = result.notes;
  const idx = entries.findIndex(e => String(e.id) === String(target.id));
  if (idx > -1) entries[idx] = target;
  localStorage.setItem('entries', JSON.stringify(entries));
  try { renderWallet(); } catch(e){}
  try { renderEntries(); } catch(e){}
  try { renderAnalytics(); } catch(e){}
  if (typeof firebaseReady !== 'undefined' && firebaseReady && typeof db !== 'undefined' && db) {
   setTimeout(() => { db.collection("entries").doc(String(target.id)).set(target).catch(()=>{}); }, 50);
  }
  return (result.answer && result.answer.trim()) || `Aakhri entry update kar di gayi: ₹${Number(target.amount)||0} · ${target.party||'Unknown'}.`;
 }

 return "Samajh nahi paaya kaunsa action karna hai.";
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
   actionType: { type: "STRING", enum: ["delete_last_entry", "update_last_entry"] }
  },
  required: ["intent", "transcript"]
 };
 const promptText = `Tum ek Hindi/Hinglish personal-finance app ("DayToDay") ke andar voice assistant ho. Attached audio clip suno — user Hindi/Hinglish me bol raha hai.

User teen tarah ki cheezein bol sakta hai — pehle decide karo "intent" kya hai:

1) TRANSACTION — user ek expense/income entry bata raha hai:
   - transcript: jo bola gaya uska Roman/Hinglish text.
   - amount: number (sirf digits).
   - party: naam. Agar existing party names (${JSON.stringify(partyNames)}) se close match kare to exact wahi naam use karo.
   - date: agar user ne koi specific din/date bola ho (jaise "kal", "parso", "yesterday", "15 august", "10 tarikh", "2 din pehle"), to calculated exact YYYY-MM-DD format me date do. Aaj ki date hai: "${todayStr}". Agar koi date na boli ho to "${todayStr}" do.
   - method: audio me DHYAN SE suno — agar "UPI", "opi", "u-p-i", "yupi", "GPay", "PhonePe", "Paytm" jaisa bola ho to "UPI" do aur transcript me "UPI" likho; agar "bank", "transfer", "account se" bola ho to "Bank" do; agar "cash"/"nakad" bola ho YA method na bola gaya ho to "Cash" do.
   - type: "expense" (diye/pay kiya/kharch) ya "income" (mila/receive hua/aaye).
   - notes: sirf DO trigger words hain — "se" aur "for". Jo bhi in shabdon ke baad ka remainder text hai wahi notes me daalo. Dono na ho to notes "" do.

2) QUESTION — user balance, party info, analysis, recent entries, savings goals/targets poochh raha hai:
   - transcript: jo sawaal poocha gaya.
   - answer: SEEDHA aur SIRF asli jawaab do — KABHI bhi "Maine samjha", "Mene samjha", "Theek hai", "Samajh gaya", "Chaliye batata hoon" mat likho. Pehle hi shabd se direct fact/number/answer shuru karo. NEECHE diye REAL DATA ke base par chhota jawaab (2-4 lines).

3) ACTION — user apni pichli entry delete ya edit karne ko bol raha hai:
   - actionType: "delete_last_entry" ya "update_last_entry".
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
    { inline_data: { mime_type: mimeType, data: base64Audio } }
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
 return JSON.parse(textOut);
}

let aiMicKeepListening = false; // true = question ka jawaab milne ke baad mic khud-ba-khud dobara sunna shuru kar dega (dobara tap nahi karna padega)

async function toggleAiMic(){
 initAiOrb(); // pehli baar tap hote hi lazily set ho jaata hai (harmless agar dobara call ho)

// Pleasant futuristic tone feedback on mic start and stop
function playMicFeedbackSound(type){
 try {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === 'start') {
   // Soft ascending chime: 520Hz -> 780Hz
   osc.type = 'sine';
   osc.frequency.setValueAtTime(520, now);
   osc.frequency.exponentialRampToValueAtTime(780, now + 0.12);
   gain.gain.setValueAtTime(0.09, now);
   gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
   osc.start(now);
   osc.stop(now + 0.22);
   if (navigator.vibrate) navigator.vibrate(40);
  } else if (type === 'stop') {
   // Soft descending chime: 660Hz -> 440Hz
   osc.type = 'sine';
   osc.frequency.setValueAtTime(660, now);
   osc.frequency.exponentialRampToValueAtTime(440, now + 0.14);
   gain.gain.setValueAtTime(0.09, now);
   gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
   osc.start(now);
   osc.stop(now + 0.24);
   if (navigator.vibrate) navigator.vibrate(30);
  }
  setTimeout(() => { try { ctx.close(); } catch(e){} }, 350);
 } catch(e){}
}

let aiMicKeepListening = false;

async function toggleAiMic(){
 if (!getGeminiKey()) { openAiSettingsModal(); return; }

 if (window.speechSynthesis && window.speechSynthesis.speaking) {
  try { window.speechSynthesis.cancel(); } catch(e){}
  aiMicKeepListening = false;
  setAiOrbState('idle');
  setAivState('idle');
  return;
 }

 if (aiMicActive && aiMicRecorder && aiMicRecorder.state === 'recording') {
  playMicFeedbackSound('stop');
  aiMicRecorder.stop();
  return;
 }

 aiMicKeepListening = false;
 await startAiMicRecording();
}

async function startAiMicRecording(){
 const statusEl = document.getElementById('qaVoiceStatus');
 const captionEl = document.getElementById('qaLiveCaption');
 const btn = document.getElementById('qaAiMicBtn');
 const haloEl = document.getElementById('qaAiMicHalo');
 const stateDotEl = document.getElementById('qaMicStateDot');
 const stateTextEl = document.getElementById('qaMicStateText');

 if (!window.isSecureContext) {
  statusEl.textContent = "⚠️ Voice sirf HTTPS pe chalta hai (file:// ya http:// pe nahi).";
  setAivCaption("⚠️ Voice sirf HTTPS pe chalta hai.");
  return;
 }
 if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
  statusEl.textContent = "⚠️ Ye browser audio recording support nahi karta.";
  setAivCaption("⚠️ Ye browser audio recording support nahi karta.");
  return;
 }

 try {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
  aiMicRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  aiMicChunks = [];
  aiMicActive = true;

  captionEl.value = "";
  document.getElementById('qaLine').value = "";
  btn.classList.add('qa-listening');
  btn.style.transform = "scale(1.08)";
  if (haloEl) haloEl.classList.add('listening');
  setAiOrbState('listening');
  setAivState('listening');
  setAivCaption("Bolo — jaise ruko, khud process ho jaayega");
  if (stateDotEl) stateDotEl.classList.add('on');
  if (stateTextEl) { stateTextEl.textContent = "🔴 AI Mic ON — bolo..."; stateTextEl.style.color = "#a855f7"; }
  statusEl.textContent = "🔴 Sun raha hoon... bolna khatam karte hi khud process ho jaayega.";

  aiMicRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) aiMicChunks.push(e.data); };

  setupAiMicAutoStop(stream, aiMicRecorder);

  aiMicRecorder.onstop = async () => {
   aiMicActive = false;
   playMicFeedbackSound('stop');
   try { stream.getTracks().forEach(t => t.stop()); } catch(e){}
   btn.classList.remove('qa-listening');
   btn.style.transform = "scale(1)";
   if (haloEl) haloEl.classList.remove('listening');
   if (stateDotEl) stateDotEl.classList.remove('on');

   if (!hasSpoken || aiMicChunks.length === 0) {
    setAiOrbState('idle');
    setAivState('idle');
    setAivCaption("Kuch bola nahi gaya — mic dabao aur bolo.");
    if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak."; stateTextEl.style.color = "#888"; }
    statusEl.textContent = "Kuch bola nahi gaya — mic dabao aur bolo.";
    btn.disabled = false;
    return;
   }

   const blob = new Blob(aiMicChunks, { type: (aiMicRecorder && aiMicRecorder.mimeType) || mimeType || 'audio/webm' });
   setAiOrbState('thinking');
   setAivState('thinking');
   setAivCaption("Thinking...");
   if (stateTextEl) { stateTextEl.textContent = "✨ AI is thinking..."; stateTextEl.style.color = "#a855f7"; }
   statusEl.textContent = "✨ AI is thinking...";
   btn.disabled = true;

   try {
    let base64Audio, mimeForApi;
    try {
     base64Audio = await blobToWavBase64(blob);
     mimeForApi = 'audio/wav';
    } catch (convErr) {
     base64Audio = await blobToBase64(blob);
     mimeForApi = blob.type ? blob.type.split(';')[0] : 'audio/webm';
    }
    const result = await aiMicToEntry(base64Audio, mimeForApi);

    if (!document.getElementById('aiVoiceFullscreen')?.classList.contains('active')) {
     btn.disabled = false;
     return;
    }

    if (!result || result.intent === "none" || (!result.transcript && !result.amount && !result.answer)) {
     setAiOrbState('idle');
     setAivState('idle');
     setAivCaption("Kuch clear nahi suna — mic dabao aur bolo.");
     if (stateTextEl) { stateTextEl.textContent = "AI Mic is off — tap to speak."; stateTextEl.style.color = "#888"; }
     statusEl.textContent = "Kuch clear nahi suna — mic dabao aur bolo.";
     btn.disabled = false;
     return;
    }

    if (result.intent === "question") {
     aiMicKeepListening = false;
     const askedText = result.transcript || "";
     const answer = (result.answer || "Maaf karo, jawaab nahi mil paya.").trim();
     captionEl.value = askedText;
     statusEl.textContent = `💬 ${answer}`;
     setAiOrbState('speaking');
     setAivState('speaking');
     setAivCaption(answer);
     if (stateTextEl) { stateTextEl.textContent = "🔊 speaking..."; stateTextEl.style.color = "#a855f7"; }
     speakText(answer, () => {
      setAiOrbState('idle');
      setAivState('idle');
      setAivCaption("Agla sawaal poocho, ya entry bolo...");
      if (stateTextEl) { stateTextEl.textContent = "AI Mic band hai — tap to speak"; stateTextEl.style.color = "#888"; }
     });
     btn.disabled = false;
     return;
    }

    if (result.intent === "action") {
     aiMicKeepListening = false;
     const askedText = result.transcript || "";
     let answer;
     try {
      answer = performAiVoiceAction(result);
     } catch(actionErr) {
      answer = "Sorry, ye action complete nahi ho paaya — " + (actionErr && actionErr.message ? actionErr.message : "kuch gadbad ho gayi.");
     }
     captionEl.value = askedText;
     statusEl.textContent = `💬 ${answer}`;
     setAiOrbState('speaking');
     setAivState('speaking');
     setAivCaption(answer);
     if (stateTextEl) { stateTextEl.textContent = "🔊 speaking..."; stateTextEl.style.color = "#a855f7"; }
     speakText(answer, () => {
      setAiOrbState('idle');
      setAivState('idle');
      setAivCaption("Agla sawaal poocho, ya entry bolo...");
      if (stateTextEl) { stateTextEl.textContent = "AI Mic band hai — tap to speak"; stateTextEl.style.color = "#888"; }
     });
     btn.disabled = false;
     return;
    }

    const rawPartyMatch = matchPartyName(result.party);
    const matchedParty = rawPartyMatch || result.party || "";
    const amount = Number(result.amount) || "";
    const transcript = result.transcript || "";
    const entryDate = quickAddParseDate(result.date) || getLocalDateStr();
    const method = detectMethodFromTranscript(transcript) || normalizeVoiceMethod(result.method);
    if (result.type === "income" || result.type === "expense") quickAddVoiceType = result.type;
    const cleanNotes = sanitizeVoiceNotes(result.notes, transcript);

    captionEl.value = transcript;
    document.getElementById('qaLine').value = `${amount},${matchedParty},${entryDate},${method},${cleanNotes}`;

    const typeWord = (quickAddVoiceType === "income") ? "receive hua" : "payment kiya";
    const noteSpeak = cleanNotes ? ` Note: ${cleanNotes}.` : "";

    if (amount && rawPartyMatch) {
     const summaryLine = `₹${amount} · ${matchedParty} · ${method} · ${entryDate}${cleanNotes ? ' · ' + cleanNotes : ''}`;
     statusEl.textContent = `✨ Entry: ${summaryLine} — Saving...`;
     setAiOrbState('speaking');
     setAivState('speaking');
     setAivCaption(summaryLine + " — saving...");
     if (stateTextEl) { stateTextEl.textContent = "🔊 AI bol raha hai..."; stateTextEl.style.color = "#a855f7"; }
     const speakLine = `${amount} rupaye, ${matchedParty} (${method}, ${typeWord}).${noteSpeak} Entry save kar raha hoon.`;
     speakText(speakLine, () => {
      submitQuickAdd();
      setAiOrbState('idle');
      setAivState('idle');
      setAivCaption("Say an entry, or ask a question");
      if (stateTextEl) { stateTextEl.textContent = "Mic is off — tap and speak."; stateTextEl.style.color = "#888"; }
     });
    } else {
     const summaryLine = `₹${amount || '?'} · ${matchedParty || '(party set nahi)'} · ${method} · ${entryDate}${cleanNotes ? ' · ' + cleanNotes : ''}`;
     statusEl.textContent = `✨ Entry: ${summaryLine} — theek hai to Confirm dabao`;
     setAiOrbState('speaking');
     setAivState('speaking');
     setAivCaption("Check karke Confirm karo — " + summaryLine);
     if (stateTextEl) { stateTextEl.textContent = "🔊 AI bol raha hai..."; stateTextEl.style.color = "#a855f7"; }
     const speakLine = `${amount ? ('₹' + amount) : 'Amount'} aur party check karke Confirm dabao.`;
     speakText(speakLine, () => {
      setAiOrbState('idle');
      setAivState('idle');
      if (stateTextEl) { stateTextEl.textContent = "AI Mic band hai — dabao aur bolo"; stateTextEl.style.color = "#888"; }
     });
    }
   } catch (err) {
    setAiOrbState('idle');
    setAivState('idle');
    setAivCaption("⚠️ AI se nahi ho paya: " + err.message);
    statusEl.textContent = "⚠️ AI se nahi ho paya: " + err.message + " — backup mic try karo.";
    speakText("Maaf karo, samajh nahi paya. Dobara try karo.");
   } finally {
    btn.disabled = false;
   }
  };

  aiMicRecorder.start();
  playMicFeedbackSound('start');
 } catch (err) {
  setAiOrbState('idle');
  setAivState('idle');
  setAivCaption("⚠️ Mic access nahi mila: " + (err.message || err));
  statusEl.textContent = "⚠️ Mic access nahi mila: " + (err.message || err);
 }
}

// VAD: audio volume ko monitor karta hai (750ms silence detection + 18 RMS threshold)
function setupAiMicAutoStop(stream, recorder){
 try {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const audioCtx = new AudioCtx();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  const SPEECH_THRESHOLD = 18;      // increased threshold to prevent ambient noise triggers
  const SILENCE_MS_TO_STOP = 750;   // 750ms for snappy instant trigger
  const MAX_RECORD_MS = 25000;
  let hasSpoken = false;
  let silenceStart = null;
  const startedAt = Date.now();
  let closed = false;
  const cleanup = () => { if (closed) return; closed = true; try { audioCtx.close(); } catch(e){} };

  const tick = () => {
   if (recorder.state !== 'recording') { cleanup(); return; }
   analyser.getByteTimeDomainData(data);
   let sum = 0;
   for (let i = 0; i < data.length; i++) { const v = data[i] - 128; sum += v * v; }
   const rms = Math.sqrt(sum / data.length);

   if (rms > SPEECH_THRESHOLD) {
    hasSpoken = true;
    silenceStart = null;
   } else if (hasSpoken) {
    if (silenceStart === null) silenceStart = Date.now();
    else if (Date.now() - silenceStart > SILENCE_MS_TO_STOP) {
     cleanup();
     try { recorder.stop(); } catch(e){}
     return;
    }
   }

   if (Date.now() - startedAt > MAX_RECORD_MS) {
    cleanup();
    try { recorder.stop(); } catch(e){}
    return;
   }

   requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
 } catch(e) {
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
 try { if (quickAddActiveRecognition) { quickAddActiveRecognition.abort(); quickAddActiveRecognition = null; } } catch(e){}
 try { if (aiMicRecorder && aiMicRecorder.state === 'recording') { aiMicRecorder.stop(); } } catch(e){}
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
function matchPartyName(input){
 if (!input) return null;
 const sel = document.getElementById("partySel");
 if (!sel) return null;
 const names = Array.from(sel.options).map(o => o.value).filter(v => v);
 if (names.length === 0) return null;
 const lower = input.trim().toLowerCase();

 let match = names.find(n => n.toLowerCase() === lower);
 if (match) return match;
 match = names.find(n => n.toLowerCase().startsWith(lower));
 if (match) return match;
 match = names.find(n => n.toLowerCase().includes(lower));
 if (match) return match;

 // Closest-spelling match (handles typos/phonetic variants like mami/mummy)
 let best = null, bestDist = Infinity;
 names.forEach(n => {
  const d = levenshtein(lower, n.toLowerCase());
  if (d < bestDist) { bestDist = d; best = n; }
 });
 // Allow closer edits for short names — enough for typo/phonetic variants
 // like mami/mummy, but capped so unrelated names don't false-match.
 const longer = Math.max(lower.length, best ? best.length : 0);
 const threshold = Math.min(3, Math.ceil(longer * 0.5));
 if (best && bestDist <= threshold) return best;

 return null;
}

async function submitQuickAdd(){
 const line = document.getElementById("qaLine").value.trim();
 if (!line) { alert("Entry likho pehle"); return; }

 // Format: amount,party,date,method,notes  (date/method/notes optional)
 const parts = line.split(",").map(s => s.trim());
 const amt = parseFloat(parts[0] || 0);
 const typedParty = parts[1] || "";
 const party = matchPartyName(typedParty);
 const method = parts[3] || "Cash";
 const notes = parts.slice(4).join(",").trim();

 if (!amt) { alert("Sahi amount likho (pehla field)"); return; }
 if (!typedParty) { alert("Party name likho (dusra field)"); return; }
 if (!party) { alert(`"${typedParty}" tumhari party list me nahi mili. Sahi/nazdeeki naam likho.`); return; }

 const entryData = {
  id: 'e_' + Date.now(),
  party: party,
  method: method,
  amount: amt,
  type: quickAddVoiceType || entryType,
  date: quickAddParseDate(parts[2]),
  time: new Date().toLocaleTimeString("en-IN", {hour:'2-digit', minute:'2-digit'}),
  notes: notes,
  timestamp: new Date().toISOString(),
  image: null,
  userId: (currentUser && currentUser.uid) || localStorage.getItem('currentUserUid') || null
 };

 entries.unshift(entryData);
 localStorage.setItem('entries', JSON.stringify(entries));
 // Keep any Goal whose name matches this Party Name in sync
 if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();

 // Update UI immediately — same local-first fix as saveEntry(): the AI
 // Mic calls this right after speaking "Saving entry...", so if this stays
 // blocked on the network, the voice flow looks like it silently did
 // nothing even though the entry saved. Firebase now syncs in the
 // background instead.
 renderWallet();
 renderEntries();
 renderAnalytics();
 showNotification('Entry saved ✓', 'success');
 if (typeof renderList === "function") renderList();

 closeQuickAdd();

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
 document.getElementById("editPartySel").value = entry.party || "Self";
 document.getElementById("editAmountInput").value = entry.amount || "0.00";
 document.getElementById("editDateInput").value = entry.date;
 document.getElementById("editNotesInput").value = entry.notes || "";

 document.getElementById("editExpenseBtn").classList.toggle("active", editEntryType === "expense");
 document.getElementById("editIncomeBtn").classList.toggle("active", editEntryType === "income");

 document.getElementById("editModal").classList.add("active");
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

 if (!party) { alert("Please select a party"); return; }
 if (!amount) { alert("Enter amount"); return; }

 updateEntryInProgress = true;

 const updatedData = {
  id: entry.id,
  party: party,
  method: entry.method || 'Cash',
  amount: amount,
  type: type,
  date: date,
  time: entry.time || new Date().toLocaleTimeString("en-IN"),
  notes: notes,
  timestamp: new Date().toISOString(),
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
 showNotification('Entry updated ✓', 'success');
 updateEntryInProgress = false;

 // Sync to Firebase in the background (non-blocking, fire-and-forget)
 if (firebaseReady && db) {
  db.collection('entries').doc(String(entry.id)).set(updatedData)
   .catch(err => console.warn('Firebase update failed:', err));
 }
}

// ===== EDIT MODAL HELPERS =====

function setEditEntryType(t){
 editEntryType = t;
 document.getElementById("editExpenseBtn").classList.toggle("active", t==="expense");
 document.getElementById("editIncomeBtn").classList.toggle("active", t==="income");
}

async function deleteEntry(){
 if (!confirm("Are you sure you want to delete this entry?")) return;

 const entry = entries.find(e => String(e.id) === String(editingEntryId));
 if (!entry) { showNotification('Entry not found', 'error'); return; }

 // Save to deleted history before removing
 saveToDeletedHistory(entry);

 // INSTANT: Remove from memory and UI immediately
 entries = entries.filter(e => String(e.id) !== String(editingEntryId));
 localStorage.setItem('entries', JSON.stringify(entries));
 // Keep any linked Goal in sync now that this entry is gone
 if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();

 closeEditModal();
 renderWallet();
 renderEntries();
 renderAnalytics();
 if (typeof renderList === 'function') renderList(); // keep Goals tab live
 showNotification('Entry deleted ✓', 'success');

 // BACKGROUND: Delete from Firebase without blocking UI
 if (firebaseReady && db) {
  setTimeout(async () => {
   try {
    await db.collection("entries").doc(String(entry.id)).delete();
    console.log('✓ Entry deleted from Firebase:', entry.id);
   } catch(err) { console.warn('Firebase delete error (local already done):', err); }
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
 const partyEntries = entries.filter(e => (e.party||'Unknown') === partyName);
 let totalIncome = 0, totalExpense = 0;
 partyEntries.forEach(e=>{
 if(e.type==='income') totalIncome += Number(e.amount||0);
 else if(e.type==='expense') totalExpense += Number(e.amount||0);
 });

 const sorted = [...partyEntries].sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp));
 currentPartyDetailName = partyName;
 currentPartyDetailEntries = sorted;

 document.getElementById("partyDetailTitle").textContent = partyName;
 document.getElementById("partyDetailSummary").innerHTML = `
 <div style="display:flex;gap:10px;margin-bottom:14px;">
 <div style="flex:1;background:#1f2430;border-radius:10px;padding:10px;text-align:center;">
 <div style="font-size:11px;color:#8b9099;">Total Receive</div>
 <div style="font-size:16px;font-weight:700;color:#3ddc84;">₹${totalIncome.toLocaleString("en-IN")}</div>
 </div>
 <div style="flex:1;background:#1f2430;border-radius:10px;padding:10px;text-align:center;">
 <div style="font-size:11px;color:#8b9099;">Total Payment</div>
 <div style="font-size:16px;font-weight:700;color:#f06464;">₹${totalExpense.toLocaleString("en-IN")}</div>
 </div>
 </div>`;

 document.getElementById("partyDetailBody").innerHTML = sorted.length===0
 ? '<div class="empty-state" style="padding:10px 0;">No entries</div>'
 : sorted.map(e=>txnRowHTML(e,false)).join("");

 document.getElementById("partyDetailModal").classList.add("active");
}
function closePartyDetailModal(){
 document.getElementById("partyDetailModal").classList.remove("active");
}

// ===== WhatsApp party-wise summary share =====
function sharePartySummaryOnWhatsApp(){
 if (!currentPartyDetailName) return;
 let totalIncome = 0, totalExpense = 0;
 currentPartyDetailEntries.forEach(e=>{
  if(e.type==='income') totalIncome += Number(e.amount||0);
  else if(e.type==='expense') totalExpense += Number(e.amount||0);
 });

 let text = `📋 ${currentPartyDetailName} — Summary\n\n`;
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

function setEntryFilter(f){
 currentFilter = f;
 ["all","expense","income","transfer"].forEach(k=>{
 document.getElementById("filter"+k.charAt(0).toUpperCase()+k.slice(1)).classList.toggle("active", k===f);
 });
 renderEntries();
}

// ===== SEARCH =====
function toggleSearchBox(){
 const wrap = document.getElementById("searchInputWrap");
 const box = document.getElementById("searchInput");
 const show = wrap.style.display === "none";
 wrap.style.display = show ? "block" : "none";
 if(show) box.focus();
 else { box.value=""; document.getElementById("calendarPanel").style.display="none"; renderEntries(); }
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
function exportToExcel(){
 // Lazy-load xlsx only when needed
 if (typeof XLSX === 'undefined') {
  showNotification('Loading Excel library...', 'success');
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = () => exportToExcel();
  document.head.appendChild(s);
  return;
 }
 const list = getExportList();
 if(list.length===0){ showNotification("There are no entries to export", "error"); return; }
 
 // Get party name from first entry or use "All Parties"
 const partyName = list.length > 0 && list[0].party ? list[0].party : "ALL PARTIES";
 
 // Calculate totals
 let totalDebit = 0, totalCredit = 0;
 list.forEach(e => {
  if(e.type === 'expense') totalDebit += parseFloat(e.amount) || 0;
  else totalCredit += parseFloat(e.amount) || 0;
 });
 
 // Create rows with proper format
 const headerRows = [
  ['WALLET STATEMENT'],
  ['Party Name: ' + partyName],
  [''],
  ['No.', 'Date', 'Party Name', 'Debit', 'Credit', 'Method', 'Note']
 ];
 
function formatDate(date) {
    if (!date) return '';

    const parts = date.split('-');

    if (parts.length !== 3) return date;

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

const dataRows = list.map((e, idx) => [
  idx + 1,
  formatDate(e.date),
  e.party || 'N/A',
  e.type === 'expense' ? e.amount : '',
  e.type === 'income' ? e.amount : '',
  e.method || '',
  e.notes || ''
]);
 
 // Add totals
 const totalRows = [
  [],
  [
    'TOTAL',
    '',
    totalDebit,
    totalCredit,
    'NET BALANCE',
    'Rs. ' + (totalCredit - totalDebit)
  ]
];
 const allRows = [...headerRows, ...dataRows, ...totalRows];
 
 const ws = XLSX.utils.aoa_to_sheet(allRows);
 
 // Set column widths
 ws['!cols'] = [
  {wch: 5},   // No.
  {wch: 12 }, // Date
  {wch: 18},  // Party Name
  {wch: 12},  // Debit
  {wch: 12},  // Credit
  {wch: 12},  // Method
  {wch: 25}   // Note
 ];
 
 const wb = XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb, ws, "Wallet Statement");
 XLSX.writeFile(wb, `WalletStatement_${partyName}_${Date.now()}.xlsx`);
 showNotification("Excel exported! ✓", "success");
 closeFilterModal();
}
function exportToPDF(){
 // Lazy-load jsPDF + autotable only when needed
 if (typeof jspdf === 'undefined' || typeof jspdf.jsPDF === 'undefined') {
  showNotification('Loading PDF library...', 'success');
  const s1 = document.createElement('script');
  s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  s1.onload = () => {
   const s2 = document.createElement('script');
   s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
   s2.onload = () => exportToPDF();
   document.head.appendChild(s2);
  };
  document.head.appendChild(s1);
  return;
 }
 const list = getExportList();
 if(list.length===0){ showNotification("There are no entries to export", "error"); return; }
 
 const doc = new jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
 const pageWidth = doc.internal.pageSize.getWidth();
 const pageHeight = doc.internal.pageSize.getHeight();
 
 // ===== BACKGROUND IMAGE (full A4 page) =====
 try {
  doc.addImage(PDF_BG_IMAGE, 'JPEG', 0, 0, pageWidth, pageHeight);
 } catch(e) {
  // Fallback: plain cream background
  doc.setFillColor(255, 250, 240);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
 }
 
 // Decorative top border
//  doc.setDrawColor(25, 102, 172);
//  doc.setLineWidth(1);
//  doc.line(0, 8, pageWidth, 8);
 
 // Get party name
 const partyName = list.length > 0 && list[0].party ? list[0].party : "ALL PARTIES";
 
 // HEADER SECTION
doc.setFont('helvetica', 'bold');
doc.setFontSize(15);
doc.setTextColor(0, 0, 0);

// Center Title
doc.text('WALLET STATEMENT', 14, 20); 

// Party Name
doc.setFont('helvetica', 'normal');
doc.setFontSize(11);

doc.text('Party : ' + partyName, 14, 26);

 
 // Prepare table data — clean notes (remove special chars that cause encoding issues)
 const cleanText = (str) => {
  if (!str) return '';
  return String(str)
   .replace(/[^\x00-\x7F]/g, (c) => {
    // Replace common Unicode chars with ASCII equivalents
    const map = { '\u20B9': 'Rs', '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"' };
    return map[c] || '';
   })
   .trim();
 };

function formatDate(date) {
    if (!date) return '';

    const parts = date.split('-');

    if (parts.length !== 3) return date;

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}


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
 
 // Calculate totals
 let totalDebit = 0, totalCredit = 0;
 list.forEach(e => {
  if(e.type === 'expense') totalDebit += parseFloat(e.amount) || 0;
  else totalCredit += parseFloat(e.amount) || 0;
 });
 
 // Add table
 doc.autoTable({
  startY: 34,
  head: [['No.', 'Date', 'Party Name', 'Debit', 'Credit', 'Method', 'Note']],
  body: tableData,
  styles: {
   font: 'helvetica',
   cellPadding: { top: 3, right: 2, bottom: 3, left: 2 },
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
   fontSize: 9,
   textColor: [50, 50, 50],
   fillColor: [255, 255, 255]
  },
  alternateRowStyles: {
   fillColor: [245, 245, 245]
  },
  columnStyles: {
   0: {halign: 'center', cellWidth: 10},
   1: {halign: 'left',   cellWidth: 22},
   2: {halign: 'left',   cellWidth: 32},
   3: {halign: 'right',  cellWidth: 24},
   4: {halign: 'right',  cellWidth: 24},
   5: {halign: 'left',   cellWidth: 20},
   6: {halign: 'left',   cellWidth: 50}
  },
  margin: {left: 14, right: 14},
  tableWidth: 182,
  // Force each new page to also get background
  didDrawPage: function(data) {
   if (data.pageNumber > 1) {
    try { doc.addImage(PDF_BG_IMAGE, 'JPEG', 0, 0, pageWidth, pageHeight); } catch(e) {}
   }
  }
 });
 

// TOTALS SECTION
const finalY = doc.lastAutoTable.finalY + 8;
const netBalance = totalCredit - totalDebit;

// Background
doc.setFillColor(240, 240, 240);
doc.rect(14, finalY, pageWidth - 28, 10, 'F');

doc.setDrawColor(25, 102, 172);
doc.line(14, finalY, pageWidth - 14, finalY);
doc.line(14, finalY + 10, pageWidth - 14, finalY + 10);

// Text
doc.setFont('helvetica', 'bold');
doc.setFontSize(10);
doc.setTextColor(0, 0, 0);

doc.text('TOTAL', 17, finalY + 7);

// Debit Total (right-aligned under Debit column, which ends at x=102)
doc.text(totalDebit.toLocaleString('en-IN'), 100, finalY + 7, { align: 'right' });

// Credit Total (right-aligned under Credit column, which ends at x=126)
doc.text(totalCredit.toLocaleString('en-IN'), 124, finalY + 7, { align: 'right' });

// Net Balance Label
doc.text('NET BALANCE', 128, finalY + 7);

// Net Balance Value
doc.text(
    (netBalance < 0 ? '- Rs. ' : 'Rs. ') +
    Math.abs(netBalance).toLocaleString('en-IN'),
    pageWidth - 17,
    finalY + 7,
    { align: 'right' }
);
 // Footer
 doc.setTextColor(100, 100, 100);
 doc.setFont('helvetica', 'normal');
 doc.setFontSize(8);
 const today = new Date().toLocaleDateString('en-IN', {day:'2-digit', month:'2-digit', year:'numeric'});
 doc.text('Generated on ' + today, pageWidth/2, pageHeight-5, {align: 'center'});
 
 doc.save('WalletStatement_' + partyName + '_' + Date.now() + '.pdf');
 showNotification("PDF Downloaded Successfully!", "success");
 closeFilterModal();
}

// ===== NOTIFICATION =====

function showNotification(message, type = 'success') {
 const notification = document.createElement('div');
 notification.style.cssText = `
 position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:8px;
 color:white;font-weight:600;z-index:1000;
 ${type === 'success' ? 'background:#3ddc84;box-shadow:0 4px 12px rgba(61,220,132,.3)' : 'background:#f06464;box-shadow:0 4px 12px rgba(240,100,100,.3)'};
 animation:slideInRight 0.3s ease both;
`;
 notification.textContent = message;
 document.body.appendChild(notification);
 
 setTimeout(() => {
 notification.style.animation = 'slideOutRight 0.3s ease both';
 setTimeout(() => notification.remove(), 300);
 }, 3000);
}

// Add notification animations
const style = document.createElement('style');
style.textContent = `
 @keyframes slideInRight { from { opacity:0; transform:translateX(100%); } to { opacity:1; transform:translateX(0); } }
 @keyframes slideOutRight { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(100%); } }
`;
document.head.appendChild(style);

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
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
 }, { passive: false });

 // 4) Ctrl/trackpad-wheel zoom rokna (kuch Android WebViews mouse/trackpad bhi bhejte hain)
 document.addEventListener('wheel', function (e) {
  if (e.ctrlKey) e.preventDefault();
 }, { passive: false });
})();

// ===== INIT =====

// Initialize Firebase and load data
document.addEventListener('DOMContentLoaded', () => {
 // ── STEP 0: Apply saved theme preference (dark by default) ──
 try {
   if (localStorage.getItem("appTheme") === "light") {
     document.body.classList.add("light-theme");
     const profileBtn = document.getElementById('profileThemeToggleBtn');
     if (profileBtn) profileBtn.textContent = "☀️";
   }
 } catch(e){}

 // ── STEP 1: Paint UI from localStorage instantly (0ms) ──
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
 // NOTE: renderAnalytics() skipped here — called lazily when tab opens

 // ── STEP 2: Setup UI state ──
 loadCustomParties();
 const dateInputEl = document.getElementById("dateInput");
 if(dateInputEl) {
   dateInputEl.value = getLocalDateStr();
   updateDateLabel(dateInputEl.value);
 }
 updateGreeting();
 updateDateDisplay();
 updateMonthDisplayToCurrent();
 if(pinMode === 'create'){
   const pinTitle = document.getElementById('pinTitleText');
   const pinSub = document.getElementById('pinSubText');
   if(pinTitle) pinTitle.textContent = "Set a PIN";
   if(pinSub) pinSub.textContent = "Create a new 4-digit PIN";
 }

 // ── STEP 3: Check session (Google or email login) — show login or go to PIN ──
 const savedUser = localStorage.getItem('googleUser') || localStorage.getItem('currentUser');
 if (savedUser) {
   try {
     currentUser = JSON.parse(savedUser);
     hideLoadingPage();
     updateProfileEmail();
     hideGoogleLoginPage(); // → shows PIN screen → user unlocks → app shows
   } catch(e) {
     hideLoadingPage();
     showGoogleLoginPage();
   }
 } else {
   hideLoadingPage();
   showGoogleLoginPage(); // fresh user: login first
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
});

function initFirebase() {
 try {
   if (!firebaseConfig.apiKey.includes("PASTE_YOUR") && !window.__firebaseInitDone) {
     window.__firebaseInitDone = true;
     firebase.initializeApp(firebaseConfig);
     db = firebase.firestore();
     db.enablePersistence().catch(err => console.warn('Persistence failed:', err));
     firebaseReady = true;
     
     // 📡 UPDATE INDICATOR: Firebase Connected
     updateFirebaseStatus(true);
     console.log("✅ Firebase connected");
     logFirebaseEvent('Connected to Firebase', 'success');

     // 🔒 Watch the REAL Firebase Auth session. If our app thinks the user
     // is logged in (currentUser set from localStorage) but Firebase Auth's
     // own session has been wiped (e.g. by browser tracking-prevention /
     // "Clear site data"), force the user to log in again instead of
     // silently failing every Firestore save with "permission-denied".
     // Firebase always fires onAuthStateChanged once immediately with whatever
     // state it has AT THAT INSTANT — which can be `null` for a brief moment
     // right after page load while it's still restoring the persisted session
     // from storage. Treating that very first callback as "logged out" was
     // forcing a real, already-logged-in user back to the login screen on
     // almost every refresh. We skip that first callback and only act on
     // GENUINE session-loss events that happen afterwards.
     let authStateInitialCheckDone = false;
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

     
     // Background sync after brief delay so UI stays fast
     setTimeout(async () => {
       try {
         await loadEntriesFromFirebase();
         dedupeEntries();
         renderWallet();
         renderEntries();
         // Only re-render analytics if that screen is active
         if (document.getElementById('screen-analytics').classList.contains('active')) renderAnalytics();
         console.log('✓ Firebase sync done:', entries.length, 'entries');
         logFirebaseEvent(`Synced ${entries.length} entries from Firestore`, 'success');

         // Party list bhi cloud se sync karo, taaki refresh/logout-login
         // ke baad koi bhi party name gayab na ho
         await syncCustomPartiesFromFirebase();
       } catch(err) {
         console.warn('⚠ Firebase sync failed, using local data:', err);
         logFirebaseEvent('Firestore sync failed — using local data (' + (err.message || err.code || 'unknown error') + ')', 'error');
       }
     }, 800);
   }
 } catch(err) {
   console.warn('Firebase init failed, local mode:', err);
   firebaseReady = false;
   updateFirebaseStatus(false);
 }
}

// ═══════════════════════════════════════════════════════════════════════
// FIREBASE CONNECTION STATUS INDICATOR - UPDATE UI
// ═══════════════════════════════════════════════════════════════════════
function updateFirebaseStatus(isConnected) {
 const indicator = document.getElementById('firebaseStatusIndicator');
 const statusText = document.getElementById('firebaseStatusText');
 
 if (isConnected) {
   indicator.classList.remove('disconnected');
   indicator.classList.add('connected');
   statusText.textContent = '';
 } else {
   indicator.classList.remove('connected');
   indicator.classList.add('disconnected');
   statusText.textContent = '';
 }
}

// Handle visibility change - just re-render existing data, no reload
document.addEventListener('visibilitychange', () => {
 if (!document.hidden) {
  renderWallet();
  renderEntries();
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

function removeParty(name) {
 if (!confirm(`Remove party "${name}"?`)) return;
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
 try { localStorage.setItem("appTheme", isLight ? "light" : "dark"); } catch(e){}
 showNotification(isLight ? "Light mode on" : "Dark mode on", "success");
 const profileBtn = document.getElementById('profileThemeToggleBtn');
 if (profileBtn) profileBtn.textContent = isLight ? "☀️" : "🌙";
 // Refresh canvas-based charts so their colors match the new theme (CSS can't reach into canvas)
 if (typeof renderMiniChart === 'function') renderMiniChart();
 if (typeof renderCharts === 'function' && document.getElementById('donutChart')) renderCharts();
 // Keep the Goals tab (now inline, same page) in sync too, in case it's
 // already open — its canvas ring reads its colors from body.light-theme,
 // which CSS can't do for canvas, so it needs a manual repaint.
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
     emailEl.textContent = user.email || 'dharm@example.com';
     if (user.displayName) nameEl.textContent = user.displayName;
    } else {
     emailEl.textContent = firebaseConfig.authDomain
      ? firebaseConfig.authDomain.replace('.firebaseapp.com', '') + '@gmail.com'
      : 'dharm@example.com';
    }
   });
   return;
  }
 } catch(e) {}

 // Fallback
 emailEl.textContent = 'dharm@example.com';
}

// ===== LOGOUT =====
function logoutUser(){
 if(!confirm("Are you sure you want to log out?")) return;
 showNotification("Logged out", "success");
 setTimeout(()=> location.reload(), 800);
}

// ===== BACKUP & RESTORE FUNCTIONS =====
function openPage(id){
    document.getElementById(id).classList.add('active');
}
function closePage(id){
    document.getElementById(id).classList.remove('active');
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
 if (!firebaseReady || !db) { showNotification('Firebase not ready yet, try again in a moment', 'error'); return; }
 if (!currentUser || !currentUser.uid) { showNotification('Please log in again first', 'error'); return; }

 if (!confirm('This will tag all your existing cloud entries with your account, so they show up on every device. Continue?')) return;

 showNotification('Fixing old entries… please wait', 'info');

 try {
  // NOTE: this reads the WHOLE collection (not filtered by userId), since
  // the entries we need to fix are exactly the ones missing that field.
  // This only works if your Firestore rules allow it — if you get a
  // "Missing or insufficient permissions" error here, the rules need to
  // temporarily allow reading entries with no userId field.
  const snapshot = await db.collection('entries').get();
  let fixedCount = 0;
  const batch = db.batch();

  snapshot.forEach(doc => {
   const data = doc.data();
   if (!data.userId) {
    batch.update(doc.ref, { userId: currentUser.uid });
    fixedCount++;
   }
  });

  if (fixedCount === 0) {
   showNotification('No old entries needed fixing ✓', 'success');
   return;
  }

  await batch.commit();
  showNotification(`Fixed ${fixedCount} old entr${fixedCount === 1 ? 'y' : 'ies'} ✓`, 'success');

  // Reload so the newly-tagged entries show up immediately
  await loadEntriesFromFirebase();
  dedupeEntries();
  renderWallet();
  renderEntries();
 } catch (err) {
  console.error('Migration failed:', err);
  showNotification('Fix failed: ' + err.message, 'error');
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

function permanentDeleteEntry(idx) {
 if (!confirm("Permanently delete this entry? This cannot be undone.")) return;
 const history = JSON.parse(localStorage.getItem('deletedEntries') || '[]');
 history.splice(idx, 1);
 localStorage.setItem('deletedEntries', JSON.stringify(history));
 showNotification('Entry permanently deleted', 'success');
 const modal = document.getElementById('deletedHistoryModal');
 if (modal) modal.remove();
 openDeletedHistory();
}


function clearAllDeletedHistory() {
 if (!confirm("Clear the entire deleted history?")) return;
 localStorage.removeItem('deletedEntries');
 showNotification('Deleted history cleared', 'success');
 const modal = document.getElementById('deletedHistoryModal');
 if (modal) modal.remove();
}

// Hey dharm  
const welcomeMessagesMorning = [
    "Good morning Dharm, have a great day.",
    "Morning! Take a quick look at today's plan.",
    "Awake? Let’s check the budget/accounts now.",
    "Fresh mind this morning—everything will get planned today."
    
];

const welcomeMessagesSunday = [
    "Chill today, but check the budget too.",
    "Sunday funday—but don't forget to track expenses.",
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
    "Day is ending, check the budget/accounts.",
    "Relax a bit, you worked hard all day.",
    "Did you add all today's entries?",
    "It's evening, a tea break is a must."
];
const welcomeMessagesNight = [
    "Make a plan for tomorrow.",
    "Rest up, tomorrow is a new day.",
    "Did you check today's budget?",
    "Check your wallet one last time before sleep.",
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

    // हर period की base greeting और उसका message pool
    const greetingConfig = {
        sunday:    { base: 'Happy Sunday Dharm ☀️', pool: welcomeMessagesSunday },
        morning:   { base: 'Morning Dharm ☀️',       pool: welcomeMessagesMorning },
        afternoon: { base: 'Afternoon Dharm 🌤️',     pool: welcomeMessagesAfternoon },
        evening:   { base: 'Evening Dharm',          pool: welcomeMessagesEvening },
        night:     { base: 'Good Night Dharm 🌙',    pool: welcomeMessagesNight }
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


// ===== 4-DIGIT PIN LOCK SYSTEM =====
let pinEntered = "";
let pinFirstEntry = "";
let pinMode = localStorage.getItem('appPin') ? 'verify' : 'create';

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
// Focuses the hidden numeric input so the device's own number-pad keyboard
// opens. Digits typed there flow into the same pinPress() logic as the
// on-screen pad, so both entry methods stay in sync.
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

function pinSubmit(){
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
 localStorage.setItem('appPin', pinEntered);
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
 if(pinEntered === storedPin){
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

  // Pull this account's entries from the cloud right after unlock.
  // Without this, a fresh login on a NEW device only ever showed that
  // device's empty local storage — the cloud data was never fetched
  // until this point.
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

function resetAppPin(){
 if(!confirm("Reset your PIN? You'll need to set a new one next time.")) return;
 localStorage.removeItem('appPin');
 showNotification('PIN has been reset', 'success');
}

// ===== AUTO-LOCK ON APP SWITCH =====
// The moment the app is backgrounded (person switches to another app, locks
// their phone, or changes tabs), blur the screen immediately so nothing
// sensitive is visible in the OS's recent-apps thumbnail, and show the PIN
// lock screen so the app only re-opens once the correct PIN is entered.
let autoLockPending = false;

function triggerAutoLock(){
  const appContainer = document.getElementById('app');
  const pinScreen = document.getElementById('pinLockScreen');
  if (!appContainer || !pinScreen) return;

  // Only auto-lock if the person is actually past login and a PIN exists —
  // don't interrupt the login/PIN-setup flow itself.
  if (appContainer.style.display === 'none') return;
  if (!localStorage.getItem('appPin')) return;
  if (pinScreen.style.display === 'flex') return; // already locked

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
}

function handleAppVisibilityChange(){
  if (document.hidden) {
    // Lock right away — don't wait for the person to come back, since some
    // mobile browsers freeze JS execution shortly after backgrounding.
    autoLockPending = true;
    triggerAutoLock();
  } else if (autoLockPending) {
    triggerAutoLock();
  }
}
document.addEventListener('visibilitychange', handleAppVisibilityChange);
// Some in-app/webview browsers don't fire visibilitychange reliably —
// window blur/focus and pagehide are used as a backup so the lock still
// engages when switching apps.
window.addEventListener('blur', () => { autoLockPending = true; triggerAutoLock(); });
window.addEventListener('pagehide', () => { autoLockPending = true; triggerAutoLock(); });


// ===== Monthly Budget Warning Alert System =====
const MONTHLY_BUDGET_KEY = 'monthly_budget_limit';
const DEFAULT_MONTHLY_BUDGET = 20000;
let dismissedBudgetAlertMonth = null;

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
   if (subEl) subEl.textContent = `Aapne is mahine ke budget limit (₹${budgetLimit.toLocaleString('en-IN')}) ka ${usedPct}% kharch kar diya hai!`;
   if (fillEl) {
    fillEl.style.width = '100%';
    fillEl.className = 'budget-progress-bar-fill critical';
   }
  } else {
   banner.className = 'budget-alert-card warning';
   if (iconEl) iconEl.textContent = '⚠️';
   if (titleEl) titleEl.textContent = 'Monthly Budget Warning';
   if (subEl) subEl.textContent = `Aapne is mahine ke budget limit ka ${usedPct}% kharch kar liya hai!`;
   if (fillEl) {
    fillEl.style.width = `${Math.min(100, usedPct)}%`;
    fillEl.className = 'budget-progress-bar-fill warning';
   }
  }
  if (spentEl) spentEl.textContent = `Kharch: ₹${curMonthExpense.toLocaleString('en-IN')} (${usedPct}%)`;
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
  alert("Kripya sahi budget amount daalein (e.g. 20000)");
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
}

// ===== Payment Method widget (Wallet/home screen) =====
// Current calendar month's EXPENSE entries only, grouped by method
// (Cash/UPI/Bank) — deliberately independent of whatever month the
// Analytics tab happens to be browsing, since this is a home-screen
// "right now" snapshot. Colors/layout match the reference list style
// (icon chip + label + amount, colored progress bar + %).
const PAYMENT_METHOD_META = {
  Cash: { color: '#22c55e', icon: 'ti-wallet' },
  UPI:  { color: '#8b5cf6', icon: 'ti-qrcode' },
  Bank: { color: '#3b82f6', icon: 'ti-building-bank' },
};
// Kaunsa method abhi expand/select kiya hua hai (bar/legend row par tap karne
// se yahan set hota hai). Widget re-render hone par bhi selection yaad rehti
// hai jab tak dobara tap na ho ya wahi method dobara tap karke close na ho.
let pmSelectedMethod = null;

function selectPaymentMethod(method){
  pmSelectedMethod = (pmSelectedMethod === method) ? null : method;
  renderPaymentMethodWidget();
}

function renderPaymentMethodWidget(){
  const listEl = document.getElementById('paymentMethodList');
  if (!listEl) return;

  const now = new Date();
  const curMonth = now.getMonth(), curYear = now.getFullYear();
  const totals = { Cash: 0, UPI: 0, Bank: 0 };
  const allEntries = (typeof entries !== 'undefined' ? entries : []);
  allEntries.forEach(e => {
    if (e.type !== 'expense') return;
    const d = new Date(e.date);
    if (d.getFullYear() !== curYear || d.getMonth() !== curMonth) return;
    const m = ["Cash","UPI","Bank"].includes(e.method) ? e.method : "Cash";
    totals[m] += Number(e.amount) || 0;
  });

  const grandTotal = totals.Cash + totals.UPI + totals.Bank;
  const methods = ["Cash", "UPI", "Bank"];

  if (grandTotal <= 0) {
    listEl.innerHTML = '<div class="empty-state" style="padding:14px 0;">Is mahine abhi koi payment nahi hua</div>';
    pmSelectedMethod = null;
    return;
  }

  // Sirf wahi methods jinka amount > 0 hai, taaki bar/legend clutter na ho.
  const slices = methods
    .map(m => ({
      name: m,
      amt: totals[m],
      pct: (totals[m] / grandTotal) * 100,
      color: PAYMENT_METHOD_META[m].color
    }))
    .filter(s => s.amt > 0);

  // Agar selected method ab is mahine data me hi nahi hai (e.g. sab entries
  // delete ho gayi), to selection clear kar do.
  if (pmSelectedMethod && !slices.some(s => s.name === pmSelectedMethod)) {
    pmSelectedMethod = null;
  }

  // ---- Stacked bar (ek hi rounded bar, colors me divide) ----
  const barSegsHtml = slices.map(s => `
    <div class="pm-stackbar-seg${pmSelectedMethod && pmSelectedMethod !== s.name ? ' dim' : ''}"
         style="width:${s.pct}%;background:${s.color};"
         onclick="selectPaymentMethod('${s.name}')"></div>`).join('');

  // ---- Legend rows (tap karne se detail panel open/close hota hai) ----
  const legendHtml = slices.map(s => `
    <div class="pm-legend-row${pmSelectedMethod === s.name ? ' selected' : ''}" onclick="selectPaymentMethod('${s.name}')">
      <span class="pm-legend-dot" style="background:${s.color};"></span>
      <span class="pm-legend-name">${s.name}</span>
      <span class="pm-legend-amt">₹${s.amt.toLocaleString('en-IN')}</span>
      <span class="pm-legend-pct">${s.pct.toFixed(1)}%</span>
      <i class="ti ti-chevron-right pm-legend-chev"></i>
    </div>`).join('');

  // ---- Detail panel: short summary + is method ke recent transactions ----
  let detailHtml = '';
  if (pmSelectedMethod) {
    const sel = slices.find(s => s.name === pmSelectedMethod);
    const meta = PAYMENT_METHOD_META[pmSelectedMethod];
    const monthTxns = allEntries.filter(e => {
      if (e.type !== 'expense' || e.method !== pmSelectedMethod) return false;
      const d = new Date(e.date);
      return d.getFullYear() === curYear && d.getMonth() === curMonth;
    });
    const recentTxns = monthTxns.slice(0, 4); // entries newest-first hoti hain

    const txnsHtml = recentTxns.length
      ? recentTxns.map(e => txnRowHTML(e, false)).join('')
      : '<div class="pm-detail-empty">Is method se abhi koi transaction nahi mila</div>';

    detailHtml = `
      <div class="pm-detail-panel">
        <div class="pm-detail-summary">
          <span class="pm-detail-dot" style="background:${sel.color};"></span>
          <div style="flex:1;">
            <div class="pm-detail-title">${sel.name}</div>
            <div class="pm-detail-sub">${sel.pct.toFixed(1)}% of this month's payments · ${monthTxns.length} transaction${monthTxns.length===1?'':'s'}</div>
          </div>
          <div class="pm-detail-amt">₹${sel.amt.toLocaleString('en-IN')}</div>
        </div>
        <div class="pm-detail-heading">Recent ${pmSelectedMethod} transactions</div>
        ${txnsHtml}
      </div>`;
  }

  listEl.innerHTML = `
    <div class="pm-stackbar">${barSegsHtml}</div>
    <div class="pm-legend">${legendHtml}</div>
    ${detailHtml}`;
}

// ===== Swipeable Real-Time Info Carousel (Wallet dashboard) =====
// Cards, in order: one per active/incomplete savings goal (see the GOALS
// TAB module above — goals[], ICON_META, GOAL_COLORS), then the most
// recent entry, then a Receive-QR shortcut. Everything is read live off
// `entries`/`goals` at render time — nothing here is cached or hardcoded.
// Re-rendered from renderWallet() (after saveEntry/updateEntry/deleteEntry)
// and from renderGoalsList() (after any goal/contribution change).
let rtCarouselIndex = 0;
let rtCarouselCount = 0;

function rtBuildGoalCards(){
  if (typeof syncGoalsWithEntries === 'function') syncGoalsWithEntries();
  return goals
    .filter(g => g.status !== 'completed')
    .map(g => {
      const pct = pctOfGoal(g);
      const barColor = goalProgressColor(g);
      // Reuse the real Food/Medicine/Auto photos where the goal's icon
      // matches one; every other icon falls back to the goal's own
      // glossy gradient badge (no stock photo exists for it).
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

// Wraps at both ends, per spec. `isAuto` is set only by the autoplay timer
// below — any manual move (arrow tap or swipe) resets the auto-advance
// countdown so it doesn't fight the person mid-interaction.
function rtCarouselMove(dir, isAuto){
  if (rtCarouselCount <= 1) return;
  rtCarouselIndex = (rtCarouselIndex + dir + rtCarouselCount) % rtCarouselCount;
  rtApplyCarouselTransform(true);
  if (!isAuto) rtStartAutoplay();
}

// ===== Auto-advance (slides left automatically, same as swiping left) =====
// Keeps running alongside manual swipe/arrow-tap navigation; any manual
// interaction just resets the countdown rather than disabling it.
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

// Touch-drag / mouse-drag swipe support for the carousel viewport.
function rtCarouselInitSwipe(){
  const viewport = document.getElementById('rtViewport');
  if (!viewport || viewport.dataset.rtBound) return;
  viewport.dataset.rtBound = '1';

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

  // Pausing on hover feels natural on desktop; touch devices already pause
  // for the duration of the drag itself (see start()/end() above).
  viewport.addEventListener('mouseenter', rtStopAutoplay);
  viewport.addEventListener('mouseleave', () => { if (!dragging) rtStartAutoplay(); });
}

// ---- Receive-money QR modal (the carousel's QR card shortcut) ----
// No dedicated QR/UPI screen exists elsewhere in this app to reuse, so this
// is a lightweight modal that renders a scannable UPI QR for the signed-in
// user (falls back to a generic "Wallet" payee if not signed in).
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

// ===== BACKUP REMINDER (WEEKLY ONLY) =====
// Message sirf HAFTE MEIN EK BAAR dikhta hai — na ki roz:
//  - Agar banner ko X se band kiya, to agla message ek hafte baad hi aayega
//    (chahe backup liya ho ya nahi) — 'backupReminderDismissedAt' se track hota hai.
//  - Agar backup le liya, to agla message us backup ke ek hafte baad aayega
//    (lastBackupDate se track hota hai, jaisa pehle tha, bas threshold 30 -> 7 din).
function checkBackupReminder(){
 const banner = document.getElementById('backupReminderBanner');
 if (!banner) return;

 const lastBackupStr = localStorage.getItem('lastBackupDate');
 const dismissedStr = localStorage.getItem('backupReminderDismissedAt');

 // Pichle 7 din ke andar hi X se band kiya tha to abhi dobara mat dikhao.
 if (dismissedStr) {
   const daysSinceDismiss = Math.floor((Date.now() - new Date(dismissedStr).getTime()) / 86400000);
   if (daysSinceDismiss < 7) { banner.style.display = 'none'; return; }
 }

 let daysSince;
 if (!lastBackupStr) {
   // Kabhi backup nahi liya — sirf tab dikhao jab kaafi entries ho chuki hon,
   // taaki bilkul naye users ko turant hi warning na mile.
   if (!entries || entries.length < 5) { banner.style.display = 'none'; return; }
   daysSince = Infinity;
 } else {
   daysSince = Math.floor((Date.now() - new Date(lastBackupStr).getTime()) / 86400000);
 }

 if (daysSince >= 7) {
   document.getElementById('backupReminderText').textContent =
     lastBackupStr ? `⚠️ ${daysSince} din ho gaye — aapne backup nahi liya` : `⚠️ Aapne abhi tak koi backup nahi liya`;
   banner.style.display = 'flex';
 } else {
   banner.style.display = 'none';
 }
}
function hideBackupReminder(){
 document.getElementById('backupReminderBanner').style.display = 'none';
 // Weekly-only suppression: ab agla message ek hafte baad hi dikhega,
 // roz app kholne par nahi.
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

// ===== PARTY ICON MAPPING =====
function getPartyIcon(partyName) {
  if(!partyName) return '💸';
  
  const name = partyName.toLowerCase().trim();
  
  // Exact name mappings
  const iconMap = {
    'sagar': '👨',
    'self': '🧑',
    'ritesh': '👤',
    'netflix': '📺',
    'spotify': '🎵',
    'coffee': '☕',
    'shopping': '🛍️',
    'salary': '💰',
    'travel': '✈️',
    'food': '🍔',
    'movie': '🎬',
    'electricity': '⚡',
    'water': '💧',
    'rent': '🏠',
    'doctor': '🏥',
    'gym': '💪',
    'gas': '⛽',
    'mobile': '📱',
    'books': '📚',
    'gift': '🎁',
    'uber': '🚗',
    'auto': '🚗',
    'taxi': '🚕',
    'groceries': '🛒',
    'medicine': '💊',
    'restaurant': '🍽️',
    'petrol': '⛽',
    'school': '🎓',
    'friend': '👥',
    'family': '👨‍👩‍👧‍👦',
    'office': '🏢',
    'home': '🏠'
  };
  
  // Check exact match
  if(iconMap[name]) return iconMap[name];
  
  // Check partial match
  for(let key in iconMap) {
    if(name.includes(key) || key.includes(name)) {
      return iconMap[key];
    }
  }
  
  // Default icon
  return '💸';
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

// ---- Allowed accounts (only these two emails can ever access the app) ----
const ALLOWED_EMAILS = ["dharm6410@gmail.com", "dharm1331@gmail.com"];

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
 if (!ALLOWED_EMAILS.includes(email)) {
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
 document.getElementById('googleLoginPage').classList.remove('hidden');
 document.getElementById('forgotPasswordPage').classList.add('hidden');
 document.getElementById('forgotPinPage').classList.add('hidden');
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

// ---- Forgot Password ----
function showForgotPassword() {
 document.getElementById('googleLoginPage').classList.add('hidden');
 document.getElementById('forgotPasswordPage').classList.remove('hidden');
 document.getElementById('fpStep1').style.display = '';
 document.getElementById('fpStep2').style.display = 'none';
 const inp = document.getElementById('fpEmail');
 if (inp) { inp.value = ''; inp.classList.remove('error'); }
 document.getElementById('fpEmailError').style.display = 'none';
}

function fpClearError() {
 document.getElementById('fpEmailError').style.display = 'none';
 const inp = document.getElementById('fpEmail');
 if (inp) inp.classList.remove('error');
}

function fpSubmitEmail() {
 const email = (document.getElementById('fpEmail').value || '').trim();
 const errDiv = document.getElementById('fpEmailError');
 const errSpan = errDiv.querySelector('span');

 if (!email) {
  document.getElementById('fpEmail').classList.add('error');
  errDiv.style.display = 'flex';
  errSpan.textContent = 'Email address is required';
  return;
 }
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  document.getElementById('fpEmail').classList.add('error');
  errDiv.style.display = 'flex';
  errSpan.textContent = 'Please enter a valid email address';
  return;
 }

 const btn = document.getElementById('fpSubmitBtn');
 btn.disabled = true;
 btn.textContent = 'Bhej raha hun...';

 // Simulate sending (replace with real email logic if needed)
 setTimeout(() => {
  btn.disabled = false;
  btn.innerHTML = 'Reset Link Bhejo';
  document.getElementById('fpSentEmail').textContent = email;
  document.getElementById('fpStep1').style.display = 'none';
  document.getElementById('fpStep2').style.display = '';
  showNotification('Reset email bhej diya ✓', 'success');
 }, 1800);
}

function fpResend() {
 document.getElementById('fpStep2').style.display = 'none';
 document.getElementById('fpStep1').style.display = '';
 showNotification('Enter your email to resend it', 'success');
}

// ---- Forgot PIN ----
let fpinOTPCode = '';
let fpinNewPin = '';
let fpinConfirmPin = '';

function openForgotPinPage() {
 const page = document.getElementById('forgotPinPage');
 page.classList.remove('hidden');

 // Populate user info
 if (currentUser) {
  const photo = document.getElementById('fpinUserPhoto');
  const fallback = document.getElementById('fpinAvatarFallback');
  const nameEl = document.getElementById('fpinUserName');
  const emailEl = document.getElementById('fpinUserEmail');
  if (currentUser.picture && photo) {
   photo.src = currentUser.picture;
   photo.style.display = 'block';
   if (fallback) fallback.style.display = 'none';
  } else if (fallback) {
   fallback.textContent = (currentUser.name || 'U').charAt(0).toUpperCase();
  }
  if (nameEl) nameEl.textContent = currentUser.name || 'User';
  if (emailEl) emailEl.textContent = currentUser.email || 'No email';
 }

 // Reset steps
 document.getElementById('fpinStep1').style.display = '';
 document.getElementById('fpinStep3').style.display = 'none';
 document.getElementById('fpinStep4').style.display = 'none';
 fpinNewPin = '';
 fpinConfirmPin = '';

 // Clear re-login fields and errors
 const emailInp = document.getElementById('fpinLoginEmail');
 const passInp = document.getElementById('fpinLoginPassword');
 const errDiv = document.getElementById('fpinLoginError');
 if (emailInp) { emailInp.value = ''; emailInp.classList.remove('error'); }
 if (passInp) { passInp.value = ''; passInp.classList.remove('error'); }
 if (errDiv) errDiv.style.display = 'none';
}

function closeForgotPinPage() {
 document.getElementById('forgotPinPage').classList.add('hidden');
}

function fpinVerifyLogin() {
 const emailInp = document.getElementById('fpinLoginEmail');
 const passInp  = document.getElementById('fpinLoginPassword');
 const errDiv   = document.getElementById('fpinLoginError');
 const email    = (emailInp?.value || '').trim().toLowerCase();
 const password = passInp?.value || '';

 if (errDiv) errDiv.style.display = 'none';
 emailInp?.classList.remove('error');
 passInp?.classList.remove('error');

 if (!email || !password) {
  if (errDiv) { errDiv.querySelector('span').textContent = 'Please enter your email and password'; errDiv.style.display = 'flex'; }
  return;
 }

 const btn = document.getElementById('fpinLoginBtn');
 if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Verifying...'; }
 const resetBtn = () => { if (btn) { btn.disabled = false; btn.innerHTML = 'Verify &amp; Continue'; } };

 if (!window.firebase || !firebase.auth) {
  resetBtn();
  if (errDiv) { errDiv.querySelector('span').textContent = 'Connecting... please try again in a moment'; errDiv.style.display = 'flex'; }
  return;
 }

 firebase.auth().signInWithEmailAndPassword(email, password)
  .then(() => {
   resetBtn();
   document.getElementById('fpinStep1').style.display = 'none';
   document.getElementById('fpinStep3').style.display = '';
   fpinNewPin = '';
   fpinUpdateNewPinDots();
   showNotification('Identity verified ✓', 'success');
  })
  .catch((err) => {
   resetBtn();
   passInp?.classList.add('error');
   let msg = 'Login failed. Please try again.';
   if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = 'Wrong password. Please try again.';
   else if (err.code === 'auth/user-not-found') msg = 'No account found with this email.';
   else if (err.code === 'auth/too-many-requests') msg = 'Too many attempts. Please wait and try again.';
   if (errDiv) { errDiv.querySelector('span').textContent = msg; errDiv.style.display = 'flex'; }
  });
}

// New PIN pad
function fpinUpdateNewPinDots() {
 const dots = document.getElementById('fpinNewPinDots').querySelectorAll('span');
 dots.forEach((d, i) => d.classList.toggle('filled', i < fpinNewPin.length));
}

function fpinPinPress(num) {
 if (fpinNewPin.length >= 4) return;
 fpinNewPin += num;
 fpinUpdateNewPinDots();
 document.getElementById('fpinNewPinError').textContent = '';
 if (fpinNewPin.length === 4) {
  setTimeout(() => {
   document.getElementById('fpinStep3').style.display = 'none';
   document.getElementById('fpinStep4').style.display = '';
   fpinConfirmPin = '';
   fpinUpdateConfirmPinDots();
  }, 200);
 }
}

function fpinPinClear() {
 fpinNewPin = '';
 fpinUpdateNewPinDots();
 document.getElementById('fpinNewPinError').textContent = '';
}

function fpinPinBackspace() {
 fpinNewPin = fpinNewPin.slice(0, -1);
 fpinUpdateNewPinDots();
}

// Confirm PIN pad
function fpinUpdateConfirmPinDots() {
 const dots = document.getElementById('fpinConfirmPinDots').querySelectorAll('span');
 dots.forEach((d, i) => d.classList.toggle('filled', i < fpinConfirmPin.length));
}

function fpinConfirmPinPress(num) {
 if (fpinConfirmPin.length >= 4) return;
 fpinConfirmPin += num;
 fpinUpdateConfirmPinDots();
 document.getElementById('fpinConfirmPinError').textContent = '';
 if (fpinConfirmPin.length === 4) {
  setTimeout(() => {
   if (fpinConfirmPin === fpinNewPin) {
    localStorage.setItem('appPin', fpinNewPin);
    showNotification('PIN successfully reset! ✓', 'success');
    closeForgotPinPage();
    // Show pin screen again with new PIN (verify mode)
    pinEntered = "";
    pinFirstEntry = "";
    pinMode = 'verify';
    document.getElementById('pinTitleText').textContent = "Enter New PIN";
    document.getElementById('pinSubText').textContent  = "Enter the new PIN you just set";
    pinUpdateDots();
    document.getElementById('pinErrorText').textContent = "";
    const fpinLink3 = document.getElementById('forgotPinLink');
    if (fpinLink3) fpinLink3.style.display = '';
    document.getElementById('pinLockScreen').style.display = 'flex';
    setTimeout(focusPinHiddenInput, 150);
   } else {
    document.getElementById('fpinConfirmPinError').textContent = "PIN didn't match, please try again";
    fpinConfirmPin = '';
    fpinUpdateConfirmPinDots();
   }
  }, 150);
 }
}

function fpinConfirmPinClear() {
 fpinConfirmPin = '';
 fpinUpdateConfirmPinDots();
 document.getElementById('fpinConfirmPinError').textContent = '';
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
  console.error('❌ Uncaught Error:', event.error);
  showNotification('Something went wrong, please try again', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Unhandled Promise Rejection:', event.reason);
  showNotification('Background error: ' + (event.reason?.message || 'Unknown'), 'error');
});

// ===== NETWORK STATUS MONITORING =====
window.addEventListener('online', () => {
  console.log('✓ Internet connected');
  showNotification('Internet connection restored', 'success');
  // Attempt to sync with Firebase when coming back online
  if (firebaseReady && currentUser) {
    setTimeout(() => {
      loadEntriesFromFirebase()
        .then(() => {
          console.log('✓ Synced with Firebase');
          renderWallet();
          renderEntries();
        })
        .catch(err => console.warn('Sync failed:', err));
    }, 500);
  }
});

window.addEventListener('offline', () => {
  console.warn('⚠ Internet disconnected');
  showNotification('Internet disconnected - using offline mode', 'warning');
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
 wrapOpenClose('openGoalFormModal', 'closeGoalFormModal');
 wrapOpenClose('openGoalDetailsModal', 'closeGoalDetailsModal');
 wrapOpenClose('openAddMoneyModal', 'closeAddMoneyModal');
 wrapOpenClose('openGoalSuccessModal', 'closeGoalSuccessModal');
 wrapOpenClose('askDeleteGoal', 'closeDeleteGoalModal');

 window.addEventListener('popstate', function() {
  handlingPop = true;
  if (overlayStack.length > 0) {
   const fnName = overlayStack.pop();
   const fn = window[fnName];
   if (typeof fn === 'function') fn();
  } else if (screenHistoryStack.length > 0) {
   const prevScreen = screenHistoryStack.pop();
   goTo(prevScreen, true);
  } else if (typeof currentAppScreen !== 'undefined' && currentAppScreen !== 'wallet') {
   goTo('wallet', true);
  }
  handlingPop = false;
 });

 // Base history entry to return to
 history.replaceState({ screen: 'wallet' }, '');
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
  if (!headerEl) return;
  const container = headerEl.closest('.gfscreen') || headerEl.closest('.screen');
  if (!container) return;
  container.style.paddingTop = (headerEl.offsetHeight + 10) + 'px';
 }
 function initFixedHeaderSync(){
  const headers = document.querySelectorAll('.top-row, #screen-goals .header');
  if (!headers.length) return;
  if ('ResizeObserver' in window) {
   const ro = new ResizeObserver((entries) => {
    entries.forEach((entry) => applyHeaderPad(entry.target));
   });
   headers.forEach((h) => { ro.observe(h); applyHeaderPad(h); });
  } else {
   headers.forEach(applyHeaderPad);
   window.addEventListener('resize', () => headers.forEach(applyHeaderPad));
  }
 }
 if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFixedHeaderSync);
 } else {
  initFixedHeaderSync();
 }
 // Naye headers (jaise dynamically dikhne wale) ke liye bhi safety net —
 // app fully load hone ke thodi der baad ek baar aur sync kar deta hai.
 window.addEventListener('load', () => setTimeout(initFixedHeaderSync, 300));
})();

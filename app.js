// ── VERSION GATE ──────────────────
// Change this string on every deploy (date or build number works fine)
const APP_VERSION = 'TULONG_v1_AI3';

(function enforceVersion() {
  const stored = localStorage.getItem('tulong_version');
  if (stored !== APP_VERSION) {
    localStorage.clear();
    localStorage.setItem('tulong_version', APP_VERSION);
    console.log('[TULONG] New version detected — localStorage cleared');
  }
})();
// ─────────────────────────────────────────────────────────────────────────

'use strict';

// ══════════════════════════════
// STATE
// ══════════════════════════════
const S = {
  screen: 'screen-home',
  history: [],
  coords: null,
  address: null,
  capturedPhoto: null,
  photos: [],          // multi-photo array for confirm strip
  cameraStream: null,
  facing: 'environment',
  flashOn: false,
  aiType: null,
  aiDept: null,
  aiEmoji: '⚠️',
  aiDescription: '',   // Taglish situational description (set by gemini-integration.js)
  refNum: null,
  cdTimer: null,
  cdVal: 5,
  map: null,
  mapMarker: null,
};

const GEOCODE_MIN_INTERVAL_MS = 15000;
const GEOCODE_MIN_MOVE = 0.0003;
let geocodeTimer = null;
let lastGeocodeAt = 0;
let lastGeocodeCoords = null;

// ══════════════════════════════
// NAVIGATION
// ══════════════════════════════
function navTo(id) {
  const cur  = document.getElementById(S.screen);
  const next = document.getElementById(id);
  if (!cur || !next) return;

  // If navigating to the same screen, avoid rerunning transitions but still
  // refresh dynamic data for certain screens.
  if (id === S.screen) {
    if (id === 'screen-confirm') initConfirm();
    return;
  }

  S.history.push(S.screen);
  cur.classList.remove('active');
  cur.classList.add('exit');
  next.classList.add('active');
  S.screen = id;
  // Push browser history so back gesture is catchable
  window.history.pushState({ tulong: true }, '');
  setTimeout(() => {
    cur.classList.remove('exit');
    // ensure hidden after transition so it can't bleed through
  }, 340);
  // screen hooks
  if (id === 'screen-confirm') initConfirm();
  if (id === 'screen-done')    initDone();
}

function navBack() {
  if (!S.history.length) return;
  const prev = S.history.pop();
  const cur  = document.getElementById(S.screen);
  const tgt  = document.getElementById(prev);
  cur.classList.remove('active');
  cur.classList.add('exit');
  setTimeout(() => cur.classList.remove('exit'), 340);
  tgt.classList.remove('exit');
  tgt.classList.add('active');
  S.screen = prev;
}

function goHome() {
  S.history = [];
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active','exit'));
  document.getElementById('screen-home').classList.add('active');
  S.screen = 'screen-home';
  stopCamera();
  // Replace all stacked browser history with a single clean home state
  window.history.replaceState({ tulong: true }, '');
}

// ══════════════════════════════
// DRAWER
// ══════════════════════════════
function openDrawer()  { document.getElementById('drawer').classList.add('open'); document.getElementById('drawer-overlay').classList.add('open'); }
function closeDrawer() { document.getElementById('drawer').classList.remove('open'); document.getElementById('drawer-overlay').classList.remove('open'); }


// ══════════════════════════════
// GPS
// ══════════════════════════════
function initGPS() {
  if (!navigator.geolocation) {
    setGPSText('Hindi available', 'err', 'N/A');
    return;
  }
  navigator.geolocation.watchPosition(onGPSSuccess, onGPSError, {
    enableHighAccuracy: true, timeout: 12000, maximumAge: 4000
  });
}

// Sa app.js, hanapin at i-replace ang onGPSSuccess:
function onGPSSuccess(pos) {
  const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
  S.coords = { lat, lng, acc };
  const latS = lat.toFixed(5);
  const lngS = lng.toFixed(5);
  const accR = Math.round(acc);
  
  // Kung > 80m, gawing 'err' (pula) ang status
  setGPSText(`${latS}°N, ${lngS}°E`, acc < 40 ? 'good' : (acc <= 80 ? 'warn' : 'err'), `±${accR}m`);
  queueReverseGeocode(lat, lng);

  // LIVE UPDATE: I-refresh ang confirm screen UI kung nakabukas ito habang inaayos ng phone ang GPS
  if (S.screen === 'screen-confirm') {
    initConfirm();
  }
}

function onGPSError(e) {
  setGPSText('Hindi makuha ang GPS', 'err', 'ERROR');
}
function setGPSText(txt, cls, acc) {
  document.getElementById('gps-text').textContent = txt;
  const badge = document.getElementById('gps-acc');
  badge.textContent = acc;
  badge.className = `gps-acc-tag ${cls}`;
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&zoom=18&addressdetails=1`,
      { headers: { 'Accept-Language': 'fil,en' } }
    );
    if (!r.ok) throw new Error(`Reverse geocode failed: ${r.status}`);
    const d = await r.json();
    const a = d.address || {};
    const parts = [a.road, a.suburb || a.village || a.neighbourhood, a.city || a.municipality || a.town].filter(Boolean);
    S.address = parts.length ? parts.join(', ') : d.display_name;
    // update compose loc
    document.getElementById('compose-loc').textContent = '📍 ' + S.address;
    // update confirm if open
    if (S.screen === 'screen-confirm') {
      document.getElementById('c-address').textContent = S.address;
    }
  } catch(e) {
    S.address = S.coords ? `${S.coords.lat.toFixed(4)}°N, ${S.coords.lng.toFixed(4)}°E` : 'Hindi makuha';
    document.getElementById('compose-loc').textContent = '📍 ' + S.address;
  }
}

function queueReverseGeocode(lat, lng) {
  const now = Date.now();
  const movedEnough = !lastGeocodeCoords
    || Math.abs(lastGeocodeCoords.lat - lat) >= GEOCODE_MIN_MOVE
    || Math.abs(lastGeocodeCoords.lng - lng) >= GEOCODE_MIN_MOVE;

  if (!movedEnough && now - lastGeocodeAt < GEOCODE_MIN_INTERVAL_MS) {
    return;
  }

  clearTimeout(geocodeTimer);
  geocodeTimer = setTimeout(() => {
    lastGeocodeAt = Date.now();
    lastGeocodeCoords = { lat, lng };
    reverseGeocode(lat, lng);
  }, 600);
}

// ══════════════════════════════
// CONNECTIVITY
// ══════════════════════════════
function checkNet() {
  const pill  = document.getElementById('status-pill');
  const label = document.getElementById('status-label');
  if (navigator.onLine) {
    pill.className = 'status-pill online';
    label.textContent = 'ONLINE';
  } else {
    pill.className = 'status-pill offline';
    label.textContent = 'OFFLINE — SMS Mode';
    showToast('⚠️ Offline — gagamit ng SMS fallback');
  }
}
window.addEventListener('online',  checkNet);
window.addEventListener('offline', checkNet);
checkNet();

// ══════════════════════════════
// SOS HANDLER
// ══════════════════════════════
function handleSOS() {
  // HAPTIC FEEDBACK (SOS Pattern: short-short-long)
  if (navigator.vibrate) {
    navigator.vibrate([100, 50, 100, 50, 300]);
  }

  S.capturedPhoto = null;
  S.photos = [];
  S.aiType = null;
  navTo('screen-camera');
  setTimeout(() => startCamera(), 350);
}

// ══════════════════════════════
// CAMERA
// ══════════════════════════════
async function startCamera() {
  const video   = document.getElementById('cam-video');
  const blocked = document.getElementById('cam-blocked');

  // Check if mediaDevices is available (blocked by browser shield or non-HTTPS)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    video.style.display = 'none';
    blocked.style.display = 'flex';
    showToast('⚠️ Camera blocked — subukan sa Chrome browser');
    return;
  }

  try {
    if (S.cameraStream) stopCamera();
    // Use simpler constraints first — some browsers reject complex ones
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: S.facing },
      audio: false
    });
    S.cameraStream = stream;
    video.srcObject = stream;
    video.style.display = 'block';
    blocked.style.display = 'none';
    setTimeout(() => { document.getElementById('scan-line').style.display = 'block'; }, 700);
  } catch(err) {
    video.style.display = 'none';
    blocked.style.display = 'flex';
    if (err.name === 'NotAllowedError') {
      showToast('⚠️ Camera permission denied — payagan sa settings');
    } else if (err.name === 'NotFoundError') {
      showToast('⚠️ Walang camera na nahanap');
    } else {
      showToast('⚠️ Camera error: ' + err.name);
    }
    console.warn('Camera error:', err.name, err.message);
  }
}

function skipCameraAndProceed() {
  // Let user pick from gallery and proceed without live camera
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      S.capturedPhoto = ev.target.result;
      const img = document.getElementById('gal-img');
      img.src = S.capturedPhoto; img.style.display = 'block';
      document.getElementById('gal-icon').style.display = 'none';
      showToast('🖼️ Larawan pinili');
      runAI(() => {
        stopCamera();
        navTo('screen-confirm');
      });
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

function stopCamera() {
  if (S.cameraStream) {
    S.cameraStream.getTracks().forEach(t => t.stop());
    S.cameraStream = null;
  }
  document.getElementById('scan-line').style.display = 'none';
  document.getElementById('ai-badge').style.display = 'none';
}

async function flipCamera() {
  S.facing = S.facing === 'environment' ? 'user' : 'environment';
  await startCamera();
  showToast('📷 Camera napalitan');
}

function toggleFlash() {
  if (!S.cameraStream) return;
  const track = S.cameraStream.getVideoTracks()[0];
  if (!track) return;
  S.flashOn = !S.flashOn;
  try {
    track.applyConstraints({ advanced: [{ torch: S.flashOn }] });
  } catch(e) { /* not all devices support */ }
  const btn = document.getElementById('flash-btn');
  btn.classList.toggle('flash-on', S.flashOn);
  showToast(S.flashOn ? '⚡ Flash ON' : '⚡ Flash OFF');
}

function capturePhoto() {
  const video  = document.getElementById('cam-video');
  const canvas = document.getElementById('cam-canvas');
  if (!S.cameraStream || !video.videoWidth) {
    showToast('⚠️ Walang aktibong camera');
    return;
  }
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  S.capturedPhoto = canvas.toDataURL('image/jpeg', 0.85);
  // Add to photos array (primary photo for AI)
  S.photos = [S.capturedPhoto];

  // show in gallery thumb
  const img = document.getElementById('gal-img');
  img.src = S.capturedPhoto; img.style.display = 'block';
  document.getElementById('gal-icon').style.display = 'none';

  // shutter flash
  flashShutter();
  showToast('📸 Larawan nakuha!');

  // run AI sim then go to confirm
  runAI(() => {
    stopCamera();
    navTo('screen-confirm');
  });
}

function flashShutter() {
  const vf = document.getElementById('cam-vf');
  const f = Object.assign(document.createElement('div'), {
    style: 'position:absolute;inset:0;background:white;z-index:20;pointer-events:none;opacity:0.85;transition:opacity 0.18s'
  });
  vf.appendChild(f);
  requestAnimationFrame(() => { f.style.opacity = '0'; setTimeout(() => f.remove(), 200); });
}

function openGallery() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      S.capturedPhoto = ev.target.result;
      S.photos = [S.capturedPhoto];
      const img = document.getElementById('gal-img');
      img.src = S.capturedPhoto; img.style.display = 'block';
      document.getElementById('gal-icon').style.display = 'none';
      showToast('🖼️ Larawan pinili');
      runAI(() => {
        stopCamera();
        navTo('screen-confirm');
      });
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

// Add extra photo from confirm screen (does not re-trigger AI)
function addExtraPhoto() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      S.photos.push(ev.target.result);
      renderPhotoStrip();
      showToast('📸 Larawan naidagdag');
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

// ══════════════════════════════
// CONFIRM SCREEN
// ══════════════════════════════
function updateConfirmTimestamp() {
  const timeEl = document.getElementById('c-time');
  const refEl  = document.getElementById('c-ref');
  if (!timeEl || !refEl) return;

  const now     = new Date();
  const DAYS    = ['Linggo','Lunes','Martes','Miyerkules','Huwebes','Biyernes','Sabado'];
  const MONS    = ['Enero','Pebrero','Marso','Abril','Mayo','Hunyo','Hulyo','Agosto','Setyembre','Oktubre','Nobyembre','Disyembre'];
  const hours24 = now.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = now.getMinutes().toString().padStart(2,'0');
  const ampm    = hours24 < 12 ? 'AM' : 'PM';
  const timeStr = `${hours12}:${minutes} ${ampm}`;
  const dateStr = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONS[now.getMonth()]} ${now.getFullYear()}`;

  timeEl.textContent = `${timeStr} · ${dateStr}`;
  S.refNum = `DRR-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-${(1000+Math.floor(Math.random()*8999))}`;
  refEl.textContent = `REFNUM: ${S.refNum}`;
}

function renderPhotoStrip() {
  const strip = document.getElementById('photo-strip');
  if (!strip) return;
  strip.innerHTML = '';

  S.photos.forEach((src, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'photo-sq';
    thumb.innerHTML = `<img src="${src}" alt="Photo ${i+1}">`;
    strip.appendChild(thumb);
  });

  // Add "+" button if under 4 photos
  if (S.photos.length < 4) {
    const addBtn = document.createElement('div');
    addBtn.className = 'photo-sq photo-add';
    addBtn.onclick = addExtraPhoto;
    addBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Dagdag</span>`;
    strip.appendChild(addBtn);
  }

  // Show/hide empty state
  const empty = document.getElementById('photo-strip-empty');
  if (empty) empty.style.display = S.photos.length ? 'none' : 'flex';
}

function initConfirm() {
  updateConfirmTimestamp();
  renderPhotoStrip();
  document.getElementById('c-type').textContent = S.aiType ? `${S.aiEmoji} ${S.aiType}` : '⚠️ Di pa na-classify';
  document.getElementById('c-dept').textContent  = S.aiDept ? `Ipapadala sa: ${S.aiDept}` : 'Pumili ng uri sa compose';
  document.getElementById('type-icon').textContent = S.aiEmoji || '⚠️';

  if (typeof enhanceConfirmWithAI === 'function') enhanceConfirmWithAI();

  document.getElementById('c-address').textContent = S.address || 'Naglo-load...';
  if (S.coords) {
    document.getElementById('c-coords').textContent =
      `${S.coords.lat.toFixed(5)}°N, ${S.coords.lng.toFixed(5)}°E · ±${Math.round(S.coords.acc)}m`;
  }

  // ── DITO NAGBAGO: GPS CHIPS & BUTTON BLOCKER ──
  const btnSend = document.querySelector('.confirm-actions .btn-primary');
  
  if (S.coords) {
    const acc = S.coords.acc;
    const chip = document.getElementById('chip-acc');
    chip.className = acc <= 80 ? 'vchip ok' : 'vchip bad'; // Nagiging pula kapag > 80
    chip.innerHTML = `<div class="vdot ${acc<=80?'ok':'bad'}"></div>±${Math.round(acc)}m`;

    if (acc > 80) {
      btnSend.style.opacity = '0.5';
      btnSend.style.pointerEvents = 'none'; // I-disable ang pindutan
      btnSend.innerHTML = `⚠️ MAHINA ANG GPS (±${Math.round(acc)}m)`;
    } else {
      btnSend.style.opacity = '1';
      btnSend.style.pointerEvents = 'auto'; // I-enable ang pindutan
      btnSend.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> IPADALA ANG ULAT`;
    }
  } else {
    btnSend.style.opacity = '0.5';
    btnSend.style.pointerEvents = 'none';
    btnSend.innerHTML = `📍 NAGHAHANAP NG GPS...`;
  }

  setTimeout(buildMap, 180);
}

function buildMap() {
  if (S.map) { S.map.remove(); S.map = null; }
  const lat = S.coords?.lat ?? 14.8292;
  const lng = S.coords?.lng ?? 121.0457;

  S.map = L.map('confirm-map', {
    center: [lat, lng], zoom: 16,
    zoomControl: true, attributionControl: false,
    dragging: true, scrollWheelZoom: false, tap: false
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(S.map);

  const pinIcon = L.divIcon({
    className: '', html: '<div class="map-pin-div"></div>',
    iconSize: [28, 28], iconAnchor: [14, 28]
  });
  S.mapMarker = L.marker([lat, lng], { icon: pinIcon }).addTo(S.map);
  S.map.invalidateSize();
}

// ══════════════════════════════
// COUNTDOWN
// ══════════════════════════════
function startCountdown() {
  const ov = document.getElementById('countdown-overlay');
  const el = document.getElementById('cd-num');
  S.cdVal = 5; el.textContent = 5;
  ov.classList.add('active');
  S.cdTimer = setInterval(() => {
    S.cdVal--;
    el.textContent = S.cdVal;
    if (S.cdVal <= 0) {
      clearInterval(S.cdTimer);
      ov.classList.remove('active');
      navTo('screen-done');
    }
  }, 1000);
}
function cancelCountdown() {
  clearInterval(S.cdTimer);
  document.getElementById('countdown-overlay').classList.remove('active');
  showToast('Kanselado ang pagpapadala');
}

// ══════════════════════════════
// DONE SCREEN
// ══════════════════════════════
function initDone() {
  document.getElementById('done-ref').textContent = S.refNum || `DRR-${Date.now()}`;
  document.getElementById('done-desc').textContent =
    `Naipadala na ang iyong ulat sa ${S.aiDept || 'kaukulang departamento'}. Mangyaring maghintay at manatiling ligtas.`;
  document.getElementById('done-dispatch').innerHTML =
    `📢 Naipadala sa: ${S.aiDept || 'CDRRMO'}<br>⏱ Response time: ~5–10 minuto`;
  saveReport();
}

// ══════════════════════════════
// REPORT HISTORY (localStorage)
// ══════════════════════════════
const REPORTS_KEY = 'tulong_reports';

function saveReport() {
  const reports = loadReports();
  const report = {
    refNum:      S.refNum,
    aiType:      S.aiType   || 'Di na-classify',
    aiDept:      S.aiDept   || 'CDRRMO',
    aiEmoji:     S.aiEmoji  || '⚠️',
    aiDesc:      S.aiDescription || '',
    address:     S.address  || 'Hindi nakuha ang lokasyon',
    coords:      S.coords   ? { lat: S.coords.lat, lng: S.coords.lng } : null,
    photo:       S.photos && S.photos.length ? S.photos[0] : null, // save first photo thumbnail
    timestamp:   Date.now(),
  };
  // Avoid duplicate if somehow called twice
  if (!reports.find(r => r.refNum === report.refNum)) {
    reports.unshift(report); // newest first
    // cap at 50 reports
    if (reports.length > 50) reports.length = 50;
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
  }
}

function loadReports() {
  try {
    return JSON.parse(localStorage.getItem(REPORTS_KEY)) || [];
  } catch { return []; }
}

function deleteReport(refNum) {
  const reports = loadReports().filter(r => r.refNum !== refNum);
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
}

function deleteAllReports() {
  localStorage.removeItem(REPORTS_KEY);
}

// ── Screen: Mga Ulat (list) ──
function initReports() {
  const list    = document.getElementById('reports-list');
  const empty   = document.getElementById('reports-empty');
  const reports = loadReports();

  list.innerHTML = '';
  if (!reports.length) {
    empty.style.display = 'flex';
    list.style.display  = 'none';
    return;
  }
  empty.style.display = 'none';
  list.style.display  = 'flex';

  reports.forEach(r => {
    const date = new Date(r.timestamp);
    const dateStr = date.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'rpt-item';
    item.innerHTML = `
      <div class="rpt-thumb">${r.photo ? `<img src="${r.photo}" alt="">` : `<span>${r.aiEmoji}</span>`}</div>
      <div class="rpt-info">
        <div class="rpt-ref">${r.refNum}</div>
        <div class="rpt-addr">${r.address}</div>
        <div class="rpt-date">Reported on ${dateStr}</div>
      </div>
      <button class="rpt-menu-btn" onclick="openReportDetail('${r.refNum}')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>`;
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.rpt-menu-btn')) openReportDetail(r.refNum);
    });
    list.appendChild(item);
  });
}

function confirmDeleteAll() {
  if (!loadReports().length) { showToast('Walang ulat na ide-delete'); return; }
  if (!confirm('I-delete ang lahat ng saved reports?')) return;
  deleteAllReports();
  initReports();
  showToast('🗑️ Lahat ng ulat na-delete');
}

// ── Screen: Report Detail ──
function openReportDetail(refNum) {
  const report = loadReports().find(r => r.refNum === refNum);
  if (!report) { showToast('Report not found'); return; }

  // Fill detail screen
  document.getElementById('detail-ref-sub').textContent  = refNum;
  document.getElementById('detail-type-icon').textContent = report.aiEmoji;
  document.getElementById('detail-type-val').textContent  = report.aiType;
  document.getElementById('detail-type-sub').textContent  = `Ipapadala sa: ${report.aiDept}`;
  document.getElementById('detail-addr-val').textContent  = report.address;
  if (report.coords) {
    document.getElementById('detail-coords').textContent = `${report.coords.lat.toFixed(5)}°N, ${report.coords.lng.toFixed(5)}°E`;
  } else {
    document.getElementById('detail-coords').textContent = '';
  }
  const date = new Date(report.timestamp);
  const dateStr = date.toLocaleString('fil-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  document.getElementById('detail-time-val').textContent = dateStr;
  document.getElementById('detail-refnum').textContent   = `REFNUM: ${report.refNum}`;

  // description
  const descWrap = document.getElementById('detail-desc-wrap');
  const descVal  = document.getElementById('detail-desc-val');
  if (report.aiDesc) {
    descVal.textContent = report.aiDesc;
    descWrap.style.display = 'block';
  } else {
    descWrap.style.display = 'none';
  }

  // photo
  const photoWrap = document.getElementById('detail-photo-wrap');
  const photoImg  = document.getElementById('detail-photo-img');
  if (report.photo) {
    photoImg.src = report.photo;
    photoWrap.style.display = 'block';
  } else {
    photoWrap.style.display = 'none';
  }

  // map
  initDetailMap(report);

  // delete button
  document.getElementById('detail-delete-btn').onclick = () => {
    if (!confirm(`I-delete ang report ${refNum}?`)) return;
    deleteReport(refNum);
    navBack();
    initReports();
    showToast('🗑️ Report na-delete');
  };

  navTo('screen-report-detail');
}

let detailMap = null;
function initDetailMap(report) {
  const mapEl = document.getElementById('detail-map');
  if (!report.coords) { mapEl.style.display = 'none'; return; }
  mapEl.style.display = 'block';

  if (detailMap) { detailMap.remove(); detailMap = null; }

  setTimeout(() => {
    detailMap = L.map('detail-map', { zoomControl: false, attributionControl: false })
      .setView([report.coords.lat, report.coords.lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(detailMap);
    const pin = L.divIcon({ className: '', html: '<div class="map-pin-div"></div>', iconSize: [28,28], iconAnchor: [14,28] });
    L.marker([report.coords.lat, report.coords.lng], { icon: pin }).addTo(detailMap);
    detailMap.invalidateSize();
  }, 120);
}

function shareReport() {
  if (navigator.share) {
    navigator.share({
      title: 'DRR Alert — Emergency Report',
      text: `Emergency report ${S.refNum}: ${S.aiType} sa ${S.address || 'aking lokasyon'}. Ipinadala via DRR Alert.`,
    }).catch(() => {});
  } else {
    showToast('Share hindi available sa browser na ito');
  }
}

// ══════════════════════════════
// COMPOSE SUBMIT
// ══════════════════════════════
const COMPOSE_MAP = {
  sunog:            { type: 'Sunog / Apoy',          dept: 'Bureau of Fire Protection (BFP)', emoji: '🔥' },
  baha:             { type: 'Baha / Tubig',           dept: 'CDRRMO / DSWD',                  emoji: '🌊' },
  aksidente:        { type: 'Aksidente / Banggaan',   dept: 'PNP + Emergency Medical Services',emoji: '🚗' },
  medikal:          { type: 'Medikal / Sugat',        dept: 'Rural Health Unit / EMS',         emoji: '🏥' },
  krimen:           { type: 'Krimen / Banta',         dept: 'Philippine National Police',      emoji: '🚔' },
  lindol:           { type: 'Lindol / Pagyanig',      dept: 'CDRRMO / NDRRMC',                 emoji: '🌍' },
  'sunog-kagubatan':{ type: 'Sunog ng Kagubatan',     dept: 'DENR + BFP',                      emoji: '🌿' },
  iba:              { type: 'Iba Pang Emergency',     dept: 'Barangay Hall / CDRRMO',          emoji: '⚠️' },
};

function submitCompose() {
  const type = document.getElementById('ctype').value;
  const desc = document.getElementById('cdesc').value.trim();
  if (!type) { showToast('⚠️ Pumili muna ng uri ng emergency'); return; }
  if (desc.length < 10) { showToast('⚠️ Magbigay ng mas detalyadong paglalarawan'); return; }

  const pick = COMPOSE_MAP[type] || COMPOSE_MAP.iba;
  S.aiType   = pick.type;
  S.aiDept   = pick.dept;
  S.aiEmoji  = pick.emoji;
  S.capturedPhoto = null;
  navTo('screen-confirm');
}

// ══════════════════════════════
// TOAST
// ══════════════════════════════
let _toastT;
function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = ' ' + msg;
  t.classList.add('show');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => t.classList.remove('show'), 3000);
}

// ══════════════════════════════
// PWA MANIFEST + SERVICE WORKER
// ══════════════════════════════
// Inject manifest dynamically
(function injectManifest() {
  const manifest = {
    name: 'DRR Alert — Barangay Emergency Response',
    short_name: 'DRR Alert',
    description: 'Mag-ulat ng emergency sa iyong barangay',
    start_url: '.',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#C0001A',
    icons: [
      { src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%23C0001A'/%3E%3Ctext x='96' y='136' font-size='110' text-anchor='middle'%3E🆘%3C/text%3E%3C/svg%3E", sizes: '192x192', type: 'image/svg+xml' },
      { src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='100' fill='%23C0001A'/%3E%3Ctext x='256' y='360' font-size='300' text-anchor='middle'%3E🆘%3C/text%3E%3C/svg%3E", sizes: '512x512', type: 'image/svg+xml' }
    ]
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const link = Object.assign(document.createElement('link'), {
    rel: 'manifest', href: URL.createObjectURL(blob)
  });
  document.head.appendChild(link);
})();

// Service worker for offline caching
if ('serviceWorker' in navigator) {
  const sw = `
    const CACHE='drr-v8';
    self.addEventListener('install', e => {
      self.skipWaiting();
      e.waitUntil(
        caches.open(CACHE).then(c => c.add(self.location.href))
      );
    });
    self.addEventListener('activate', e => {
      e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
      ));
    });
    self.addEventListener('fetch', e => {
      if (e.request.method !== 'GET') return;
      e.respondWith(
        caches.match(e.request).then(r => r ||
          fetch(e.request).then(res => {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
            return res;
          }).catch(() => caches.match(e.request))
        )
      );
    });
  `;
  const swBlob = new Blob([sw], { type: 'application/javascript' });
  navigator.serviceWorker.register(URL.createObjectURL(swBlob)).catch(() => {});
}

// ══════════════════════════════
// INIT
// ══════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Push initial browser history entry so the first back is catchable
  window.history.replaceState({ tulong: true }, '');
  initGPS();
  // Prevent pull-to-refresh on iOS
  document.addEventListener('touchmove', e => {
    if (e.target.closest('.screen-scroll')) return;
    e.preventDefault();
  }, { passive: false });
});

// ══════════════════════════════
// BACK GESTURE / HARDWARE BACK BUTTON INTERCEPTION
// ══════════════════════════════
window.addEventListener('popstate', () => {
  // Always re-push so there's always a state to catch next time
  window.history.pushState({ tulong: true }, '');
  if (S.history.length) {
    navBack();
  } else {
    // Already at home — warn instead of letting the app close
    showToast('📍 Nasa home ka na — i-swipe up para lumabas sa app');
  }
});
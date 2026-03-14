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
  cameraStream: null,
  facing: 'environment',
  flashOn: false,
  aiType: null,
  aiDept: null,
  aiEmoji: '⚠️',
  refNum: null,
  cdTimer: null,
  cdVal: 5,
  map: null,
  mapMarker: null,
};

// ══════════════════════════════
// NAVIGATION
// ══════════════════════════════
function navTo(id) {
  if (id === S.screen) return;
  const cur  = document.getElementById(S.screen);
  const next = document.getElementById(id);
  if (!cur || !next) return;
  S.history.push(S.screen);
  cur.classList.remove('active');
  cur.classList.add('exit');
  next.classList.add('active');
  S.screen = id;
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

function onGPSSuccess(pos) {
  const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
  S.coords = { lat, lng, acc };
  const latS = lat.toFixed(5);
  const lngS = lng.toFixed(5);
  const accR = Math.round(acc);
  setGPSText(`${latS}°N, ${lngS}°E`, acc < 40 ? 'good' : 'warn', `±${accR}m`);
  reverseGeocode(lat, lng);
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
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'fil,en' } }
    );
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
  S.capturedPhoto = null;
  S.aiType = null;
  navTo('screen-camera');
  // small delay so screen transition completes before getUserMedia fires
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
        setTimeout(() => { stopCamera(); navTo('screen-confirm'); }, 800);
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

  // show in gallery thumb
  const img = document.getElementById('gal-img');
  img.src = S.capturedPhoto; img.style.display = 'block';
  document.getElementById('gal-icon').style.display = 'none';

  // shutter flash
  flashShutter();
  showToast('📸 Larawan nakuha!');

  // run AI sim then go to confirm
  runAI(() => {
    setTimeout(() => { stopCamera(); navTo('screen-confirm'); }, 600);
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
      const img = document.getElementById('gal-img');
      img.src = S.capturedPhoto; img.style.display = 'block';
      document.getElementById('gal-icon').style.display = 'none';
      showToast('🖼️ Larawan pinili');
      runAI(() => {});
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

// ══════════════════════════════
// AI CLASSIFICATION (simulated)
// ══════════════════════════════
const AI_TYPES = [
  { type: 'Sunog / Apoy',         dept: 'Bureau of Fire Protection (BFP)', emoji: '🔥', conf: 94 },
  { type: 'Baha / Tubig',         dept: 'CDRRMO / Disaster Risk Office',   emoji: '🌊', conf: 88 },
  { type: 'Aksidente / Banggaan', dept: 'PNP + Emergency Medical Services', emoji: '🚗', conf: 91 },
  { type: 'Medikal / Emerhensya', dept: 'Rural Health Unit (RHU) / EMS',   emoji: '🏥', conf: 86 },
  { type: 'Krimen / Panganib',    dept: 'Philippine National Police (PNP)', emoji: '🚔', conf: 89 },
];

function runAI(cb) {
  const badge = document.getElementById('ai-badge');
  badge.style.display = 'none';
  document.getElementById('ai-type').textContent = '...';
  document.getElementById('ai-conf').textContent  = 'Nagsusuri...';

  setTimeout(() => {
    const pick = AI_TYPES[Math.floor(Math.random() * AI_TYPES.length)];
    S.aiType  = pick.type;
    S.aiDept  = pick.dept;
    S.aiEmoji = pick.emoji;
    document.getElementById('ai-type').textContent = `${pick.emoji} ${pick.type}`;
    document.getElementById('ai-conf').textContent  = `${pick.conf}% confidence · → ${pick.dept}`;
    badge.style.display = 'block';
    cb && cb();
  }, 900);
}

// ══════════════════════════════
// CONFIRM SCREEN
// ══════════════════════════════
function initConfirm() {
  // photo
  const img = document.getElementById('photo-preview');
  const plc = document.getElementById('photo-thumb');
  if (S.capturedPhoto) {
    img.src = S.capturedPhoto; img.style.display = 'block';
    plc.querySelector('i').style.display = 'none';
    plc.querySelector('span') && (plc.querySelector('span').style.display = 'none');
  } else {
    img.style.display = 'none';
  }

  // AI result
  document.getElementById('c-type').textContent = S.aiType ? `${S.aiEmoji} ${S.aiType}` : '⚠️ Di pa na-classify';
  document.getElementById('c-dept').textContent  = S.aiDept ? `Ipapadala sa: ${S.aiDept}` : 'Pumili ng uri sa compose';
  document.getElementById('type-icon').textContent = S.aiEmoji || '⚠️';

  // address
  document.getElementById('c-address').textContent = S.address || 'Naglo-load...';
  if (S.coords) {
    document.getElementById('c-coords').textContent =
      `${S.coords.lat.toFixed(5)}°N, ${S.coords.lng.toFixed(5)}°E · ±${Math.round(S.coords.acc)}m`;
  }

  // time & ref
  const now   = new Date();
  const DAYS  = ['Linggo','Lunes','Martes','Miyerkules','Huwebes','Biyernes','Sabado'];
  const MONS  = ['Ene','Peb','Mar','Abr','Mayo','Hun','Hul','Ago','Set','Okt','Nob','Dis'];
  const h     = now.getHours().toString().padStart(2,'0');
  const m     = now.getMinutes().toString().padStart(2,'0');
  document.getElementById('c-time').textContent =
    `${h}:${m} ${now.getHours()<12?'AM':'PM'} · ${DAYS[now.getDay()]}, ${MONS[now.getMonth()]} ${now.getDate()} ${now.getFullYear()}`;
  S.refNum = `DRR-${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}-${(1000+Math.floor(Math.random()*8999))}`;
  document.getElementById('c-ref').textContent = `REFNUM: ${S.refNum}`;

  // GPS chips
  if (S.coords) {
    const acc = S.coords.acc;
    const chip = document.getElementById('chip-acc');
    chip.className = acc < 30 ? 'vchip ok' : 'vchip warn';
    chip.innerHTML = `<div class="vdot ${acc<30?'ok':'warn'}"></div>±${Math.round(acc)}m`;
  }

  // map
  setTimeout(buildMap, 120);
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
    const CACHE='drr-v2';
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
  initGPS();
  // Prevent pull-to-refresh on iOS
  document.addEventListener('touchmove', e => {
    if (e.target.closest('.screen-scroll')) return;
    e.preventDefault();
  }, { passive: false });
});

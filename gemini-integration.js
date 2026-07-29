// ══════════════════════════════════════════════════════════════════════════
// TULONG! SYSTEM — GEMINI AI + FIREBASE INTEGRATION  v2.2 (Realtime DB)
// ──────────────────────────────────────────────────────────────────────────

// ── GEMINI CONFIG ──────────────────────────────────────────────────────────
const GEMINI_API_KEY = 'AIzaSyCeEQ0UiNIv7mebf201sj7o0IGKaq89vno';
const GEMINI_MODEL   = 'gemini-flash-lite-latest';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── ROBOFLOW CLASSIFICATION CONFIG ─────────────────────────────────────────
const ROBOFLOW_API_KEY = 'GAhmuwX9Goxrv4bgwjsR';
const ROBOFLOW_MODEL   = 'tulongaivision/2';

// ── FIREBASE CONFIG (REALTIME DATABASE VERSION) ────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD-iNn6FchuM3d1Rg-JhtTTGjXrCl1-tDw",
  authDomain: "csjdm-tulong.firebaseapp.com",
  projectId: "csjdm-tulong",
  databaseURL: "https://csjdm-tulong-default-rtdb.asia-southeast1.firebasedatabase.app", 
  storageBucket: "csjdm-tulong.firebasestorage.app",
  messagingSenderId: "545283314775",
  appId: "1:545283314775:web:359887a1cf18bafd773f12"
};

// ——— EMERGENCY TYPE CONFIG (OPTIMIZED FOR TULONG! APP) ———
const EMERGENCY_CONFIG = {
  'SUNOG':      { type: 'Sunog / Apoy', dept: 'Bureau of Fire Protection (BFP)', emoji: '🔥', responseTime: '5–8 minuto' },
  'BAHA':       { type: 'Baha / Tubig', dept: 'CDRRMO / Disaster Risk Office', emoji: '🌊', responseTime: '10–15 minuto' },
  'AKSIDENTE':  { type: 'Aksidente / Pagkaguho', dept: 'PNP + Emergency Medical Services / Rescue', emoji: '💥', responseTime: '5–10 minuto' },
  'MEDIKAL':    { type: 'Medikal / Emerhensya', dept: 'Rural Health Unit (RHU) / EMS', emoji: '🚑', responseTime: '5–10 minuto' },
  'KRIMEN':     { type: 'Krimen / Kaguluhan / Panganib', dept: 'Philippine National Police (PNP) / Tanod', emoji: '🚨', responseTime: '3–7 minuto' },
  'NORMAL':     { type: 'Ligtas / Payapa', dept: 'None (System Status: Clear)', emoji: '✨', responseTime: '0 minuto' },
  'UNKNOWN':    { type: 'Iba pa / Di Matukoy', dept: 'Barangay Hall / CDRRMO', emoji: '❓', responseTime: '10–15 minuto' }
};

// ══════════════════════════════════════════════════════════════════════════
// FIREBASE REALTIME DATABASE UPLOAD (With Strict Anonymous Auth)
// ══════════════════════════════════════════════════════════════════════════
async function getAnonymousAuthToken() {
  const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`;
  
  const response = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true })
  });

  if (!response.ok) {
    throw new Error('Failed to get Anonymous Auth Token');
  }

  const data = await response.json();
  return data.idToken; 
}

// ══════════════════════════════════════════════════════════════════════════
// FIREBASE STORAGE UPLOAD (REST API, walang SDK kailangan)
// ══════════════════════════════════════════════════════════════════════════
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function uploadImageToStorage(dataUrl, path) {
  const bucket = FIREBASE_CONFIG.storageBucket;
  if (!bucket) throw new Error('Walang storageBucket sa FIREBASE_CONFIG');

  const blob = dataUrlToBlob(dataUrl);
  const encodedPath = encodeURIComponent(path); 
  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodedPath}`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'image/jpeg' },
    body: blob
  });

  if (!res.ok) throw new Error(`Storage upload rejected: ${res.status}`);

  const data = await res.json();
  const token = data.downloadTokens; // present kapag naka-enable ang firebaseStorageDownloadTokens
  const base = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}`;
  return token ? `${base}?alt=media&token=${token}` : `${base}?alt=media`;
}

async function uploadPhotosToStorage(refNum, photos) {
  if (!photos || !photos.length) return [];
  const urls = [];
  for (let i = 0; i < photos.length; i++) {
    try {
      const path = `reports/${refNum}/photo_${i}.jpg`;
      const url = await uploadImageToStorage(photos[i], path);
      urls.push(url);
      console.log(`[TULONG Storage] ✅ Photo ${i} uploaded:`, url);
    } catch (err) {
      console.error(`[TULONG Storage] ❌ Photo ${i} failed:`, err);
    }
  }
  return urls;
}

async function uploadToFirebase() {
  const dbUrl = FIREBASE_CONFIG.databaseURL;

  if (!dbUrl || dbUrl.includes('REPLACE_')) return;
  if (!S.refNum) return;

  // Diretso sa .json endpoint nang walang query token requirement, sakto sa Spark Plan!
  const REALTIME_DB_URL = `${dbUrl}/reports/${S.refNum}.json`;

  // 1) I-upload muna ang mga larawan sa Firebase Storage
  let photoURLs = [];
  try {
    photoURLs = await uploadPhotosToStorage(S.refNum, S.photos);
  } catch (err) {
    console.error('[TULONG Storage] Upload batch failed:', err);
  }
  const storageUploadOk = photoURLs.length > 0 && photoURLs.length === (S.photos?.length ?? 0);

  const reportData = {
    refNum:             String(S.refNum ?? ''),
    submittedAt:        new Date().toISOString(),
    aiType:             String(S.aiType ?? ''),
    aiDept:             String(S.aiDept ?? ''),
    aiEmoji:            String(S.aiEmoji ?? ''),
    aiSeverity:         String(S.aiSeverity ?? ''),
    aiConfidence:       Number(S.aiConfidence ?? 0),
    aiDescription:      String(S.aiDescription ?? ''),
    aiAction:           String(S.aiAction ?? ''),
    aiAuthentic:        Boolean(S.aiAuthentic),
    aiAuthNote:         String(S.aiAuthNote ?? ''),
    emergencyType:      String(S.aiType ?? ''),
    address:            String(S.address ?? ''),
    latitude:           Number(S.coords?.lat ?? 0),
    longitude:          Number(S.coords?.lng ?? 0),
    gpsAccuracy:        Number(S.coords?.acc ?? 0),
    status:             'pending',
    photoURLs:          photoURLs,                    // ✅ Storage download URLs (bagong primary source)
    photoURL:           photoURLs[0] || '',            // convenience field — unang larawan
    photoCount:         Number(S.photos?.length ?? 0),
    // Fallback lang: base64 ng unang larawan, kapag bigo ang Storage upload.
    // Aalisin ito sa DB payload sa susunod na iteration kapag stable na ang Storage flow.
    photoBase64:        storageUploadOk ? '' : String(S.capturedPhoto ?? '')
  };

  try {
    console.log("[TULONG Firebase] Sending data to Realtime DB via Spark Plan gateway...");

    // Diretsong HTTP PUT request nang walang dalang security payload
    const res = await fetch(REALTIME_DB_URL, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(reportData)
    });

    if (!res.ok) throw new Error(`Upload rejected by Realtime DB: ${res.status}`);

    console.log(`[TULONG Firebase] ✅ Report uploaded successfully to Realtime DB: ${S.refNum}`);
    if (typeof showToast === 'function') {
      if (storageUploadOk) {
        showToast('☁️ Na-save ang report + larawan sa Firebase');
      } else if (S.photos?.length) {
        showToast('☁️ Na-save ang report (larawan gamit ang base64 fallback)');
      } else {
        showToast('☁️ Nai-save sa Realtime DB');
      }
    }

  } catch (err) {
    console.error('[TULONG Firebase] Realtime DB Upload failed:', err);
    if(typeof showToast === 'function') showToast('⚠️ Realtime DB upload failed — check console');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ROBOFLOW API
// ══════════════════════════════════════════════════════════════════════════
async function callRoboflow(base64Image) {
  const uploadUrl = `https://classify.roboflow.com/${ROBOFLOW_MODEL}?api_key=${ROBOFLOW_API_KEY}`;
  
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: base64Image
  });

  if (!response.ok) throw new Error(`Roboflow Error: ${response.status}`);

  const data = await response.json();
  
  if (data.predictions && Array.isArray(data.predictions) && data.predictions.length > 0) {
    const topClass = data.top;
    const match = data.predictions.find(p => p.class === topClass) || data.predictions[0];
    return { class: match.class.toUpperCase(), confidence: match.confidence * 100 };
  } else if (data.top && data.confidence) {
    return { class: data.top.toUpperCase(), confidence: data.confidence * 100 };
  }
  
  return { class: 'UNKNOWN', confidence: 0 };
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN AI FUNCTION: runAI()
// ══════════════════════════════════════════════════════════════════════════
async function runAI(cb) {
  const badge  = document.getElementById('ai-badge');
  const aiType = document.getElementById('ai-type');
  const aiConf = document.getElementById('ai-conf');

  badge.style.display = 'none';

  if (!S.capturedPhoto) {
    cb && cb();
    return;
  }

  badge.style.display = 'block';
  aiType.textContent  = 'Sinu-SURI...';
  aiConf.textContent  = 'Kina-classify ang data...';

  try {
    const base64Data = S.capturedPhoto.split(',')[1];
    const mimeType   = S.capturedPhoto.split(';')[0].split(':')[1] || 'image/jpeg';

    // 1. TAWAGIN ANG ROBOFLOW
    const roboResult = await callRoboflow(base64Data);

    aiConf.textContent  = 'Bumubuo ng Report...';

    // 2. RESTRUCTURED GEMINI PROMPT 
    const loc = S.address || "hindi matukoy na lokasyon";
    const promptText = `
      Ang AI Vision ay nag-classify sa larawang ito bilang: ${roboResult.class}.
      Lokasyon ng insidente: ${loc}.

      Ikaw ay isang mahigpit na emergency fraud detector at objective incident reporter. Suriin mong mabuti ang larawan.
      Bumuo ng maikling JSON response.
      {
        "severity": "<HIGH, MEDIUM, o LOW>",
        "is_authentic": <true o false. MAHALAGA: Mag-return ng FALSE kung ang larawan ay: (1) Picture ng isang computer screen, TV, o cellphone, (2) Halatang AI-generated, (3) Stock photo, meme, (4) SELFIE o nakangiting tao na walang kaugnayan sa emergency, o (5) Normal na kalsada, bahay, o paligid na WALA namang nagaganap na sakuna (walang apoy, baha, aksidente, o krimen). Mag-return ng TRUE LAMANG kung may malinaw na PISIKAL NA EBIDENSYA ng emergency.>,
        "authenticity_note": "<Kung false ang is_authentic, ipaliwanag nang maikli in Taglish kung bakit tinanggihan (hal. 'Ito ay isang selfie lamang at walang indikasyon ng sakuna.'). Kung true, iwanang blank.>",
        "taglish_description": "<1-2 pangungusap sa Taglish na PORMAL, ASSERTIVE, at OBHEKTIBO. Ilarawan LAMANG ang pisikal na nangyayari sa larawan at isama ang lokasyon. STRICT RULE: BAWAL gumamit ng mga emosyonal na reaksyon.>",
        "recommended_action": "<1 maikling, direktang aksyon para sa mga responder>"
      }
      Tumugon lamang sa JSON format.
    `;

    const requestBody = {
      contents: [{
        parts: [
          { text: promptText },
          { inline_data: { mime_type: mimeType, data: base64Data } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 300,
        responseMimeType: 'application/json',
      }
    };

    const response = await fetch(GEMINI_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) throw new Error('Gemini API error');
    
    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const geminiResult = JSON.parse(rawText);

    // 3. PAGSAMAHIN ANG RESULTS
    const config   = EMERGENCY_CONFIG[roboResult.class] || EMERGENCY_CONFIG['UNKNOWN'];
    const conf     = Math.round(roboResult.confidence);
    const severity = geminiResult.severity || 'MEDIUM';

    // Persist sa global state S
    S.aiType        = config.type;
    S.aiDept        = config.dept;
    S.aiEmoji       = config.emoji;
    S.aiSeverity    = severity;
    S.aiConfidence  = conf;
    S.aiDescription = geminiResult.taglish_description || '';  
    S.aiAction      = geminiResult.recommended_action  || '';
    S.aiAuthentic   = geminiResult.is_authentic        ?? true;
    S.aiAuthNote    = geminiResult.authenticity_note   || '';
    S.aiResponseTime = config.responseTime;

    // Update UI badge
    const sevTag = severity === 'HIGH' ? '🔴' : severity === 'MEDIUM' ? '🟡' : '🟢';
    aiType.textContent = `${config.emoji} ${config.type}`;
    aiConf.textContent = `${conf}% · ${sevTag} ${severity}`;

    if (!geminiResult.is_authentic) {
      showRejectionOverlay(geminiResult.authenticity_note || 'Hindi mukhang tunay na emergency photo.');
      return; 
    }

    cb && cb();

  } catch (err) {
    console.error('[TULONG AI] Error:', err);
    handleAIError(err, cb);
  }
}

function handleAIError(err, cb) {
  const aiType = document.getElementById('ai-type');
  const aiConf = document.getElementById('ai-conf');

  if(typeof showToast === 'function') showToast('⚠️ AI error — manwal na pagpili ang gagamitin');

  S.aiType        = 'Iba pa / Di Matukoy';
  S.aiDept        = 'Barangay Hall / CDRRMO';
  S.aiEmoji       = '❓';
  S.aiSeverity    = 'UNKNOWN';
  S.aiDescription = 'Nagkaroon ng error sa AI. Pakisuri at punan nang manwal ang detalye.';
  S.aiAuthentic   = true;

  if(aiType) aiType.textContent = '⚠️ Error';
  if(aiConf) aiConf.textContent = 'Manual fallback';

  cb && cb();
}

// ══════════════════════════════════════════════════════════════════════════
// REJECTION OVERLAY
// ══════════════════════════════════════════════════════════════════════════
function showRejectionOverlay(reason) {
  const existing = document.getElementById('rejection-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'rejection-overlay';
  overlay.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;padding:24px;`;

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px 24px 24px;max-width:340px;width:100%;text-align:center;">
      <div style="font-size:3rem;margin-bottom:4px;">🚫</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:1.25rem;font-weight:900;color:#b91c1c;margin-bottom:6px;text-transform:uppercase;">Hindi Natanggap ang Larawan</div>
      <div style="font-size:0.8rem;color:#6b7280;margin-bottom:16px;">Nadetektahan ng AI na hindi ito isang tunay na emergency photo.</div>
      <div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;padding:12px 14px;margin-bottom:20px;text-align:left;">
        <div style="font-size:0.68rem;font-weight:800;color:#b91c1c;margin-bottom:4px;">📋 DAHILAN NG PAGTANGGI:</div>
        <div style="font-size:0.82rem;color:#374151;font-weight:600;">${reason}</div>
      </div>
      <button onclick="dismissRejectionAndRetake()" style="width:100%;padding:13px;background:#C0001A;color:#fff;border:none;border-radius:12px;font-family:'Barlow Condensed',sans-serif;font-size:1rem;font-weight:800;cursor:pointer;margin-bottom:10px;">📷 KUMUHA ULIT NG LARAWAN</button>
      <button onclick="dismissRejectionAndGoHome()" style="width:100%;padding:11px;background:transparent;color:#6b7280;border:1.5px solid #e5e7eb;border-radius:12px;font-family:'Nunito',sans-serif;font-size:0.85rem;font-weight:700;cursor:pointer;">Bumalik sa Home</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function dismissRejectionAndRetake() {
  const overlay = document.getElementById('rejection-overlay');
  if (overlay) overlay.remove();
  S.capturedPhoto = null; S.photos = [];
  const galImg = document.getElementById('gal-img');
  const galIcon = document.getElementById('gal-icon');
  if (galImg) { galImg.src = ''; galImg.style.display = 'none'; }
  if (galIcon) galIcon.style.display = 'block';
  S.screen === 'screen-camera' ? startCamera() : (navTo('screen-camera'), setTimeout(() => startCamera(), 350));
}

function dismissRejectionAndGoHome() {
  const overlay = document.getElementById('rejection-overlay');
  if (overlay) overlay.remove();
  S.capturedPhoto = null; S.photos = [];
  goHome();
}

// ══════════════════════════════════════════════════════════════════════════
// CONFIRM SCREEN — AI CARD & MANUAL DROPDOWN OVERRIDE
// ══════════════════════════════════════════════════════════════════════════
function enhanceConfirmWithAI() {
  
  // ── INJECT MANUAL OVERRIDE DROPDOWN ──
  const cTypeDiv = document.getElementById('c-type');
  const cDeptDiv = document.getElementById('c-dept');
  const typeIconDiv = document.getElementById('type-icon');

  if (cTypeDiv && cDeptDiv) {
    let selectHtml = `<select id="manual-type-select" style="width:100%; padding:6px; border-radius:8px; font-weight:800; border:1px solid #ccc; font-family:inherit; font-size:0.82rem; margin-top:2px; background:#fff; color:#111; cursor:pointer;">`;
    
    Object.keys(EMERGENCY_CONFIG).forEach(key => {
      const conf = EMERGENCY_CONFIG[key];
      const isSelected = (conf.type === S.aiType) ? 'selected' : '';
      selectHtml += `<option value="${key}" ${isSelected}>${conf.emoji} ${conf.type}</option>`;
    });
    selectHtml += `</select>`;

    cTypeDiv.innerHTML = selectHtml;

    document.getElementById('manual-type-select').addEventListener('change', (e) => {
      const newKey = e.target.value;
      const newConf = EMERGENCY_CONFIG[newKey];
      
      S.aiType = newConf.type;
      S.aiDept = newConf.dept;
      S.aiEmoji = newConf.emoji;
      S.aiResponseTime = newConf.responseTime;

      cDeptDiv.textContent = `Ipapadala sa: ${newConf.dept}`;
      if (typeIconDiv) typeIconDiv.textContent = newConf.emoji;
    });
  }

  if (!S.aiType && !S.aiDescription && !S.aiAction) return;

  // ── AI Taglish Description Card ──
  let descCard = document.getElementById('ai-desc-card');
  if (descCard) descCard.remove();
  descCard = document.createElement('div');
  descCard.id = 'ai-desc-card';
  const infoCards = document.querySelector('.info-cards');
  if (infoCards) infoCards.insertAdjacentElement('beforebegin', descCard);

  const authentic = S.aiAuthentic;
  const borderColor = authentic ? '#22c55e' : '#ef4444';
  const bgColor     = authentic ? '#f0fdf4' : '#fef2f2';
  const headerColor = authentic ? '#15803d' : '#b91c1c';

  descCard.style.cssText = `margin:0 0 4px 0;padding:14px 16px 12px;background:${bgColor};border-top:3px solid ${borderColor};border-bottom:1px solid ${borderColor}20;`;

  descCard.innerHTML = `
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px;">
      <span style="font-size:1.1rem;">🤖</span>
      <span style="font-size:0.72rem;font-weight:800;color:${headerColor};letter-spacing:0.06em;text-transform:uppercase;">AI Incident Report</span>
      <span style="margin-left:auto;font-size:0.62rem;font-weight:700;background:${borderColor};color:#fff;padding:2px 7px;border-radius:20px;">${S.aiConfidence ?? '?'}% accuracy</span>
    </div>
    <div style="font-family:'Nunito',sans-serif;font-size:0.92rem;font-weight:600;color:#1e293b;line-height:1.6;background:#fff;border-radius:10px;padding:10px 12px;border:1.5px solid ${borderColor}40;margin-bottom:9px;">
      ${S.aiDescription}
    </div>
    <div style="font-size:0.68rem;color:#64748b;font-style:italic;line-height:1.5;">
      ✏️ Maaari mong palitan ang "Uri ng Emergency" sa ibaba kung nagkamali ang AI.
    </div>
  `;

  // ── Technical Action Card (Dispatcher) ──
  let summaryCard = document.getElementById('ai-summary-card');
  if (summaryCard) summaryCard.remove();
  
  if (S.aiAction) {
    summaryCard = document.createElement('div');
    summaryCard.id = 'ai-summary-card';
    summaryCard.style.cssText = 'margin: 4px 0 0 0;';
    const infoCardsForSummary = document.querySelector('.info-cards');
    if (infoCardsForSummary) infoCardsForSummary.insertAdjacentElement('afterend', summaryCard);

    const sevColor = S.aiSeverity === 'HIGH' ? '#dc2626' : S.aiSeverity === 'MEDIUM' ? '#d97706' : '#16a34a';
    const sevBg    = S.aiSeverity === 'HIGH' ? '#fef2f2'  : S.aiSeverity === 'MEDIUM' ? '#fffbeb'  : '#f0fdf4';

    summaryCard.innerHTML = `
      <details style="padding:12px 16px;background:${sevBg};border-top:2px solid ${sevColor}30;cursor:pointer;">
        <summary style="list-style:none;display:flex;align-items:center;gap:7px;user-select:none;">
          <span style="font-size:0.7rem;font-weight:800;color:${sevColor};letter-spacing:0.05em;">📋 DISPATCHER ACTION (${S.aiSeverity})</span>
          <span style="margin-left:auto;font-size:0.68rem;color:#94a3b8;">i-tap ▾</span>
        </summary>
        <div style="margin-top:10px;font-size:0.78rem;color:#374151;line-height:1.55;">
          <div style="padding:8px 10px;background:#fff;border-radius:8px;border:1.5px solid ${sevColor}30;">
            <strong style="color:${sevColor};">📌 Recommended Action:</strong><br>${S.aiAction}
          </div>
          <div style="margin-top:8px;font-size:0.68rem;color:#94a3b8;">⏱ Est. response time: ${S.aiResponseTime || '5–10 minuto'}</div>
        </div>
      </details>
    `;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// HOOK: Intercept startCountdown()
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const _origStartCountdown = window.startCountdown;
  if (typeof _origStartCountdown === 'function') {
    window.startCountdown = function () {
      uploadToFirebase().catch(console.error);
      _origStartCountdown.apply(this, arguments);
    };
  } else {
    setTimeout(() => {
      const fn = window.startCountdown;
      if (typeof fn === 'function') {
        window.startCountdown = function () {
          uploadToFirebase().catch(console.error);
          fn.apply(this, arguments);
        };
      }
    }, 500);
  }
});// ══════════════════════════════════════════════════════════════════════════
// HOOK: Intercept startCountdown()
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const wrapCountdown = (fn) => {
    return function () {
      if (!S.coords || S.coords.acc > 80) {
        const accVal = S.coords ? Math.round(S.coords.acc) : 'N/A';
        if(typeof showToast === 'function') showToast(`⚠️ Accuracy: ±${accVal}m. Maghintay ng mas malinaw na GPS signal.`);
        return; // Pigilan ang pagpapatuloy ng system
      }
      uploadToFirebase().catch(console.error);
      fn.apply(this, arguments);
    };
  };

  const _origStartCountdown = window.startCountdown;
  if (typeof _origStartCountdown === 'function') {
    window.startCountdown = wrapCountdown(_origStartCountdown);
  } else {
    setTimeout(() => {
      const fn = window.startCountdown;
      if (typeof fn === 'function') {
        window.startCountdown = wrapCountdown(fn);
      }
    }, 500);
  }
});
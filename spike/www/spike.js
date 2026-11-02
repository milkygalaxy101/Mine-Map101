// THROWAWAY week-1 device spike for URCI Field (eng review R13).
// Measures on a real phone: SAF folder, <=2048 px capture + canvas stamp, crash-safe SAF writes,
// 20-photo PDF built in a Web Worker that reads photos via https://localhost/_saf/ (no base64 reads),
// fused vs native GPS (with the fix recorded at camera launch), clock drift, folder listing speed.
'use strict';

const C = window.Capacitor;
const Spike = C.registerPlugin('UrciSpike');
const Camera = C.registerPlugin('Camera');
const Geo = C.registerPlugin('Geolocation');

const results = { device: navigator.userAgent, startedAt: new Date().toISOString(), steps: [] };
const photos = []; // relative paths in the data folder
let lastFix = null; // most recent fused fix (OV-5: record at camera launch)
let watchId = null;

const $ = (id) => document.getElementById(id);
const logEl = $('log');

const statusEl = $('status');
function status(msg, bad) {
  statusEl.textContent = msg;
  statusEl.className = bad ? 'bad' : '';
}
// Any script error or rejected promise shows at the top, not only in the log at the bottom.
window.addEventListener('error', (e) => { status('ERROR skrip: ' + e.message, true); log('ERROR skrip: ' + e.message, 'bad'); });
window.addEventListener('unhandledrejection', (e) => {
  const m = (e.reason && (e.reason.code || e.reason.message)) || String(e.reason);
  status('ERROR: ' + m, true); log('ERROR: ' + m, 'bad');
});

function log(msg, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg; // textContent only (SEC-1)
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
function record(step, data, ok = true) {
  results.steps.push({ step, ok, at: new Date().toISOString(), ...data });
  const line = `${ok ? 'OK ' : 'GAGAL '}${step}: ${JSON.stringify(data)}`;
  log(line, ok ? 'ok' : 'bad');
  status(line, !ok);
}
function ms(t0) { return Math.round(performance.now() - t0); }
function enable(...ids) { ids.forEach((id) => { $(id).disabled = false; }); }

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- 1. folder ----------
$('btnFolder').onclick = async () => {
  status('Membuka pemilih folder…');
  const t0 = performance.now();
  // If the picker never appears, say so instead of doing nothing.
  let pickerShown = false;
  const onHide = () => { if (document.hidden) { pickerShown = true; clearTimeout(timer); } };
  document.addEventListener('visibilitychange', onHide);
  const timer = setTimeout(() => status('Pemilih folder belum muncul setelah 20 dtk. Kirim tangkapan layar ini.', true), 20000);
  try {
    const r = await Spike.pickFolder();
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onHide);
    record('folder', { ms: ms(t0), uri: r.uri, pickerShown });
    enable('btnPhoto', 'btnSaveJson', 'btnList', 'btnExport');
  } catch (e) {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onHide);
    record('folder', { pickerShown, error: e.code || e.message || String(e), message: e.message }, false);
  }
};

// ---------- GPS watch (warm-up) ----------
async function startWatch() {
  try {
    await Geo.requestPermissions();
    watchId = await Geo.watchPosition({ enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }, (pos, err) => {
      if (pos) lastFix = pos;
    });
  } catch (e) { log('watch gagal: ' + (e.message || e), 'warn'); }
}
startWatch();

// ---------- 2. capture + stamp ----------
$('btnPhoto').onclick = async () => {
  const step = {};
  try {
    const fixAtLaunch = lastFix ? { acc: lastFix.coords.accuracy, ageMs: Date.now() - lastFix.timestamp } : null;
    step.fixAtLaunch = fixAtLaunch;
    const t0 = performance.now();
    // camera 8 API: takePhoto with target size (R7: downscale before JS)
    const photo = await Camera.takePhoto({ quality: 100, targetWidth: 2048, targetHeight: 2048,
      correctOrientation: true, saveToGallery: false });
    step.cameraMs = ms(t0);
    if (!photo.uri) throw new Error('no photo uri');

    // fresh fix on resume (OV-5), max 10 s (CEO D18)
    const tFix = performance.now();
    let fix = null;
    try { fix = await Geo.getCurrentPosition({ enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 }); }
    catch (e) { step.fixError = e.message || String(e); }
    step.fixAfterResumeMs = ms(tFix);
    if (fix) step.fixAcc = Math.round(fix.coords.accuracy);

    // decode (must already be <= 2048 px: R7)
    const tDec = performance.now();
    const img = new Image();
    img.src = C.convertFileSrc(photo.uri);
    await img.decode();
    step.decodeMs = ms(tDec);
    step.width = img.naturalWidth; step.height = img.naturalHeight;
    step.resizeHonored = Math.max(img.naturalWidth, img.naturalHeight) <= 2048;

    // stamp after fonts are loaded (OV-13)
    const tStamp = performance.now();
    await document.fonts.load('400 32px "IBM Plex Mono"');
    const cv = $('cv');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const lines = ['83 KERITING · S', `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      'I-HR01/S03/SU2', fix ? `${fix.coords.latitude.toFixed(5)}, ${fix.coords.longitude.toFixed(5)} ±${Math.round(fix.coords.accuracy)}m` : 'GPS: n/a'];
    const fs = Math.round(cv.width / 40);
    ctx.font = `400 ${fs}px "IBM Plex Mono"`;
    const pw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + fs;
    const ph = lines.length * fs * 1.4 + fs * 0.6;
    ctx.fillStyle = 'rgba(20,23,26,0.82)';
    ctx.fillRect(fs * 0.5, cv.height - ph - fs * 0.5, pw, ph);
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, fs, cv.height - ph - fs * 0.5 + fs * 1.3 * (i + 1)));
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.85));
    step.stampMs = ms(tStamp);
    step.jpegBytes = blob.size;

    // write via plugin (spike uses base64 for writes; measure its cost)
    const tB64 = performance.now();
    const b64 = await blobToBase64(blob);
    step.base64Ms = ms(tB64);
    const name = `spike/photo-${photos.length + 1}.jpg`;
    const w = await Spike.writeFileSafe({ path: name, base64: b64 });
    step.write = w;
    photos.push(name);

    // display via URL handler (R9)
    const tShow = performance.now();
    const thumb = new Image();
    thumb.src = `/_saf/${name}?t=${Date.now()}`;
    await thumb.decode();
    step.urlHandlerDisplayMs = ms(tShow);
    $('thumbs').appendChild(thumb);
    record('photo', step, step.resizeHonored);
    enable('btnPdf');
  } catch (e) { record('photo', { ...step, error: e.code || e.message || String(e) }, false); }
};

// ---------- 3. crash-safe JSON writes ----------
$('btnSaveJson').onclick = async () => {
  const runs = [];
  try {
    for (let i = 1; i <= 3; i++) {
      const body = JSON.stringify({ uuid: 'spike', rev: { me: i }, savedAt: new Date().toISOString(), filler: 'x'.repeat(4000) });
      runs.push(await Spike.writeFileSafe({ path: 'spike/inspection.json', text: body }));
    }
    const allNamed = runs.every((r) => r.finalName === 'inspection.json');
    record('safeReplace', { runs, finalNameStable: allNamed }, allNamed);
  } catch (e) { record('safeReplace', { runs, error: e.code || e.message }, false); }
};

// ---------- 4. 20-photo PDF in worker ----------
$('btnPdf').onclick = async () => {
  if (!photos.length) return;
  const urls = Array.from({ length: 20 }, (_, i) => `${location.origin}/_saf/${photos[i % photos.length]}`);
  const t0 = performance.now();
  let longestFrameGap = 0, last = performance.now();
  let raf = true;
  const tick = () => { const n = performance.now(); longestFrameGap = Math.max(longestFrameGap, n - last); last = n; if (raf) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const worker = new Worker('pdf.worker.js');
  worker.onmessage = async (ev) => {
    const m = ev.data;
    if (m.type === 'progress') { log(`PDF ${m.done}/${m.total}`); return; }
    raf = false;
    worker.terminate();
    if (m.type === 'error') { record('pdf20', { error: m.error }, false); return; }
    const buildMs = ms(t0);
    const tW = performance.now();
    try {
      const b64 = await blobToBase64(new Blob([m.pdf], { type: 'application/pdf' }));
      const w = await Spike.writeFileSafe({ path: 'spike/test-20.pdf', base64: b64 });
      record('pdf20', { buildMs, writeMs: ms(tW), pdfBytes: m.pdf.byteLength, longestMainThreadFrameGapMs: Math.round(longestFrameGap), write: w });
    } catch (e) { record('pdf20', { buildMs, error: e.code || e.message }, false); }
  };
  worker.postMessage({ urls });
};

// ---------- 5. GPS ----------
$('btnGps').onclick = async () => {
  const t0 = performance.now();
  try {
    const p = await Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 60000, maximumAge: 0 });
    record('gpsFused', { fixMs: ms(t0), acc: Math.round(p.coords.accuracy) });
  } catch (e) { record('gpsFused', { ms: ms(t0), error: e.message || String(e) }, false); }
};
$('btnNative').onclick = async () => {
  try {
    const r = await Spike.nativeFix({ timeoutMs: 120000 });
    const driftSec = Math.round((r.phoneTime - r.gpsTime) / 1000);
    record('gpsNative', { fixMs: r.fixMs, acc: Math.round(r.accuracy), clockDriftSec: driftSec, driftOver5min: Math.abs(driftSec) > 300 });
  } catch (e) { record('gpsNative', { error: e.code || e.message }, false); }
};

// ---------- 6. listing + space ----------
$('btnList').onclick = async () => {
  try {
    const l = await Spike.list({ path: 'spike' });
    const f = await Spike.freeSpace();
    record('listAndSpace', { entries: l.names.length, listMs: Math.round(l.ms), freeMB: Math.round(f.freeBytes / 1048576) });
  } catch (e) { record('listAndSpace', { error: e.code || e.message }, false); }
};

// ---------- 7. export ----------
$('btnExport').onclick = async () => {
  results.finishedAt = new Date().toISOString();
  try {
    await Spike.writeFileSafe({ path: 'spike/spike-results.json', text: JSON.stringify(results, null, 2) });
    log('Disimpan: spike/spike-results.json di folder data. Kirim file ini ke pengembang.', 'ok');
  } catch (e) { log('Gagal simpan hasil: ' + (e.code || e.message), 'bad'); }
};

(async () => {
  const wv = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [, '?'])[1];
  const native = !!(C && C.isNativePlatform && C.isNativePlatform());
  const hasPlugin = !!(C && C.isPluginAvailable && C.isPluginAvailable('UrciSpike'));
  let d = {};
  try { d = await Spike.diag(); } catch (e) { d = { diagError: e.code || e.message }; }
  results.diag = { webview: wv, native, hasPlugin, ...d };
  const msg = `Siap. Android ${d.release || '?'} (SDK ${d.sdk || '?'}) ${d.model || ''}\nWebView ${wv} · plugin ${hasPlugin ? 'OK' : 'TIDAK ADA'} · pemilih folder ${d.hasFolderPicker === false ? 'TIDAK ADA' : d.hasFolderPicker ? 'OK' : '?'}`;
  const bad = !native || !hasPlugin || d.hasFolderPicker === false || d.diagError;
  status(msg + (d.diagError ? `\ndiag: ${d.diagError}` : ''), bad);
  log(msg, bad ? 'bad' : 'ok');
})();

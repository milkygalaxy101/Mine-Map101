// Photo stamp (burned in, never redrawn): distress · level, date/time, location code, GPS.
// Example: "83 BERGELOMBANG · SEDANG / 03/11/2026 10:11 / I-HR01/S03/SU2 / -2.98712, 115.42301 ±4m"
(function (root) {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');

  function stampLines({ code, shortName, sevName, at, branch, section, sampleUnit, fix, gpsNa }) {
    const d = new Date(at);
    return [
      `${code} ${shortName.toUpperCase()} · ${sevName.toUpperCase()}`,
      `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      `${branch}/${section}/SU${sampleUnit}`,
      fix ? `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)} ±${Math.round(fix.acc)}m` : gpsNa,
    ];
  }

  async function loadImage(url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  }

  // url: downscaled image (<= 2048 px). Returns a JPEG Blob at quality 0.85 (design: stamp.js).
  async function stampPhoto(url, lines) {
    try { await document.fonts.load('400 32px "IBM Plex Mono"'); } catch (e) { /* fallback font is acceptable */ }
    const img = await loadImage(url);
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const fs = Math.max(16, Math.round(Math.min(cv.width, cv.height) / 28));
    ctx.font = `400 ${fs}px "IBM Plex Mono", monospace`;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + fs;
    const lh = fs * 1.35;
    const h = lines.length * lh + fs * 0.6;
    const x = fs * 0.5;
    const y = cv.height - h - fs * 0.5;
    ctx.fillStyle = 'rgba(20,23,26,0.82)';
    ctx.fillRect(x, y, Math.min(w, cv.width - fs), h);
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'alphabetic';
    lines.forEach((l, i) => ctx.fillText(l, x + fs * 0.5, y + fs * 0.3 + lh * (i + 1) - fs * 0.3));
    return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.85));
  }

  function photoName(code, sev, at, uuid) {
    const d = new Date(at);
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `${code}-${sev}-${ts}-${uuid.replace(/-/g, '').slice(0, 8)}.jpg`;
  }

  root.UrciStamp = { stampLines, stampPhoto, photoName };
})(typeof self !== 'undefined' ? self : this);

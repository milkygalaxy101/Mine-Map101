// Photo stamp (burned in, never redrawn): distress · level, date/time, location code, GPS.
// Example: "83 BERGELOMBANG · SEDANG / 03/11/2026 10:11 / I-HR01/S03/SU2 / -2.98712, 115.42301 ±4m"
(function (root) {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');

  // marker: first line for gallery imports ("IMPOR GALERI" / "IMPOR GALERI · WAKTU MANUAL"); never on camera photos.
  // EXIF GPS has no accuracy, so its line has no ±.
  function stampLines({ code, shortName, sevName, at, branch, section, sampleUnit, fix, gpsNa, marker }) {
    const d = new Date(at);
    const gps = !fix ? gpsNa : `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}${Number.isFinite(fix.acc) ? ` ±${Math.round(fix.acc)}m` : ''}`;
    return [
      ...(marker ? [marker] : []),
      `${code} ${shortName.toUpperCase()} · ${sevName.toUpperCase()}`,
      `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      `${branch}/${section}/SU${sampleUnit}`,
      gps,
    ];
  }

  // EXIF DateTimeOriginal "YYYY:MM:DD HH:MM:SS" (+ optional OffsetTimeOriginal "+08:00") -> epoch ms, or null.
  // Without an offset the time is the phone's local time (the crew's own time zone).
  function parseExifTime(dto, offset) {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(dto || '').trim());
    if (!m) return null;
    const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
    if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
    const o = /^([+-])(\d{2}):(\d{2})$/.exec(String(offset || '').trim());
    let ms;
    if (o) ms = Date.UTC(y, mo - 1, d, h, mi, se) - (o[1] === '-' ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3])) * 60000;
    else ms = new Date(y, mo - 1, d, h, mi, se).getTime();
    const back = new Date(ms);
    return Number.isFinite(ms) && (o || back.getDate() === d) ? ms : null;
  }

  // Browser test build only (the phone reads EXIF natively): DateTimeOriginal + OffsetTimeOriginal from a JPEG.
  function readExifTime(buf) {
    try {
      const v = new DataView(buf);
      if (v.getUint16(0) !== 0xffd8) return null;
      let p = 2;
      while (p + 4 <= v.byteLength) {
        const marker = v.getUint16(p);
        const len = v.getUint16(p + 2);
        if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) { // "Exif"
          const t = p + 10;
          const le = v.getUint16(t) === 0x4949;
          const u16 = (o) => v.getUint16(t + o, le);
          const u32 = (o) => v.getUint32(t + o, le);
          const ascii = (o, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = v.getUint8(t + o + i); if (!c) break; s += String.fromCharCode(c); } return s; };
          const tags = (ifd) => { const out = {}; const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), val: e + 8 }; } return out; };
          const ifd0 = tags(u32(4));
          if (!ifd0[0x8769]) return null;
          const ex = tags(u32(ifd0[0x8769].val));
          const str = (tg) => (tg && tg.type === 2 ? ascii(tg.count > 4 ? u32(tg.val) : tg.val, tg.count) : null);
          const dto = str(ex[0x9003]);
          return dto ? { dto, offset: str(ex[0x9011]) } : null;
        }
        if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
        p += 2 + len;
      }
    } catch (e) { /* not a readable JPEG: no time */ }
    return null;
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

  root.UrciStamp = { stampLines, stampPhoto, photoName, parseExifTime, readExifTime };
})(typeof self !== 'undefined' ? self : this);

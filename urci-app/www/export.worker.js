// Builds the inspection PDF off the main thread (eng R3). Photos are fetched by URL (/_saf/... on the phone,
// blob: in the browser test build), never passed as base64 through the bridge (eng R9). Each photo's SHA-256
// is re-checked against the record (HASH-1) and marked "FOTO DIUBAH" when it no longer matches.
'use strict';
importScripts('vendor/jspdf.umd.min.js', 'pdf-sheet.js');

async function b64(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

self.onmessage = async (ev) => {
  try {
    const { data, photos } = ev.data;
    const fonts = {
      regular: await b64('pdf-fonts/Barlow-Regular.ttf'),
      semibold: await b64('pdf-fonts/Barlow-SemiBold.ttf'),
      mono: await b64('pdf-fonts/IBMPlexMono-Regular.ttf'),
    };
    const loaded = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      self.postMessage({ type: 'progress', done: i, total: photos.length });
      try {
        const res = await fetch(p.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
        const actual = await sha256Hex(bytes);
        loaded.push({ ...p, bytes, tampered: !!p.sha256 && actual !== p.sha256 });
      } catch (e) {
        loaded.push({ ...p, missing: true });
      }
    }
    const usable = loaded.filter((p) => !p.missing);
    const doc = self.UrciPdfSheet.build(self.jspdf.jsPDF, {
      ...data, fonts, photos: usable, tampered: usable.some((p) => p.tampered), missingPhotos: loaded.filter((p) => p.missing).map((p) => p.name),
    });
    const pdf = doc.output('arraybuffer');
    self.postMessage({ type: 'done', pdf, missing: loaded.filter((p) => p.missing).map((p) => p.name) }, [pdf]);
  } catch (e) {
    self.postMessage({ type: 'error', error: String((e && e.message) || e) });
  }
};

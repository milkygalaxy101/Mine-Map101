// THROWAWAY spike worker: builds a 20-page PDF, fetching photos straight from the
// app-local URL handler (https://localhost/_saf/...) so no base64 crosses the bridge (eng R9).
'use strict';
importScripts('vendor/jspdf.umd.min.js');

// Fit an image inside a box without changing its shape (portrait photos must not be squashed to 4:3).
function fitBox(imgW, imgH, boxW, boxH) {
  const k = Math.min(boxW / imgW, boxH / imgH);
  return { w: imgW * k, h: imgH * k };
}
self.fitBox = fitBox;

self.onmessage = async (ev) => {
  try {
    const { urls } = ev.data;
    const { jsPDF } = self.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    for (let i = 0; i < urls.length; i++) {
      const res = await fetch(urls[i], { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch ' + res.status + ' ' + urls[i]);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (i > 0) doc.addPage();
      doc.setFontSize(11);
      doc.text('Lampiran foto ' + (i + 1) + ' / ' + urls.length + ' - URCI Spike', 15, 15);
      // A4 = 210 x 297 mm: 15 mm side margins, photo area from y=22 to 15 mm above the bottom
      const props = doc.getImageProperties(bytes);
      const box = { x: 15, y: 22, w: 180, h: 297 - 22 - 15 };
      const f = fitBox(props.width, props.height, box.w, box.h);
      doc.addImage(bytes, 'JPEG', box.x + (box.w - f.w) / 2, box.y, f.w, f.h);
      self.postMessage({ type: 'progress', done: i + 1, total: urls.length });
    }
    const pdf = doc.output('arraybuffer');
    self.postMessage({ type: 'done', pdf }, [pdf]);
  } catch (e) {
    self.postMessage({ type: 'error', error: String(e && e.message || e) });
  }
};

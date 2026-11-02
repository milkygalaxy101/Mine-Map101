// THROWAWAY spike worker: builds a 20-page PDF, fetching photos straight from the
// app-local URL handler (https://localhost/_saf/...) so no base64 crosses the bridge (eng R9).
'use strict';
importScripts('vendor/jspdf.umd.min.js');

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
      doc.addImage(bytes, 'JPEG', 15, 22, 180, 135);
      self.postMessage({ type: 'progress', done: i + 1, total: urls.length });
    }
    const pdf = doc.output('arraybuffer');
    self.postMessage({ type: 'done', pdf }, [pdf]);
  } catch (e) {
    self.postMessage({ type: 'error', error: String(e && e.message || e) });
  }
};

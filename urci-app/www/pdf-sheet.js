// Inspection sheet PDF in DA Form 7348-R layout (blocks 1-10), metric, ID/EN, plus photo pages.
// Pure: given jsPDF and data, returns the document. Runs in export.worker.js and in Node tests.
// Rules: title per owner decision; photos fitted by their own aspect ratio (never a fixed box, spike lesson);
// symbols the embedded fonts lack are written as text (OV-13); every photo shows its SHA-256 and a
// "PERINGATAN: FOTO DIUBAH" line when the fingerprint no longer matches (HASH-1).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UrciPdfSheet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CODES = ['81', '82', '83', '84', '85', '86', '87'];
  const SEVS = ['L', 'M', 'H'];
  const BAND_RGB = [[20, 83, 45], [63, 98, 18], [133, 77, 14], [194, 65, 12], [159, 18, 57]];
  const M = 12; // page margin, mm
  const PW = 210, PH = 297, CW = PW - 2 * M;

  function fitBox(w, h, bw, bh) {
    const k = Math.min(bw / w, bh / h);
    return { w: w * k, h: h * k };
  }

  function build(jsPDF, d) {
    const t = d.t;
    const num = (v, dp = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : (Math.round(v * 10 ** dp) / 10 ** dp).toFixed(dp).replace('.', d.lang === 'id' ? ',' : '.'));
    const qty = (v) => String(Number.isInteger(v) ? v : Math.round(v * 100) / 100).replace('.', d.lang === 'id' ? ',' : '.');
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    if (d.fonts) {
      doc.addFileToVFS('Barlow-Regular.ttf', d.fonts.regular);
      doc.addFont('Barlow-Regular.ttf', 'Barlow', 'normal');
      doc.addFileToVFS('Barlow-SemiBold.ttf', d.fonts.semibold);
      doc.addFont('Barlow-SemiBold.ttf', 'Barlow', 'bold');
      doc.addFileToVFS('IBMPlexMono-Regular.ttf', d.fonts.mono);
      doc.addFont('IBMPlexMono-Regular.ttf', 'PlexMono', 'normal');
    }
    const F = d.fonts ? { sans: 'Barlow', mono: 'PlexMono' } : { sans: 'helvetica', mono: 'courier' };
    const font = (style = 'normal', size = 9, mono = false) => { doc.setFont(mono ? F.mono : F.sans, mono ? 'normal' : style); doc.setFontSize(size); };
    const ink = () => doc.setTextColor(20, 23, 26);
    const muted = () => doc.setTextColor(74, 82, 96);
    doc.setLineWidth(0.3);
    doc.setDrawColor(20, 23, 26);
    const box = (x, y, w, h, label, value, opts = {}) => {
      doc.rect(x, y, w, h);
      font('normal', 7); muted(); doc.text(label, x + 1.5, y + 3.5);
      if (value !== undefined && value !== null && value !== '') {
        font(opts.bold ? 'bold' : 'normal', opts.size || 10, opts.mono); ink();
        doc.text(String(value), x + 1.5, y + h - 2.2, { maxWidth: w - 3 });
      }
    };
    const rec = d.rec;
    const h = rec.header;
    const calc = d.calc;
    let y = M;

    // ---- title ----
    doc.rect(M, y, CW, 15);
    font('bold', 11); ink();
    doc.text(t.pdfTitle, PW / 2, y + 6, { align: 'center' });
    font('normal', 7.5); muted();
    doc.text(t.pdfSubtitle, PW / 2, y + 11.5, { align: 'center' });
    y += 15;

    // ---- blocks 1-6 ----
    const c3 = CW / 3;
    const [yy, mm, dd] = h.date.split('-');
    box(M, y, c3, 11, `1. ${t.branch}`, h.branch, { bold: true });
    box(M + c3, y, c3, 11, `2. ${t.section}`, h.section, { bold: true });
    box(M + 2 * c3, y, c3, 11, `3. ${t.date}`, `${dd}/${mm}/${yy}`);
    y += 11;
    box(M, y, c3, 11, `4. ${t.sampleUnit}`, `SU${h.sampleUnit}`, { bold: true });
    box(M + c3, y, c3, 11, `5. ${t.sampleArea}`, qty(h.sampleArea));
    box(M + 2 * c3, y, c3, 11, `6. ${t.inspector}`, h.inspector || '-');
    y += 11;

    // ---- block 7: location (the app records GPS instead of a hand sketch) + distress types ----
    const leftW = CW * 0.52;
    const b7h = 34;
    doc.rect(M, y, leftW, b7h);
    font('normal', 7); muted(); doc.text(`7. ${t.pdfLocation}`, M + 1.5, y + 3.5);
    font('normal', 8.5, true); ink();
    const loc = [d.roundLabel, d.gps ? `GPS ${d.gps.lat.toFixed(5)}, ${d.gps.lon.toFixed(5)} ±${Math.round(d.gps.acc)} m` : `${t.gpsNa}`];
    if (d.photoCount) loc.push(`${d.photoCount} ${t.photosWord}`);
    loc.forEach((l, i) => doc.text(l, M + 1.5, y + 9 + i * 4.6));
    doc.rect(M + leftW, y, CW - leftW, b7h);
    font('bold', 7.5); ink(); doc.text(t.pdfDistressTypes, M + leftW + (CW - leftW) / 2, y + 3.8, { align: 'center' });
    font('normal', 7.5);
    CODES.forEach((c, i) => {
      const dd2 = t.distress[c];
      doc.text(`${c}. ${dd2.name}${dd2.unit ? ` (${t.units[dd2.unit]})` : ''}`, M + leftW + 2, y + 8.5 + i * 3.6, { maxWidth: CW - leftW - 4 });
    });
    y += b7h;

    // ---- block 8: quantity and severity grid ----
    font('normal', 7); muted();
    doc.rect(M, y, CW, 5); doc.text(`8. ${t.block8.replace(/^8 · /, '')}`, M + 1.5, y + 3.5);
    y += 5;
    const typeW = 32, colW = (CW - typeW) / 7, rowH = 6.5;
    doc.rect(M, y, typeW, rowH); font('bold', 8); ink(); doc.text(t.pdfType, M + typeW / 2, y + 4.4, { align: 'center' });
    CODES.forEach((c, i) => { doc.rect(M + typeW + i * colW, y, colW, rowH); doc.text(c, M + typeW + i * colW + colW / 2, y + 4.4, { align: 'center' }); });
    y += rowH;
    const q = {};
    for (const e of rec.entries || []) q[`${e.code}-${e.sev}`] = e.code === '84' ? 'X' : qty(e.quantity);
    SEVS.forEach((s) => {
      doc.rect(M, y, typeW, rowH);
      font('normal', 8); ink(); doc.text(t.sevName[s], M + typeW / 2, y + 4.4, { align: 'center' });
      CODES.forEach((c, i) => {
        doc.rect(M + typeW + i * colW, y, colW, rowH);
        const v = q[`${c}-${s}`];
        if (v) { font('bold', 9); doc.text(v, M + typeW + i * colW + colW / 2, y + 4.5, { align: 'center' }); }
      });
      y += rowH;
    });

    // ---- block 9: URCI calculation (left) + 10: remarks (right) ----
    const calcW = CW * 0.6;
    const cols = [calcW * 0.4, calcW * 0.2, calcW * 0.18, calcW * 0.22];
    doc.rect(M, y, CW, 5); font('normal', 7); muted(); doc.text(`9. ${t.block9.replace(/^9 · /, '')}`, M + 1.5, y + 3.5);
    doc.text(`10. ${t.pdfRemarks}`, M + calcW + 1.5, y + 3.5);
    y += 5;
    const heads = [`${t.pdfDistressType} (a)`, `${t.density} % (b)`, `${t.pdfSeverity} (c)`, `${t.deduct} (d)`];
    let x = M;
    font('bold', 7.5); ink();
    heads.forEach((hd, i) => { doc.rect(x, y, cols[i], 7); doc.text(hd, x + cols[i] / 2, y + 4.6, { align: 'center', maxWidth: cols[i] - 2 }); x += cols[i]; });
    const tableTop = y;
    y += 7;
    const rows = Math.max(8, calc.rows.length);
    for (let i = 0; i < rows; i++) {
      const r = calc.rows[i];
      x = M;
      const cells = r ? [`${r.code} ${t.distress[r.code].short}`, r.code === '84' ? '-' : num(r.density, 1), t.sevName[r.sev], num(r.deduct, 1)] : ['', '', '', ''];
      cells.forEach((c, j) => {
        doc.rect(x, y, cols[j], 6);
        font(j === 3 ? 'bold' : 'normal', 8.5, j === 1 || j === 3); ink();
        if (c) doc.text(c, j === 0 ? x + 1.5 : x + cols[j] / 2, y + 4.2, { align: j === 0 ? 'left' : 'center', maxWidth: cols[j] - 2 });
        x += cols[j];
      });
      y += 6;
    }
    // remarks box
    const remH = y - tableTop;
    doc.rect(M + calcW, tableTop, CW - calcW, remH);
    const remarks = [];
    for (const r of calc.rows) {
      if (r.flags.includes('offChartHigh')) remarks.push(`${r.code}-${t.sevShort[r.sev]}: ${t.offChart}`);
      if (r.flags.includes('belowFirstPoint')) remarks.push(`${r.code}-${t.sevShort[r.sev]}: ${t.belowFirst}`);
    }
    if (d.conflict) remarks.push(`PERINGATAN: ${t.conflictFlag}`);
    if (d.tampered) remarks.push(`PERINGATAN: ${t.pdfTampered}`);
    if (d.missingPhotos && d.missingPhotos.length) remarks.push(`PERINGATAN: ${t.pdfMissingPhotos}: ${d.missingPhotos.length}`);
    remarks.push(`${t.qLabel}.`);
    font('normal', 7.5); ink();
    let ry = tableTop + 4;
    for (const line of remarks) {
      const lines = doc.splitTextToSize(line, CW - calcW - 3);
      doc.text(lines, M + calcW + 1.5, ry);
      ry += lines.length * 3.4 + 0.8;
    }
    // band table (site convention)
    ry += 1;
    font('bold', 7.5); doc.text(t.rating, M + calcW + 1.5, ry); ry += 3.6;
    font('normal', 7.5);
    for (const b of d.bandRanges) {
      doc.setFillColor(...BAND_RGB[b.band]);
      doc.rect(M + calcW + 1.5, ry - 2.6, 3, 3, 'F');
      doc.text(`${t.bands[b.band]}  ${b.lo}-${b.hi}`, M + calcW + 6, ry);
      ry += 3.6;
    }
    font('normal', 6.5); muted();
    doc.text(doc.splitTextToSize(t.bandsNote, CW - calcW - 3), M + calcW + 1.5, ry + 0.5);

    // ---- e-h totals + result stamp ----
    const tw = CW / 4;
    const band = d.band;
    box(M, y, tw, 12, `e. ${t.tdvLabel}`, num(calc.tdv, 1), { bold: true, size: 12, mono: true });
    box(M + tw, y, tw, 12, `f. q`, String(calc.q), { bold: true, size: 12, mono: true });
    box(M + 2 * tw, y, tw, 12, `g. URCI`, String(calc.urci), { bold: true, size: 16 });
    doc.setFillColor(...BAND_RGB[band]);
    doc.rect(M + 3 * tw, y, tw, 12, 'FD');
    font('normal', 7); doc.setTextColor(255, 255, 255); doc.text(`h. ${t.rating}`, M + 3 * tw + 1.5, y + 3.5);
    font('bold', 11); doc.text(t.bands[band].toUpperCase(), M + 3 * tw + 1.5, y + 9.5);
    y += 12;

    // footer on page 1
    font('normal', 6.5); muted();
    doc.text(doc.splitTextToSize(`${t.pdfSource} ${t.pdfGenerated}: ${d.generatedAt}. ${t.pdfCurves}`, CW), M, PH - 14);

    // ---- photo pages: two per page, each fitted by its own aspect ratio ----
    const photos = d.photos || [];
    for (let i = 0; i < photos.length; i++) {
      if (i % 2 === 0) {
        doc.addPage();
        font('bold', 10); ink();
        doc.text(`${t.pdfPhotos} · ${h.branch}/${h.section}/SU${h.sampleUnit} · ${dd}/${mm}/${yy}`, M, M + 4);
      }
      const p = photos[i];
      const slotTop = M + 8 + (i % 2) * 136;
      const props = doc.getImageProperties(p.bytes);
      const f = fitBox(props.width, props.height, CW, 114);
      doc.addImage(p.bytes, 'JPEG', M + (CW - f.w) / 2, slotTop, f.w, f.h);
      let cy = slotTop + f.h + 4;
      font('bold', 8.5); ink();
      const mark = p.source === 'gallery' ? ` · ${t.galleryMark}${p.timeManual ? ` · ${t.manualTimeMark}` : ''}` : '';
      doc.text(`${p.code} ${t.distress[p.code].short} · ${t.sevName[p.sev]}${mark}`, M, cy);
      font('normal', 7.5, true); muted();
      cy += 3.8;
      const when = p.takenAt ? new Date(p.takenAt) : null;
      const pad = (n) => String(n).padStart(2, '0');
      const meta = [p.name, when ? `${pad(when.getDate())}/${pad(when.getMonth() + 1)}/${when.getFullYear()} ${pad(when.getHours())}:${pad(when.getMinutes())}` : '',
        p.gps ? `${p.gps.lat.toFixed(5)}, ${p.gps.lon.toFixed(5)}${Number.isFinite(p.gps.acc) ? ` ±${p.gps.acc} m` : ''}` : t.gpsNa].filter(Boolean).join(' · ');
      doc.text(meta, M, cy, { maxWidth: CW });
      cy += 3.6;
      doc.text(`SHA-256 ${p.sha256 || '-'}`, M, cy, { maxWidth: CW });
      if (p.tampered) {
        cy += 4;
        font('bold', 8.5); doc.setTextColor(180, 35, 24);
        doc.text(`PERINGATAN: ${t.pdfTampered}`, M, cy);
      }
    }
    // page numbers
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      font('normal', 7); muted();
      doc.text(`${i} / ${n}`, PW - M, PH - 6, { align: 'right' });
    }
    return doc;
  }

  return { build, fitBox };
});

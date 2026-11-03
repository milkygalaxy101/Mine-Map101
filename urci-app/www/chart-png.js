// Section trend chart as a picture (design T7 "graph PNG") for reports and WhatsApp. Drawn with the canvas 2D API so
// it uses the app's own loaded fonts (an SVG drawn into an image cannot reach them). Same geometry and marks as the
// on-screen chart: band backgrounds, solid/hollow points, n/N under each month, red triangle for an outlier round.
(function (root) {
  'use strict';
  const BAND_COLORS = ['#14532D', '#3F6212', '#854D0E', '#C2410C', '#9F1239'];
  const INK = '#14171A', MUTED = '#4A5260', RULE = '#C9CED6', ERROR = '#B42318', NAVY = '#1D3B6E';

  // opts: { trend, bandRanges, bandNames, title, subtitle, legend, footnote, warning, num, scale }
  function render(canvas, opts) {
    const S = opts.scale || 2;
    const W = 800, H = 520;
    canvas.width = W * S;
    canvas.height = H * S;
    const c = canvas.getContext('2d');
    c.scale(S, S);
    c.fillStyle = '#FFFFFF';
    c.fillRect(0, 0, W, H);
    const font = (w, px, fam = 'Barlow') => { c.font = `${w} ${px}px "${fam}", sans-serif`; };
    const text = (s, x, y, { color = INK, align = 'left' } = {}) => { c.fillStyle = color; c.textAlign = align; c.fillText(s, x, y); };

    // header
    c.textBaseline = 'alphabetic';
    font(600, 26); text(opts.title, 32, 46);
    font(400, 15); text(opts.subtitle, 32, 70, { color: MUTED });
    let top = 92;
    if (opts.warning) {
      font(600, 15); text(`⚠ ${opts.warning}`, 32, top + 4, { color: ERROR });
      top += 22;
    }

    // plot area
    const L = 64, R = 150, T = top + 10, B = 104;
    const pw = W - L - R, ph = H - T - B;
    const trend = opts.trend;
    const x = (i) => (trend.length === 1 ? L + pw / 2 : L + 18 + (i * (pw - 36)) / (trend.length - 1));
    const y = (v) => T + ((100 - v) * ph) / 100;

    for (const b of opts.bandRanges) {
      const hi = b.hi + (b.band === 0 ? 0 : 1);
      c.globalAlpha = 0.12; c.fillStyle = BAND_COLORS[b.band];
      c.fillRect(L, y(hi), pw, y(b.lo) - y(hi));
      c.globalAlpha = 1;
      // band name + range at the right edge
      const mid = (y(hi) + y(b.lo)) / 2;
      c.fillStyle = BAND_COLORS[b.band]; c.fillRect(L + pw + 10, mid - 6, 12, 12);
      font(600, 13); text(opts.bandNames[b.band], L + pw + 28, mid - 1);
      font(400, 12, 'IBM Plex Mono'); text(`${b.lo}–${b.hi}`, L + pw + 28, mid + 14, { color: MUTED });
    }
    c.lineWidth = 1; c.strokeStyle = RULE;
    font(400, 13);
    for (const v of [0, 25, 50, 75, 100]) {
      c.beginPath(); c.moveTo(L, y(v) + 0.5); c.lineTo(L + pw, y(v) + 0.5); c.stroke();
      text(String(v), L - 8, y(v) + 4, { color: MUTED, align: 'right' });
    }
    c.save(); c.translate(20, T + ph / 2); c.rotate(-Math.PI / 2); font(600, 13); text('URCI', 0, 0, { color: MUTED, align: 'center' }); c.restore();

    const pts = trend.map((r, i) => (r.mean === null ? null : [x(i), y(r.mean)]));
    c.strokeStyle = INK; c.lineWidth = 2.5; c.lineJoin = 'round';
    c.beginPath();
    let first = true;
    for (const p of pts) { if (!p) continue; if (first) c.moveTo(p[0], p[1]); else c.lineTo(p[0], p[1]); first = false; }
    c.stroke();
    trend.forEach((r, i) => {
      const px = x(i);
      const [yy, mm] = r.month.split('-');
      font(400, 13); text(`${mm}/${yy.slice(2)}`, px, T + ph + 22, { color: MUTED, align: 'center' });
      font(400, 12, 'IBM Plex Mono'); text(`${r.n}/${r.N}`, px, T + ph + 40, { color: MUTED, align: 'center' });
      if (!pts[i]) return;
      const py = pts[i][1];
      c.beginPath(); c.arc(px, py, 6, 0, Math.PI * 2);
      c.fillStyle = r.incomplete ? '#FFFFFF' : INK; c.fill();
      c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke();
      font(600, 15); text(opts.num(r.mean), px, py - 13, { align: 'center' });
      if (r.units.some((u) => u.outlier)) {
        c.fillStyle = ERROR; c.beginPath(); c.moveTo(px + 22, py - 28); c.lineTo(px + 29, py - 16); c.lineTo(px + 15, py - 16); c.closePath(); c.fill();
      }
    });

    // legend + source
    font(400, 12);
    const wrap = (s, maxW) => {
      const out = []; let line = '';
      for (const w of s.split(' ')) { const tryL = line ? `${line} ${w}` : w; if (c.measureText(tryL).width > maxW && line) { out.push(line); line = w; } else line = tryL; }
      if (line) out.push(line);
      return out;
    };
    let ly = H - 36;
    for (const l of wrap(opts.legend, W - 64)) { text(l, 32, ly, { color: MUTED }); ly += 15; }
    font(400, 10.5);
    text(opts.footnote, 32, H - 8, { color: MUTED });
    c.fillStyle = NAVY; c.fillRect(0, 0, W, 6);
    return canvas;
  }

  function toBlob(canvas) {
    return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'));
  }

  root.UrciChartPng = { render, toBlob };
})(typeof self !== 'undefined' ? self : this);

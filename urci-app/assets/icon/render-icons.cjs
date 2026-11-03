// node render.cjs <dir>: renders the icon SVGs to PNGs with Chromium (exact SVG rendering, transparent where wanted)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const dir = process.argv[2];
const adaptive = fs.readFileSync(path.join(dir, 'adaptive-108dp.svg'), 'utf8');
const original = fs.readFileSync(path.join(dir, 'original.svg'), 'utf8');
const dataUrl = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });
  async function shot(html, w, h, out, transparent = true) {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${html}</body></html>`);
    await p.waitForTimeout(50);
    await p.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  }
  const img = (svg, s, style = '') => `<img src="${dataUrl(svg)}" width="${s}" height="${s}" style="display:block;${style}">`;
  // visible 72dp part of the adaptive composition (what launchers show), for legacy / round icons
  const vis = (s, radius) => `<div style="width:${s}px;height:${s}px;overflow:hidden;border-radius:${radius};position:relative">
    <img src="${dataUrl(adaptive)}" style="position:absolute;width:${s * 1.5}px;height:${s * 1.5}px;left:${-s * 0.25}px;top:${-s * 0.25}px"></div>`;
  const out = path.join(dir, 'res'); fs.mkdirSync(out, { recursive: true });
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    fs.mkdirSync(path.join(out, `mipmap-${d}`), { recursive: true });
    await shot(img(adaptive, 108 * k), 108 * k, 108 * k, path.join(out, `mipmap-${d}`, 'ic_launcher_foreground.png'));
    await shot(vis(48 * k, '18%'), 48 * k, 48 * k, path.join(out, `mipmap-${d}`, 'ic_launcher.png'));
    await shot(vis(48 * k, '50%'), 48 * k, 48 * k, path.join(out, `mipmap-${d}`, 'ic_launcher_round.png'));
  }
  // previews: launcher masks
  const masks = [['Lingkaran / circle', '50%'], ['Squircle', '30%'], ['Kotak membulat / rounded', '14%'], ['Desain asli / original', '0']];
  const cells = masks.map(([n, r], i) => `<div style="text-align:center;font:600 18px sans-serif;color:#14171A">${i < 3 ? vis(220, r) : img(original, 220)}<p>${n}</p></div>`).join('');
  await shot(`<div style="display:flex;gap:28px;padding:28px;background:#ECEFF3">${cells}</div>`, 1080, 330, path.join(dir, 'preview-masks.png'), false);
  fs.writeFileSync(path.join(dir, 'vis.html'), vis(1, '0'));
  await b.close();
})();

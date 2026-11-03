const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const dir = process.argv[2]; const adaptive = fs.readFileSync(path.join(dir, 'adaptive-108dp.svg'), 'utf8');
const url = 'data:image/svg+xml;base64,' + Buffer.from(adaptive).toString('base64');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const s = 768;
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<body style="margin:0;background:transparent"><div style="width:${s}px;height:${s}px;overflow:hidden;border-radius:22%;position:relative"><img src="${url}" style="position:absolute;width:${s * 1.5}px;height:${s * 1.5}px;left:${-s * 0.25}px;top:${-s * 0.25}px"></div></body>`);
  await p.waitForTimeout(50);
  await p.screenshot({ path: path.join(dir, 'icon-rounded-768.png'), omitBackground: true });
  await b.close();
})();

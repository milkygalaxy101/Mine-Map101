// History (IA-1, IA-3, P7-2) at 360 dp: worst-first list, trend chart, flags, drill-down, back button, Ubah, Hapus.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../../www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

(async () => {
  const srv = http.createServer((req, rsp) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
    rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(rsp);
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/index.html`);
  await page.waitForSelector('#urci-num');
  await page.click('#tip-ok');

  // seed: I-HR01/S03 over 3 months (4 units; October only 1 unit = incomplete; September has an outlier), I-HR02/S01 one round
  await page.evaluate(async () => {
    const s = window.__urci.store;
    const save = (branch, section, su, date, urci) => s.saveInspection({
      header: { branch, section, sampleUnit: su, date, sampleArea: 100 },
      entries: [{ code: '83', sev: 'M', quantity: 10 }], result: { urciRaw: urci, urci: Math.round(urci), tdv: 20, q: 1 } });
    for (const [su, u] of [[1, 82], [2, 80], [3, 78], [4, 76]]) await save('I-HR01', 'S03', su, '2026-08-10', u);
    for (const [su, u] of [[1, 70], [2, 68], [3, 72], [4, 50]]) await save('I-HR01', 'S03', su, '2026-09-12', u);
    await save('I-HR01', 'S03', 1, '2026-10-05', 36);
    await save('I-HR02', 'S01', 1, '2026-10-06', 88);
  });

  await page.click('#tab-history');
  await page.waitForSelector('.rows');
  const titles = await page.locator('.row-title').allTextContents();
  check(titles[0] === 'I-HR01 / S03' && titles[1] === 'I-HR02 / S01', `sections sorted worst-first: ${JSON.stringify(titles)}`);
  const sub = await page.locator('.row-sub').first().textContent();
  check(/turun 29/.test(sub) && /1 dari 4 unit/.test(sub), `row shows change and coverage: "${sub}"`);
  check(await page.locator('#resultbar').isHidden(), 'result bar hidden on History');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal scroll (sections)');

  await page.locator('.row-link').first().click();
  await page.waitForSelector('svg.chart');
  const head = await page.textContent('.headline');
  check(/Sekarang 36/.test(head) && /dari 65, turun 29/.test(head) && /Buruk/.test(head), `headline: "${head}"`);
  const pts = await page.locator('svg.chart circle').evaluateAll((cs) => cs.map((c) => c.getAttribute('fill')));
  check(pts.length === 3 && pts[2] === '#FFFFFF' && pts[0] === '#14171A', `3 points, the incomplete October round is hollow: ${JSON.stringify(pts)}`);
  const flags = await page.locator('.flags li').allTextContents();
  check(flags.some((f) => /SU4 50/.test(f)) && flags.some((f) => /belum lengkap/.test(f)), `flags list outlier SU4 and incomplete round: ${JSON.stringify(flags)}`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal scroll (trend)');
  await page.screenshot({ path: path.join(__dirname, 'history-trend.png'), fullPage: true });

  // drill-down: September round -> units -> SU4 detail
  await page.locator('.data-table a', { hasText: 'Sep' }).click();
  await page.waitForSelector('.rows');
  const units = await page.locator('.row-title').allTextContents();
  check(units.join() === 'SU1,SU2,SU3,SU4', `round lists its units: ${units}`);
  check((await page.locator('.rows li').nth(3).textContent()).includes('jauh di bawah rata-rata'), 'SU4 marked far below average');
  await page.locator('.row-link').nth(3).click();
  await page.waitForSelector('.facts');
  check((await page.textContent('h2.block')) === 'I-HR01 / S03 / SU4', 'detail shows the inspection');
  await page.goBack();
  await page.waitForSelector('.rows');
  check((await page.locator('.row-title').allTextContents()).join() === 'SU1,SU2,SU3,SU4', 'back button returns to the unit list');
  await page.locator('.row-link').nth(3).click();
  await page.waitForSelector('.facts');

  // Ubah -> form loaded -> change quantity -> save updates the same record
  const before = await page.evaluate(() => window.__urci.store.live().length);
  await page.click('.sheet-actions .btn-primary');
  await page.waitForSelector('#urci-num');
  check(await page.locator('.banner.info', { hasText: 'mengubah inspeksi' }).count() === 1, 'Ubah opens the form in edit mode');
  const r83 = page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: '83' }) });
  check((await r83.locator('button.cell').nth(1).textContent()).trim() === '10', 'saved quantity is in the form');
  await r83.locator('button.cell').nth(1).click();
  await page.fill('.sheet input', '25');
  await page.click('.sheet .sheet-actions .btn-primary');
  await page.click('#save');
  await page.waitForSelector('.toast');
  const after = await page.evaluate(() => { const r = window.__urci.store.live().find((x) => x.header.sampleUnit === 4 && x.header.date === '2026-09-12'); return { n: window.__urci.store.live().length, q: r.entries[0].quantity, vv: Object.values(r.vv)[0] }; });
  check(after.n === before && after.q === 25 && after.vv === 2, `edit saved in place (same count, new quantity, version 2): ${JSON.stringify(after)}`);

  // Hapus with confirm
  await page.evaluate(() => { const r = window.__urci.store.live().find((x) => x.header.branch === 'I-HR02'); location.hash = `#/history/i/${r.uuid}`; });
  await page.waitForSelector('.facts');
  await page.click('.sheet-actions .btn-tertiary');
  await page.waitForSelector('.dialog');
  check((await page.textContent('.dialog .btn-primary')).trim() === 'Hapus', 'delete asks with an explicit red "Hapus"');
  await page.click('.dialog .btn-primary');
  await page.waitForFunction(() => !window.__urci.store.live().some((x) => x.header.branch === 'I-HR02'));
  check(true, 'record deleted (tombstone)');

  check(errors.length === 0, `no script errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await browser.close();
  srv.close();
  if (fails.length) { console.error(`${fails.length} check(s) failed`); process.exit(1); }
  console.log('HISTORY UI OK');
})();

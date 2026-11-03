// R10 clock check at 360 dp: no GPS time = nothing shown; 6 min drift = warning banner (photo/Save not blocked);
// 26 h drift = banner + blocking "Tanggal HP salah" before Save, "Buka Pengaturan" stops, "Lanjutkan saja" goes on once.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../../www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

async function open(browser, base, driftMs) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (driftMs !== null) await page.addInitScript((d) => localStorage.setItem('urci.testDriftMs', String(d)), driftMs);
  await page.goto(base + '/index.html');
  await page.waitForSelector('#urci-num');
  if (await page.locator('#tip-ok').count()) await page.click('#tip-ok');
  return { ctx, page, errors };
}

async function fill(page) {
  await page.fill('#f-branch', 'I-HR01');
  await page.fill('#f-section', 'S03');
  await page.fill('#f-sampleUnit', '2');
  await page.fill('#f-sampleArea', '200');
  await page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: '83' }) }).locator('button.cell').nth(1).click();
  await page.fill('.sheet input', '10');
  await page.click('.sheet .sheet-actions .btn-primary');
}

(async () => {
  const srv = http.createServer((req, rsp) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
    rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(rsp);
  }).listen(0);
  await new Promise((r) => srv.on('listening', r));
  const browser = await chromium.launch();
  const base = `http://127.0.0.1:${srv.address().port}`;

  { // no GPS time: nothing
    const { ctx, page, errors } = await open(browser, base, null);
    check(await page.locator('#drift-banner').count() === 0, 'no GPS time: no banner');
    check(errors.length === 0, `no script errors ${errors.length ? JSON.stringify(errors) : ''}`);
    await ctx.close();
  }
  { // 4 min: under the limit
    const { ctx, page } = await open(browser, base, 4 * 60000);
    check(await page.locator('#drift-banner').count() === 0, '4 min drift: no banner');
    await ctx.close();
  }
  { // 6 min: banner, Save not blocked
    const { ctx, page, errors } = await open(browser, base, -6 * 60000);
    await page.waitForSelector('#drift-banner');
    check(/±6 menit/.test(await page.textContent('#drift-banner')), `6 min drift banner: "${await page.textContent('#drift-banner')}"`);
    await page.click('#drift-banner button');
    check(await page.evaluate(() => window.__urciOpenedDateSettings === true), 'banner button opens the date settings');
    await fill(page);
    check(await page.locator('#drift-banner').count() === 1, 'banner stays while filling in');
    await page.click('#save');
    await page.waitForSelector('.toast');
    check(await page.locator('.dialog').count() === 0, '6 min drift: Save is not blocked');
    check(await page.evaluate(() => window.__urci.store.live().length) === 1, '6 min drift: saved');
    const log = await page.evaluate(() => UrciLog.all().filter((e) => e.event === 'clock'));
    check(log.length === 1 && log[0].driftS === -360, `drift logged: ${JSON.stringify(log)}`);
    check(errors.length === 0, `no script errors ${errors.length ? JSON.stringify(errors) : ''}`);
    await ctx.close();
  }
  { // 26 h: blocking confirm before Save
    const { ctx, page, errors } = await open(browser, base, 26 * 3600000);
    await page.waitForSelector('#drift-banner');
    check(/±26 jam/.test(await page.textContent('#drift-banner')), '26 h drift banner in hours');
    await fill(page);
    await page.click('#save');
    await page.locator('.dialog').waitFor();
    check((await page.textContent('.dialog h2')) === 'Tanggal HP salah', 'date drift: blocking dialog before Save');
    check(/HP: .* GPS: /.test(await page.textContent('.dialog p')), 'dialog shows phone and GPS date');
    await page.click('.dialog .btn-primary'); // Buka Pengaturan
    check(await page.evaluate(() => window.__urciOpenedDateSettings === true && window.__urci.store.live().length === 0), '"Buka Pengaturan" opens settings and does not save');
    await page.click('#save');
    await page.locator('.dialog').waitFor();
    await page.click('.dialog .btn-tertiary'); // Lanjutkan saja
    await page.waitForSelector('.toast');
    check(await page.evaluate(() => window.__urci.store.live().length) === 1, '"Lanjutkan saja" saves');
    check(await page.evaluate(() => UrciLog.all().some((e) => e.event === 'clock-continue')), 'continuing is logged');
    await fill(page);
    await page.click('#save');
    await page.waitForFunction(() => window.__urci.store.live().length === 2);
    check(await page.locator('.dialog').count() === 0, 'not asked again in the same session');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal scroll with the banner');
    await page.screenshot({ path: path.join(__dirname, 'clock-banner.png') });
    check(errors.length === 0, `no script errors ${errors.length ? JSON.stringify(errors) : ''}`);
    await ctx.close();
  }
  await browser.close();
  srv.close();
  if (fails.length) { console.error(`${fails.length} check(s) failed`); process.exit(1); }
  console.log('CLOCK UI OK');
})();

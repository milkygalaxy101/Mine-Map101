// Owner bug report (2026-11-03): "Ambil foto" only appeared after entering a value, tapping Selesai and reopening
// the box, and the photo buttons could not be pressed (silently disabled until the WHOLE header, including area
// and date, was valid). Now: buttons show at once; tapping saves the typed amount first; a missing location
// (road code, segment, unit) is explained and shown instead of a dead button; area is not needed for a photo.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../../www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
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
  const row = (code) => page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: code }) });

  // empty form: open a box; the photo buttons are there at once and can be pressed
  await row('83').locator('button.cell').nth(1).click();
  await page.waitForSelector('.sheet #take-photo');
  check(await page.locator('.sheet #take-photo').isEnabled() && await page.locator('.sheet #pick-gallery').isEnabled(), 'photo buttons shown and enabled in a new, empty box');
  // no amount yet: asks for it, stays in the sheet
  await page.click('.sheet #take-photo');
  check(await page.locator('.sheet').count() === 1 && /Isi ukurannya dulu/.test(await page.textContent('.sheet .err-text')), 'no amount: asks for the amount, sheet stays open');
  // amount typed, location missing: amount kept, location explained and shown in red
  await page.fill('.sheet input', '50');
  await page.click('.sheet #take-photo');
  await page.waitForSelector('.toast');
  check(/kode jalan, segmen, nomor unit/.test(await page.textContent('.toast')), `missing location explained: "${await page.textContent('.toast')}"`);
  check(await page.evaluate(() => window.__urci.screen.state.qty['83-M']) === 50, 'typed amount kept (no need to tap Selesai and reopen)');
  const red = await page.locator('[aria-invalid="true"]').evaluateAll((els) => els.map((e) => e.id));
  check(red.join() === 'f-branch,f-section,f-sampleUnit', `only the stamp's fields marked: ${red}`);
  // location only (no area): the camera opens straight from a fresh box
  await page.fill('#f-branch', 'I-HR01');
  await page.fill('#f-section', 'S03');
  await page.fill('#f-sampleUnit', '2');
  await row('86').locator('button.cell').nth(0).click();
  await page.fill('.sheet input', '7');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.sheet #take-photo')]);
  await chooser.setFiles(path.join(__dirname, 'fixture-road.jpg'));
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('.photo-badge')]; return b.length && !b.some((x) => x.classList.contains('busy')); }, null, { timeout: 15000 });
  const st = await page.evaluate(() => ({ q: window.__urci.screen.state.qty['86-L'], n: (window.__urci.screen.state.photos['86-L'] || []).length }));
  check(st.q === 7 && st.n === 1, `photo taken from a fresh box without sample area: ${JSON.stringify(st)}`);
  // gallery from a fresh box too
  await row('87').locator('button.cell').nth(1).click();
  await page.fill('.sheet input', '12');
  const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.click('.sheet #pick-gallery')]);
  await ch2.setFiles(path.join(__dirname, 'fixture-exif.jpg'));
  await page.waitForFunction(() => (window.__urci.screen.state.photos['87-M'] || []).length === 1, null, { timeout: 15000 });
  check(true, 'gallery import works from a fresh box');

  check(errors.length === 0, `no script errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await browser.close();
  srv.close();
  if (fails.length) { console.error(`${fails.length} check(s) failed`); process.exit(1); }
  console.log('PHOTO FLOW UI OK');
})();

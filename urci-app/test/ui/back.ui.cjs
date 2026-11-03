// Android back button (owner request): back closes the open sheet/dialog safely, else returns to the previous
// panel. MainActivity calls window.__urciBack(); when it returns false the WebView goes back in history (or the
// app goes to the background). Simulated here exactly that way.
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
  const page = await (await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${srv.address().port}/index.html`);
  await page.waitForSelector('#urci-num');
  await page.click('#tip-ok');
  // what MainActivity does: ask JS; if not handled, WebView history back
  const back = async () => {
    const handled = await page.evaluate(() => window.__urciBack());
    if (!handled) await page.evaluate(() => history.back());
    await page.waitForTimeout(150);
    return handled;
  };
  const row = (code) => page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: code }) });

  // nothing open on the first screen: not handled (phone puts the app in the background)
  check(await page.evaluate(() => window.__urciBack()) === false, 'first screen, nothing open: back is left to the phone');

  // keypad sheet: back closes it without clearing the value
  await page.fill('#f-branch', 'I-HR01'); await page.fill('#f-section', 'S03'); await page.fill('#f-sampleUnit', '1'); await page.fill('#f-sampleArea', '200');
  await row('83').locator('button.cell').nth(1).click();
  await page.fill('.sheet input', '20'); await page.click('.sheet .sheet-actions .btn-primary');
  await row('83').locator('button.cell').nth(1).click();
  await page.waitForSelector('.sheet');
  check(await back() === true && await page.locator('.scrim').count() === 0, 'back closes the keypad sheet');
  check(await page.evaluate(() => window.__urci.screen.state.qty['83-M']) === 20, 'back does not clear the value (never "Kosongkan")');

  // a confirm dialog: back = Batal
  await page.evaluate(() => { window.__urci.screen.confirm({ title: 'Hapus?', body: 'x', ok: 'Hapus', cancel: 'Batal', destructiveOk: true }).then((v) => { window.__answer = v; }); });
  await page.waitForSelector('.dialog');
  check(await back() === true && await page.evaluate(() => window.__answer) === false, 'back on a confirm = Batal (never the destructive button)');
  // a dialog without Batal/Tutup (e.g. keep or discard draft) stays open
  await page.evaluate(() => { window.__urci.screen.confirm({ title: 'Draf', body: 'x', ok: 'Lanjutkan', cancel: 'Buang', destructiveCancel: true }).then((v) => { window.__answer2 = v; }); });
  await page.waitForSelector('.dialog');
  check(await back() === true && await page.locator('.dialog').count() === 1 && await page.evaluate(() => window.__answer2) === undefined, 'back leaves a keep/discard dialog open');
  await page.click('.dialog .btn-primary');

  // panels: Inspect -> History -> Berkas -> Settings -> Manual §3; back walks the same way home
  await page.click('#tab-history'); await page.waitForSelector('.block');
  await page.click('#tab-files'); await page.waitForSelector('#backup-full');
  await page.click('#settings-btn'); await page.waitForSelector('#version');
  await page.evaluate(() => { location.hash = '#/manual/s3'; }); await page.waitForSelector('#manual-urci');
  const trail = [];
  for (let i = 0; i < 4; i++) { await back(); trail.push(await page.evaluate(() => document.body.dataset.tab)); }
  check(trail.join() === 'settings,files,history,inspect', `back walks the panels in reverse: ${trail}`);

  check(errors.length === 0, `no script errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await browser.close();
  srv.close();
  if (fails.length) { console.error(`${fails.length} check(s) failed`); process.exit(1); }
  console.log('BACK UI OK');
})();

// Playwright UI test for the Inspect screen (DR-T1 verify): 360 dp wide at font scale 1.0 and 1.3.
// Serves www/ over HTTP (like https://localhost on the phone). Fails on any console error or CSP violation.
// Run: node test/ui/inspect.ui.cjs   (needs Playwright + Chromium)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../../www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}

const failures = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

async function run(browser, base, scale) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  if (scale !== 1) {
    // Approximate Android font scale (WebView textZoom): multiply every computed font size, re-applied after re-renders.
    await page.addInitScript((k) => {
      // Scale only elements that set their own font size; inherited sizes follow their (already scaled) parent.
      const apply = () => document.querySelectorAll('body, body *').forEach((n) => {
        if (n.dataset.zoomed) return;
        n.dataset.zoomed = '1';
        const own = parseFloat(getComputedStyle(n).fontSize);
        const parent = n.parentElement ? parseFloat(getComputedStyle(n.parentElement).fontSize) : NaN;
        if (n.parentElement && n.parentElement.dataset.zoomed && own === parent) return; // inherited
        n.style.fontSize = own * k + 'px';
      });
      new MutationObserver(apply).observe(document, { childList: true, subtree: true });
      addEventListener('DOMContentLoaded', apply);
    }, scale);
  }
  await page.goto(base + '/index.html');
  await page.waitForSelector('#urci-num');
  const tag = `[scale ${scale}]`;

  check((await page.textContent('#urci-num')).trim() === '—', `${tag} result bar shows "—" before any entry`);
  const noHScroll = async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  check(await noHScroll(), `${tag} no horizontal scroll on empty form`);

  // validation on empty save
  await page.click('#save');
  check(await page.locator('[aria-invalid="true"]').count() >= 4, `${tag} empty Save marks required fields red`);

  // FS 144 (TM 5-626 Fig 3-3 metric): 130 m2, 81-M 30.5, 82-H 61.0, 84-L, 86-M 45.5, 86-H 84.5
  await page.fill('#f-branch', 'i-hr01');
  await page.fill('#f-section', 's03');
  await page.fill('#f-sampleUnit', '2');
  await page.fill('#f-sampleArea', '130');
  const cell = async (code, sevIndex, value) => {
    const row = page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: code }) });
    await row.locator('button.cell').nth(sevIndex).click();
    await page.fill('.sheet input', value);
    await page.click('.sheet .btn-primary');
  };
  await cell('81', 1, '30,5');
  check(await page.locator('.summary').count() === 1, `${tag} header collapses to the summary line after the first fill`);
  await cell('82', 2, '61');
  await page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: '84' }) }).locator('.dust-chip').nth(0).click();
  await cell('86', 1, '45.5');
  await cell('86', 2, '84,5');
  const num = (await page.textContent('#urci-num')).trim();
  const tq = await page.textContent('.resultbar .tq');
  check(num === '23', `${tag} FS144 live URCI = 23 (TM 25 within ±2), got ${num}`);
  check(/q 4/.test(tq) && /TDV 133/.test(tq), `${tag} TDV 133 · q 4 shown, got "${tq}"`);
  check(await noHScroll(), `${tag} no horizontal scroll with a filled grid`);
  const save = await page.locator('#save').boundingBox();
  check(save && save.y + save.height <= 760, `${tag} Save is inside the viewport`);

  // calc sheet
  await page.click('.result-open');
  check(await page.locator('.calc-row').count() === 5, `${tag} calc sheet lists the 5 entered rows`);
  check((await page.textContent('.stamp-num')).trim() === '23', `${tag} calc stamp shows 23`);
  await page.click('.sheet .sheet-actions .btn-primary');

  // save
  await page.click('#save');
  await page.waitForSelector('.toast');
  check((await page.textContent('.toast')).includes('Tersimpan'), `${tag} toast "Tersimpan" after Save`);
  const live = await page.evaluate(() => window.__urci.store.live().map((r) => ({ b: r.header.branch, s: r.header.section, n: r.entries.length, u: r.result.urci, rid: r.roundId })));
  check(live.length === 1 && live[0].b === 'I-HR01' && live[0].n === 5 && live[0].u === 23, `${tag} record saved (uppercased header, 5 entries, URCI 23): ${JSON.stringify(live)}`);
  check((await page.textContent('#urci-num')).trim() === '—', `${tag} form returns empty after Save`);

  // language
  await page.click('#lang');
  check((await page.textContent('#save')).trim() === 'Save', `${tag} EN switch relabels Save`);

  check(errors.length === 0, `${tag} no console errors / CSP violations ${errors.length ? JSON.stringify(errors) : ''}`);
  if (scale === 1.3) await page.screenshot({ path: path.join(__dirname, 'inspect-360-scale13.png'), fullPage: false });
  await ctx.close();
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    await run(browser, base, 1);
    await run(browser, base, 1.3);
  } finally {
    await browser.close();
    srv.close();
  }
  if (failures.length) { console.error(`\n${failures.length} UI check(s) failed`); process.exit(1); }
  console.log('\nALL UI CHECKS PASSED');
})();

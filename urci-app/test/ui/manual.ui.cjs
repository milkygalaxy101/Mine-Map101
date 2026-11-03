// Panduan / Manual at 360 dp, font scale 1.0 and 1.3: contents, every section opens with its source footnote,
// every in-manual link lands on an existing section/anchor, row-help links open the right distress,
// §3 shows the TM 5-626 FS101 example computed by the engine (URCI 59), Settings links in, EN works.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../../www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

async function run(browser, base, scale) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (scale !== 1) {
    await page.addInitScript((k) => {
      const apply = () => document.querySelectorAll('body, body *').forEach((n) => {
        if (n.dataset.zoomed) return;
        n.dataset.zoomed = '1';
        const own = parseFloat(getComputedStyle(n).fontSize);
        const parent = n.parentElement ? parseFloat(getComputedStyle(n.parentElement).fontSize) : NaN;
        if (n.parentElement && n.parentElement.dataset.zoomed && own === parent) return;
        n.style.fontSize = own * k + 'px';
      });
      new MutationObserver(apply).observe(document, { childList: true, subtree: true });
      addEventListener('DOMContentLoaded', apply);
    }, scale);
  }
  const tag = `[scale ${scale}]`;
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  await page.goto(base + '/index.html');
  await page.waitForSelector('#urci-num');
  await page.click('#tip-ok');

  // top-bar book icon opens the contents
  check((await page.getAttribute('#help', 'aria-label')) === 'Buka panduan', `${tag} book icon has a TalkBack label`);
  await page.click('#help');
  await page.waitForSelector('#manual-toc');
  check((await page.textContent('#title')) === 'Panduan', `${tag} title reads Panduan`);
  check(await page.locator('#manual-toc a').count() === 5, `${tag} contents lists 5 sections`);
  check(await page.locator('#help').isHidden(), `${tag} book icon hidden inside the manual`);

  // every section: heading, source footnote, no horizontal scroll; collect in-manual links
  const links = new Set();
  for (const s of ['s1', 's2', 's3', 's4', 's5']) {
    await page.evaluate((h) => { location.hash = h; }, `#/manual/${s}`);
    await page.waitForSelector(`#m-${s}`);
    const foot = await page.textContent('.manual-source');
    check(/TM 5-626/.test(foot), `${tag} ${s} has the source footnote`);
    check(await noHScroll(), `${tag} ${s} no horizontal scroll`);
    for (const h of await page.locator('a[href^="#/manual"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))) links.add(h);
    if (scale === 1) await page.screenshot({ path: path.join(__dirname, `manual-${s}.png`), fullPage: true });
  }
  for (const h of links) {
    await page.evaluate((x) => { location.hash = x; }, h);
    const parts = h.replace('#/manual', '').split('/').filter(Boolean);
    const id = parts.length ? `#m-${parts[parts.length - 1]}` : '#manual-toc';
    const found = await page.waitForSelector(id, { timeout: 2000 }).then(() => true, () => false);
    check(found, `${tag} link ${h} opens ${id}`);
  }

  // §3: the TM example computed live
  await page.evaluate(() => { location.hash = '#/manual/s3'; });
  await page.waitForSelector('#manual-urci');
  const urci = await page.textContent('#manual-urci');
  check(/URCI = 59/.test(urci), `${tag} §3 FS101 example gives URCI 59: "${urci}"`);
  const tdv = await page.textContent('#manual-tdv');
  check(/q = 3/.test(tdv), `${tag} §3 shows q = 3: "${tdv}"`);
  check(await page.locator('#manual-example tbody tr').count() === 4, `${tag} §3 table has 4 distress rows`);

  // §5 site bands follow Settings
  await page.evaluate(() => { location.hash = '#/manual/s5'; });
  await page.waitForSelector('#manual-site-bands');
  check(/85–100/.test(await page.textContent('#manual-site-bands')), `${tag} §5 shows the site bands`);

  // row help: "Panduan §2.x →" opens and scrolls to that distress
  await page.click('#tab-inspect');
  await page.waitForSelector('#urci-num');
  await page.locator('.row-label').nth(2).click(); // 83
  await page.waitForSelector('.sheet .manual-link');
  check((await page.textContent('.sheet .manual-link')) === 'Panduan §2.3 →', `${tag} help sheet links its manual section`);
  await page.click('.sheet .manual-link');
  await page.waitForSelector('#m-83');
  check(await page.locator('.sheet').count() === 0, `${tag} help sheet closes when following the link`);
  await page.waitForFunction(() => { const r = document.getElementById('m-83').getBoundingClientRect(); return r.top >= -2 && r.top < 120; });
  check(true, `${tag} manual scrolled to 83`);

  // Settings link, then English
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.click('#settings-manual');
  await page.waitForSelector('#manual-toc');
  check(true, `${tag} Settings opens the manual`);
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.click('.seg-btn:has-text("English")');
  await page.evaluate(() => { location.hash = '#/manual/s3'; });
  await page.waitForSelector('#manual-urci');
  check((await page.textContent('#title')) === 'Manual', `${tag} EN title Manual`);
  check(/URCI = 59 · Good/.test(await page.textContent('#manual-urci')), `${tag} EN §3 rating word`);
  check(/^Source:/.test(await page.textContent('.manual-source')), `${tag} EN footnote`);

  check(errors.length === 0, `${tag} no script errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await ctx.close();
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
  await run(browser, base, 1);
  await run(browser, base, 1.3);
  await browser.close();
  srv.close();
  if (fails.length) { console.error(`${fails.length} check(s) failed`); process.exit(1); }
  console.log('MANUAL UI OK');
})();

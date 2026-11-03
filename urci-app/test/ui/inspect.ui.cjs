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
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    geolocation: { latitude: -2.98712, longitude: 115.42301, accuracy: 4 }, permissions: ['geolocation'] });
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
  // first-timer guidance (owner feedback: the screen must say what to do)
  check(await page.locator('.tip li').count() === 3, `${tag} first open shows the 3-step "Cara mengisi" card`);
  check((await page.textContent('.resultbar')).includes('Isi luas unit sampel'), `${tag} result bar says what is missing before an area is entered`);
  check((await page.getAttribute('#f-branch', 'placeholder')) === 'contoh: I-HR01', `${tag} fields show example placeholders`);
  check((await page.textContent('.how')).startsWith('Ketuk kotak'), `${tag} grid has a one-line instruction`);
  check((await page.textContent('.grid-head')).includes('Berat'), `${tag} columns use full severity words`);
  await page.click('#tip-ok');
  check(await page.locator('.tip').count() === 0, `${tag} "Mengerti" dismisses the card`);
  await page.reload();
  await page.waitForSelector('#urci-num');
  check(await page.locator('.tip').count() === 0, `${tag} card stays dismissed after reopening`);
  await page.click('#help');
  await page.waitForSelector('#manual-toc');
  await page.click('a[href="#/manual/s4"]');
  await page.click('#manual-show-tip');
  await page.waitForSelector('.tip');
  check(await page.locator('.tip').count() === 1, `${tag} Panduan §4 reopens the card`);
  await page.click('#tip-ok');
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
    if (code === '83' || code === '86') {
      check((await page.textContent('.sheet .sev-guide')).includes('cm'), `${tag} keypad for ${code} describes the severity (depth)`);
      check((await page.textContent('.sheet .ask')).includes('meter persegi'), `${tag} keypad asks a plain question with the unit`);
    }
    await page.fill('.sheet input', value);
    await page.click('.sheet .btn-primary');
  };
  // pothole keypad shows TM Table B-1 sizes with the chosen severity marked (owner request)
  {
    const row = page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: '85' }) });
    await row.locator('button.cell').nth(1).click();
    check(!(await page.isVisible('.sheet .pothole-table')), `${tag} pothole size table is closed by default (keypad looks like the others)`);
    await page.click('.sheet .more-toggle');
    const marked = await page.locator('.sheet .pothole-table td.mark').allTextContents();
    check(marked.length === 4 && marked.every((x) => x === 'S'), `${tag} "Lihat tabel ukuran" opens Table B-1 with the 4 Sedang cells marked, got ${JSON.stringify(marked)}`);
    check(await page.evaluate(() => document.querySelector('.sheet').scrollWidth <= document.querySelector('.sheet').clientWidth), `${tag} pothole table fits the sheet width`);
    await page.click('.sheet .sheet-actions .btn-tertiary');
  }
  // row-name help: picture + do-not-confuse note (corrugation vs ruts)
  {
    await page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: '83' }) }).locator('.row-label').click();
    check(await page.locator('.sheet svg.illus').count() === 1, `${tag} Bergelombang help shows a picture`);
    check((await page.textContent('.sheet .confuse')).includes('Alur roda'), `${tag} Bergelombang help warns not to confuse it with Alur roda`);
    check((await page.textContent('.sheet')).includes('MELINTANG'), `${tag} help says corrugations run across the road`);
    check(await page.evaluate(() => document.querySelector('.sheet').scrollWidth <= document.querySelector('.sheet').clientWidth), `${tag} help sheet fits the width`);
    await page.click('.sheet .sheet-actions .btn-primary');
    const r86 = page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: '86' }) });
    await r86.locator('button.cell').nth(2).click();
    check(!(await page.isVisible('.sheet .levels-table')), `${tag} keypad picture/table closed by default`);
    await page.click('.sheet .more-toggle');
    check(await page.isVisible('.sheet svg.illus'), `${tag} Alur roda keypad opens the picture`);
    check((await page.locator('.sheet .levels-table tr.mark th').allTextContents()).join() === 'Berat', `${tag} Alur roda · Berat keypad marks the Berat row`);
    await page.click('.sheet .sheet-actions .btn-tertiary');
  }
  await cell('81', 1, '30,5');
  check(await page.locator('.summary').count() === 1, `${tag} header collapses to the summary line after the first fill`);
  // photo on a filled box (R6/R7/HASH-1): stamp, badge, then saved with the record
  {
    check((await page.textContent('#gps-chip')).includes('±4 m'), `${tag} GPS chip shows the fix accuracy`);
    const r81 = page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: '81' }) });
    await r81.locator('button.cell').nth(1).click();
    const take = page.locator('#take-photo');
    check(await take.isEnabled(), `${tag} "Ambil foto" is enabled once the location is filled in`);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), take.click()]);
    await chooser.setFiles(path.join(__dirname, 'fixture-road.jpg'));
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('.photo-badge')]; return b.length && !b.some((x) => x.classList.contains('busy')); }, null, { timeout: 15000 });
    check((await r81.locator('button.cell').nth(1).locator('.photo-badge').textContent()).trim() === '1', `${tag} cell shows a photo count badge`);
    await r81.locator('button.cell').nth(1).click();
    check(await page.locator('.sheet .thumb img').count() === 1, `${tag} keypad shows the photo thumbnail`);
    await page.click('.sheet .sheet-actions .btn-primary');
    // gallery import (P7-3): EXIF time used as is; no EXIF time -> date/time dialog, stamp says WAKTU MANUAL
    if (scale === 1) {
      const waitIdle = (n) => page.waitForFunction((k) => { const b = [...document.querySelectorAll('.photo-badge')]; return b.some((x) => x.textContent.trim() === String(k)) && !b.some((x) => x.classList.contains('busy')); }, n, { timeout: 15000 });
      await r81.locator('button.cell').nth(1).click();
      let [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pick-gallery')]);
      await chooser.setFiles(path.join(__dirname, 'fixture-exif.jpg'));
      await waitIdle(2);
      let ph = await page.evaluate(() => window.__urci.screen.state.photos['81-M'][1]);
      check(ph.source === 'gallery' && !ph.timeManual && ph.takenAt === '2026-10-01T02:11:12.000Z' && ph.gps === null,
        `${tag} gallery photo keeps its EXIF time (+08:00) and has no GPS: ${JSON.stringify({ s: ph.source, t: ph.takenAt, m: ph.timeManual, g: ph.gps })}`);
      await r81.locator('button.cell').nth(1).click();
      [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pick-gallery')]);
      await chooser.setFiles(path.join(__dirname, 'fixture-road.jpg'));
      await page.waitForSelector('#photo-time');
      check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(await page.inputValue('#photo-time')), `${tag} time dialog is pre-filled`);
      await page.fill('#photo-time', '2999-01-01T10:00');
      await page.click('#photo-time-ok');
      check((await page.textContent('.dialog .err-text')).length > 0, `${tag} a future photo time is refused`);
      await page.fill('#photo-time', '2026-10-02T08:30');
      await page.click('#photo-time-ok');
      await waitIdle(3);
      ph = await page.evaluate(() => window.__urci.screen.state.photos['81-M'][2]);
      check(ph.timeManual === true && new Date(ph.takenAt).getHours() === 8 && /-20261002-0830/.test(ph.name), `${tag} typed time is used and marked manual: ${ph.name}`);
      // drop the two imports again so the rest of the run sees one photo
      await page.evaluate(() => { const s = window.__urci.screen; s.state.photos['81-M'] = s.state.photos['81-M'].slice(0, 1); s.render(); });
    }
  }
  await cell('82', 2, '61');
  // dust (P7-1): a level opens the same sheet with "Ambil foto"; a photo is stamped and badged on the chip
  {
    const r84 = page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: '84' }) });
    await r84.locator('.dust-chip').nth(1).click();
    await page.waitForSelector('.sheet #take-photo');
    check((await page.textContent('.sheet h2')).includes('Debu · Sedang'), `${tag} dust chip opens its sheet`);
    if (scale === 1) {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#take-photo')]);
      await chooser.setFiles(path.join(__dirname, 'fixture-road.jpg'));
      await page.waitForFunction(() => { const b = document.querySelector('.dust-chip .photo-badge'); return b && !b.classList.contains('busy'); }, null, { timeout: 15000 });
      check((await r84.locator('.dust-chip').nth(1).locator('.photo-badge').textContent()).trim() === '1', `${tag} dust chip shows a photo badge`);
      // switching to Ringan asks before dropping the Sedang photo
      await r84.locator('.dust-chip').nth(0).click();
      await page.locator('.dialog').waitFor();
      await page.click('.dialog .btn-primary');
      await page.waitForSelector('.sheet #take-photo');
      check(await page.evaluate(() => !window.__urci.screen.state.photos['84-M'] && window.__urci.screen.state.dust === 'L'), `${tag} switching dust level drops the old level's photo after asking`);
    } else {
      await page.click('.sheet .sheet-actions .btn-primary');
      await r84.locator('.dust-chip').nth(0).click();
      await page.waitForSelector('.sheet #take-photo');
    }
    await page.click('.sheet .sheet-actions .btn-primary');
    check(await page.evaluate(() => window.__urci.screen.state.dust === 'L'), `${tag} dust level Ringan selected`);
  }
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
  {
    const ph = await page.evaluate(() => {
      const r = window.__urci.store.live()[0];
      const e = r.entries.find((x) => x.code === '81' && x.sev === 'M');
      const p = e && e.photos && e.photos[0];
      return p ? { ...p, file: localStorage.getItem(`urci-fs:inspections/${r.folder}/${p.name}`) !== null } : null;
    });
    check(ph && /^81-M-\d{8}-\d{6}-[0-9a-f]{8}\.jpg$/.test(ph.name), `${tag} saved photo has a TM-style name: ${ph && ph.name}`);
    check(ph && /^[0-9a-f]{64}$/.test(ph.sha256), `${tag} saved photo has a SHA-256 fingerprint`);
    check(ph && ph.gps && Math.abs(ph.gps.lat + 2.98712) < 1e-4 && ph.gps.acc === 4, `${tag} saved photo carries the GPS fix`);
    check(ph && ph.file, `${tag} photo file is in the inspection folder`);
  }

  // PDF from the saved inspection's detail (DA 7348-R layout + photo page), built in the worker
  if (scale === 1) {
    const uuid = await page.evaluate(() => window.__urci.store.live()[0].uuid);
    await page.evaluate((u) => { location.hash = `#/history/i/${u}`; }, uuid);
    await page.waitForSelector('#make-pdf');
    await page.click('#make-pdf');
    await page.waitForFunction(() => window.__urciLastExport, null, { timeout: 30000 });
    const b64 = await page.evaluate(() => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(window.__urciLastExport.blob); }));
    const name = await page.evaluate(() => window.__urciLastExport.name);
    check(/^URCI_I-HR01_S03_SU2_\d{8}\.pdf$/.test(name), `PDF file name: ${name}`);
    const os = require('os');
    const f = path.join(os.tmpdir(), `urci-ui-${process.pid}.pdf`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    try {
      const { execFileSync } = require('child_process');
      const txt = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
      const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f], { encoding: 'utf8' }))[1]);
      check(txt.includes('format DA 7348-R') && /\b23\b/.test(txt) && txt.includes('SANGAT BURUK'), 'PDF has the sheet with URCI 23 and the rating');
      check(pages === 2 && txt.includes('Lampiran foto') && /81-M-\d{8}-\d{6}-[0-9a-f]{8}\.jpg/.test(txt), `PDF has the photo page (${pages} pages)`);
      check(!txt.includes('FOTO DIUBAH'), 'photo fingerprint verified (no tamper warning)');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      console.log('skip PDF text checks: poppler not installed');
    } finally { fs.unlinkSync(f); }
    check(await page.locator('.dialog', { hasText: 'PDF tersimpan' }).count() === 1, 'PDF saved dialog shown');
    await page.click('.dialog .btn-tertiary');
    await page.evaluate(() => { location.hash = '#/inspect'; });
    await page.waitForSelector('#urci-num');
  }

  // Settings: bands, self-test, diagnostics (scale 1), language (both)
  await page.click('#settings-btn');
  await page.waitForSelector('#bands-save');
  if (scale === 1) {
    check(await page.locator('#bands-save').isDisabled(), `${tag} band Save disabled until something changes`);
    await page.fill('#band-1', '90');
    check(await page.locator('#bands-save').isDisabled() && (await page.textContent('.err-text')).length > 0, `${tag} non-decreasing limits are refused (Save disabled + message)`);
    await page.fill('#band-1', '65');
    await page.fill('#band-3', '20');
    check(await page.locator('#bands-save').isEnabled(), `${tag} valid change enables Save`);
    check((await page.locator('#bands-preview tr').last().textContent()).includes('0–19'), `${tag} preview shows derived range 0–19`);
    await page.click('#bands-save');
    await page.waitForSelector('.toast');
    const band = await page.evaluate(() => { const r = window.__urci.store.live()[0]; return window.UrciEngine.rate(r.result.urci, window.__urci.settings.bands); });
    check(band === 3, `${tag} URCI 23 now rates Buruk (band 3) with lower limit 20`);
    await page.reload();
    await page.waitForSelector('#version');
    check(await page.evaluate(() => window.__urci.settings.bands.join('/')) === '85/65/45/20', `${tag} bands persist in settings.json across restarts`);
    for (let i = 0; i < 5; i++) await page.click('#version');
    await page.waitForSelector('#self-test');
    const st = await page.textContent('#self-test');
    check(/FS 101: URCI 59 \(TM 59\) · LULUS/.test(st) && /FS 144: URCI 23 \(TM 25\) · LULUS/.test(st), `${tag} 5 taps on version open the self-test; both TM examples pass`);
    await page.click('#self-test .btn-primary');
    await page.click('#diag-export');
    await page.waitForFunction(() => window.__urciLastExport && /^diagnostik-/.test(window.__urciLastExport.name));
    const diag = await page.evaluate(() => window.__urciLastExport.blob.text());
    check(/"selfTest"/.test(diag) && /"event": "save"/.test(diag) && !/115\.42301/.test(diag), `${tag} diagnostics has self-test and log, and no GPS coordinates`);
  }
  await page.click('.seg-btn >> text=English');
  check((await page.textContent('#title')).trim() === 'Settings', `${tag} language switch to English`);
  await page.click('#tab-inspect');
  const saveLabel = await page.waitForFunction(() => { const b = document.querySelector('#save'); return b && b.offsetParent && b.textContent.trim() === 'Save' ? 'Save' : false; }, null, { timeout: 5000 }).then((h) => h.jsonValue()).catch(async () => page.textContent('#save'));
  check(saveLabel === 'Save', `${tag} EN switch relabels Save (got "${saveLabel}")`);

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

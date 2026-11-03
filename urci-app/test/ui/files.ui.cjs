// Two "phones" (separate browser contexts = separate storage): backup on A, import on B, re-import, conflict
// resolution, and a hostile bundle rejected as a whole. Uses the real .urci.zip format (fflate in the test build).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const fflate = require(path.join(__dirname, '../../node_modules/fflate/umd/index.js'));
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
  const base = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch();
  const errors = [];
  async function phone() {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, geolocation: { latitude: -2.98712, longitude: 115.42301, accuracy: 4 }, permissions: ['geolocation'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base);
    await page.waitForSelector('#urci-num');
    await page.click('#tip-ok');
    return page;
  }
  const lastExport = (page) => page.evaluate(() => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res({ name: window.__urciLastExport.name, b64: fr.result.split(',')[1] }); fr.readAsDataURL(window.__urciLastExport.blob); }));
  const tmp = (name, buf) => { const f = path.join(require('os').tmpdir(), `${process.pid}-${name}`); fs.writeFileSync(f, buf); return f; };
  async function importFile(page, file) {
    await page.click('#tab-files');
    await page.waitForSelector('#import-bundle');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#import-bundle')]);
    await chooser.setFiles(file);
  }

  const A = await phone();
  const B = await phone();

  // Phone A: one inspection with a photo
  await A.fill('#f-branch', 'I-HR01'); await A.fill('#f-section', 'S03'); await A.fill('#f-sampleUnit', '2'); await A.fill('#f-sampleArea', '130');
  const r83 = A.locator('.grid-row').filter({ has: A.locator('.code', { hasText: '83' }) });
  await r83.locator('button.cell').nth(1).click(); await A.fill('.sheet input', '20'); await A.click('.sheet .sheet-actions .btn-primary');
  await r83.locator('button.cell').nth(1).click();
  const [ch] = await Promise.all([A.waitForEvent('filechooser'), A.click('#take-photo')]);
  await ch.setFiles(path.join(__dirname, 'fixture-road.jpg'));
  await A.waitForFunction(() => { const b = [...document.querySelectorAll('.photo-badge')]; return b.length && !b.some((x) => x.classList.contains('busy')); }, null, { timeout: 15000 });
  await A.click('#save'); await A.waitForSelector('.toast');

  // backup on A
  await A.click('#tab-files');
  await A.waitForSelector('#backup-full');
  check((await A.textContent('.banner.warning')).includes('Belum pernah backup'), 'File tab warns: never backed up');
  await A.click('#backup-full');
  await A.locator('.dialog', { hasText: 'Backup tersimpan' }).waitFor();
  const bk = await lastExport(A);
  check(/^backup-\d{8}\.urci\.zip$/.test(bk.name), `backup file name: ${bk.name}`);
  const zip = fflate.unzipSync(new Uint8Array(Buffer.from(bk.b64, 'base64')));
  const names = Object.keys(zip);
  check(names.includes('manifest.json') && names.some((n) => /inspection\.json$/.test(n)) && names.some((n) => /\.jpg$/.test(n)) && names.some((n) => /^rounds\//.test(n)), `bundle has manifest, record, photo, round: ${names.length} entries`);
  await A.click('.dialog .btn-tertiary');
  await A.waitForTimeout(200);
  check(await A.locator('.banner.warning').count() === 0, 'backup banner gone after backup');
  await A.screenshot({ path: path.join(__dirname, 'files-tab.png') });
  check((await A.locator('.export-row').count()) === 1, 'backup listed under Ekspor sebelumnya');
  const bundleFile = tmp('a.urci.zip', Buffer.from(bk.b64, 'base64'));

  // import on B
  await importFile(B, bundleFile);
  await B.waitForSelector('#import-stats');
  const stats = await B.locator('.stat').allTextContents();
  check(/^1\s*Diimpor/.test(stats[0].trim()), `B imported 1: ${JSON.stringify(stats)}`);
  const onB = await B.evaluate(() => { const r = window.__urci.store.live()[0]; return r && { b: r.header.branch, ph: r.entries[0].photos.length, file: localStorage.getItem(`urci-fs:inspections/${r.folder}/${r.entries[0].photos[0].name}`) !== null }; });
  check(onB && onB.b === 'I-HR01' && onB.ph === 1 && onB.file, `record and photo arrived on B: ${JSON.stringify(onB)}`);
  await B.click('#import-done');

  // import again: nothing new
  await importFile(B, bundleFile);
  await B.waitForSelector('#import-stats');
  check((await B.textContent('.headline')).includes('Tidak ada data baru'), 'second import: "Tidak ada data baru"');
  await B.click('#import-done');

  // conflict: A and B edit the same inspection; B imports A's version
  const editOn = async (page, value) => {
    await page.evaluate(() => { location.hash = `#/history/i/${window.__urci.store.live()[0].uuid}`; });
    await page.waitForSelector('.facts');
    await page.click('.sheet-actions .btn-primary');
    await page.waitForSelector('#urci-num');
    const row = page.locator('.grid-row').filter({ has: page.locator('.code', { hasText: '83' }) });
    await row.locator('button.cell').nth(1).click(); await page.fill('.sheet input', value); await page.click('.sheet .sheet-actions .btn-primary');
    await page.click('#save'); await page.waitForSelector('.toast');
  };
  await editOn(A, '35');
  await editOn(B, '25');
  await A.click('#tab-files'); await A.waitForSelector('#backup-full'); await A.click('#backup-full');
  await A.locator('.dialog', { hasText: 'Backup tersimpan' }).waitFor();
  const bk2 = await lastExport(A);
  await importFile(B, tmp('a2.urci.zip', Buffer.from(bk2.b64, 'base64')));
  await B.waitForSelector('#import-stats');
  const st2 = await B.locator('.stat').allTextContents();
  check(/^1\s*Konflik baru/.test(st2[2].trim()), `B reports 1 new conflict: ${JSON.stringify(st2)}`);
  await B.click('a[href="#/history/conflicts"]');
  await B.waitForSelector('.conflict-table');
  await B.screenshot({ path: path.join(__dirname, 'conflicts.png') });
  const cells = await B.locator('.conflict-table tbody tr').first().locator('td').allTextContents();
  check(cells[0].startsWith('25') && cells[1].startsWith('35'), `conflict shows both versions side by side: ${JSON.stringify(cells)}`);
  await B.click('.choice .btn-secondary >> text=Pakai versi masuk');
  await B.waitForSelector('.toast');
  const q = await B.evaluate(() => ({ q: window.__urci.store.live()[0].entries[0].quantity, open: window.__urci.store.conflicts.size }));
  check(q.q === 35 && q.open === 0, `conflict resolved with the incoming version: ${JSON.stringify(q)}`);

  // hostile bundle: path escape -> whole bundle rejected
  const evil = fflate.zipSync({ 'manifest.json': fflate.strToU8(JSON.stringify({ format: 'urci-bundle', version: 1, createdBy: 'x', count: 0 })), '../../escape.json': fflate.strToU8('{}') });
  await importFile(B, tmp('evil.urci.zip', Buffer.from(evil)));
  await B.locator('.dialog', { hasText: 'Bundel ditolak' }).waitFor();
  check((await B.textContent('.dialog')).includes('tidak aman'), 'hostile bundle rejected with a clear reason');
  await B.click('.dialog .btn-primary');
  const notZip = tmp('notzip.urci.zip', Buffer.from('hello'));
  await importFile(B, notZip);
  await B.locator('.dialog', { hasText: 'Bundel ditolak' }).waitFor();
  check((await B.textContent('.dialog')).includes('bukan file bundel'), 'non-zip file: "bukan file bundel URCI"');

  check(errors.length === 0, `no script errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await browser.close();
  srv.close();
  if (fails.length) { console.error(`${fails.length} check(s) failed`); process.exit(1); }
  console.log('FILES UI OK');
})();

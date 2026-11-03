// Phone boot path in a browser: the REAL vendored @capacitor/core runs against a fake *native bridge*
// (androidBridge + PluginHeaders + nativePromise only; no registerPlugin given). Guards the spike failure class.
// First run: no folder -> welcome -> "Pilih folder data" -> new folder -> Inspect screen + toast.
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
  const page = await browser.newPage({ viewport: { width: 360, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    const calls = (window.__calls = []);
    const files = new Map();
    let picked = false;
    window.androidBridge = { postMessage() {} };
    const m = (names, rtype = 'promise') => names.map((name) => ({ name, rtype }));
    const err = (code) => Object.assign(new Error(code), { code });
    const handlers = {
      folderStatus: () => ({ hasFolder: picked, name: picked ? 'URCI' : null }),
      pickFolder: () => { picked = true; return { uri: 'content://tree/URCI', name: 'URCI' }; },
      list: ({ path: dir }) => {
        const out = new Map();
        for (const p of files.keys()) if (p.startsWith(dir + '/')) { const rest = p.slice(dir.length + 1); const i = rest.indexOf('/'); out.set(i < 0 ? rest : rest.slice(0, i), i >= 0); }
        if (!out.size) throw err('NOT_FOUND');
        return { entries: [...out].map(([name, d]) => ({ name, dir: d })) };
      },
      readText: ({ path: p }) => { if (!files.has(p)) throw err('NOT_FOUND'); return { text: files.get(p) }; },
      writeTextSafe: ({ path: p, text }) => { files.set(p, text); return {}; },
      delete: ({ path: p }) => { files.delete(p); return {}; },
      requestPermissions: () => ({ location: 'granted' }),
      takeIncoming: () => ({}),
    };
    window.Capacitor = {
      PluginHeaders: [
        { name: 'UrciStorage', methods: [...m(['pickFolder', 'folderStatus', 'list', 'readText', 'writeTextSafe', 'delete', 'rename', 'writeDraftPhoto', 'deleteDraftPhoto', 'copyDraftIn', 'downscale', 'freeSpace', 'nativeFix', 'pickPhoto', 'openDateSettings', 'takeIncoming', 'pickBundle', 'removeAllListeners']), ...m(['addListener', 'removeListener'], 'none')] },
        { name: 'Camera', methods: m(['takePhoto']) },
        { name: 'Geolocation', methods: [...m(['requestPermissions', 'getCurrentPosition', 'checkPermissions']), ...m(['watchPosition'], 'callback')] },
      ],
      nativePromise: async (plugin, method, opts) => {
        calls.push(`${plugin}.${method}`);
        const h = handlers[method];
        if (!h) throw err('UNIMPLEMENTED');
        return h(opts || {});
      },
      nativeCallback: (plugin, method) => { calls.push(`${plugin}.${method}`); return 'cb1'; },
    };
  });
  await page.goto(`http://127.0.0.1:${srv.address().port}/index.html`);
  await page.waitForSelector('#pick-folder', { timeout: 10000 });
  check(true, 'first run shows the welcome screen with "Pilih folder data"');
  check((await page.textContent('.welcome')).includes('Documents'), 'welcome suggests Documents/URCI');
  await page.click('#pick-folder');
  await page.waitForSelector('#urci-num', { timeout: 10000 });
  check(true, 'after choosing a folder the Inspect screen opens');
  await page.waitForSelector('.toast');
  check((await page.textContent('.toast')).includes('Folder baru siap'), 'empty folder: toast "Folder baru siap dipakai"');
  check((await page.locator('.banner.info').filter({ hasText: 'Mode uji' }).count()) === 0, 'no "Mode uji" banner on the phone path');
  const calls = await page.evaluate(() => window.__calls);
  check(calls.includes('UrciStorage.pickFolder') && calls.includes('Geolocation.watchPosition'), `native calls made: ${[...new Set(calls)].join(', ')}`);
  check(errors.length === 0, `no script errors ${errors.length ? JSON.stringify(errors) : ''}`);
  await browser.close();
  srv.close();
  if (fails.length) { console.error(`${fails.length} check(s) failed`); process.exit(1); }
  console.log('NATIVE BOOT OK');
})();

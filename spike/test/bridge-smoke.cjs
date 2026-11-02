// Browser smoke test with a fake that mimics Capacitor's *native bridge* only (no registerPlugin):
// window.androidBridge + Capacitor.PluginHeaders + nativePromise/nativeCallback. The real vendored
// @capacitor/core must turn that into working plugin proxies, exactly as on a phone.
// Run: node test/bridge-smoke.cjs   (needs Playwright + Chromium, preinstalled in CI images)
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    const calls = (window.__calls = []);
    window.androidBridge = { postMessage() {} };
    const m = (names, rtype = 'promise') => names.map((name) => ({ name, rtype }));
    window.Capacitor = {
      PluginHeaders: [
        { name: 'UrciSpike', methods: m(['pickFolder', 'diag', 'folderStatus', 'writeFileSafe', 'list', 'freeSpace', 'nativeFix', 'downscale']) },
        { name: 'Camera', methods: m(['takePhoto']) },
        { name: 'Geolocation', methods: [...m(['requestPermissions', 'getCurrentPosition']), ...m(['watchPosition'], 'callback')] },
      ],
      nativePromise: async (plugin, method) => {
        calls.push(`${plugin}.${method}`);
        if (method === 'pickFolder') return { uri: 'content://tree/x' };
        if (method === 'diag') return { sdk: 35, release: '15', model: 'fake', hasFolderPicker: true };
        return {};
      },
      nativeCallback: (plugin, method) => { calls.push(`${plugin}.${method}`); return 'cb1'; },
    };
  });
  await p.goto('file://' + path.resolve(__dirname, '../www/index.html'));
  await p.waitForTimeout(300);
  const boot = await p.textContent('#status');
  await p.click('#btnFolder');
  await p.waitForTimeout(300);
  const calls = await p.evaluate(() => window.__calls);
  const status = await p.textContent('#status');
  await b.close();
  const ok = !errs.length && calls.includes('UrciSpike.diag') && calls.includes('UrciSpike.pickFolder') && /OK folder/.test(status) && /UrciSpike/.test(boot);
  console.log({ boot, status, calls, errs });
  if (!ok) { console.error('BRIDGE SMOKE FAILED'); process.exit(1); }
  console.log('BRIDGE SMOKE OK');
})();

'use strict';
// The phone adapter (platform.js, native branch) against a fake UrciStorage plugin: store.js contract mapping,
// native error codes passed through unchanged, and a full Store round trip over the adapter.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function fakeNative() {
  const files = new Map();
  const calls = [];
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });
  const plugin = {
    async folderStatus() { return { hasFolder: true, name: 'URCI' }; },
    async list({ path: dir }) {
      calls.push(['list', dir]);
      const out = new Map();
      for (const p of files.keys()) if (p.startsWith(dir + '/')) { const rest = p.slice(dir.length + 1); const i = rest.indexOf('/'); out.set(i < 0 ? rest : rest.slice(0, i), i >= 0); }
      if (!out.size) throw err('NOT_FOUND');
      return { entries: [...out].map(([name, dir]) => ({ name, dir })) };
    },
    async readText({ path: p }) { if (!files.has(p)) throw err('NOT_FOUND'); return { text: files.get(p) }; },
    async writeTextSafe({ path: p, text }) { calls.push(['writeTextSafe', p]); files.set(p, text); },
    async delete({ path: p }) { files.delete(p); },
    async rename({ path: p, newName }) { const to = p.slice(0, p.lastIndexOf('/') + 1) + newName; if (files.has(to)) throw err('NAME_CLASH'); files.set(to, files.get(p)); files.delete(p); },
    async copyDraftIn({ from, to }) { if (files.has(to)) throw err('NAME_CLASH'); files.set(to, `jpeg from ${from}`); },
    async writeDraftPhoto() { return { path: '/data/files/draft-photos/x.jpg' }; },
    async deleteDraftPhoto() {},
    async downscale() { throw err('OOM'); },
  };
  const ls = new Map();
  const self = {
    Capacitor: {
      isNativePlatform: () => true,
      isPluginAvailable: (n) => n === 'UrciStorage',
      registerPlugin: (n) => (n === 'UrciStorage' ? plugin : {}),
      convertFileSrc: (u) => u.replace('file://', 'https://localhost/_capacitor_file_'),
    },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), key: (i) => [...ls.keys()][i], get length() { return ls.size; } },
    crypto: require('node:crypto').webcrypto,
  };
  return { self, files, calls, plugin };
}

function load(self) {
  global.self = self;
  for (const m of ['../www/dev-storage.js', '../www/platform.js']) delete require.cache[require.resolve(m)];
  require('../www/dev-storage.js');
  require('../www/platform.js');
  const P = self.UrciPlatform;
  delete global.self;
  return P;
}

test('native adapter maps the store contract and passes error codes through', async () => {
  const f = fakeNative();
  const P = load(f.self);
  assert.equal(P.isNative, true);
  const plat = P.create();
  assert.equal(plat.native, true);
  f.files.set('inspections/A/inspection.json', '{}');
  assert.deepEqual(await plat.io.fs.list('inspections'), [{ name: 'A', dir: true }]);
  assert.equal(await plat.io.fs.readText('inspections/A/inspection.json'), '{}');
  await assert.rejects(plat.io.fs.readText('missing.json'), { code: 'NOT_FOUND' });
  await plat.media.copyIn('/data/files/draft-photos/x.jpg', 'inspections/A/83-M-20261103-101010-aaaaaaaa.jpg');
  await assert.rejects(plat.media.copyIn('/data/files/draft-photos/x.jpg', 'inspections/A/83-M-20261103-101010-aaaaaaaa.jpg'), { code: 'NAME_CLASH' });
  assert.equal(plat.media.folderUrl('inspections/A B/x.jpg'), '/_saf/inspections/A%20B/x.jpg');
  assert.equal(plat.media.draftUrl('/data/files/draft-photos/x.jpg'), 'https://localhost/_capacitor_file_/data/files/draft-photos/x.jpg');
});

test('a full Store round trip works over the native adapter', async () => {
  const f = fakeNative();
  const P = load(f.self);
  const plat = P.create();
  const S = require('../www/store.js');
  let n = 0;
  const newId = () => `a${String(++n).padStart(7, '0')}-0000-4000-8000-a${String(n).padStart(7, '0')}0000`;
  const store = new S.Store({ fs: plat.io.fs, kv: plat.io.kv, newId });
  await store.init();
  await store.loadAll();
  const rec = await store.saveInspection({
    header: { branch: 'I-HR01', section: 'S03', sampleUnit: 2, date: '2026-11-03', sampleArea: 130 },
    entries: [{ code: '83', sev: 'M', quantity: 20, photos: [{ name: '83-M-20261103-101010-aaaaaaaa.jpg', sha256: 'a'.repeat(64) }] }],
  }, undefined, { beforeWrite: (r) => plat.media.copyIn('/data/files/draft-photos/x.jpg', `inspections/${r.folder}/83-M-20261103-101010-aaaaaaaa.jpg`) });
  const order = f.calls.filter((c) => c[0] === 'writeTextSafe').map((c) => c[1]);
  assert.equal(order[0], `inspections/${rec.folder}/inspection.json`);
  assert.ok(f.files.has(`inspections/${rec.folder}/83-M-20261103-101010-aaaaaaaa.jpg`));
  const again = new S.Store({ fs: plat.io.fs, kv: plat.io.kv, newId });
  await again.init();
  await again.loadAll();
  assert.equal(again.live().length, 1);
  assert.equal(again.broken.length, 0);
});

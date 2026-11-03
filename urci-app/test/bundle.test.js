'use strict';
// Bundle export plan, part splitting, the import checks (including hostile bundles), and a two-phone round trip.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../www/store.js');
const B = require('../www/bundle.js');
const { FakeStorage, FakeKV, idGen } = require('./fake-storage.js');

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 3, 8, 0, clock++)).toISOString();
async function phone(prefix) {
  const fs = new FakeStorage();
  const st = new S.Store({ fs, kv: new FakeKV(), newId: idGen(prefix), now });
  await st.init();
  await st.loadAll();
  return { fs, st };
}
const body = (su, photo) => ({
  header: { branch: 'I-HR01', section: 'S03', sampleUnit: su, date: '2026-11-03', sampleArea: 100 },
  entries: [{ code: '83', sev: 'M', quantity: 10, ...(photo ? { photos: [{ name: photo, sha256: 'c'.repeat(64) }] } : {}) }],
  result: { urciRaw: 80, urci: 80, tdv: 20, q: 1 },
});

// build a bundle "zip" in memory from a phone, the way native exportZip would
async function makeBundle(from, records) {
  const plan = B.exportPlan(from.st, records);
  const [part] = B.splitParts(plan, from.st.deviceId);
  const files = { 'manifest.json': JSON.stringify(part.manifest) };
  for (const p of part.paths) files[p] = from.fs.files.get(p);
  return files;
}
const entriesOf = (files) => Object.entries(files).map(([name, v]) => ({ name, size: String(v).length }));
const textsOf = (files) => Object.fromEntries(Object.entries(files).filter(([n]) => n.endsWith('.json')));

test('export plan: record JSON, its photos and its round file; never conflict files or index.json', async () => {
  const A = await phone('a');
  const ph = '83-M-20261103-101010-aaaaaaaa.jpg';
  const r = await A.st.saveInspection(body(1, ph), undefined, { beforeWrite: async (rec) => A.fs.put(`inspections/${rec.folder}/${ph}`) });
  A.fs.put(`inspections/${r.folder}/inspection.conflict-x-1.json`, '{}');
  const files = await makeBundle(A, [A.st.records.get(r.uuid)]);
  assert.deepEqual(Object.keys(files).sort(), ['inspections/' + r.folder + '/' + ph, `inspections/${r.folder}/inspection.json`, 'manifest.json', `rounds/${r.roundId}.json`].sort());
  assert.deepEqual(JSON.parse(files['manifest.json']), { format: 'urci-bundle', version: 1, createdBy: A.st.deviceId, count: 1 });
});

test('full backup is split into complete parts under the size limit', () => {
  const store = { rounds: new Map([['I-HR01-S03-2026-11', {}]]) };
  const recs = [1, 2, 3, 4, 5].map((i) => ({ uuid: `u${i}`, folder: `20261103_I-HR01_S03_SU${i}_0000000${i}`, roundId: 'I-HR01-S03-2026-11', entries: [] }));
  const sizes = new Map(recs.map((r) => [`inspections/${r.folder}/inspection.json`, 400]));
  const parts = B.splitParts(B.exportPlan(store, recs, sizes), 'dev', 1000);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => p.manifest.count), [2, 2, 1]);
  for (const p of parts) assert.ok(p.paths.includes('rounds/I-HR01-S03-2026-11.json'), 'each part carries its rounds');
});

test('hostile or broken bundles are rejected as a whole with a class', () => {
  const ok = { name: 'manifest.json', size: 80 };
  const man = (count, extra = {}) => ({ 'manifest.json': JSON.stringify({ format: 'urci-bundle', version: 1, createdBy: 'x', count, ...extra }) });
  const cases = [
    [[ok, { name: '../evil.json', size: 1 }], man(0), 'UNSAFE_PATH'],
    [[ok, { name: '/abs/inspection.json', size: 1 }], man(0), 'UNSAFE_PATH'],
    [[ok, { name: 'inspections/x/../../a.jpg', size: 1 }], man(0), 'UNSAFE_PATH'],
    [[ok, { name: 'inspections/20261103_A_B_SU1_aaaaaaaa/x.jpg', size: 21 * 1024 * 1024 }], man(0), 'ENTRY_TOO_BIG'],
    [[ok, { name: 'notes.txt', size: 1 }], man(0), 'BAD_NAME'],
    [[ok, { name: 'inspections/bad folder/inspection.json', size: 1 }], man(1), 'BAD_NAME'],
    [[ok], { 'manifest.json': '{"format":"zip"}' }, 'NOT_A_BUNDLE'],
    [[ok], {}, 'NOT_A_BUNDLE'],
    [[ok], { 'manifest.json': JSON.stringify({ format: 'urci-bundle', version: 9, count: 0 }) }, 'VERSION'],
    [[ok, { name: 'inspections/20261103_A_B_SU1_aaaaaaaa/inspection.json', size: 10 }], man(3), 'COUNT_MISMATCH'],
    [[ok, ok], man(0), 'DUPLICATE'],
  ];
  for (const [entries, texts, cls] of cases) assert.equal(B.checkBundle(entries, texts).errorClass, cls, cls);
  const many = [ok, ...Array.from({ length: 20001 }, (_, i) => ({ name: `rounds/A-B-2026-${i}.json`, size: 1 }))];
  assert.equal(B.checkBundle(many, man(0)).errorClass, 'TOO_MANY');
});

test('schema-invalid records are skipped with a reason; unlisted photos are not copied', async () => {
  const A = await phone('a');
  const r = await A.st.saveInspection(body(1));
  const files = await makeBundle(A, [A.st.records.get(r.uuid)]);
  const evil = { ...JSON.parse(files[`inspections/${r.folder}/inspection.json`]), uuid: 'bbbbbbbb-0000-4000-8000-bbbbbbbb0000', folder: '20261103_I-HR01_S03_SU9_bbbbbbbb' };
  evil.header = { ...evil.header, remarks: 'x'.repeat(5000) };
  files['inspections/20261103_I-HR01_S03_SU9_bbbbbbbb/inspection.json'] = JSON.stringify(evil);
  files['inspections/20261103_I-HR01_S03_SU9_bbbbbbbb/83-M-20261103-101010-bbbbbbbb.jpg'] = 'jpeg';
  files['manifest.json'] = JSON.stringify({ ...JSON.parse(files['manifest.json']), count: 2 });
  const c = B.checkBundle(entriesOf(files), textsOf(files));
  assert.equal(c.ok, true);
  assert.equal(c.records.length, 1);
  assert.equal(c.skipped.length, 1);
  assert.match(c.skipped[0].reason, /remarks/);
  assert.deepEqual(c.photos, [], 'photo of a skipped record is not copied');
});

test('two phones: export from A, import on B, then again (nothing new), then a conflict', async () => {
  const A = await phone('a');
  const B2 = await phone('b');
  const r1 = await A.st.saveInspection(body(1));
  const r2 = await A.st.saveInspection(body(2));
  const files = await makeBundle(A, A.st.live());
  let c = B.checkBundle(entriesOf(files), textsOf(files));
  let res = await B.applyBundle(B2.st, c);
  assert.equal(res.imported, 2);
  assert.equal(B2.st.live().length, 2);
  assert.ok(B2.st.rounds.has(r1.roundId));
  res = await B.applyBundle(B2.st, B.checkBundle(entriesOf(files), textsOf(files)));
  assert.deepEqual([res.imported, res.alreadyHad], [0, 2], 'second import: nothing new');
  // concurrent edits -> conflict on B
  await A.st.saveInspection({ ...body(1), entries: [{ code: '83', sev: 'M', quantity: 99 }] }, r1.uuid);
  await B2.st.saveInspection({ ...body(1), entries: [{ code: '83', sev: 'M', quantity: 11 }] }, r1.uuid);
  const files2 = await makeBundle(A, [A.st.records.get(r1.uuid)]);
  res = await B.applyBundle(B2.st, B.checkBundle(entriesOf(files2), textsOf(files2)));
  assert.equal(res.conflicts.length, 1);
  assert.ok(res.conflicts[0].fields.includes('83-M'));
  assert.equal(B2.st.records.get(r1.uuid).entries[0].quantity, 11, 'local stays in use until resolved');
  void r2;
});

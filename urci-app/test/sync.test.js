'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../www/store.js');
const { FakeStorage, FakeKV, idGen } = require('./fake-storage.js');

let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 1, 10, 0, clock++)).toISOString();

async function phone(prefix) {
  const fs = new FakeStorage();
  const st = new S.Store({ fs, kv: new FakeKV(), newId: idGen(prefix), now });
  await st.init();
  await st.loadAll();
  return { fs, st };
}

const body = (over = {}) => ({
  header: { branch: 'I-HR01', section: 'S03', sampleUnit: 2, date: '2026-10-01', sampleArea: 100, inspector: 'Ani', ...(over.header || {}) },
  entries: over.entries || [{ code: '83', sev: 'M', quantity: 50, photos: [{ name: '83-M-20261001-101107-9f3e2c11.jpg' }] }],
});

// Simulate a bundle: copy record JSON (and its photos) from one phone to another, then apply.
async function ship(from, to, uuid) {
  const rec = from.st.records.get(uuid);
  const dir = `inspections/${rec.folder}`;
  for (const n of from.fs.names(dir)) if (n.endsWith('.jpg') && !to.fs.has(`${dir}/${n}`)) to.fs.put(`${dir}/${n}`);
  const round = from.st.rounds.get(rec.roundId);
  if (round) await to.st.applyIncomingRound(JSON.parse(JSON.stringify(round)));
  return to.st.applyIncoming(JSON.parse(JSON.stringify(rec)));
}

test('version vectors: compare, merge, bump', () => {
  assert.equal(S.compareVV({ a: 1 }, { a: 1 }), 'equal');
  assert.equal(S.compareVV({ a: 2 }, { a: 1 }), 'dominates');
  assert.equal(S.compareVV({ a: 1 }, { a: 1, b: 1 }), 'dominated');
  assert.equal(S.compareVV({ a: 2 }, { a: 1, b: 1 }), 'concurrent');
  assert.deepEqual(S.mergeVV({ a: 2, b: 1 }, { a: 1, c: 4 }), { a: 2, b: 1, c: 4 });
  assert.deepEqual(S.bumpVV({ a: 2 }, 'b'), { a: 2, b: 1 });
});

test('round ids are deterministic per section and month (SYNC-1)', () => {
  assert.equal(S.roundIdFor('I-HR01', 'S03', '2026-10-31'), 'I-HR01-S03-2026-10');
  assert.equal(S.roundIdFor('Jalan Utama/1', 'S 3', '2026-11-01'), 'Jalan-Utama-1-S-3-2026-11');
  assert.match(S.roundIdFor('x'.repeat(50), 'y'.repeat(50), '2026-10-01'), S.PATTERNS.roundId);
  assert.equal(S.folderNameFor({ date: '2026-10-01', branch: 'I-HR01', section: 'S03', sampleUnit: 2, uuid: 'a1b2c3d4-0000-4000-8000-000000000000' }), '20261001_I-HR01_S03_SU2_a1b2c3d4');
});

test('save writes the record, the month round and the index; edit bumps only this phone', async () => {
  const A = await phone('a');
  const r1 = await A.st.saveInspection(body());
  assert.deepEqual(r1.vv, { [A.st.deviceId]: 1 });
  assert.ok(A.fs.has(`inspections/${r1.folder}/inspection.json`));
  assert.ok(A.fs.has('rounds/I-HR01-S03-2026-10.json'));
  const r2 = await A.st.saveInspection(body({ header: { inspector: 'Budi' } }), r1.uuid);
  assert.deepEqual(r2.vv, { [A.st.deviceId]: 2 });
  assert.equal(r2.folder, r1.folder);
  assert.equal(await A.st.indexIsStale(), false);
});

test('import: new record is taken; older copy is kept out; newer copy fast-forwards and photos reconcile', async () => {
  const A = await phone('a');
  const B = await phone('b');
  const r = await A.st.saveInspection(body());
  A.fs.put(`inspections/${r.folder}/83-M-20261001-101107-9f3e2c11.jpg`);
  assert.equal((await ship(A, B, r.uuid)).action, 'take');
  // B edits: replaces the photo
  const newPhoto = '83-M-20261001-111111-aaaaaaaa.jpg';
  B.fs.put(`inspections/${r.folder}/${newPhoto}`);
  await B.st.saveInspection(body({ entries: [{ code: '83', sev: 'M', quantity: 60, photos: [{ name: newPhoto }] }] }), r.uuid);
  assert.equal((await ship(B, A, r.uuid)).action, 'take');
  assert.equal(A.st.records.get(r.uuid).entries[0].quantity, 60);
  assert.deepEqual(A.fs.names(`inspections/${r.folder}`).filter((n) => n.endsWith('.jpg')), [newPhoto]);
  // the stale A copy shipped again to B is ignored
  const stale = { ...r };
  assert.equal(S.decideApply(B.st.records.get(r.uuid), stale), 'keep');
});

test('concurrent edits conflict; local stays in use; photos of both kept (OV-10)', async () => {
  const A = await phone('a');
  const B = await phone('b');
  const r = await A.st.saveInspection(body());
  await ship(A, B, r.uuid);
  const pa = '83-M-20261001-120000-aaaaaaaa.jpg';
  const pb = '83-H-20261001-120000-bbbbbbbb.jpg';
  A.fs.put(`inspections/${r.folder}/${pa}`);
  B.fs.put(`inspections/${r.folder}/${pb}`);
  await A.st.saveInspection(body({ entries: [{ code: '83', sev: 'M', quantity: 70, photos: [{ name: pa }] }] }), r.uuid);
  await B.st.saveInspection(body({ entries: [{ code: '83', sev: 'H', quantity: 10, photos: [{ name: pb }] }] }), r.uuid);
  const res = await ship(B, A, r.uuid);
  assert.equal(res.action, 'conflict');
  assert.ok(res.fields.includes('83-M') && res.fields.includes('83-H'));
  assert.equal(A.st.records.get(r.uuid).entries[0].quantity, 70); // local still in use
  assert.ok(A.fs.has(`inspections/${r.folder}/${res.conflictFile}`));
  await A.st.reconcilePhotos(r.uuid);
  assert.ok(A.fs.has(`inspections/${r.folder}/${pa}`) && A.fs.has(`inspections/${r.folder}/${pb}`));
  // shipping the same conflicting version twice does not duplicate
  assert.equal((await ship(B, A, r.uuid)).conflictFile, res.conflictFile);
  assert.equal(A.st.conflicts.get(r.uuid).length, 1);
  // the conflict survives a restart
  await A.st.loadAll();
  assert.equal(A.st.conflicts.get(r.uuid).length, 1);
});

test('resolve on A, import on B: B fast-forwards, no new conflict, no leftover conflict file', async () => {
  const A = await phone('a');
  const B = await phone('b');
  const r = await A.st.saveInspection(body());
  await ship(A, B, r.uuid);
  await A.st.saveInspection(body({ header: { inspector: 'A-edit' } }), r.uuid);
  await B.st.saveInspection(body({ header: { inspector: 'B-edit' } }), r.uuid);
  const onA = await ship(B, A, r.uuid);
  const onB = await ship(A, B, r.uuid); // B also sees the conflict
  assert.equal(onA.action, 'conflict');
  assert.equal(onB.action, 'conflict');
  const resolved = await A.st.resolveConflict(r.uuid, onA.conflictFile, 'incoming');
  assert.equal(resolved.header.inspector, 'B-edit');
  assert.ok(!A.fs.names(`inspections/${r.folder}`).some((n) => n.startsWith('inspection.conflict-')));
  const res = await ship(A, B, r.uuid);
  assert.equal(res.action, 'take');
  assert.equal(B.st.conflicts.has(r.uuid), false);
  assert.ok(!B.fs.names(`inspections/${r.folder}`).some((n) => n.startsWith('inspection.conflict-')));
  // and shipping back to A changes nothing
  assert.equal((await ship(B, A, r.uuid)).action, 'keep');
});

test('independent identical resolutions merge silently (OV-8); different ones re-conflict', async () => {
  for (const [choiceA, choiceB, expect] of [['incoming', 'mine', 'merge-equal'], ['mine', 'mine', 'conflict']]) {
    const A = await phone('a');
    const B = await phone('b');
    const r = await A.st.saveInspection(body());
    await ship(A, B, r.uuid);
    await A.st.saveInspection(body({ header: { inspector: 'A-edit' } }), r.uuid);
    await B.st.saveInspection(body({ header: { inspector: 'B-edit' } }), r.uuid);
    const ca = await ship(B, A, r.uuid);
    const cb = await ship(A, B, r.uuid);
    await A.st.resolveConflict(r.uuid, ca.conflictFile, choiceA); // A picks B-edit or A-edit
    await B.st.resolveConflict(r.uuid, cb.conflictFile, choiceB); // B picks B-edit
    const res = await ship(B, A, r.uuid);
    assert.equal(res.action, expect, `${choiceA}/${choiceB}`);
    if (expect === 'merge-equal') {
      assert.equal(A.st.conflicts.has(r.uuid), false);
      assert.equal(S.compareVV(A.st.records.get(r.uuid).vv, B.st.records.get(r.uuid).vv), 'dominates');
    }
  }
});

test('tombstones travel, delete photos, and an older copy cannot resurrect the record', async () => {
  const A = await phone('a');
  const B = await phone('b');
  const r = await A.st.saveInspection(body());
  A.fs.put(`inspections/${r.folder}/83-M-20261001-101107-9f3e2c11.jpg`);
  await ship(A, B, r.uuid);
  const live = JSON.parse(JSON.stringify(B.st.records.get(r.uuid)));
  await A.st.deleteInspection(r.uuid);
  assert.equal(A.fs.names(`inspections/${r.folder}`).filter((n) => n.endsWith('.jpg')).length, 0);
  assert.equal((await ship(A, B, r.uuid)).action, 'take');
  assert.ok(B.st.records.get(r.uuid).deletedAt);
  assert.equal(B.fs.names(`inspections/${r.folder}`).filter((n) => n.endsWith('.jpg')).length, 0);
  assert.equal((await B.st.applyIncoming(live)).action, 'keep');
  assert.ok(B.st.records.get(r.uuid).deletedAt);
  assert.equal(B.st.live().length, 0);
});

test('delete-vs-edit conflict keeps the incoming photos until resolved (OV-10)', async () => {
  const A = await phone('a');
  const B = await phone('b');
  const r = await A.st.saveInspection(body({ entries: [] }));
  await ship(A, B, r.uuid);
  const pb = '83-M-20261001-130000-bbbbbbbb.jpg';
  B.fs.put(`inspections/${r.folder}/${pb}`);
  await B.st.saveInspection(body({ entries: [{ code: '83', sev: 'M', quantity: 5, photos: [{ name: pb }] }] }), r.uuid);
  await A.st.deleteInspection(r.uuid);
  const res = await ship(B, A, r.uuid);
  assert.equal(res.action, 'conflict');
  assert.ok(res.fields.includes('deleted'));
  assert.ok(A.fs.has(`inspections/${r.folder}/${pb}`));
  await A.st.resolveConflict(r.uuid, res.conflictFile, 'mine'); // keep deletion
  assert.ok(!A.fs.has(`inspections/${r.folder}/${pb}`));
});

test('round files auto-merge without a prompt (R4) and the merge is symmetric', () => {
  const id = 'I-HR01-S03-2026-10';
  const def = S.defaultRoundLabel(id);
  const a = { roundId: id, label: def, vv: { a: 1 } };
  const b = { roundId: id, label: def, vv: { b: 1 } };
  assert.deepEqual(S.mergeRound(a, b), { roundId: id, label: def, vv: { a: 1, b: 1 } });
  const ac = { ...a, vv: { a: 2 }, closedAt: '2026-10-30T00:00:00Z' };
  const br = { ...b, vv: { b: 2 }, label: 'Putaran khusus' };
  const m1 = S.mergeRound(ac, br);
  const m2 = S.mergeRound(br, ac);
  assert.deepEqual(m1, m2);
  assert.equal(m1.closedAt, '2026-10-30T00:00:00Z');
  assert.equal(m1.label, 'Putaran khusus');
  // a reopen that dominates the close wins (R5)
  const reopened = { roundId: id, label: def, vv: { a: 3, b: 2 } };
  assert.equal(S.mergeRound(m1, reopened).closedAt, undefined);
  // both renamed differently: same pick on both phones
  const x = { ...a, label: 'Alpha', vv: { a: 2 } };
  const y = { ...b, label: 'Bravo', vv: { b: 2 } };
  assert.equal(S.mergeRound(x, y).label, S.mergeRound(y, x).label);
});

test('same-month rounds on two phones converge with no prompt', async () => {
  const A = await phone('a');
  const B = await phone('b');
  const ra = await A.st.saveInspection(body());
  const rb = await B.st.saveInspection(body({ header: { sampleUnit: 3 } }));
  assert.equal(ra.roundId, rb.roundId);
  await A.st.closeRound(ra.roundId);
  await ship(A, B, ra.uuid);
  await ship(B, A, rb.uuid);
  assert.deepEqual(A.st.rounds.get(ra.roundId), B.st.rounds.get(ra.roundId));
  assert.ok(B.st.isRoundClosed(ra.roundId));
});

test('closed round is read-only until reopened (R5)', async () => {
  const A = await phone('a');
  const r = await A.st.saveInspection(body());
  await A.st.closeRound(r.roundId);
  await assert.rejects(A.st.saveInspection(body({ header: { sampleUnit: 9 } })), { code: 'ROUND_CLOSED' });
  await assert.rejects(A.st.saveInspection(body(), r.uuid), { code: 'ROUND_CLOSED' });
  await assert.rejects(A.st.deleteInspection(r.uuid), { code: 'ROUND_CLOSED' });
  await A.st.reopenRound(r.roundId);
  await A.st.saveInspection(body({ header: { sampleUnit: 9 } }));
  assert.equal(A.st.live().length, 2);
});

test('crash-safe save recovery decisions (ERR-1)', async () => {
  const ok = { ok: 1 };
  const reader = (good) => async (n) => (good.includes(n) ? ok : null);
  const B = 'inspection.json';
  assert.deepEqual(await S.decideRecovery([B], B, reader([B])), []);
  assert.deepEqual(await S.decideRecovery([B, B + '.new', B + '.old'], B, reader([B])), [
    { op: 'delete', name: B + '.new' },
    { op: 'delete', name: B + '.old' },
  ]);
  // crashed after step 2: only .new and .old exist
  assert.deepEqual(await S.decideRecovery([B + '.new', B + '.old'], B, reader([B + '.new', B + '.old'])), [
    { op: 'rename', from: B + '.new', to: B },
    { op: 'delete', name: B + '.old' },
  ]);
  // .new truncated: fall back to .old
  assert.deepEqual(await S.decideRecovery([B + '.new', B + '.old'], B, reader([B + '.old'])), [
    { op: 'rename', from: B + '.old', to: B },
    { op: 'delete', name: B + '.new' },
  ]);
});

test('loadAll recovers interrupted writes and reports broken files without crashing (LOCAL-1)', async () => {
  const A = await phone('a');
  const r = await A.st.saveInspection(body());
  const dir = `inspections/${r.folder}`;
  // simulate crash between rename steps
  await A.fs.rename(`${dir}/inspection.json`, 'inspection.json.new');
  A.fs.put(`${dir}/inspection.json.old`, '{"truncated');
  // a hand-edited broken record and an evil one
  A.fs.put('inspections/20261002_I-HR01_S03_SU5_bbbbbbbb/inspection.json', '{not json');
  const evil = { ...r, uuid: 'cccccccc-0000-4000-8000-cccccccc0000', folder: '20261003_I-HR01_S03_SU6_cccccccc', header: { ...r.header, remarks: '<img src=x onerror=alert(1)>'.repeat(100) } };
  A.fs.put(`inspections/${evil.folder}/inspection.json`, JSON.stringify(evil));
  A.fs.put('inspections/../escape/inspection.json'.replace('../', 'x'), '{}'); // odd folder name
  await A.st.loadAll();
  assert.ok(A.st.records.has(r.uuid));
  assert.ok(A.fs.has(`${dir}/inspection.json`) && !A.fs.has(`${dir}/inspection.json.new`) && !A.fs.has(`${dir}/inspection.json.old`));
  const reasons = A.st.broken.map((b) => b.path + ' ' + b.reason).join('\n');
  assert.match(reasons, /SU5_bbbbbbbb\/inspection.json not JSON/);
  assert.match(reasons, /SU6_cccccccc\/inspection.json remarks: longer than 1000/);
  assert.match(reasons, /unexpected folder name/);
});

test('index goes stale when a crash lands between record and index writes (OV-17)', async () => {
  const A = await phone('a');
  await A.st.saveInspection(body());
  assert.equal(await A.st.indexIsStale(), false);
  await A.st._beginWrite(); // record written, app killed before index
  assert.equal(await A.st.indexIsStale(), true);
  await A.st.writeIndex();
  assert.equal(await A.st.indexIsStale(), false);
  A.fs.put('inspections/20261009_I-HR01_S03_SU7_dddddddd/inspection.json', '{}'); // folder copied in by hand
  assert.equal(await A.st.indexIsStale(), true);
});

test('share by section/date includes tombstones, never conflict files, and does not match a longer section name', async () => {
  const A = await phone('a');
  const keep = await A.st.saveInspection(body());
  const gone = await A.st.saveInspection(body({ header: { sampleUnit: 4 } }));
  await A.st.deleteInspection(gone.uuid);
  await A.st.saveInspection(body({ header: { section: 'S03-B' } }));
  await A.st.saveInspection(body({ header: { date: '2026-12-01' } }));
  const sel = A.st.selectForShare({ sectionKey: S.sectionKey('I-HR01', 'S03'), from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(sel.records.map((r) => r.uuid).sort(), [keep.uuid, gone.uuid].sort());
  assert.deepEqual(sel.rounds.map((r) => r.roundId), ['I-HR01-S03-2026-10']);
});

test('schema validation: caps, photo names, duplicates, newer schema, folder/uuid match', () => {
  const base = {
    schemaVersion: 1,
    uuid: 'a1b2c3d4-0000-4000-8000-000000000001',
    folder: '20261001_I-HR01_S03_SU2_a1b2c3d4',
    roundId: 'I-HR01-S03-2026-10',
    vv: { dev1: 1 },
    ...body(),
  };
  assert.deepEqual(S.validateInspection(base).errors, []);
  const bad = (patch) => S.validateInspection({ ...base, ...patch }).errors.join('|');
  assert.match(bad({ schemaVersion: 2 }), /newer than this app/);
  assert.match(bad({ folder: '20261001_I-HR01_S03_SU2_ffffffff' }), /does not match uuid/);
  assert.match(bad({ roundId: 'I-HR01-S03-2026-11' }), /does not match section\/month/);
  assert.match(bad({ entries: [{ code: '83', sev: 'M', quantity: 1, photos: [{ name: '../../x.jpg' }] }] }), /name: invalid/);
  assert.match(bad({ entries: [{ code: '83', sev: 'M', quantity: 1, photos: [{ name: '81-L-20261001-101107-9f3e2c11.jpg' }] }] }), /wrong distress/);
  assert.match(bad({ entries: [{ code: '83', sev: 'M', quantity: 1 }, { code: '83', sev: 'M', quantity: 2 }] }), /83-M twice/);
  assert.match(bad({ entries: [{ code: '88', sev: 'M', quantity: 1 }] }), /code: invalid/);
  assert.match(bad({ vv: {} }), /vv: invalid/);
  assert.match(bad({ header: { ...base.header, inspector: 'x'.repeat(61) } }), /inspector: longer than 60/);
});

test('saveInspection beforeWrite runs before the record is written; a failure writes nothing', async () => {
  const A = await phone('a');
  const order = [];
  const photo = '83-M-20261001-101107-9f3e2c11.jpg';
  const rec = await A.st.saveInspection(body(), undefined, {
    beforeWrite: async (r) => { order.push('photos'); A.fs.put(`inspections/${r.folder}/${photo}`); assert.ok(!A.fs.has(`inspections/${r.folder}/inspection.json`)); },
  });
  order.push('saved');
  assert.deepEqual(order, ['photos', 'saved']);
  assert.ok(A.fs.has(`inspections/${rec.folder}/${photo}`), 'photo kept: it is listed in the record');
  const before = A.st.records.size;
  await assert.rejects(A.st.saveInspection(body({ header: { sampleUnit: 7 } }), undefined, { beforeWrite: async () => { throw Object.assign(new Error('copy failed'), { code: 'NO_SPACE' }); } }), { code: 'NO_SPACE' });
  assert.equal(A.st.records.size, before);
});

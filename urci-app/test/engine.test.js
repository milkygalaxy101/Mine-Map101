'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const E = require('../www/urci-engine.js');

const curves = JSON.parse(fs.readFileSync(path.join(__dirname, '../www/curves.json'), 'utf8'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

// Tiny synthetic curves for exact rule tests (independent of digitized data).
function fakeCurves() {
  const line = [[0, 0], [10, 10], [100, 40]];
  const deduct = {};
  for (const c of ['81', '82', '83', '85', '86', '87']) deduct[c] = { points: { L: line, M: line, H: line } };
  const urci = {};
  for (let q = 2; q <= 7; q++) urci[q] = { points: [[20, 80], [100, 30], [180, 2 * q]] };
  return { format: 'urci-curves', status: 'reconciled', dust84: { L: 2, M: 4, H: 15 }, deduct, urci };
}

test('curves.json passes structural validation', () => {
  const v = E.validateCurves(curves);
  assert.deepEqual(v.errors, []);
});

test('worked example FS 101 (TM 5-626): deducts ±1, URCI ±2', () => {
  // 81-L 18.2 %, 83-M 50.0 %, 84-M, 87-M 29.2 %; area chosen so quantities give those densities
  const area = 100;
  const r = E.computeUrci(curves, {
    sampleArea: area,
    entries: [
      { code: '81', sev: 'L', quantity: 18.2 },
      { code: '83', sev: 'M', quantity: 50.0 },
      { code: '84', sev: 'M' },
      { code: '87', sev: 'M', quantity: 29.2 },
    ],
  });
  const tm = { '81-L': 13, '83-M': 29, '84-M': 4, '87-M': 18 };
  for (const row of r.rows) near(E.roundHalfUp(row.deduct), tm[`${row.code}-${row.sev}`], 1, `${row.code}-${row.sev}`);
  assert.equal(r.q, 3);
  near(r.urci, 59, 2, 'FS101 URCI');
});

test('worked example FS 144 (TM 5-626): 130 m², deducts ±1, URCI ±2', () => {
  const r = E.computeUrci(curves, {
    sampleArea: 130,
    entries: [
      { code: '81', sev: 'M', quantity: 30.5 },
      { code: '82', sev: 'H', quantity: 61.0 },
      { code: '84', sev: 'L' },
      { code: '86', sev: 'M', quantity: 45.5 },
      { code: '86', sev: 'H', quantity: 84.5 },
    ],
  });
  const tm = { '81-M': [23.5, 19], '82-H': [46.9, 36], '84-L': [null, 2], '86-M': [35.0, 31], '86-H': [65.0, 44] };
  for (const row of r.rows) {
    const [dens, dv] = tm[`${row.code}-${row.sev}`];
    if (dens !== null) near(row.density, dens, 0.05, `density ${row.code}-${row.sev}`);
    near(E.roundHalfUp(row.deduct), dv, 1, `${row.code}-${row.sev}`);
  }
  assert.equal(r.q, 4);
  near(r.urci, 25, 2, 'FS144 URCI');
});

test('q counts deducts greater than 5.0; exactly 5.0 is not counted', () => {
  assert.equal(E.countQ([5.0, 5.0, 5.0001, 12, 2]), 2);
  const c = fakeCurves();
  // 5 % on the fake line gives deduct exactly 5.0
  const r = E.computeUrci(c, { sampleArea: 100, entries: [{ code: '81', sev: 'L', quantity: 5 }, { code: '82', sev: 'L', quantity: 5 }] });
  assert.equal(r.rows[0].deduct, 5);
  assert.equal(r.q, 0);
  assert.equal(r.urci, 90); // q=0 → 100 − TDV
});

test('q = 0: no distress gives URCI 100', () => {
  const r = E.computeUrci(curves, { sampleArea: 100, entries: [] });
  assert.equal(r.tdv, 0);
  assert.equal(r.q, 0);
  assert.equal(r.urci, 100);
});

test('q = 1 uses 100 − TDV and is clamped at 0 (TDV 150 → 0)', () => {
  assert.equal(E.urciFromTdv(curves, 30, 1).raw, 70);
  assert.equal(E.urciFromTdv(curves, 150, 1).raw, 0);
  assert.equal(E.urciFromTdv(curves, 150, 0).raw, 0);
});

test('q = 9 uses the q = 7 curve and is flagged', () => {
  const a = E.urciFromTdv(curves, 120, 9);
  const b = E.urciFromTdv(curves, 120, 7);
  assert.equal(a.raw, b.raw);
  assert.equal(a.curveQ, 7);
  assert.ok(a.flags.includes(E.FLAG.Q_OVER_7));
});

test('TDV over 200 is clamped and flagged; URCI stays in 0..100', () => {
  const r = E.urciFromTdv(curves, 260, 4);
  assert.ok(r.flags.includes(E.FLAG.TDV_OVER_200));
  assert.ok(r.raw >= 0 && r.raw <= 100);
  assert.equal(r.raw, E.urciFromTdv(curves, 200, 4).raw);
});

test('q >= 2 with TDV below the first plotted point uses that point and flags', () => {
  const c = fakeCurves();
  const r = E.urciFromTdv(c, 10, 3);
  assert.equal(r.raw, 80);
  assert.ok(r.flags.includes(E.FLAG.TDV_BELOW_CURVE));
});

test('q = 2 past the printed end continues to 0, never negative', () => {
  const r = E.urciFromTdv(curves, 190, 2);
  assert.equal(r.raw, 0);
});

test('density below the first plotted point interpolates from (0,0) and flags', () => {
  const c = fakeCurves();
  const d = E.deductValue(c, '81', 'M', 4);
  assert.equal(d.value, 4);
  assert.ok(d.flags.includes(E.FLAG.BELOW_FIRST_POINT));
  assert.deepEqual(E.deductValue(c, '81', 'M', 0), { value: 0, flags: [] });
});

test('density beyond the curve is clamped to the end and flagged off chart', () => {
  const c = fakeCurves();
  const d = E.deductValue(c, '81', 'H', 250);
  assert.equal(d.value, 40);
  assert.ok(d.flags.includes(E.FLAG.OFF_CHART_HIGH));
});

test('dust 84 is fixed per severity and ignores quantity', () => {
  for (const [s, v] of [['L', 2], ['M', 4], ['H', 15]]) assert.equal(E.deductValue(curves, '84', s, null).value, v);
});

test('same distress/severity entered twice is summed into one row', () => {
  const r = E.computeUrci(fakeCurves(), {
    sampleArea: 200,
    entries: [{ code: '83', sev: 'M', quantity: 10 }, { code: '83', sev: 'M', quantity: 10 }],
  });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].quantity, 20);
  assert.equal(r.rows[0].density, 10);
});

test('rounding happens once from raw: 84.45 → 84, 84.5 → 85', () => {
  assert.equal(E.roundHalfUp(84.45), 84);
  assert.equal(E.roundHalfUp(84.5), 85);
  assert.equal(E.roundHalfUp(84.49999999999999), 85); // binary noise just under .5 counts as .5
  assert.equal(E.rate(E.roundHalfUp(84.45)), 1); // Baik, not Sangat Baik
  assert.equal(E.rate(E.roundHalfUp(84.5)), 0);
});

test('draft curves are flagged on every result; reconciled curves are not', () => {
  const draft = { ...fakeCurves(), status: 'draft-reader1' };
  assert.ok(E.computeUrci(draft, { sampleArea: 100, entries: [] }).flags.includes(E.FLAG.CURVES_DRAFT));
  assert.ok(!E.computeUrci(fakeCurves(), { sampleArea: 100, entries: [] }).flags.includes(E.FLAG.CURVES_DRAFT));
  assert.equal(curves.status, 'reconciled');
  assert.ok(!E.computeUrci(curves, { sampleArea: 100, entries: [] }).flags.includes(E.FLAG.CURVES_DRAFT));
});

test('bad input throws InputError naming the field', () => {
  assert.throws(() => E.density(5, 0), (e) => e instanceof E.InputError && e.field === 'sampleArea');
  assert.throws(() => E.density(-1, 100), (e) => e.field === 'quantity');
  assert.throws(() => E.computeUrci(curves, { sampleArea: 100, entries: [{ code: '88', sev: 'L', quantity: 1 }] }), E.InputError);
  assert.throws(() => E.computeUrci(curves, { sampleArea: 100, entries: [{ code: '81', sev: 'X', quantity: 1 }] }), E.InputError);
  assert.throws(() => E.computeUrci(curves, { sampleArea: 100, entries: [{ code: '81', sev: 'L', quantity: NaN }] }), E.InputError);
});

test('bands: validation, derived ranges with no gaps, rating', () => {
  assert.ok(E.validateBands([85, 65, 45, 25]).ok);
  assert.ok(!E.validateBands([85, 85, 45, 25]).ok);
  assert.ok(!E.validateBands([100, 65, 45, 25]).ok);
  assert.ok(!E.validateBands([85, 65, 45, 0]).ok);
  assert.ok(!E.validateBands([85, 65.5, 45, 25]).ok);
  const r = E.bandRanges([85, 65, 45, 25]);
  assert.deepEqual(r.map((b) => [b.lo, b.hi]), [[85, 100], [65, 84], [45, 64], [25, 44], [0, 24]]);
  assert.equal(E.rate(65), 1);
  assert.equal(E.rate(64), 2);
  assert.equal(E.rate(0), 4);
  assert.equal(E.rate(100), 0);
});

test('section mean and outliers use raw values; outlier is > 10 below the mean', () => {
  const units = [{ id: 'a', urciRaw: 70 }, { id: 'b', urciRaw: 72 }, { id: 'c', urciRaw: 74 }, { id: 'd', urciRaw: 52.4 }];
  const mean = E.sectionMean(units.map((u) => u.urciRaw));
  near(mean, 67.1, 1e-9, 'mean');
  assert.deepEqual(E.outliers(units), ['d']);
  assert.equal(E.sectionMean([]), null);
});

test('engine is monotonic: more distress never raises URCI (same q)', () => {
  let prev = 101;
  for (let t = 0; t <= 200; t += 5) {
    const u = E.urciFromTdv(curves, t, 4).raw;
    assert.ok(u <= prev + 1e-9, `TDV ${t}`);
    prev = u;
  }
});

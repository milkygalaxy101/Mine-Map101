'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../www/history-model.js');

let n = 0;
function rec(branch, section, su, date, urci, extra = {}) {
  n++;
  return {
    uuid: `u${n}`, roundId: `${branch}-${section}-${date.slice(0, 7)}`, updatedAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`,
    header: { branch, section, sampleUnit: su, date }, entries: extra.entries || [], result: { urciRaw: urci }, ...extra,
  };
}

test('trend: one point per round = mean of the latest inspection of each unit', () => {
  const rs = [
    rec('A', 'S1', 1, '2026-09-03', 80), rec('A', 'S1', 2, '2026-09-04', 70),
    rec('A', 'S1', 1, '2026-10-02', 50), rec('A', 'S1', 1, '2026-10-20', 60), // re-inspected: latest counts
    rec('A', 'S1', 2, '2026-10-05', 40),
  ];
  const t = H.buildTrend(rs, new Map());
  assert.deepEqual(t.map((x) => [x.month, x.mean, x.n, x.N]), [['2026-09', 75, 2, 2], ['2026-10', 50, 2, 2]]);
});

test('coverage below 50 % marks a round incomplete; deleted records are ignored', () => {
  const rs = [1, 2, 3, 4].map((su) => rec('A', 'S1', su, '2026-09-01', 70));
  rs.push(rec('A', 'S1', 1, '2026-10-01', 40));
  rs.push({ ...rec('A', 'S1', 2, '2026-10-01', 10), deletedAt: '2026-10-02T00:00:00Z' });
  const t = H.buildTrend(rs, new Map());
  assert.equal(t[1].n, 1);
  assert.equal(t[1].N, 4);
  assert.equal(t[1].incomplete, true);
  assert.equal(t[0].incomplete, false);
});

test('outlier: a unit more than 10 points below its round mean', () => {
  const rs = [rec('A', 'S1', 1, '2026-09-01', 80), rec('A', 'S1', 2, '2026-09-01', 78), rec('A', 'S1', 3, '2026-09-01', 50)];
  const units = H.buildTrend(rs, new Map())[0].units;
  assert.deepEqual(units.filter((u) => u.outlier).map((u) => u.sampleUnit), [3]);
});

test('sections are sorted worst-first with change since the previous round', () => {
  const rs = [
    rec('A', 'S1', 1, '2026-09-01', 80), rec('A', 'S1', 1, '2026-10-01', 68),
    rec('B', 'S2', 1, '2026-10-01', 30),
    rec('C', 'S3', 1, '2026-10-01', 90),
  ];
  const s = H.buildSections(rs, new Map());
  assert.deepEqual(s.map((x) => x.key), ['B-S2', 'A-S1', 'C-S3']);
  assert.equal(s[1].change, -12);
  assert.equal(s[0].change, null);
});

test('photo count per unit and round labels from round files', () => {
  const r = rec('A', 'S1', 1, '2026-09-01', 70, { entries: [{ code: '83', sev: 'M', quantity: 5, photos: [{ name: 'a' }, { name: 'b' }] }] });
  const t = H.buildTrend([r], new Map([[r.roundId, { label: 'Putaran khusus', closedAt: '2026-09-30' }]]));
  assert.equal(t[0].units[0].photos, 2);
  assert.equal(t[0].label, 'Putaran khusus');
  assert.equal(t[0].closed, true);
});

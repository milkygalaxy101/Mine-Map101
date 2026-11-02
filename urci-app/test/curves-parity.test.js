'use strict';
// The app's curves.json must be exactly the digitized table in docs/designs/curves, and that
// table must still pass the TM 5-626 worked-example anchors (validate.py).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '../..');
const curvesDir = path.join(root, 'docs/designs/curves');
const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../www/curves.json'), 'utf8'));
const src = JSON.parse(fs.readFileSync(path.join(curvesDir, 'curves.reconciled.json'), 'utf8'));

test('www/curves.json matches docs/designs/curves/curves.reconciled.json', () => {
  assert.deepEqual(app.dust84, src.dust84);
  for (const [code, v] of Object.entries(src.deduct)) assert.deepEqual(app.deduct[code].points, v.severity, `deduct ${code}`);
  for (const [q, v] of Object.entries(src.urci)) assert.deepEqual(app.urci[q].points, v.points, `urci q=${q}`);
  assert.equal(Object.keys(app.deduct).length, Object.keys(src.deduct).length);
});

test('app curve status follows the source: reconciled only when the source says so', () => {
  assert.equal(app.status === 'reconciled', src._status.startsWith('RECONCILED'));
});

test('validate.py: TM worked-example anchors pass', (t) => {
  let out;
  try {
    out = execFileSync('python3', ['-I', path.join(curvesDir, 'validate.py'), path.join(curvesDir, 'curves.reconciled.json')], { encoding: 'utf8' });
  } catch (e) {
    if (e.code === 'ENOENT') return t.skip('python3 not installed');
    throw e;
  }
  assert.match(out, /ALL ANCHORS PASS/);
});

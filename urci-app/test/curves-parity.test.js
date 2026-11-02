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
const src = JSON.parse(fs.readFileSync(path.join(curvesDir, 'curves.reader1.json'), 'utf8'));

test('www/curves.json matches docs/designs/curves/curves.reader1.json', () => {
  assert.deepEqual(app.dust84, src.dust84);
  for (const [code, v] of Object.entries(src.deduct)) assert.deepEqual(app.deduct[code].points, v.severity, `deduct ${code}`);
  for (const [q, v] of Object.entries(src.urci)) assert.deepEqual(app.urci[q].points, v.points, `urci q=${q}`);
  assert.equal(Object.keys(app.deduct).length, Object.keys(src.deduct).length);
});

test('app curves stay marked draft until reader 2 reconciles them', () => {
  if (src._status.startsWith('DRAFT')) assert.notEqual(app.status, 'reconciled');
});

test('validate.py: TM worked-example anchors pass', (t) => {
  let out;
  try {
    out = execFileSync('python3', ['-I', path.join(curvesDir, 'validate.py'), path.join(curvesDir, 'curves.reader1.json')], { encoding: 'utf8' });
  } catch (e) {
    if (e.code === 'ENOENT') return t.skip('python3 not installed');
    throw e;
  }
  assert.match(out, /ALL ANCHORS PASS/);
});

'use strict';
// ID and EN content must have the same keys, so no screen ever shows a missing label (eng: content parity check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { id, en } = require('../www/content.js');

function keys(o, p = '') {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
}

test('content.id and content.en have identical keys', () => {
  assert.deepEqual(keys(id), keys(en));
});

test('every distress 81-87 has short name, full name, figure and help in both languages', () => {
  for (const lang of [id, en]) {
    for (const c of ['81', '82', '83', '84', '85', '86', '87']) {
      const d = lang.distress[c];
      assert.ok(d && d.short && d.name && d.fig && d.help, `${c} incomplete`);
    }
    assert.equal(lang.bands.length, 5);
  }
});

test('no content key is accidentally redefined with a different type (e.g. units object vs string)', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../www/content.js'), 'utf8');
  for (const block of [src.slice(src.indexOf('const id = {'), src.indexOf('const en = {')), src.slice(src.indexOf('const en = {'))]) {
    const top = [...block.matchAll(/^ {4}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
    const dup = top.filter((k, i) => top.indexOf(k) !== i);
    assert.deepEqual(dup, [], `duplicate top-level keys: ${dup}`);
  }
  for (const lang of [id, en]) {
    assert.equal(typeof lang.units, 'object');
    assert.equal(lang.units.m2, 'm²');
  }
});

test('www/version.js matches package.json version', () => {
  const fs = require('node:fs');
  const v = /URCI_VERSION = '([^']+)'/.exec(fs.readFileSync(require.resolve('../www/version.js'), 'utf8'))[1];
  assert.equal(v, require('../package.json').version);
});

test('self-test on the shipped curves passes (FS101 59, FS144 within 2 of TM 25)', () => {
  global.self = {};
  require('../www/settings.js');
  const { runSelfTest } = global.self.UrciSelfTest;
  delete global.self;
  const curves = require('../www/curves.json');
  const res = runSelfTest(require('../www/urci-engine.js'), curves);
  assert.deepEqual(res.map((r) => [r.id, r.urci, r.ok]), [['FS 101', 59, true], ['FS 144', 23, true]]);
});

'use strict';
// Release gate (DEP-1 / T9) and the one-version-source rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(app, p), 'utf8');

test('release.json, package.json and www/version.js carry the same version', async () => {
  const { checkRelease, jsVersionOf } = await import('../scripts/release-check.mjs');
  const release = JSON.parse(read('release.json'));
  const errors = checkRelease({ tag: `urci-v${release.versionName}`, release, pkgVersion: JSON.parse(read('package.json')).version, jsVersion: jsVersionOf(read('www/version.js')), prev: null });
  assert.deepEqual(errors, []);
  assert.match(read('android/app/build.gradle'), /versionCode urciRelease\.versionCode/);
});

test('gate: tag must match, versionCode must rise, a released name cannot be reused', async () => {
  const { checkRelease } = await import('../scripts/release-check.mjs');
  const base = { tag: 'urci-v0.2.0', release: { versionName: '0.2.0', versionCode: 2 }, pkgVersion: '0.2.0', jsVersion: '0.2.0' };
  const prev = { tag: 'urci-v0.1.0', release: { versionName: '0.1.0', versionCode: 1 } };
  assert.deepEqual(checkRelease({ ...base, prev }), []);
  assert.match(checkRelease({ ...base, release: { versionName: '0.2.0', versionCode: 1 }, prev }).join(), /must be higher than 1/);
  assert.match(checkRelease({ ...base, tag: 'urci-v0.2.1', prev }).join(), /does not match/);
  assert.match(checkRelease({ ...base, jsVersion: '0.1.0', prev }).join(), /version\.js/);
  assert.match(checkRelease({ ...base, pkgVersion: '0.1.0', prev }).join(), /package\.json/);
  assert.match(checkRelease({ ...base, prev: { tag: 'urci-v0.2.0-rc', release: { versionName: '0.2.0', versionCode: 1 } } }).join(), /already released/);
  assert.match(checkRelease({ ...base, release: { versionName: '0.2', versionCode: 2 }, tag: 'urci-v0.2' }).join(), /x\.y\.z/);
  assert.match(checkRelease({ ...base, release: { versionName: '0.2.0', versionCode: 0 } }).join(), /positive integer/);
});

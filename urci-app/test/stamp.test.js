'use strict';
// Stamp text and gallery-import time rules (design: Photo rules / Gallery import, P7-3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ctx = {};
new Function('self', fs.readFileSync(path.join(__dirname, '../www/stamp.js'), 'utf8'))(ctx);
const S = ctx.UrciStamp;
const base = { code: '83', shortName: 'Bergelombang', sevName: 'Sedang', at: new Date(2026, 9, 1, 10, 11).getTime(), branch: 'I-HR01', section: 'S03', sampleUnit: 2, gpsNa: 'GPS: n/a' };

test('camera stamp has no marker line', () => {
  const l = S.stampLines({ ...base, fix: { lat: -2.98712, lon: 115.42301, acc: 4.2 } });
  assert.deepEqual(l, ['83 BERGELOMBANG · SEDANG', '01/10/2026 10:11', 'I-HR01/S03/SU2', '-2.98712, 115.42301 ±4m']);
});

test('gallery stamp starts with the marker; EXIF GPS has no ±', () => {
  const l = S.stampLines({ ...base, fix: { lat: -2.98712, lon: 115.42301, acc: null }, marker: 'IMPOR GALERI · WAKTU MANUAL' });
  assert.equal(l[0], 'IMPOR GALERI · WAKTU MANUAL');
  assert.equal(l[4], '-2.98712, 115.42301');
  assert.equal(S.stampLines({ ...base, fix: null, marker: 'IMPOR GALERI' })[4], 'GPS: n/a');
});

test('parseExifTime: local time, offsets, and junk', () => {
  assert.equal(S.parseExifTime('2026:10:01 10:11:12'), new Date(2026, 9, 1, 10, 11, 12).getTime());
  assert.equal(S.parseExifTime('2026:10:01 10:11:12', '+08:00'), Date.UTC(2026, 9, 1, 2, 11, 12));
  assert.equal(S.parseExifTime('2026:10:01 10:11:12', '-03:30'), Date.UTC(2026, 9, 1, 13, 41, 12));
  for (const bad of [null, '', '0000:00:00 00:00:00', '2026:13:01 10:00:00', '2026:02:30 10:00:00', 'yesterday']) assert.equal(S.parseExifTime(bad), null, String(bad));
});

test('readExifTime reads DateTimeOriginal + offset from a JPEG, null when absent', () => {
  const buf = (f) => { const b = fs.readFileSync(path.join(__dirname, 'ui', f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  assert.deepEqual(S.readExifTime(buf('fixture-exif.jpg')), { dto: '2026:10:01 10:11:12', offset: '+08:00' });
  assert.equal(S.readExifTime(buf('fixture-road.jpg')), null);
  assert.equal(S.readExifTime(new ArrayBuffer(8)), null);
});

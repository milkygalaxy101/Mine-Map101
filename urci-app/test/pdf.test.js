'use strict';
// Builds the TM FS144 worked example into a real PDF (embedded Barlow/Plex fonts + one photo) and reads it back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { jsPDF } = require(path.join(__dirname, '../node_modules/jspdf/dist/jspdf.node.min.js'));
const E = require('../www/urci-engine.js');
const { id, en } = require('../www/content.js');
const Sheet = require('../www/pdf-sheet.js');
const curves = JSON.parse(fs.readFileSync(path.join(__dirname, '../www/curves.json'), 'utf8'));
const font = (f) => fs.readFileSync(path.join(__dirname, '../www/pdf-fonts', f)).toString('base64');

function fs144(lang, photos = []) {
  const entries = [
    { code: '81', sev: 'M', quantity: 30.5 }, { code: '82', sev: 'H', quantity: 61 }, { code: '84', sev: 'L' },
    { code: '86', sev: 'M', quantity: 45.5 }, { code: '86', sev: 'H', quantity: 84.5 },
  ];
  const calc = E.computeUrci(curves, { sampleArea: 130, entries });
  const t = lang === 'id' ? id : en;
  return {
    t, lang, calc,
    rec: { header: { branch: 'I-HR01', section: 'S03', sampleUnit: 2, date: '2026-11-03', sampleArea: 130, inspector: 'Ani' }, entries },
    roundLabel: 'Putaran Nov 2026', gps: { lat: -2.98712, lon: 115.42301, acc: 4 }, photoCount: photos.length,
    band: E.rate(calc.urci, E.DEFAULT_BAND_LOWERS), bandRanges: E.bandRanges(E.DEFAULT_BAND_LOWERS),
    fonts: { regular: font('Barlow-Regular.ttf'), semibold: font('Barlow-SemiBold.ttf'), mono: font('IBMPlexMono-Regular.ttf') },
    generatedAt: '03/11/2026 10:30', photos,
  };
}

function textOf(doc) {
  const f = path.join(os.tmpdir(), `urci-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, Buffer.from(doc.output('arraybuffer')));
  try { return { text: execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }), pages: Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f], { encoding: 'utf8' }))[1]), fonts: execFileSync('pdffonts', [f], { encoding: 'utf8' }) }; }
  finally { fs.unlinkSync(f); }
}

test('FS144 sheet: blocks 1-10, calculation and result in Indonesian', (t) => {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch (e) { return t.skip('poppler not installed'); }
  const { text, pages, fonts } = textOf(Sheet.build(jsPDF, fs144('id')));
  assert.equal(pages, 1);
  for (const s of ['Lembar Inspeksi Jalan Tanah', 'format DA 7348-R', 'I-HR01', 'S03', '03/11/2026', 'SU2', '130', 'Ani',
    'Putaran Nov 2026', '-2.98712', 'JENIS KERUSAKAN', 'Kemiringan jalan', 'Drainase tepi', 'Alur roda', '30,5', '84,5',
    'Sangat Buruk', 'TM 5-626']) assert.ok(text.includes(s), `missing "${s}"`);
  assert.match(text, /\b23\b/, 'URCI 23');
  assert.match(text, /132,9/, 'TDV 132,9 (one decimal of 132.95)');
  assert.match(text, /36,2/, '82-H deduct 36,2');
  assert.match(fonts, /Barlow/);
  assert.match(fonts, /PlexMono|IBMPlexMono/);
});

test('photo pages: two per page, aspect kept, SHA shown, tamper warning', (t) => {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch (e) { return t.skip('poppler not installed'); }
  const jpg = new Uint8Array(fs.readFileSync(path.join(__dirname, 'ui/fixture-road.jpg')));
  const ph = (n, tampered) => ({ code: '86', sev: 'H', name: `86-H-20261103-1030${n}0-aaaaaaa${n}.jpg`, bytes: jpg, sha256: 'b'.repeat(64), takenAt: '2026-11-03T02:30:00Z', gps: { lat: -2.98712, lon: 115.42301, acc: 4 }, tampered });
  const { text, pages } = textOf(Sheet.build(jsPDF, fs144('id', [ph(1, false), ph(2, false), ph(3, true)])));
  assert.equal(pages, 3, '1 sheet + 2 photo pages');
  assert.ok(text.includes('Lampiran foto'));
  assert.ok(text.includes('86-H-20261103-103010-aaaaaaa1.jpg'));
  assert.ok(text.includes('SHA-256 ' + 'b'.repeat(64)));
  assert.equal((text.match(/PERINGATAN: FOTO DIUBAH/g) || []).length, 1);
  const f = Sheet.fitBox(1200, 1600, 186, 114);
  assert.ok(Math.abs(f.w / f.h - 0.75) < 1e-9, 'portrait photo keeps 3:4');
});

test('English sheet uses English labels', (t) => {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch (e) { return t.skip('poppler not installed'); }
  const { text } = textOf(Sheet.build(jsPDF, fs144('en')));
  for (const s of ['DISTRESS TYPES', 'Cross slope', 'Very Poor', '30.5', 'Remarks']) assert.ok(text.includes(s), `missing "${s}"`);
});

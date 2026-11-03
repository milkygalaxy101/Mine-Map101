'use strict';
// "All data as .xlsx" (T7): sheet contents from the store records, and a file Excel-compatible readers open.
// The file is read back with openpyxl when Python has it (CI installs it); the zip/XML checks always run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fflate = require('fflate');
const E = require('../www/urci-engine.js');
const { buildWorkbook } = require('../www/xlsx-export.js');
const { UrciXlsx } = require('../www/xlsx-writer.js');
const content = require('../www/content.js');
const curves = JSON.parse(fs.readFileSync(path.join(__dirname, '../www/curves.json'), 'utf8'));

const FS101 = [{ code: '81', sev: 'L', quantity: 30.5 }, { code: '83', sev: 'M', quantity: 83.7 }, { code: '84', sev: 'M' }, { code: '87', sev: 'M', quantity: 48.8 }];
function rec(uuid, su, date, entries, extra = {}) {
  const res = E.computeUrci(curves, { sampleArea: 167.4, entries });
  return { uuid, roundId: `I-HR01__S03-${date.slice(0, 7)}`, header: { branch: 'I-HR01', section: 'S03', sampleUnit: su, date, sampleArea: 167.4, ...extra },
    entries, result: { urciRaw: res.urciRaw, urci: res.urci, tdv: res.tdv, q: res.q } };
}
const records = [
  rec('u-1', 1, '2026-10-01', FS101, { inspector: '=HYPERLINK("x")\u0007 Budi' }),
  rec('u-2', 2, '2026-10-02', [{ code: '85', sev: 'H', quantity: 3, photos: [{ name: '85-H-20261002-101010-aaaaaaaa.jpg' }] }]),
  { ...rec('u-3', 3, '2026-10-03', FS101), deletedAt: '2026-10-04T00:00:00Z' },
];
const rounds = new Map([['I-HR01__S03-2026-10', { closedAt: '2026-10-31T00:00:00Z' }]]);
const t = content.id;

function wb() {
  return buildWorkbook({ records, rounds, engine: E, curves, t, lowers: [...E.DEFAULT_BAND_LOWERS], hasConflict: (u) => u === 'u-2', generatedAt: '03/11/2026 10:00', version: '0.1.0' });
}

test('sheets: inspections, distresses with engine deducts, trend, info; deleted records left out', () => {
  const [ins, dis, tr, info] = wb();
  assert.deepEqual([ins.name, dis.name, tr.name, info.name], ['Inspeksi', 'Kerusakan', 'Tren', 'Info']);
  assert.equal(ins.rows.length, 2);
  const r1 = ins.rows[0];
  assert.equal(r1[10], 59); // URCI of the TM FS101 example
  assert.equal(r1[7], 'Ditutup');
  assert.equal(ins.rows[1][14], 'Ya'); // conflict marked
  const calc = E.computeUrci(curves, { sampleArea: 167.4, entries: FS101 });
  const deducts = dis.rows.filter((r) => r[12] === 'u-1').map((r) => r[10]);
  assert.deepEqual(deducts, calc.rows.map((r) => Math.round(r.deduct * 10) / 10));
  const dust = dis.rows.find((r) => r[4] === 84);
  assert.equal(dust[7], null); assert.equal(dust[9], null);
  assert.equal(dis.rows.find((r) => r[4] === 85)[11], 1);
  assert.equal(tr.rows.length, 1);
  assert.equal(tr.rows[0][6], 2); assert.equal(tr.rows[0][7], 2);
  assert.ok(info.rows.some((r) => /1 inspeksi punya konflik/.test(r[1])));
});

test('the .xlsx: valid package, inline strings (no formulas), control characters dropped', () => {
  const bytes = UrciXlsx.build(wb(), fflate);
  const files = fflate.unzipSync(bytes);
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet4.xml']) assert.ok(files[p], p);
  const s1 = fflate.strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.ok(!/<f>/.test(s1), 'no formula cells');
  assert.ok(s1.includes('=HYPERLINK(&quot;x&quot;) Budi'), 'typed "=..." kept as text, escaped');
  assert.ok(!s1.includes('\u0007'));
  assert.equal(UrciXlsx.colName(0), 'A'); assert.equal(UrciXlsx.colName(25), 'Z'); assert.equal(UrciXlsx.colName(26), 'AA');

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'urci-xlsx-')), 'all.xlsx');
  fs.writeFileSync(out, bytes);
  let have = true;
  try { execFileSync('python3', ['-c', 'import openpyxl']); } catch (e) { have = false; }
  if (!have) return; // openpyxl not installed here: zip/XML checks above still ran
  const py = `import json,sys,openpyxl
wb=openpyxl.load_workbook(sys.argv[1])
o={n:[[c for c in r] for r in wb[n].iter_rows(values_only=True)] for n in wb.sheetnames}
o['_frozen']=wb['Inspeksi'].freeze_panes
o['_fmt']=wb['Kerusakan']['K2'].number_format
print(json.dumps(o,default=str))`;
  const got = JSON.parse(execFileSync('python3', ['-c', py, out], { encoding: 'utf8' }));
  assert.deepEqual(Object.keys(got).filter((k) => !k.startsWith('_')), ['Inspeksi', 'Kerusakan', 'Tren', 'Info']);
  assert.equal(got.Inspeksi[0][0], 'Kode jalan');
  assert.equal(got.Inspeksi[1][10], 59);
  assert.equal(typeof got.Inspeksi[1][4], 'number');
  assert.equal(got.Inspeksi[1][5], '=HYPERLINK("x") Budi');
  assert.equal(got._frozen, 'A2');
  assert.equal(got._fmt, '0.0');
});

// "All data as .xlsx" (design T7): the sheets as plain rows; xlsx-writer.js turns them into a file in the export
// worker. Sheets: Inspeksi (one row per inspection), Kerusakan (one row per distress entry, with density and the
// deduct value recomputed by the engine), Tren (one row per section per survey round), Info (source, bands,
// generated time). Deleted inspections are left out; an unresolved conflict exports the local version, marked.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./history-model.js'));
  else root.UrciXlsxExport = factory(root.UrciHistory);
})(typeof self !== 'undefined' ? self : this, function (H) {
  'use strict';

  const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

  function buildWorkbook({ records, rounds, engine, curves, t, lowers, hasConflict = () => false, generatedAt, version }) {
    const x = t.xlsx;
    const live = records.filter((r) => !r.deletedAt && r.header)
      .sort((a, b) => a.header.branch.localeCompare(b.header.branch) || a.header.section.localeCompare(b.header.section)
        || a.header.sampleUnit - b.header.sampleUnit || a.header.date.localeCompare(b.header.date));
    const bandName = (raw) => (Number.isFinite(raw) ? t.bands[engine.rate(engine.roundHalfUp(raw), lowers)] : '');
    const roundOf = (id) => (rounds && rounds.get ? rounds.get(id) : null);
    const status = (id) => (roundOf(id) && roundOf(id).closedAt ? x.closed : x.open);
    const yes = (b) => (b ? x.yes : '');
    const photoCount = (r) => (r.entries || []).reduce((a, e) => a + ((e.photos && e.photos.length) || 0), 0);

    const inspections = {
      name: x.sheets.inspections,
      columns: [
        { header: x.cols.branch, width: 12 }, { header: x.cols.section, width: 10 }, { header: x.cols.unit, type: 'int', width: 9 },
        { header: x.cols.date, width: 12 }, { header: x.cols.area, type: 'num', width: 11 }, { header: x.cols.inspector, width: 16 },
        { header: x.cols.round, width: 12 }, { header: x.cols.roundStatus, width: 11 },
        { header: 'TDV', type: 'num1', width: 8 }, { header: 'q', type: 'int', width: 5 },
        { header: 'URCI', type: 'int', width: 7 }, { header: x.cols.urci1dp, type: 'num1', width: 10 }, { header: x.cols.band, width: 13 },
        { header: x.cols.photos, type: 'int', width: 8 }, { header: x.cols.conflict, width: 10 }, { header: x.cols.id, width: 38 },
      ],
      rows: live.map((r) => {
        const res = r.result || {};
        return [r.header.branch, r.header.section, r.header.sampleUnit, r.header.date, r.header.sampleArea, r.header.inspector || '',
          H.monthOf(r.roundId), status(r.roundId), r1(res.tdv), res.q, res.urci, r1(res.urciRaw), bandName(res.urciRaw),
          photoCount(r), yes(hasConflict(r.uuid)), r.uuid];
      }),
    };

    const distressRows = [];
    for (const r of live) {
      let calc = null;
      try { calc = engine.computeUrci(curves, { sampleArea: r.header.sampleArea, entries: r.entries || [] }); } catch (e) { /* bad record: amounts only */ }
      const byKey = new Map((calc ? calc.rows : []).map((row) => [`${row.code}-${row.sev}`, row]));
      for (const e of r.entries || []) {
        const d = t.distress[e.code] || {};
        const row = byKey.get(`${e.code}-${e.sev}`);
        distressRows.push([r.header.branch, r.header.section, r.header.sampleUnit, r.header.date, Number(e.code), d.name || '',
          t.sevName[e.sev] || e.sev, e.code === '84' ? null : e.quantity, e.code === '84' ? '' : (t.units[d.unit] || ''),
          row && Number.isFinite(row.density) ? r1(row.density) : null, row ? r1(row.deduct) : null, (e.photos || []).length, r.uuid]);
      }
    }
    const distress = {
      name: x.sheets.distress,
      columns: [
        { header: x.cols.branch, width: 12 }, { header: x.cols.section, width: 10 }, { header: x.cols.unit, type: 'int', width: 9 },
        { header: x.cols.date, width: 12 }, { header: x.cols.code, type: 'int', width: 7 }, { header: x.cols.distress, width: 30 },
        { header: x.cols.severity, width: 9 }, { header: x.cols.amount, type: 'num', width: 9 }, { header: x.cols.unitOfMeasure, width: 8 },
        { header: x.cols.density, type: 'num1', width: 12 }, { header: x.cols.deduct, type: 'num1', width: 11 },
        { header: x.cols.photos, type: 'int', width: 8 }, { header: x.cols.id, width: 38 },
      ],
      rows: distressRows,
    };

    const bySection = new Map();
    for (const r of live) {
      const k = H.sectionKeyOf(r.roundId);
      if (!bySection.has(k)) bySection.set(k, { branch: r.header.branch, section: r.header.section, recs: [] });
      bySection.get(k).recs.push(r);
    }
    const trendRows = [];
    for (const s of [...bySection.values()].sort((a, b) => a.branch.localeCompare(b.branch) || a.section.localeCompare(b.section))) {
      for (const tr of H.buildTrend(s.recs, rounds)) {
        trendRows.push([s.branch, s.section, tr.month, tr.closed ? x.closed : x.open, r1(tr.mean), bandName(tr.mean), tr.n, tr.N,
          tr.incomplete ? x.no : x.yes, tr.units.filter((u) => u.outlier).map((u) => `SU${u.sampleUnit} (${Math.round(u.urciRaw)})`).join(', ')]);
      }
    }
    const trend = {
      name: x.sheets.trend,
      columns: [
        { header: x.cols.branch, width: 12 }, { header: x.cols.section, width: 10 }, { header: x.cols.round, width: 10 },
        { header: x.cols.roundStatus, width: 11 }, { header: x.cols.mean, type: 'num1', width: 12 }, { header: x.cols.band, width: 13 },
        { header: x.cols.unitsDone, type: 'int', width: 11 }, { header: x.cols.unitsAll, type: 'int', width: 10 },
        { header: x.cols.complete, width: 9 }, { header: x.cols.outliers, width: 28 },
      ],
      rows: trendRows,
    };

    const conflicts = live.filter((r) => hasConflict(r.uuid)).length;
    const info = {
      name: x.sheets.info,
      columns: [{ header: x.cols.item, width: 26 }, { header: x.cols.value, width: 90 }],
      rows: [
        [x.info.title, x.info.titleValue],
        [x.info.generated, generatedAt],
        [x.info.app, `URCI Field ${version || ''}`.trim()],
        [x.info.counts, x.info.countsValue.replace('{i}', inspections.rows.length).replace('{d}', distress.rows.length).replace('{s}', bySection.size)],
        [x.info.bands, engine.bandRanges(lowers).map((b) => `${t.bands[b.band]} ${b.lo}–${b.hi}`).join(' · ')],
        [x.info.rules, x.info.rulesValue],
        ...(conflicts ? [[x.info.conflicts, x.info.conflictsValue.replace('{n}', conflicts)]] : []),
        [x.info.source, t.sourceFootnote],
      ],
    };
    return [inspections, distress, trend, info];
  }

  return { buildWorkbook };
});

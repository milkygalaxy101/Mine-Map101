// History model: pure functions over saved records (no DOM). Design rules:
//  - trend point = one per round: mean URCI (raw) of the LATEST live inspection of each sample unit in that round
//  - coverage "n dari N": N = distinct sample units ever inspected in the section; < 50 % = incomplete (hollow point)
//  - outlier (TM 5-626 §4-2b): a unit more than 10 points below its round mean
//  - sections list sorted worst-first by the latest round mean
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UrciHistory = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function urciOf(r) {
    return r && r.result && Number.isFinite(r.result.urciRaw) ? r.result.urciRaw : null;
  }

  function monthOf(roundId) {
    return roundId.slice(-7); // "yyyy-MM"
  }

  function sectionKeyOf(roundId) {
    return roundId.slice(0, -8);
  }

  // Latest live inspection per sample unit (by header date, then save time).
  function latestPerUnit(records) {
    const byUnit = new Map();
    for (const r of records) {
      if (r.deletedAt || !r.header) continue;
      const su = r.header.sampleUnit;
      const cur = byUnit.get(su);
      const key = (x) => `${x.header.date}|${x.updatedAt || ''}`;
      if (!cur || key(r) > key(cur)) byUnit.set(su, r);
    }
    return byUnit;
  }

  function buildTrend(records, rounds, opts = {}) {
    const roundLabel = opts.roundLabel || ((id) => id);
    const live = records.filter((r) => !r.deletedAt && r.header);
    const allUnits = new Set(live.map((r) => r.header.sampleUnit));
    const N = allUnits.size;
    const byRound = new Map();
    for (const r of live) {
      if (!byRound.has(r.roundId)) byRound.set(r.roundId, []);
      byRound.get(r.roundId).push(r);
    }
    const out = [];
    for (const [roundId, recs] of byRound) {
      const units = [...latestPerUnit(recs).values()];
      const vals = units.map(urciOf).filter((v) => v !== null);
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const round = rounds && rounds.get ? rounds.get(roundId) : null;
      out.push({
        roundId,
        month: monthOf(roundId),
        label: (round && round.label) || roundLabel(roundId),
        closed: !!(round && round.closedAt),
        mean,
        n: units.length,
        N,
        incomplete: N > 0 && units.length / N < 0.5,
        units: units
          .map((r) => ({
            uuid: r.uuid,
            sampleUnit: r.header.sampleUnit,
            urciRaw: urciOf(r),
            date: r.header.date,
            photos: (r.entries || []).reduce((a, e) => a + ((e.photos && e.photos.length) || 0), 0),
            outlier: mean !== null && urciOf(r) !== null && mean - urciOf(r) > 10,
          }))
          .sort((a, b) => a.sampleUnit - b.sampleUnit),
      });
    }
    out.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
    return out;
  }

  // Sections list (IA-1): one row per section key, worst latest mean first.
  function buildSections(records, rounds, opts = {}) {
    const bySection = new Map();
    for (const r of records) {
      if (r.deletedAt || !r.header) continue;
      const sk = sectionKeyOf(r.roundId);
      if (!bySection.has(sk)) bySection.set(sk, { key: sk, branch: r.header.branch, section: r.header.section, records: [] });
      bySection.get(sk).records.push(r);
    }
    const out = [];
    for (const s of bySection.values()) {
      const trend = buildTrend(s.records, rounds, opts);
      const last = trend[trend.length - 1];
      const prev = trend.length > 1 ? trend[trend.length - 2] : null;
      out.push({
        key: s.key,
        branch: s.branch,
        section: s.section,
        latest: last ? last.mean : null,
        previous: prev ? prev.mean : null,
        change: last && prev && last.mean !== null && prev.mean !== null ? last.mean - prev.mean : null,
        n: last ? last.n : 0,
        N: last ? last.N : 0,
        rounds: trend.length,
        conflicts: s.records.filter((r) => opts.hasConflict && opts.hasConflict(r.uuid)).length,
      });
    }
    out.sort((a, b) => (a.latest === null) - (b.latest === null) || a.latest - b.latest || a.key.localeCompare(b.key));
    return out;
  }

  return { buildTrend, buildSections, latestPerUnit, sectionKeyOf, monthOf };
});

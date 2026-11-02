// URCI engine: pure functions, no DOM, no I/O. Implements TM 5-626 Ch. 3 with the ENG-1 rules
// from docs/designs/urci-field-app.md. Works as a browser global (window.UrciEngine) and as a
// CommonJS module for `node --test`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UrciEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CODES = ['81', '82', '83', '84', '85', '86', '87'];
  const SEVERITIES = ['L', 'M', 'H'];
  const TDV_MAX = 200;
  const EPS = 1e-9;

  // Flag identifiers. The UI maps them to ID/EN strings ("di luar grafik / off chart", ...).
  const FLAG = Object.freeze({
    OFF_CHART_HIGH: 'offChartHigh', // density beyond the curve's x-range, clamped to the end
    BELOW_FIRST_POINT: 'belowFirstPoint', // density below the first plotted point, interpolated from (0,0)
    Q_OVER_7: 'qOver7', // q > 7, the q = 7 curve was used
    TDV_OVER_200: 'tdvOver200', // TDV beyond 200, clamped
    TDV_BELOW_CURVE: 'tdvBelowCurve', // q >= 2 and TDV below the curve's first plotted point
    CURVES_DRAFT: 'curvesDraft', // curves.json is not yet reconciled by two readers (CURVE-1)
  });

  class InputError extends Error {
    constructor(field, reason) {
      super(`${field}: ${reason}`);
      this.name = 'InputError';
      this.field = field;
      this.reason = reason;
    }
  }

  function isNum(x) {
    return typeof x === 'number' && Number.isFinite(x);
  }

  // Round half up, once, from the raw value (ENG-1). EPS absorbs binary noise such as 84.4999999999.
  function roundHalfUp(x) {
    return Math.floor(x + 0.5 + EPS);
  }

  // Piecewise-linear lookup on sorted [x, y] points. Outside the range: clamp (no extrapolation).
  function interpolate(points, x) {
    if (x <= points[0][0]) return points[0][1];
    const last = points[points.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i];
      if (x <= x1) {
        const [x0, y0] = points[i - 1];
        return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
      }
    }
    return last[1];
  }

  function validateCurves(curves) {
    const errors = [];
    const checkPts = (name, pts, yMin, yMax) => {
      if (!Array.isArray(pts) || pts.length < 2) return errors.push(`${name}: needs >= 2 points`);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) return errors.push(`${name}[${i}]: not [x,y]`);
        if (p[1] < yMin - EPS || p[1] > yMax + EPS) errors.push(`${name}[${i}]: y ${p[1]} out of range`);
        if (i > 0 && !(p[0] > pts[i - 1][0])) errors.push(`${name}[${i}]: x not increasing`);
      }
    };
    if (!curves || curves.format !== 'urci-curves') errors.push('format: not urci-curves');
    for (const code of CODES) {
      if (code === '84') {
        for (const s of SEVERITIES) if (!isNum(curves?.dust84?.[s])) errors.push(`84-${s}: missing`);
        continue;
      }
      for (const s of SEVERITIES) {
        const pts = curves?.deduct?.[code]?.points?.[s];
        checkPts(`${code}-${s}`, pts, 0, 100);
        if (pts && pts[0] && (pts[0][0] !== 0 || pts[0][1] !== 0)) errors.push(`${code}-${s}: must start at [0,0]`);
        // deduct curves never decrease with density
        if (pts) for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1] - EPS) errors.push(`${code}-${s}[${i}]: decreasing`);
      }
    }
    for (let q = 2; q <= 7; q++) {
      const pts = curves?.urci?.[q]?.points;
      checkPts(`urci q=${q}`, pts, 0, 100);
      if (pts) for (let i = 1; i < pts.length; i++) if (pts[i][1] > pts[i - 1][1] + EPS) errors.push(`urci q=${q}[${i}]: increasing`);
    }
    return { ok: errors.length === 0, errors };
  }

  // density (%) = quantity / sample area × 100 (TM 5-626 §3-4b(1)).
  function density(quantity, sampleArea) {
    if (!isNum(sampleArea) || sampleArea <= 0) throw new InputError('sampleArea', 'must be > 0');
    if (!isNum(quantity) || quantity < 0) throw new InputError('quantity', 'must be >= 0');
    return (quantity / sampleArea) * 100;
  }

  // Deduct value for one distress/severity. 84 (dust) is a fixed value per severity (Fig C-4).
  function deductValue(curves, code, sev, dens) {
    code = String(code);
    if (!CODES.includes(code)) throw new InputError('code', `unknown distress ${code}`);
    if (!SEVERITIES.includes(sev)) throw new InputError('severity', `unknown severity ${sev}`);
    const flags = [];
    if (code === '84') return { value: curves.dust84[sev], flags };
    if (!isNum(dens) || dens < 0) throw new InputError('density', 'must be >= 0');
    if (dens === 0) return { value: 0, flags };
    const pts = curves.deduct[code].points[sev];
    const last = pts[pts.length - 1];
    if (dens > last[0] + EPS) flags.push(FLAG.OFF_CHART_HIGH);
    // pts[0] is the (0,0) origin; pts[1] is the first plotted point (ENG-1: interpolate from (0,0)).
    if (pts.length > 1 && dens < pts[1][0]) flags.push(FLAG.BELOW_FIRST_POINT);
    return { value: interpolate(pts, dens), flags };
  }

  // q = number of deduct values greater than 5.0 (§3-4b(3)); exactly 5.0 is not counted.
  function countQ(deducts) {
    return deducts.filter((d) => d > 5.0).length;
  }

  // URCI from TDV and q (Fig C-8). Clamped to 0..100 on every curve (ENG-1).
  function urciFromTdv(curves, tdv, q) {
    if (!isNum(tdv) || tdv < 0) throw new InputError('tdv', 'must be >= 0');
    const flags = [];
    let t = tdv;
    if (t > TDV_MAX + EPS) {
      flags.push(FLAG.TDV_OVER_200);
      t = TDV_MAX;
    }
    let curveQ = q;
    if (q > 7) {
      flags.push(FLAG.Q_OVER_7);
      curveQ = 7;
    }
    let raw;
    if (curveQ <= 1) {
      raw = 100 - t; // "q = 0 or 1" line
    } else {
      const pts = curves.urci[curveQ].points;
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (t < first[0]) {
        flags.push(FLAG.TDV_BELOW_CURVE);
        raw = first[1];
      } else if (t > last[0]) {
        // The printed curves leave the chart at URCI 0 (q=2,3) or at TDV 200. Continue the last
        // segment's slope, then clamp; this reaches 0 where the printed line exits the top.
        const prev = pts[pts.length - 2];
        const slope = (last[1] - prev[1]) / (last[0] - prev[0]);
        raw = last[1] + slope * (t - last[0]);
      } else {
        raw = interpolate(pts, t);
      }
    }
    raw = Math.min(100, Math.max(0, raw));
    return { raw, flags, curveQ };
  }

  // Sum quantities per distress/severity (one DA 7348-R row each), then compute everything.
  // entries: [{ code, sev, quantity }]   (quantity ignored for 84)
  function computeUrci(curves, { sampleArea, entries }) {
    if (!isNum(sampleArea) || sampleArea <= 0) throw new InputError('sampleArea', 'must be > 0');
    if (!Array.isArray(entries)) throw new InputError('entries', 'must be an array');
    const totals = new Map();
    for (const e of entries) {
      const code = String(e.code);
      if (!CODES.includes(code)) throw new InputError('code', `unknown distress ${code}`);
      if (!SEVERITIES.includes(e.sev)) throw new InputError('severity', `unknown severity ${e.sev}`);
      const q = code === '84' ? 0 : e.quantity;
      if (code !== '84' && (!isNum(q) || q < 0)) throw new InputError(`${code}-${e.sev}`, 'quantity must be >= 0');
      const key = `${code}-${e.sev}`;
      totals.set(key, (totals.get(key) || 0) + q);
    }
    const rows = [];
    for (const code of CODES) {
      for (const sev of SEVERITIES) {
        const key = `${code}-${sev}`;
        if (!totals.has(key)) continue;
        const quantity = totals.get(key);
        if (code !== '84' && quantity === 0) continue;
        const dens = code === '84' ? null : density(quantity, sampleArea);
        const d = deductValue(curves, code, sev, dens);
        rows.push({ code, sev, quantity: code === '84' ? null : quantity, density: dens, deduct: d.value, flags: d.flags });
      }
    }
    const deducts = rows.map((r) => r.deduct);
    const tdv = deducts.reduce((a, b) => a + b, 0);
    const q = countQ(deducts);
    const u = urciFromTdv(curves, tdv, q);
    const flags = [...u.flags];
    if (curves.status !== 'reconciled') flags.push(FLAG.CURVES_DRAFT);
    return {
      rows,
      tdv,
      q,
      curveQ: u.curveQ,
      urciRaw: u.raw, // keep full precision; mean and outlier use this
      urci1dp: Math.round(u.raw * 10) / 10, // display only, never re-rounded
      urci: roundHalfUp(u.raw), // integer for display and rating, rounded once from raw
      flags,
    };
  }

  // ---- rating bands ----
  // Bands are 4 strictly decreasing integer lower limits in 1..99; band 0 is top (lower..100),
  // band 4 is bottom (0..lowest-1). Default site convention: 85 / 65 / 45 / 25.
  const DEFAULT_BAND_LOWERS = Object.freeze([85, 65, 45, 25]);

  function validateBands(lowers) {
    const errors = [];
    if (!Array.isArray(lowers) || lowers.length !== 4) return { ok: false, errors: ['need 4 lower limits'] };
    lowers.forEach((v, i) => {
      if (!Number.isInteger(v) || v < 1 || v > 99) errors.push(`limit ${i + 1}: integer 1..99`);
      if (i > 0 && !(v < lowers[i - 1])) errors.push(`limit ${i + 1}: must be below limit ${i}`);
    });
    return { ok: errors.length === 0, errors };
  }

  function bandRanges(lowers = DEFAULT_BAND_LOWERS) {
    const r = [];
    for (let i = 0; i < 5; i++) {
      const lo = i < 4 ? lowers[i] : 0;
      const hi = i === 0 ? 100 : lowers[i - 1] - 1;
      r.push({ band: i, lo, hi });
    }
    return r;
  }

  // Band index 0 (best) .. 4 (worst) for an integer URCI.
  function rate(urciInt, lowers = DEFAULT_BAND_LOWERS) {
    if (!Number.isInteger(urciInt) || urciInt < 0 || urciInt > 100) throw new InputError('urci', 'integer 0..100');
    for (let i = 0; i < 4; i++) if (urciInt >= lowers[i]) return i;
    return 4;
  }

  // ---- section statistics (raw values, ENG-1) ----
  function sectionMean(rawValues) {
    const v = rawValues.filter(isNum);
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }

  // §4-2b: a unit more than 10 points below the round mean.
  function outliers(units, threshold = 10) {
    const mean = sectionMean(units.map((u) => u.urciRaw));
    if (mean === null) return [];
    return units.filter((u) => isNum(u.urciRaw) && mean - u.urciRaw > threshold).map((u) => u.id);
  }

  return {
    CODES,
    SEVERITIES,
    FLAG,
    InputError,
    DEFAULT_BAND_LOWERS,
    roundHalfUp,
    interpolate,
    validateCurves,
    density,
    deductValue,
    countQ,
    urciFromTdv,
    computeUrci,
    validateBands,
    bandRanges,
    rate,
    sectionMean,
    outliers,
  };
});

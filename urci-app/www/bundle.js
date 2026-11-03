// .urci.zip bundles: what goes into an export, and how an incoming bundle is checked and applied.
// Pure decision logic (no I/O): native code only moves bytes and enforces hard limits (zip-slip, sizes).
//
// Bundle = manifest.json {"format":"urci-bundle","version":1,"createdBy":deviceId,"count":N}
//        + inspections/<folder>/inspection.json (tombstones included) + their photos
//        + rounds/<roundId>.json. Never .conflict-* files or index.json.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./store.js'));
  else root.UrciBundle = factory(root.UrciStore);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';
  const FORMAT = 'urci-bundle';
  const VERSION = 1;
  const PART_LIMIT = 1.5 * 1024 * 1024 * 1024; // full backup parts stay under the 2 GB import limit
  const LIMITS = { entryBytes: 20 * 1024 * 1024, totalBytes: 2 * 1024 * 1024 * 1024, entries: 20000 };

  const RE = {
    inspection: /^inspections\/([^/]+)\/inspection\.json$/,
    photo: /^inspections\/([^/]+)\/([^/]+\.jpg)$/,
    round: /^rounds\/([^/]+)\.json$/,
  };

  // ---------- export ----------
  // records: store records to include; sizes: Map(path -> bytes) for photos (optional, for part splitting)
  function exportPlan(store, records, sizes = new Map()) {
    const items = [];
    const roundIds = new Set();
    for (const r of records) {
      const dir = `inspections/${r.folder}`;
      const files = [`${dir}/inspection.json`];
      for (const n of S.photoNames(r)) files.push(`${dir}/${n}`);
      const bytes = files.reduce((a, f) => a + (sizes.get(f) || 4096), 0);
      items.push({ uuid: r.uuid, files, bytes });
      roundIds.add(r.roundId);
    }
    const rounds = [...roundIds].filter((id) => store.rounds.has(id)).map((id) => `rounds/${id}.json`);
    return { items, rounds };
  }

  // Split into parts of at most PART_LIMIT bytes; every part is a complete bundle (own manifest, own rounds).
  function splitParts(plan, deviceId, limit = PART_LIMIT) {
    const parts = [];
    let cur = null;
    for (const it of plan.items) {
      if (!cur || (cur.bytes + it.bytes > limit && cur.items.length)) {
        cur = { items: [], bytes: 0 };
        parts.push(cur);
      }
      cur.items.push(it);
      cur.bytes += it.bytes;
    }
    if (!parts.length) parts.push({ items: [], bytes: 0 });
    return parts.map((p) => ({
      paths: [...p.items.flatMap((i) => i.files), ...plan.rounds],
      manifest: { format: FORMAT, version: VERSION, createdBy: deviceId, count: p.items.length },
      bytes: p.bytes,
    }));
  }

  // ---------- import, pass 1 (after native listing) ----------
  // entries: [{ name, size }] as found in the zip; texts: { [name]: string } for manifest.json and *.json
  // Returns { ok:false, errorClass } to reject the whole bundle, or the accepted plan.
  function checkBundle(entries, texts) {
    const names = entries.map((e) => e.name);
    if (names.length > LIMITS.entries) return { ok: false, errorClass: 'TOO_MANY' };
    let total = 0;
    const seen = new Set();
    for (const e of entries) {
      const n = e.name;
      if (!n || n.startsWith('/') || n.includes('\\') || n.split('/').some((p) => p === '..' || p === '.' || p === '')) return { ok: false, errorClass: 'UNSAFE_PATH', detail: n };
      if (seen.has(n)) return { ok: false, errorClass: 'DUPLICATE', detail: n };
      seen.add(n);
      if (e.size > LIMITS.entryBytes) return { ok: false, errorClass: 'ENTRY_TOO_BIG', detail: n };
      total += e.size;
      if (total > LIMITS.totalBytes) return { ok: false, errorClass: 'TOO_BIG' };
    }
    let manifest;
    try { manifest = JSON.parse(texts['manifest.json']); } catch (e) { return { ok: false, errorClass: 'NOT_A_BUNDLE' }; }
    if (!manifest || manifest.format !== FORMAT) return { ok: false, errorClass: 'NOT_A_BUNDLE' };
    if (manifest.version !== VERSION) return { ok: false, errorClass: 'VERSION' };
    // every entry must be one of the allowed shapes (OV-2 patterns shared with UrciStorage)
    for (const n of names) {
      if (n === 'manifest.json') continue;
      let m;
      if ((m = RE.inspection.exec(n))) { if (!S.PATTERNS.folder.test(m[1])) return { ok: false, errorClass: 'BAD_NAME', detail: n }; continue; }
      if ((m = RE.photo.exec(n))) { if (!S.PATTERNS.folder.test(m[1]) || !S.PATTERNS.photo.test(m[2])) return { ok: false, errorClass: 'BAD_NAME', detail: n }; continue; }
      if ((m = RE.round.exec(n))) { if (!S.PATTERNS.roundId.test(m[1])) return { ok: false, errorClass: 'BAD_NAME', detail: n }; continue; }
      return { ok: false, errorClass: 'BAD_NAME', detail: n };
    }
    const inspNames = names.filter((n) => RE.inspection.test(n));
    if (manifest.count !== inspNames.length) return { ok: false, errorClass: 'COUNT_MISMATCH' };

    // per-record schema checks: invalid records are skipped with a reason, not fatal (IMP-1)
    const records = [];
    const skipped = [];
    for (const n of inspNames) {
      const folder = RE.inspection.exec(n)[1];
      let rec;
      try { rec = JSON.parse(texts[n]); } catch (e) { skipped.push({ name: n, reason: 'not JSON' }); continue; }
      const v = S.validateInspection(rec);
      if (!v.ok) { skipped.push({ name: n, reason: v.errors.slice(0, 2).join('; ') }); continue; }
      if (rec.folder !== folder) { skipped.push({ name: n, reason: 'folder field does not match' }); continue; }
      records.push(rec);
    }
    const rounds = [];
    for (const n of names.filter((x) => RE.round.test(x))) {
      let r;
      try { r = JSON.parse(texts[n]); } catch (e) { skipped.push({ name: n, reason: 'not JSON' }); continue; }
      const v = S.validateRound(r);
      if (!v.ok || `rounds/${r.roundId}.json` !== n) { skipped.push({ name: n, reason: v.ok ? 'name does not match roundId' : v.errors[0] }); continue; }
      rounds.push(r);
    }
    // photos are copied only when a valid record in this bundle lists them
    const wanted = new Set(records.flatMap((r) => [...S.photoNames(r)].map((p) => `inspections/${r.folder}/${p}`)));
    const photos = names.filter((n) => RE.photo.test(n) && wanted.has(n));
    const photoBytes = entries.filter((e) => wanted.has(e.name)).reduce((a, e) => a + e.size, 0);
    return { ok: true, manifest, records, rounds, photos, photoBytes, skipped };
  }

  // ---------- import, apply (after native pass 2 copied the photos) ----------
  async function applyBundle(store, checked) {
    const res = { imported: 0, alreadyHad: 0, merged: 0, conflicts: [], skipped: [...checked.skipped] };
    for (const r of checked.rounds) await store.applyIncomingRound(r);
    for (const rec of checked.records) {
      const out = await store.applyIncoming(rec);
      if (out.action === 'take') res.imported++;
      else if (out.action === 'keep') res.alreadyHad++;
      else if (out.action === 'merge-equal') res.merged++;
      else if (out.action === 'conflict') res.conflicts.push({ uuid: rec.uuid, fields: out.fields });
      else res.skipped.push({ name: rec.folder, reason: out.reason });
    }
    await store.writeIndex();
    return res;
  }

  return { FORMAT, VERSION, LIMITS, PART_LIMIT, exportPlan, splitParts, checkBundle, applyBundle };
});

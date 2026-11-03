// URCI store: every persistent read/write of the data folder, plus the multi-phone sync rules.
// All decision logic lives here (Kotlin only moves bytes). I/O goes through an injected `fs`
// (UrciStorage on the phone, an in-memory fake in tests) and `kv` (app-private key/value).
//
// Record sync (eng R1, OV-8, SYNC-1, SYNC-2, OV-10):
//
//   compare(local.vv, incoming.vv)
//     equal ............ keep local (same version)
//     dominates ........ incoming is older: keep local
//     dominated ........ incoming is newer: replace (fast-forward), reconcile photos
//     concurrent
//       same content ... merge silently: vv = max(local, incoming)        (OV-8)
//       else ........... write inspection.conflict-<dev>-<n>.json; local stays in use
//
//   resolve(choice) ..... content = chosen, vv = max(both) + 1 for this phone; delete conflict file
//   incoming applied while a conflict is open: if incoming.vv >= conflict.vv the conflict closes
//
// Round files (R4, R5): auto-merge, never prompt. Dominating side wins (so a reopen that
// dominates a close wins); concurrent: vv = max, closedAt = earliest set, label = renamed side.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UrciStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const CODES = ['81', '82', '83', '84', '85', '86', '87'];
  const SEVERITIES = ['L', 'M', 'H'];
  const LIMITS = { branch: 40, section: 40, inspector: 60, remarks: 1000, note: 300, label: 60 };
  const DISPLAY_ONLY = new Set(['vv', 'updatedAt']); // excluded from the content hash (OV-8)

  // Shared name patterns (OV-2). UrciStorage's import validation mirrors these exactly.
  const PATTERNS = Object.freeze({
    folder: /^\d{8}_[A-Za-z0-9-]{1,20}_[A-Za-z0-9-]{1,20}_SU\d{1,4}_[0-9a-f]{8}$/,
    roundId: /^[A-Za-z0-9-]{1,41}-\d{4}-\d{2}$/,
    photo: /^\d{2}-[LMH]-\d{8}-\d{6}-[0-9a-f]{8}\.jpg$/,
    conflict: /^inspection\.conflict-([A-Za-z0-9-]{1,64})-(\d{1,9})\.json$/,
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    deviceId: /^[A-Za-z0-9-]{1,64}$/,
    date: /^\d{4}-\d{2}-\d{2}$/,
  });

  class StoreError extends Error {
    constructor(code, detail) {
      super(`${code}${detail ? ': ' + detail : ''}`);
      this.name = 'StoreError';
      this.code = code;
      this.detail = detail;
    }
  }

  // ---------- version vectors (R1) ----------
  function compareVV(a = {}, b = {}) {
    let aBig = false;
    let bBig = false;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[k] || 0;
      const y = b[k] || 0;
      if (x > y) aBig = true;
      else if (y > x) bBig = true;
    }
    if (aBig && bBig) return 'concurrent';
    if (aBig) return 'dominates';
    if (bBig) return 'dominated';
    return 'equal';
  }
  function mergeVV(a = {}, b = {}) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] || 0, v);
    return out;
  }
  function bumpVV(vv, me) {
    return { ...vv, [me]: (vv[me] || 0) + 1 }; // OV-9: per-record counter
  }
  // a >= b on every component
  function covers(a, b) {
    const c = compareVV(a, b);
    return c === 'equal' || c === 'dominates';
  }

  // ---------- canonical content ----------
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
  }
  function contentKey(record) {
    const c = {};
    for (const k of Object.keys(record)) if (!DISPLAY_ONLY.has(k)) c[k] = record[k];
    return canonical(c);
  }
  function sameContent(a, b) {
    return contentKey(a) === contentKey(b);
  }

  // ---------- names ----------
  function sanitizeToken(s) {
    const t = String(s || '').replace(/[^A-Za-z0-9-]/g, '-').slice(0, 20);
    return t || 'X';
  }
  function sectionKey(branch, section) {
    return `${sanitizeToken(branch)}-${sanitizeToken(section)}`;
  }
  // SYNC-1: deterministic month round
  function roundIdFor(branch, section, date) {
    if (!PATTERNS.date.test(date)) throw new StoreError('BAD_DATE', date);
    return `${sectionKey(branch, section)}-${date.slice(0, 7)}`;
  }
  function defaultRoundLabel(roundId) {
    const m = /-(\d{4})-(\d{2})$/.exec(roundId);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return m ? `Putaran ${months[Number(m[2]) - 1]} ${m[1]}` : roundId;
  }
  function folderNameFor({ date, branch, section, sampleUnit, uuid }) {
    return `${date.replace(/-/g, '')}_${sanitizeToken(branch)}_${sanitizeToken(section)}_SU${sampleUnit}_${uuid.slice(0, 8)}`;
  }

  // ---------- validation (LOCAL-1, SEC-1) ----------
  function str(errors, obj, key, max, required = true) {
    const v = obj[key];
    if (v === undefined || v === null || v === '') {
      if (required) errors.push(`${key}: required`);
      return;
    }
    if (typeof v !== 'string') return errors.push(`${key}: not text`);
    if (v.length > max) errors.push(`${key}: longer than ${max}`);
  }
  function validVV(vv) {
    if (!vv || typeof vv !== 'object' || Array.isArray(vv)) return false;
    const ks = Object.keys(vv);
    return ks.length > 0 && ks.length <= 256 && ks.every((k) => PATTERNS.deviceId.test(k) && Number.isInteger(vv[k]) && vv[k] > 0);
  }

  function validateInspection(r) {
    const e = [];
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, errors: ['not an object'] };
    if (!Number.isInteger(r.schemaVersion) || r.schemaVersion < 1) e.push('schemaVersion: missing');
    else if (r.schemaVersion > SCHEMA_VERSION) e.push(`schemaVersion: ${r.schemaVersion} is newer than this app`);
    if (typeof r.uuid !== 'string' || !PATTERNS.uuid.test(r.uuid)) e.push('uuid: invalid');
    if (typeof r.folder !== 'string' || !PATTERNS.folder.test(r.folder)) e.push('folder: invalid');
    else if (typeof r.uuid === 'string' && !r.folder.endsWith('_' + r.uuid.slice(0, 8))) e.push('folder: does not match uuid');
    if (!validVV(r.vv)) e.push('vv: invalid');
    if (typeof r.roundId !== 'string' || !PATTERNS.roundId.test(r.roundId)) e.push('roundId: invalid');
    if (r.deletedAt !== undefined && typeof r.deletedAt !== 'string') e.push('deletedAt: invalid');
    if (r.deletedAt) return { ok: e.length === 0, errors: e }; // tombstones carry no body
    const h = r.header;
    if (!h || typeof h !== 'object') {
      e.push('header: missing');
    } else {
      str(e, h, 'branch', LIMITS.branch);
      str(e, h, 'section', LIMITS.section);
      str(e, h, 'inspector', LIMITS.inspector, false);
      str(e, h, 'remarks', LIMITS.remarks, false);
      if (typeof h.date !== 'string' || !PATTERNS.date.test(h.date)) e.push('date: invalid');
      if (!Number.isInteger(h.sampleUnit) || h.sampleUnit < 1 || h.sampleUnit > 9999) e.push('sampleUnit: 1..9999');
      if (typeof h.sampleArea !== 'number' || !(h.sampleArea > 0) || h.sampleArea > 100000) e.push('sampleArea: > 0');
    }
    if (!Array.isArray(r.entries) || r.entries.length > 21) {
      e.push('entries: invalid');
    } else {
      r.entries.forEach((en, i) => {
        const p = `entries[${i}]`;
        if (!en || typeof en !== 'object') return e.push(`${p}: invalid`);
        if (!CODES.includes(en.code)) e.push(`${p}.code: invalid`);
        if (!SEVERITIES.includes(en.sev)) e.push(`${p}.sev: invalid`);
        if (en.code !== '84' && !(typeof en.quantity === 'number' && Number.isFinite(en.quantity) && en.quantity >= 0)) e.push(`${p}.quantity: invalid`);
        if (en.note !== undefined && (typeof en.note !== 'string' || en.note.length > LIMITS.note)) e.push(`${p}.note: invalid`);
        if (en.photos !== undefined) {
          if (!Array.isArray(en.photos) || en.photos.length > 50) e.push(`${p}.photos: invalid`);
          else en.photos.forEach((ph, j) => {
            if (!ph || typeof ph.name !== 'string' || !PATTERNS.photo.test(ph.name)) e.push(`${p}.photos[${j}].name: invalid`);
            else if (!ph.name.startsWith(`${en.code}-${en.sev}-`)) e.push(`${p}.photos[${j}].name: wrong distress`);
            if (ph && ph.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(ph.sha256)) e.push(`${p}.photos[${j}].sha256: invalid`);
          });
        }
      });
      const seen = new Set();
      for (const en of r.entries) {
        const k = `${en && en.code}-${en && en.sev}`;
        if (seen.has(k)) e.push(`entries: ${k} twice`);
        seen.add(k);
      }
    }
    if (h && r.roundId && PATTERNS.date.test(h.date || '') && typeof h.branch === 'string' && typeof h.section === 'string') {
      if (r.roundId !== roundIdFor(h.branch, h.section, h.date)) e.push('roundId: does not match section/month');
    }
    return { ok: e.length === 0, errors: e };
  }

  function validateRound(r) {
    const e = [];
    if (!r || typeof r !== 'object') return { ok: false, errors: ['not an object'] };
    if (typeof r.roundId !== 'string' || !PATTERNS.roundId.test(r.roundId)) e.push('roundId: invalid');
    if (!validVV(r.vv)) e.push('vv: invalid');
    if (r.label !== undefined && (typeof r.label !== 'string' || r.label.length > LIMITS.label)) e.push('label: invalid');
    if (r.closedAt !== undefined && r.closedAt !== null && typeof r.closedAt !== 'string') e.push('closedAt: invalid');
    return { ok: e.length === 0, errors: e };
  }

  function photoNames(record) {
    const out = new Set();
    if (!record || record.deletedAt || !Array.isArray(record.entries)) return out;
    for (const en of record.entries) for (const ph of en.photos || []) out.add(ph.name);
    return out;
  }

  // Short list of differing fields for the one-tap resolver (SYNC-1).
  function diffFields(a, b) {
    const out = [];
    const ha = a.header || {};
    const hb = b.header || {};
    for (const k of new Set([...Object.keys(ha), ...Object.keys(hb)])) if (canonical(ha[k]) !== canonical(hb[k])) out.push(`header.${k}`);
    const ea = new Map((a.entries || []).map((x) => [`${x.code}-${x.sev}`, x]));
    const eb = new Map((b.entries || []).map((x) => [`${x.code}-${x.sev}`, x]));
    for (const k of [...new Set([...ea.keys(), ...eb.keys()])].sort()) if (canonical(ea.get(k)) !== canonical(eb.get(k))) out.push(k);
    if (!!a.deletedAt !== !!b.deletedAt) out.push('deleted');
    return out;
  }

  // ---------- pure decisions ----------
  function decideApply(local, incoming) {
    if (!local) return 'take';
    const c = compareVV(local.vv, incoming.vv);
    if (c === 'equal' || c === 'dominates') return 'keep';
    if (c === 'dominated') return 'take';
    return sameContent(local, incoming) ? 'merge-equal' : 'conflict';
  }

  // R4/R5. Symmetric: mergeRound(a,b) and mergeRound(b,a) give the same result.
  function mergeRound(a, b) {
    if (!a) return b;
    if (!b) return a;
    const c = compareVV(a.vv, b.vv);
    if (c === 'dominates' || c === 'equal') return a;
    if (c === 'dominated') return b;
    const def = defaultRoundLabel(a.roundId);
    const la = a.label && a.label !== def ? a.label : null;
    const lb = b.label && b.label !== def ? b.label : null;
    let label = def;
    if (la && lb) label = la === lb ? la : [la, lb].sort()[1]; // both renamed: deterministic pick
    else label = la || lb || def;
    const closed = [a.closedAt, b.closedAt].filter(Boolean).sort();
    const out = { roundId: a.roundId, label, vv: mergeVV(a.vv, b.vv) };
    if (closed.length) out.closedAt = closed[0];
    return out;
  }

  // ERR-1 recovery decision for one folder. names: files present; read(name) → parsed or null.
  async function decideRecovery(names, base, read) {
    const has = (n) => names.includes(n);
    const actions = [];
    if (!has(base + '.new') && !has(base + '.old')) return actions;
    const cur = has(base) ? await read(base) : null;
    if (cur) {
      if (has(base + '.new')) actions.push({ op: 'delete', name: base + '.new' });
      if (has(base + '.old')) actions.push({ op: 'delete', name: base + '.old' });
      return actions;
    }
    if (has(base)) actions.push({ op: 'delete', name: base }); // present but broken
    const nw = has(base + '.new') ? await read(base + '.new') : null;
    if (nw) {
      actions.push({ op: 'rename', from: base + '.new', to: base });
      if (has(base + '.old')) actions.push({ op: 'delete', name: base + '.old' });
      return actions;
    }
    const old = has(base + '.old') ? await read(base + '.old') : null;
    if (old) {
      actions.push({ op: 'rename', from: base + '.old', to: base });
      if (has(base + '.new')) actions.push({ op: 'delete', name: base + '.new' });
    }
    return actions;
  }

  // ---------- the store ----------
  // fs:  list(dir) -> [{name, dir:boolean}] | readText(path) | writeTextSafe(path, text)
  //      createNew(path, text) (throws {code:'NAME_CLASH'}) | delete(path) | rename(path, newName)
  // kv:  get(key) | set(key, value)            (app-private; holds deviceId and indexGen)
  // newId(): random UUID v4 string
  class Store {
    constructor({ fs, kv, newId, now = () => new Date().toISOString(), log = () => {} }) {
      this.fs = fs;
      this.kv = kv;
      this.newId = newId;
      this.now = now;
      this.log = log;
      this.deviceId = null;
      this.records = new Map(); // uuid -> record (live or tombstone)
      this.conflicts = new Map(); // uuid -> [{name, record}]
      this.rounds = new Map(); // roundId -> round
      this.broken = []; // LOCAL-1: [{path, reason}]
    }

    async init() {
      let id = await this.kv.get('deviceId');
      if (!id || !PATTERNS.deviceId.test(id)) {
        id = this.newId();
        await this.kv.set('deviceId', id);
      }
      this.deviceId = id;
      return id;
    }

    async _readJson(path, validate) {
      let text;
      try {
        text = await this.fs.readText(path);
      } catch (e) {
        this.broken.push({ path, reason: 'unreadable' });
        return null;
      }
      if (typeof text !== 'string' || text.length > 2_000_000) {
        this.broken.push({ path, reason: 'too large' });
        return null;
      }
      let obj;
      try {
        obj = JSON.parse(text);
      } catch (e) {
        this.broken.push({ path, reason: 'not JSON' });
        return null;
      }
      if (validate) {
        const v = validate(obj);
        if (!v.ok) {
          this.broken.push({ path, reason: v.errors.slice(0, 3).join('; ') });
          return null;
        }
      }
      return obj;
    }

    // Load everything; recovers interrupted safe-replace writes first (ERR-1).
    async loadAll() {
      this.records.clear();
      this.conflicts.clear();
      this.rounds.clear();
      this.broken = [];
      const top = await this.fs.list('inspections').catch(() => []);
      for (const d of top) {
        if (!d.dir) continue;
        if (!PATTERNS.folder.test(d.name)) {
          this.broken.push({ path: `inspections/${d.name}`, reason: 'unexpected folder name' });
          continue;
        }
        const dir = `inspections/${d.name}`;
        let files = (await this.fs.list(dir)).map((f) => f.name);
        const quietRead = async (n) => {
          try {
            const o = JSON.parse(await this.fs.readText(`${dir}/${n}`));
            return validateInspection(o).ok ? o : null;
          } catch (e) {
            return null;
          }
        };
        const acts = await decideRecovery(files, 'inspection.json', quietRead);
        for (const a of acts) {
          if (a.op === 'delete') await this.fs.delete(`${dir}/${a.name}`);
          else await this.fs.rename(`${dir}/${a.from}`, a.to);
          this.log(`recovered ${dir}: ${a.op} ${a.name || a.from}`);
        }
        if (acts.length) files = (await this.fs.list(dir)).map((f) => f.name);
        if (!files.includes('inspection.json')) {
          this.broken.push({ path: `${dir}/inspection.json`, reason: 'missing' });
          continue;
        }
        const rec = await this._readJson(`${dir}/inspection.json`, validateInspection);
        if (!rec) continue;
        if (rec.folder !== d.name) {
          this.broken.push({ path: `${dir}/inspection.json`, reason: 'folder field does not match' });
          continue;
        }
        this.records.set(rec.uuid, rec);
        for (const n of files) {
          if (!PATTERNS.conflict.test(n)) continue;
          const c = await this._readJson(`${dir}/${n}`, validateInspection);
          if (c && c.uuid === rec.uuid) this._addConflict(rec.uuid, n, c);
        }
      }
      const rfiles = await this.fs.list('rounds').catch(() => []);
      for (const f of rfiles) {
        if (f.dir || !f.name.endsWith('.json')) continue;
        const r = await this._readJson(`rounds/${f.name}`, validateRound);
        if (r && `${r.roundId}.json` === f.name) this.rounds.set(r.roundId, r);
        else if (r) this.broken.push({ path: `rounds/${f.name}`, reason: 'name does not match roundId' });
      }
      return { records: this.records.size, broken: this.broken.length };
    }

    _addConflict(uuid, name, record) {
      const list = this.conflicts.get(uuid) || [];
      if (!list.some((c) => c.name === name)) list.push({ name, record });
      this.conflicts.set(uuid, list);
    }

    _dir(rec) {
      return `inspections/${rec.folder}`;
    }

    // ---- index (INDEX-1, OV-17) ----
    // The generation is bumped in app-private kv BEFORE a record write and recorded in index.json
    // after it. A crash in between leaves them unequal, so the next start rebuilds.
    async _beginWrite() {
      const g = ((await this.kv.get('indexGen')) || 0) + 1;
      await this.kv.set('indexGen', g);
      return g;
    }
    buildIndex(generation) {
      const recs = [...this.records.values()].map((r) => ({
        uuid: r.uuid,
        folder: r.folder,
        roundId: r.roundId,
        deleted: !!r.deletedAt,
        conflict: this.conflicts.has(r.uuid),
        branch: r.header ? r.header.branch : undefined,
        section: r.header ? r.header.section : undefined,
        sampleUnit: r.header ? r.header.sampleUnit : undefined,
        date: r.header ? r.header.date : undefined,
        urciRaw: r.result ? r.result.urciRaw : undefined,
      }));
      return { format: 'urci-index', generation, folderCount: recs.length, records: recs };
    }
    async writeIndex(generation) {
      const g = generation !== undefined ? generation : (await this.kv.get('indexGen')) || 0;
      await this.fs.writeTextSafe('index.json', JSON.stringify(this.buildIndex(g)));
    }
    // One directory query plus the index file: stale when generation or folder count differ.
    async indexIsStale() {
      let idx;
      try {
        idx = JSON.parse(await this.fs.readText('index.json'));
      } catch (e) {
        return true;
      }
      const g = (await this.kv.get('indexGen')) || 0;
      const dirs = (await this.fs.list('inspections').catch(() => [])).filter((d) => d.dir).length;
      return !idx || idx.format !== 'urci-index' || idx.generation !== g || idx.folderCount !== dirs;
    }

    // ---- local edits ----
    // body: { header, entries, result? }  (uuid/folder/vv/roundId are managed here)
    // opts.beforeWrite(rec): runs after validation and before inspection.json is written, so photos are in
    // the folder before any record points at them. If it throws, nothing is written.
    async saveInspection(body, uuid, opts = {}) {
      const prev = uuid ? this.records.get(uuid) : null;
      if (uuid && !prev) throw new StoreError('NOT_FOUND', uuid);
      if (prev && prev.deletedAt) throw new StoreError('DELETED', uuid);
      const id = prev ? prev.uuid : this.newId();
      const h = body.header;
      const roundId = roundIdFor(h.branch, h.section, h.date);
      const round = this.rounds.get(roundId);
      if (round && round.closedAt) throw new StoreError('ROUND_CLOSED', roundId); // R5: closed = read-only
      if (prev && this.isRoundClosed(prev.roundId)) throw new StoreError('ROUND_CLOSED', prev.roundId);
      const rec = {
        schemaVersion: SCHEMA_VERSION,
        uuid: id,
        folder: prev ? prev.folder : folderNameFor({ ...h, uuid: id }),
        roundId,
        header: h,
        entries: body.entries,
        ...(body.result ? { result: body.result } : {}),
        vv: bumpVV(prev ? prev.vv : {}, this.deviceId),
        createdAt: prev ? prev.createdAt : this.now(),
        updatedAt: this.now(),
      };
      const v = validateInspection(rec);
      if (!v.ok) throw new StoreError('INVALID', v.errors.join('; '));
      if (opts.beforeWrite) await opts.beforeWrite(rec);
      const g = await this._beginWrite();
      await this.fs.writeTextSafe(`${this._dir(rec)}/inspection.json`, JSON.stringify(rec));
      this.records.set(id, rec);
      await this._ensureRound(roundId);
      await this.reconcilePhotos(id);
      await this.writeIndex(g);
      return rec;
    }

    async deleteInspection(uuid) {
      const prev = this.records.get(uuid);
      if (!prev) throw new StoreError('NOT_FOUND', uuid);
      if (prev.deletedAt) return prev;
      if (this.isRoundClosed(prev.roundId)) throw new StoreError('ROUND_CLOSED', prev.roundId);
      const rec = {
        schemaVersion: SCHEMA_VERSION,
        uuid,
        folder: prev.folder,
        roundId: prev.roundId,
        deletedAt: this.now(),
        vv: bumpVV(prev.vv, this.deviceId),
        createdAt: prev.createdAt,
        updatedAt: this.now(),
      };
      const g = await this._beginWrite();
      await this.fs.writeTextSafe(`${this._dir(rec)}/inspection.json`, JSON.stringify(rec));
      this.records.set(uuid, rec);
      await this.reconcilePhotos(uuid);
      await this.writeIndex(g);
      return rec;
    }

    // SYNC-2 / OV-10: delete .jpg files referenced by neither the live record nor an open conflict.
    async reconcilePhotos(uuid) {
      const rec = this.records.get(uuid);
      if (!rec) return [];
      const keep = photoNames(rec);
      for (const c of this.conflicts.get(uuid) || []) for (const n of photoNames(c.record)) keep.add(n);
      const files = await this.fs.list(this._dir(rec)).catch(() => []);
      const gone = [];
      for (const f of files) {
        if (f.dir || !f.name.endsWith('.jpg') || keep.has(f.name)) continue;
        await this.fs.delete(`${this._dir(rec)}/${f.name}`);
        gone.push(f.name);
      }
      return gone;
    }

    // ---- import of one record (photos already streamed in natively, OV-11) ----
    async applyIncoming(incoming) {
      const v = validateInspection(incoming);
      if (!v.ok) return { action: 'skipped', reason: v.errors.slice(0, 3).join('; ') };
      const local = this.records.get(incoming.uuid);
      if (local && local.folder !== incoming.folder) return { action: 'skipped', reason: 'folder mismatch for uuid' };
      const action = decideApply(local, incoming);
      const dir = this._dir(incoming);
      if (action === 'keep') {
        await this._closeCoveredConflicts(incoming.uuid, local.vv);
        return { action };
      }
      const g = await this._beginWrite();
      if (action === 'take' || action === 'merge-equal') {
        const rec = action === 'take' ? incoming : { ...local, vv: mergeVV(local.vv, incoming.vv) };
        await this.fs.writeTextSafe(`${dir}/inspection.json`, JSON.stringify(rec));
        this.records.set(rec.uuid, rec);
        await this._closeCoveredConflicts(rec.uuid, rec.vv);
        await this.reconcilePhotos(rec.uuid);
        await this.writeIndex(g);
        return { action };
      }
      // conflict: store incoming beside local; local stays in use until resolved
      const [dev, n] = Object.entries(incoming.vv).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      const name = `inspection.conflict-${dev}-${n}.json`;
      const existing = (this.conflicts.get(incoming.uuid) || []).find((c) => c.name === name);
      if (!existing) {
        await this.fs.writeTextSafe(`${dir}/${name}`, JSON.stringify(incoming));
        this._addConflict(incoming.uuid, name, incoming);
      }
      await this.writeIndex(g);
      return { action: 'conflict', conflictFile: name, fields: diffFields(local, incoming) };
    }

    async _closeCoveredConflicts(uuid, vv) {
      const list = this.conflicts.get(uuid);
      if (!list) return;
      const rec = this.records.get(uuid);
      const left = [];
      for (const c of list) {
        if (covers(vv, c.record.vv)) await this.fs.delete(`${this._dir(rec)}/${c.name}`);
        else left.push(c);
      }
      if (left.length) this.conflicts.set(uuid, left);
      else this.conflicts.delete(uuid);
    }

    // One-tap resolver: choice 'mine' | 'incoming'.
    async resolveConflict(uuid, conflictName, choice) {
      const local = this.records.get(uuid);
      const c = (this.conflicts.get(uuid) || []).find((x) => x.name === conflictName);
      if (!local || !c) throw new StoreError('NOT_FOUND', `${uuid}/${conflictName}`);
      const chosen = choice === 'incoming' ? c.record : local;
      const vv = bumpVV(mergeVV(local.vv, c.record.vv), this.deviceId);
      const rec = { ...chosen, vv, updatedAt: this.now() };
      const g = await this._beginWrite();
      await this.fs.writeTextSafe(`${this._dir(rec)}/inspection.json`, JSON.stringify(rec));
      this.records.set(uuid, rec);
      await this._closeCoveredConflicts(uuid, vv);
      await this.reconcilePhotos(uuid);
      await this.writeIndex(g);
      return rec;
    }

    // ---- rounds (SYNC-1, R4, R5) ----
    async _ensureRound(roundId) {
      if (this.rounds.has(roundId)) return this.rounds.get(roundId);
      const r = { roundId, label: defaultRoundLabel(roundId), vv: { [this.deviceId]: 1 } };
      await this.fs.writeTextSafe(`rounds/${roundId}.json`, JSON.stringify(r));
      this.rounds.set(roundId, r);
      return r;
    }
    async _editRound(roundId, change) {
      const cur = await this._ensureRound(roundId);
      const r = { ...cur, ...change, vv: bumpVV(cur.vv, this.deviceId) };
      if (r.closedAt === null) delete r.closedAt;
      await this.fs.writeTextSafe(`rounds/${roundId}.json`, JSON.stringify(r));
      this.rounds.set(roundId, r);
      return r;
    }
    closeRound(roundId) {
      return this._editRound(roundId, { closedAt: this.now() });
    }
    reopenRound(roundId) {
      return this._editRound(roundId, { closedAt: null });
    }
    renameRound(roundId, label) {
      if (typeof label !== 'string' || !label.trim() || label.length > LIMITS.label) throw new StoreError('INVALID', 'label');
      return this._editRound(roundId, { label: label.trim() });
    }
    isRoundClosed(roundId) {
      const r = this.rounds.get(roundId);
      return !!(r && r.closedAt);
    }
    async applyIncomingRound(incoming) {
      const v = validateRound(incoming);
      if (!v.ok) return { action: 'skipped', reason: v.errors.join('; ') };
      const local = this.rounds.get(incoming.roundId);
      const merged = mergeRound(local, incoming);
      if (local && canonical(merged) === canonical(local)) return { action: 'keep' };
      await this.fs.writeTextSafe(`rounds/${merged.roundId}.json`, JSON.stringify(merged));
      this.rounds.set(merged.roundId, merged);
      return { action: local ? 'merged' : 'take' };
    }

    // ---- queries ----
    live() {
      return [...this.records.values()].filter((r) => !r.deletedAt);
    }
    // Records for an outgoing bundle: never .conflict-* files; section/date selections include
    // matching tombstones (SYNC-2).
    selectForShare({ uuids, sectionKey: sk, from, to } = {}) {
      const all = [...this.records.values()];
      let picked;
      if (uuids) picked = all.filter((r) => uuids.includes(r.uuid));
      else if (sk) {
        picked = all.filter((r) => {
          if (r.roundId.slice(0, -8) !== sk) return false; // roundId = <sectionKey>-yyyy-MM
          const month = r.roundId.slice(-7);
          const date = r.header ? r.header.date : null;
          if (date) return (!from || date >= from) && (!to || date <= to);
          return (!from || month >= from.slice(0, 7)) && (!to || month <= to.slice(0, 7)); // tombstone: by round month
        });
      } else picked = all;
      const rounds = [...new Set(picked.map((r) => r.roundId))].map((id) => this.rounds.get(id)).filter(Boolean);
      return { records: picked, rounds };
    }
  }

  return {
    SCHEMA_VERSION,
    PATTERNS,
    LIMITS,
    StoreError,
    compareVV,
    mergeVV,
    bumpVV,
    canonical,
    contentKey,
    sameContent,
    sanitizeToken,
    sectionKey,
    roundIdFor,
    defaultRoundLabel,
    folderNameFor,
    validateInspection,
    validateRound,
    photoNames,
    diffFields,
    decideApply,
    mergeRound,
    decideRecovery,
    Store,
  };
});

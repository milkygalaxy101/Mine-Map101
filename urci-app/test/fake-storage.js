'use strict';
// In-memory stand-in for UrciStorage (eng R11 "shared fake"). The same contract is exercised
// against the real plugin by the emulator contract tests, so behaviour here must match SAF:
// paths are folder/file, directories are implicit, createNew refuses an existing name.
class FakeStorage {
  constructor() {
    this.files = new Map(); // path -> string (text) or Buffer-like marker for photos
    this.ops = [];
  }
  _norm(p) {
    if (p.split('/').some((s) => s === '..' || s === '.' || s === '')) throw Object.assign(new Error('bad path ' + p), { code: 'IO' });
    return p;
  }
  async list(dir) {
    dir = this._norm(dir);
    const out = new Map();
    for (const p of this.files.keys()) {
      if (!p.startsWith(dir + '/')) continue;
      const rest = p.slice(dir.length + 1);
      const i = rest.indexOf('/');
      if (i === -1) out.set(rest, false);
      else out.set(rest.slice(0, i), true);
    }
    if (!out.size && ![...this.files.keys()].some((p) => p.startsWith(dir + '/'))) {
      throw Object.assign(new Error('no dir ' + dir), { code: 'NOT_FOUND' });
    }
    return [...out].map(([name, isDir]) => ({ name, dir: isDir }));
  }
  async readText(p) {
    p = this._norm(p);
    if (!this.files.has(p)) throw Object.assign(new Error('missing ' + p), { code: 'NOT_FOUND' });
    return this.files.get(p);
  }
  async writeTextSafe(p, text) {
    this.ops.push(['writeTextSafe', p]);
    this.files.set(this._norm(p), text);
  }
  async createNew(p, text) {
    p = this._norm(p);
    if (this.files.has(p)) throw Object.assign(new Error('clash ' + p), { code: 'NAME_CLASH' });
    this.files.set(p, text);
  }
  async delete(p) {
    this.ops.push(['delete', p]);
    this.files.delete(this._norm(p));
  }
  async rename(p, newName) {
    p = this._norm(p);
    const to = p.slice(0, p.lastIndexOf('/') + 1) + newName;
    if (this.files.has(to)) throw Object.assign(new Error('clash ' + to), { code: 'NAME_CLASH' });
    this.files.set(to, this.files.get(p));
    this.files.delete(p);
  }
  // test helpers
  put(p, text = 'jpeg') {
    this.files.set(p, text);
  }
  has(p) {
    return this.files.has(p);
  }
  names(dir) {
    return [...this.files.keys()].filter((p) => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1)).sort();
  }
}

class FakeKV {
  constructor(init = {}) {
    this.m = new Map(Object.entries(init));
  }
  async get(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  async set(k, v) {
    this.m.set(k, v);
  }
}

// Deterministic UUID-shaped ids; prefix is one hex char so two phones never collide.
function idGen(prefix) {
  let n = 0;
  return () => {
    n++;
    const head = prefix + n.toString(16).padStart(7, '0');
    return `${head}-0000-4000-8000-${head}0000`;
  };
}

module.exports = { FakeStorage, FakeKV, idGen };

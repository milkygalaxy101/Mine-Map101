// Browser stand-in for UrciStorage (same contract as test/fake-storage.js), backed by localStorage.
// Used for desktop testing and until the native UrciStorage plugin lands (E-T4). The UI shows a
// "test mode" banner whenever this is active, so nobody mistakes it for the phone folder.
(function (root) {
  'use strict';
  const PREFIX = 'urci-fs:';
  function bad(p) {
    return p.split('/').some((s) => s === '..' || s === '.' || s === '');
  }
  function err(code, msg) {
    return Object.assign(new Error(msg), { code });
  }
  const ls = (() => {
    try {
      const k = '__urci_probe';
      root.localStorage.setItem(k, '1');
      root.localStorage.removeItem(k);
      return root.localStorage;
    } catch (e) {
      const m = new Map(); // private mode: memory only
      return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; } };
    }
  })();
  function keys() {
    const out = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  }
  const fs = {
    async list(dir) {
      if (bad(dir)) throw err('IO', 'bad path');
      const out = new Map();
      for (const p of keys()) {
        if (!p.startsWith(dir + '/')) continue;
        const rest = p.slice(dir.length + 1);
        const i = rest.indexOf('/');
        out.set(i === -1 ? rest : rest.slice(0, i), i !== -1);
      }
      if (!out.size) throw err('NOT_FOUND', 'no dir ' + dir);
      return [...out].map(([name, dir]) => ({ name, dir }));
    },
    async readText(p) {
      const v = ls.getItem(PREFIX + p);
      if (v === null) throw err('NOT_FOUND', 'missing ' + p);
      return v;
    },
    async writeTextSafe(p, text) {
      if (bad(p)) throw err('IO', 'bad path');
      ls.setItem(PREFIX + p, text);
    },
    async createNew(p, text) {
      if (ls.getItem(PREFIX + p) !== null) throw err('NAME_CLASH', p);
      ls.setItem(PREFIX + p, text);
    },
    async delete(p) {
      ls.removeItem(PREFIX + p);
    },
    async rename(p, newName) {
      const to = p.slice(0, p.lastIndexOf('/') + 1) + newName;
      const v = ls.getItem(PREFIX + p);
      if (v === null) throw err('NOT_FOUND', p);
      ls.setItem(PREFIX + to, v);
      ls.removeItem(PREFIX + p);
    },
  };
  const kv = {
    async get(k) {
      const v = ls.getItem('urci-kv:' + k);
      return v === null ? null : JSON.parse(v);
    },
    async set(k, v) {
      ls.setItem('urci-kv:' + k, JSON.stringify(v));
    },
  };
  function newId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    const b = new Uint8Array(16);
    root.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  root.UrciDevStorage = { fs, kv, newId, local: ls };
})(typeof self !== 'undefined' ? self : this);

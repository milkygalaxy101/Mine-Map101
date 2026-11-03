// Rolling diagnostics log (OBS-1): last 300 events in app-private storage. Never photos, never GPS positions.
(function (root) {
  'use strict';
  const KEY = 'urci-log';
  const MAX = 300;
  function read(local) {
    try { return JSON.parse(local.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  root.UrciLog = {
    init(local) { this.local = local; return this; },
    add(event, data = {}) {
      if (!this.local) return;
      const safe = {};
      for (const [k, v] of Object.entries(data)) if (!/^(lat|lon|gps|photo|bytes|base64)$/i.test(k)) safe[k] = typeof v === 'string' ? v.slice(0, 300) : v;
      const list = read(this.local);
      list.push({ at: new Date().toISOString(), event, ...safe });
      try { this.local.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* storage full: logging is best effort */ }
    },
    all() { return this.local ? read(this.local) : []; },
  };
})(typeof self !== 'undefined' ? self : this);

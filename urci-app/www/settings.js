// Pengaturan: language, rating bands (4 editable lower limits -> 5 ranges, stored in <folder>/settings.json),
// data folder, diagnostics export, source footnote, version (5 taps -> self-test with TM FS101 / FS144, P7-5).
(function (root) {
  'use strict';

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false && c !== '') n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }

  // TM 5-626 worked examples (Fig 3-2/3-3 metric). Quantities given as density on a 100 m² sample unit.
  const SELF_TESTS = [
    { id: 'FS 101', tm: 59, entries: [{ code: '81', sev: 'L', quantity: 18.2, tm: 13 }, { code: '83', sev: 'M', quantity: 50.0, tm: 29 }, { code: '84', sev: 'M', tm: 4 }, { code: '87', sev: 'M', quantity: 29.2, tm: 18 }] },
    { id: 'FS 144', tm: 25, entries: [{ code: '81', sev: 'M', quantity: 23.5, tm: 19 }, { code: '82', sev: 'H', quantity: 46.9, tm: 36 }, { code: '84', sev: 'L', tm: 2 }, { code: '86', sev: 'M', quantity: 35.0, tm: 31 }, { code: '86', sev: 'H', quantity: 65.0, tm: 44 }] },
  ];

  function runSelfTest(engine, curves) {
    return SELF_TESTS.map((c) => {
      const r = engine.computeUrci(curves, { sampleArea: 100, entries: c.entries.map(({ code, sev, quantity }) => (code === '84' ? { code, sev } : { code, sev, quantity })) });
      const rows = c.entries.map((e) => {
        const row = r.rows.find((x) => x.code === e.code && x.sev === e.sev);
        const got = engine.roundHalfUp(row.deduct);
        return { code: e.code, sev: e.sev, got, tm: e.tm, ok: Math.abs(got - e.tm) <= 1 };
      });
      return { id: c.id, urci: r.urci, tm: c.tm, ok: Math.abs(r.urci - c.tm) <= 2 && rows.every((x) => x.ok), rows };
    });
  }

  class SettingsScreen {
    constructor({ mount, content, getLang, setLang, platform, settings, saveSettings, engine, curves, store, toast, onChangeFolder }) {
      Object.assign(this, { mount, content, getLang, setLang, platform, settings, saveSettings, engine, curves, store, toast, onChangeFolder });
      this.taps = 0;
    }
    t() { return this.content[this.getLang()]; }

    async render() {
      const t = this.t();
      this.mount.replaceChildren();
      // language
      const langRow = el('div', { class: 'seg', role: 'group', 'aria-label': t.language },
        ...[['id', 'Bahasa Indonesia'], ['en', 'English']].map(([code, label]) => el('button', { class: 'seg-btn', type: 'button', 'aria-pressed': this.getLang() === code ? 'true' : 'false', text: label,
          onclick: async () => { await this.setLang(code); } })));
      this.mount.append(el('h2', { class: 'block', text: t.language }), langRow);

      // bands
      this.mount.append(el('h2', { class: 'block', text: t.bandsTitle }), el('p', { class: 'note', text: t.bandsHelp }));
      const lowers = [...this.settings.bands];
      const inputs = [];
      const preview = el('table', { class: 'bands-table', id: 'bands-preview' });
      const err = el('p', { class: 'err-text', role: 'alert' });
      const save = el('button', { class: 'btn-primary', type: 'button', id: 'bands-save', text: t.saveBands });
      const update = () => {
        const vals = inputs.map((i) => (i.value.trim() === '' ? NaN : Number(i.value)));
        const v = this.engine.validateBands(vals);
        save.disabled = !v.ok || vals.every((x, i) => x === this.settings.bands[i]);
        err.textContent = v.ok ? '' : t.bandsInvalid;
        preview.replaceChildren();
        if (v.ok) for (const b of this.engine.bandRanges(vals)) preview.append(el('tr', {}, el('td', {}, el('span', { class: `band band-${b.band}`, text: t.bands[b.band] })), el('td', { text: `${b.lo}–${b.hi}` })));
      };
      const grid = el('div', { class: 'fields' });
      for (let i = 0; i < 4; i++) {
        const id = `band-${i}`;
        const input = el('input', { id, inputmode: 'numeric', maxlength: 2, value: String(lowers[i]) });
        input.value = String(lowers[i]);
        input.addEventListener('input', update);
        inputs.push(input);
        grid.append(el('div', { class: 'field' }, el('label', { for: id, text: t.bandLower.replace('{band}', t.bands[i]) }), input));
      }
      save.addEventListener('click', async () => {
        const vals = inputs.map((i) => Number(i.value));
        await this.saveSettings({ ...this.settings, bands: vals });
        UrciLog.add('bands-changed', { bands: vals.join('/') });
        this.toast(t.bandsSaved);
        this.render();
      });
      const reset = el('button', { class: 'btn-tertiary', type: 'button', text: t.bandsReset, onclick: () => { this.engine.DEFAULT_BAND_LOWERS.forEach((v, i) => { inputs[i].value = String(v); }); update(); } });
      this.mount.append(grid, err, preview, el('p', { class: 'note', text: t.bandsNote }), el('div', { class: 'sheet-actions' }, reset, save));
      update();

      // data folder
      this.mount.append(el('h2', { class: 'block', text: t.folderTitle }));
      if (this.platform.native) {
        let name = '';
        try { name = (await this.platform.folderStatus()).name || ''; } catch (e) { /* shown as unknown */ }
        this.mount.append(el('p', {}, `${t.folderCurrent}: `, el('strong', { class: 'mono', text: name || '?' })), el('p', { class: 'note', text: t.folderChangeHelp }),
          el('button', { class: 'btn-secondary', type: 'button', text: t.folderChange, onclick: () => this.onChangeFolder() }));
      } else {
        this.mount.append(el('p', { class: 'note', text: t.testStorage }));
      }

      // diagnostics
      this.mount.append(el('h2', { class: 'block', text: t.diagTitle }), el('p', { class: 'note', text: t.diagHelp }),
        el('button', { class: 'btn-secondary', type: 'button', id: 'diag-export', text: t.diagExport, onclick: () => this.exportDiagnostics() }));

      // source + about (owner request: source footnote at the bottom of Settings)
      const ver = el('button', { class: 'version', type: 'button', id: 'version', text: `URCI Field ${root.URCI_VERSION}`, onclick: () => this.versionTap() });
      this.mount.append(el('h2', { class: 'block', text: t.aboutTitle }),
        el('a', { class: 'btn-secondary btn-block', href: '#/manual', id: 'settings-manual', text: t.manualFromSettings }),
        el('p', { class: 'note', text: t.sourceFootnote }), el('p', { class: 'note', text: t.pdfCurves }), el('p', { class: 'note', text: t.fontsNote }), ver);
    }

    versionTap() {
      const t = this.t();
      this.taps++;
      clearTimeout(this.tapTimer);
      this.tapTimer = setTimeout(() => { this.taps = 0; }, 2500);
      if (this.taps >= 5) {
        this.taps = 0;
        this.toast(t.selfTestOpened);
        this.showSelfTest();
      }
    }

    showSelfTest() {
      const t = this.t();
      const res = runSelfTest(this.engine, this.curves);
      const kids = [el('h2', { text: t.selfTestTitle }), el('p', { class: 'note', text: t.selfTestHelp })];
      for (const c of res) {
        const tbl = el('table', { class: 'data-table' }, el('caption', {}, `${c.id}: URCI ${c.urci} (TM ${c.tm}) · `, el('strong', { class: c.ok ? 'ok-text' : 'warn-text', text: c.ok ? t.pass : t.fail })),
          el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: t.pdfDistressType }), el('th', { scope: 'col', text: t.deduct }), el('th', { scope: 'col', text: 'TM' }))));
        const tb = el('tbody');
        for (const r of c.rows) tb.append(el('tr', {}, el('th', { scope: 'row', text: `${r.code}-${t.sevShort[r.sev]}` }), el('td', { class: 'mono', text: String(r.got) }), el('td', { class: 'mono', text: String(r.tm) })));
        tbl.append(tb);
        kids.push(tbl);
      }
      let scrim;
      const close = () => scrim.remove();
      kids.push(el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn-tertiary', type: 'button', text: t.selfTestSave, onclick: () => { UrciLog.add('self-test', { result: res.map((c) => `${c.id}=${c.urci}/${c.ok ? 'pass' : 'FAIL'}`).join(' ') }); this.toast(t.selfTestSaved); } }),
        el('button', { class: 'btn-primary', type: 'button', text: t.close, onclick: close })));
      scrim = el('div', { class: 'scrim' }, el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', id: 'self-test' }, ...kids));
      document.body.append(scrim);
    }

    async exportDiagnostics() {
      const t = this.t();
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const info = {
        app: root.URCI_VERSION, userAgent: navigator.userAgent, native: this.platform.native, language: this.getLang(),
        bands: this.settings.bands, curves: this.curves.status,
        records: this.store.records.size, live: this.store.live().length, conflicts: this.store.conflicts.size,
        brokenFiles: this.store.broken, selfTest: runSelfTest(this.engine, this.curves).map((c) => ({ id: c.id, urci: c.urci, ok: c.ok })),
        log: UrciLog.all(), exportedAt: d.toISOString(),
      };
      const name = `diagnostik-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
      try {
        const saved = await this.platform.media.saveExport(new Blob([JSON.stringify(info, null, 2)], { type: 'application/json' }), name, 'application/json');
        this.toast(`${t.diagSaved}: ${saved.relPath}`);
      } catch (e) {
        this.toast(String((e && (e.code || e.message)) || e));
      }
    }
  }

  root.SettingsScreen = SettingsScreen;
  root.UrciSelfTest = { runSelfTest, SELF_TESTS };
})(typeof self !== 'undefined' ? self : this);

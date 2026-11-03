// Berkas (File) tab, H4: "Data" (Backup penuh, Impor bundel, Bagikan pilihan; backup-age banner) and
// "Ekspor sebelumnya" (newest first, Buka / Bagikan). Import: pass 1 check (bundle.js) -> photos copied
// natively -> records applied through the sync rules -> result screen (ST-3 / E6).
(function (root) {
  'use strict';
  const DAY = 24 * 3600 * 1000;

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
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  class FilesScreen {
    constructor({ mount, store, content, getLang, platform, storeApi, bundleApi, kv, toast }) {
      Object.assign(this, { mount, store, content, getLang, platform, S: storeApi, B: bundleApi, kv, toast });
    }
    t() { return this.content[this.getLang()]; }

    async render() {
      const t = this.t();
      this.mount.replaceChildren();
      const last = await this.kv.get('lastBackupAt');
      const days = last ? Math.floor((Date.now() - last) / DAY) : null;
      if (days === null || days > 7) {
        this.mount.append(el('div', { class: 'banner warning', role: 'status' }, icon('warning', ''),
          el('p', { text: days === null ? t.backupNever : t.backupOld.replace('{d}', days) })));
      }
      const action = (id, title, help, onclick, primary) => el('div', { class: 'action' },
        el('button', { class: primary ? 'btn-primary btn-block' : 'btn-secondary btn-block', type: 'button', id, text: title, onclick }),
        el('p', { class: 'note', text: help }));
      this.mount.append(el('h2', { class: 'block', text: t.dataSection }),
        action('backup-full', t.backupFull, t.backupFullHelp, () => this.backupFull(), true),
        action('import-bundle', t.importBundle, t.importHelp, () => this.importBundle()),
        action('share-selection', t.shareSelection, t.shareHelp, () => this.shareSelection()));
      this.mount.append(el('h2', { class: 'block', text: t.exportsSection }));
      const list = await this.platform.bundles.listExports();
      if (!list.length) { this.mount.append(el('p', { class: 'note', text: t.noExports })); return; }
      list.sort((a, b) => (a.name < b.name ? 1 : -1));
      const ul = el('ul', { class: 'rows exports' });
      for (const f of list) {
        const rel = `exports/${f.name}`;
        ul.append(el('li', { class: 'export-row' },
          el('span', { class: 'row-main' }, el('span', { class: 'row-title mono', text: f.name }), f.size ? el('span', { class: 'row-sub', text: size(f.size) }) : ''),
          el('span', { class: 'export-actions' },
            el('button', { class: 'btn-tertiary', type: 'button', text: t.open, onclick: () => this.platform.bundles.open(rel).catch((e) => this.fail(t.open, e)) }),
            el('button', { class: 'btn-tertiary', type: 'button', text: t.share, onclick: () => this.platform.bundles.share(rel).catch((e) => this.fail(t.share, e)) }))));
      }
      this.mount.append(ul);
    }

    // ---------- export ----------
    estimateSizes(records) {
      const m = new Map();
      for (const r of records) for (const n of this.S.photoNames(r)) m.set(`inspections/${r.folder}/${n}`, 1.2 * 1048576);
      return m;
    }

    async backupFull() {
      const t = this.t();
      const all = [...this.store.records.values()]; // tombstones included, so deletions travel
      const plan = this.B.exportPlan(this.store, all, this.estimateSizes(all));
      const parts = this.B.splitParts(plan, this.store.deviceId);
      const prog = this.progress(t.backupFull);
      const saved = [];
      try {
        for (let i = 0; i < parts.length; i++) {
          prog.set(parts.length > 1 ? t.partOf.replace('{n}', i + 1).replace('{m}', parts.length) : t.backupFull, i / parts.length);
          const name = parts.length > 1 ? `backup-${ymd()}-part${i + 1}of${parts.length}.urci.zip` : `backup-${ymd()}.urci.zip`;
          saved.push(await this.platform.bundles.exportZip(parts[i].paths, parts[i].manifest, name));
        }
        prog.close();
        await this.kv.set('lastBackupAt', Date.now());
        UrciLog.add('backup', { parts: parts.length });
        this.done(t.backupSaved, saved);
      } catch (e) {
        prog.close();
        this.fail(t.backupFull, e);
      }
      this.render();
    }

    shareSelection() {
      const t = this.t();
      const secs = UrciHistory.buildSections([...this.store.records.values()], this.store.rounds, {});
      if (!secs.length) { this.toast(t.selectionEmpty); return; }
      const sel = el('select', { id: 'sel-section' }, ...secs.map((s) => el('option', { value: s.key, text: `${s.branch} / ${s.section}` })));
      const from = el('input', { type: 'date', id: 'sel-from' });
      const to = el('input', { type: 'date', id: 'sel-to' });
      const err = el('p', { class: 'err-text', role: 'alert' });
      const close = () => scrim.remove();
      const go = el('button', { class: 'btn-primary', type: 'button', id: 'sel-go', text: t.makeAndShare, onclick: async () => {
        const { records } = this.store.selectForShare({ sectionKey: sel.value, from: from.value || undefined, to: to.value || undefined });
        if (!records.length) { err.textContent = t.selectionEmpty; return; }
        close();
        const plan = this.B.exportPlan(this.store, records, this.estimateSizes(records));
        const [part] = this.B.splitParts(plan, this.store.deviceId, Infinity);
        const prog = this.progress(t.shareSelection);
        try {
          const name = `urci-${this.S.sanitizeToken(sel.value)}-${ymd()}.urci.zip`;
          const saved = await this.platform.bundles.exportZip(part.paths, part.manifest, name);
          prog.close();
          if (this.platform.native) await this.platform.bundles.share(saved.relPath);
          else this.done(t.bundleSaved, [saved]);
        } catch (e) { prog.close(); this.fail(t.shareSelection, e); }
        this.render();
      } });
      const field = (label, input) => el('div', { class: 'field wide' }, el('label', { for: input.id, text: label }), input);
      const scrim = el('div', { class: 'scrim' }, el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.shareSelection },
        el('h2', { text: t.shareSelection }), el('p', { class: 'sub', text: t.shareHelp }),
        el('div', { class: 'fields' }, field(t.shareSection, sel), field(t.dateFrom, from), field(t.dateTo, to)), err,
        el('div', { class: 'sheet-actions' }, el('button', { class: 'btn-tertiary', type: 'button', text: t.cancel, onclick: close }), go)));
      document.body.append(scrim);
    }

    // ---------- import ----------
    async importBundle() {
      const t = this.t();
      let picked;
      try { picked = await this.platform.bundles.pick(); } catch (e) { if (e && e.code !== 'CANCELLED') this.fail(t.importBundle, e); return; }
      const prog = this.progress(t.checkingBundle);
      let checked;
      try {
        const { entries, texts } = await this.platform.bundles.inspect(picked);
        checked = this.B.checkBundle(entries, texts);
      } catch (e) {
        prog.close();
        const cls = String((e && e.code) || '').replace('BUNDLE_INVALID:', '');
        return this.reject(t.bundleErr[cls] || String((e && (e.code || e.message)) || e));
      }
      if (!checked.ok) { prog.close(); return this.reject(t.bundleErr[checked.errorClass] || checked.errorClass); }
      try {
        prog.set(t.savingImport, 0.5);
        await this.platform.bundles.importPhotos(picked, checked.photos, checked.photoBytes);
        const res = await this.B.applyBundle(this.store, checked);
        UrciLog.add('import', { imported: res.imported, already: res.alreadyHad, conflicts: res.conflicts.length, skipped: res.skipped.length, reasons: res.skipped.map((x) => x.reason).join(' | ') });
        prog.close();
        this.result(res);
      } catch (e) {
        prog.close();
        this.fail(t.importBundle, e);
      }
    }

    result(res) {
      const t = this.t();
      this.mount.replaceChildren();
      const nothing = !res.imported && !res.conflicts.length && !res.merged;
      const row = (label, n) => el('div', { class: 'stat' }, el('span', { class: 'big-num', text: String(n) }), el('span', { text: label }));
      this.mount.append(el('h2', { class: 'block', text: t.importTitle }),
        nothing ? el('p', { class: 'headline', text: t.nothingNew }) : '',
        el('div', { class: 'stats', id: 'import-stats' }, row(t.imported, res.imported + res.merged), row(t.alreadyHad, res.alreadyHad),
          row(t.newConflicts, res.conflicts.length), row(t.skippedLbl, res.skipped.length)));
      if (res.skipped.length) {
        this.mount.append(el('h3', { class: 'sub-h', text: t.skippedLbl }),
          el('ul', { class: 'flags' }, ...res.skipped.map((s) => el('li', {}, icon('warning', ''), el('span', { class: 'mono', text: `${s.name}: ${s.reason}` })))));
      }
      this.mount.append(el('div', { class: 'sheet-actions' },
        res.conflicts.length ? el('a', { class: 'btn-secondary', href: '#/history/conflicts', text: t.openConflicts }) : '',
        el('button', { class: 'btn-primary', type: 'button', id: 'import-done', text: t.done, onclick: () => this.render() })));
    }

    // ---------- shared dialogs ----------
    progress(title) {
      const label = el('p', { class: 'note', role: 'status', text: title });
      const bar = el('div', { class: 'progress-bar' });
      const scrim = el('div', { class: 'scrim center' }, el('div', { class: 'dialog', role: 'alertdialog', 'aria-label': title },
        el('h2', { text: title }), el('div', { class: 'progress' }, bar), label));
      document.body.append(scrim);
      return { set: (text, frac) => { label.textContent = text; bar.style.width = `${Math.max(5, Math.round(frac * 100))}%`; }, close: () => scrim.remove() };
    }
    done(title, saved) {
      const t = this.t();
      const close = () => scrim.remove();
      const actions = el('div', { class: 'dialog-actions' }, el('button', { class: 'btn-tertiary', type: 'button', text: t.close, onclick: close }));
      if (this.platform.native && saved.length === 1) actions.append(el('button', { class: 'btn-primary', type: 'button', text: t.share, onclick: () => { this.platform.bundles.share(saved[0].relPath).catch(() => {}); close(); } }));
      const scrim = el('div', { class: 'scrim center' }, el('div', { class: 'dialog', role: 'dialog', 'aria-label': title },
        el('h2', { text: title }), ...saved.map((s) => el('p', { class: 'mono', text: s.relPath })), actions));
      document.body.append(scrim);
      actions.lastChild.focus();
    }
    reject(msg) { UrciLog.add('import-rejected', { reason: msg }); this.alert(this.t().bundleRejected, msg); }
    fail(title, e) {
      const t = this.t();
      const code = e && e.code;
      this.alert(title, code === 'NO_SPACE' ? t.noSpace : code === 'NO_FOLDER' || code === 'PERMISSION_LOST' ? t.folderLost : String((e && (e.code || e.message)) || e));
    }
    alert(title, body) {
      const t = this.t();
      const ok = el('button', { class: 'btn-primary', type: 'button', text: t.close, onclick: () => scrim.remove() });
      const scrim = el('div', { class: 'scrim center' }, el('div', { class: 'dialog', role: 'alertdialog', 'aria-label': title }, el('h2', { text: title }), el('p', { text: body }), el('div', { class: 'dialog-actions' }, ok)));
      document.body.append(scrim);
      ok.focus();
    }
  }

  root.FilesScreen = FilesScreen;
})(typeof self !== 'undefined' ? self : this);

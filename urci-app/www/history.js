// Riwayat: Sections list (IA-1) -> section trend (IA-3) -> round units -> read-only detail (P7-2).
// Record text via textContent only (SEC-1). Chart per DESIGN.md: band zones at 12 % tint, 2 px ink line,
// solid 8 dp points (complete) / hollow (incomplete) labelled "n dari N", outliers as text + error mark.
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const BAND_COLORS = ['#14532D', '#3F6212', '#854D0E', '#C2410C', '#9F1239'];
  const SEVS = ['L', 'M', 'H'];

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
  function svg(tag, attrs = {}, text) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  class HistoryScreen {
    constructor({ mount, store, engine, content, getLang, platform, storeApi, onEdit, toast, confirm, curves }) {
      Object.assign(this, { mount, store, engine, content, getLang, platform, S: storeApi, onEdit, toast, confirm, curves });
    }
    t() { return this.content[this.getLang()]; }
    lowers() { return this.engine.DEFAULT_BAND_LOWERS; }
    num(v) { return v === null || v === undefined ? '—' : String(this.engine.roundHalfUp(v)); }
    band(v) {
      if (v === null || v === undefined) return null;
      const b = this.engine.rate(this.engine.roundHalfUp(v), this.lowers());
      return el('span', { class: `band band-${b}`, text: this.t().bands[b] });
    }
    dateFmt(iso) {
      const [y, m, d] = iso.split('-');
      return `${d}/${m}/${y}`;
    }
    roundLabel(id) { return this.S.defaultRoundLabel(id); }
    sectionRecords(key) {
      return [...this.store.records.values()].filter((r) => r.roundId && r.roundId.slice(0, -8) === key);
    }

    render(route) {
      this.mount.replaceChildren();
      if (route.view === 'section') return this.renderSection(route.key);
      if (route.view === 'round') return this.renderRound(route.key, route.roundId);
      if (route.view === 'detail') return this.renderDetail(route.uuid);
      return this.renderSections();
    }

    back(label) {
      return el('button', { class: 'btn-tertiary back', type: 'button', onclick: () => history.back() }, '‹ ', label || this.t().back);
    }

    // ---------- IA-1: sections, worst first ----------
    renderSections() {
      const t = this.t();
      const list = UrciHistory.buildSections([...this.store.records.values()], this.store.rounds, {
        roundLabel: (id) => this.roundLabel(id), hasConflict: (u) => this.store.conflicts.has(u) });
      this.mount.append(el('h2', { class: 'block', text: t.sectionsTitle }));
      if (this.store.broken.length) {
        this.mount.append(el('div', { class: 'banner warning', role: 'status' }, icon('warning', ''),
          el('p', { text: t.brokenFiles.replace('{n}', this.store.broken.length) })));
      }
      if (!list.length) {
        this.mount.append(el('div', { class: 'empty' }, el('p', { text: t.noInspections }),
          el('a', { class: 'btn-primary', href: '#/inspect', text: t.startInspect })));
        return;
      }
      this.mount.append(el('p', { class: 'note', text: t.sortedWorst }));
      const ul = el('ul', { class: 'rows' });
      for (const s of list) {
        const change = s.change === null ? (s.rounds < 2 ? t.oneRound : '') : Math.round(s.change) < 0
          ? t.changeDown.replace('{d}', Math.abs(Math.round(s.change))) : Math.round(s.change) > 0
            ? t.changeUp.replace('{d}', Math.round(s.change)) : t.changeSame;
        ul.append(el('li', {}, el('a', { class: 'row-link', href: `#/history/s/${encodeURIComponent(s.key)}` },
          el('span', { class: 'row-main' },
            el('span', { class: 'row-title', text: `${s.branch} / ${s.section}` }),
            el('span', { class: 'row-sub' }, change, change ? ' · ' : '', t.coverage.replace('{n}', s.n).replace('{N}', s.N),
              s.conflicts ? ` · ${t.conflictFlag}` : '')),
          el('span', { class: 'row-end' }, el('span', { class: 'big-num', text: this.num(s.latest) }), this.band(s.latest)))));
      }
      this.mount.append(ul);
    }

    // ---------- IA-3: section trend ----------
    renderSection(key) {
      const t = this.t();
      const recs = this.sectionRecords(key);
      const trend = UrciHistory.buildTrend(recs, this.store.rounds, { roundLabel: (id) => this.roundLabel(id) });
      const any = recs.find((r) => r.header);
      this.mount.append(this.back(t.sectionsTitle), el('h2', { class: 'block', text: any ? `${any.header.branch} / ${any.header.section}` : key }));
      if (!trend.length) { this.mount.append(el('p', { text: t.noInspections })); return; }
      const last = trend[trend.length - 1];
      const prev = trend.length > 1 ? trend[trend.length - 2] : null;
      const head = el('p', { class: 'headline' }, `${t.now} ${this.num(last.mean)} · `, this.band(last.mean));
      if (prev && prev.mean !== null && last.mean !== null) {
        const d = Math.round(last.mean - prev.mean);
        head.append(` (${t.from} ${this.num(prev.mean)}, ${d < 0 ? t.changeDown.replace('{d}', -d) : d > 0 ? t.changeUp.replace('{d}', d) : t.changeSame})`);
      }
      this.mount.append(head, this.chart(trend));
      if (trend.length < 2) this.mount.append(el('p', { class: 'note', text: t.needTwoRounds }));
      // flags
      const flags = [];
      for (const r of trend) {
        if (r.incomplete) flags.push(`${r.label}: ${t.incomplete} (${t.coverage.replace('{n}', r.n).replace('{N}', r.N)})`);
        for (const u of r.units) if (u.outlier) flags.push(`${r.label}: SU${u.sampleUnit} ${this.num(u.urciRaw)} — ${t.outlier}`);
      }
      const conflicts = recs.filter((r) => this.store.conflicts.has(r.uuid)).length;
      if (conflicts) flags.push(`${t.conflictFlag} (${conflicts})`);
      if (flags.length) {
        this.mount.append(el('h3', { class: 'sub-h', text: t.flagsTitle }),
          el('ul', { class: 'flags' }, ...flags.map((f) => el('li', {}, icon('warning', ''), el('span', { text: f })))));
      }
      // rounds table, newest first
      const tbl = el('table', { class: 'data-table' }, el('caption', { text: t.roundsTitle }),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: t.round }), el('th', { scope: 'col', text: t.urci }), el('th', { scope: 'col', text: t.unitsCol }))));
      const tb = el('tbody');
      for (const r of [...trend].reverse()) {
        tb.append(el('tr', {},
          el('th', { scope: 'row' }, el('a', { href: `#/history/s/${encodeURIComponent(key)}/r/${encodeURIComponent(r.roundId)}`, text: r.label }), r.closed ? ` · ${t.closed}` : ''),
          el('td', {}, el('span', { class: 'mono', text: this.num(r.mean) }), ' ', this.band(r.mean)),
          el('td', { class: 'mono', text: `${r.n}/${r.N}` })));
      }
      tbl.append(tb);
      this.mount.append(tbl);
    }

    chart(trend) {
      const t = this.t();
      const W = 320, H = 190, L = 30, R = 26, T = 16, B = 40;
      const x = (i) => (trend.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (trend.length - 1));
      const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
      const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', class: 'chart', role: 'img',
        'aria-label': `${t.chartLabel}: ${trend.map((r) => `${r.label} ${this.num(r.mean)}`).join(', ')}` });
      for (const b of this.engine.bandRanges(this.lowers())) {
        s.append(svg('rect', { x: L, y: y(b.hi + (b.band === 0 ? 0 : 1)), width: W - L - R, height: y(b.lo) - y(b.hi + (b.band === 0 ? 0 : 1)), fill: BAND_COLORS[b.band], 'fill-opacity': 0.12 }));
      }
      for (const v of [0, 25, 50, 75, 100]) {
        s.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: '#C9CED6', 'stroke-width': 1 }));
        s.append(svg('text', { x: L - 4, y: y(v) + 4, 'text-anchor': 'end', 'font-family': 'Barlow', 'font-size': 11, fill: '#4A5260' }, String(v)));
      }
      const pts = trend.map((r, i) => (r.mean === null ? null : [x(i), y(r.mean)]));
      const d = pts.filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
      if (d) s.append(svg('path', { d, fill: 'none', stroke: '#14171A', 'stroke-width': 2 }));
      trend.forEach((r, i) => {
        if (!pts[i]) return;
        const [px, py] = pts[i];
        s.append(svg('circle', { cx: px, cy: py, r: 4.5, fill: r.incomplete ? '#FFFFFF' : '#14171A', stroke: '#14171A', 'stroke-width': 2 }));
        s.append(svg('text', { x: px, y: py - 9, 'text-anchor': 'middle', 'font-family': 'Barlow', 'font-size': 12, 'font-weight': 600, fill: '#14171A' }, this.num(r.mean)));
        const [yy, mm] = r.month.split('-');
        s.append(svg('text', { x: px, y: H - 22, 'text-anchor': 'middle', 'font-family': 'Barlow', 'font-size': 11, fill: '#4A5260' }, `${mm}/${yy.slice(2)}`));
        s.append(svg('text', { x: px, y: H - 8, 'text-anchor': 'middle', 'font-family': 'Barlow', 'font-size': 10, fill: '#4A5260' }, `${r.n}/${r.N}`));
        if (r.units.some((u) => u.outlier)) s.append(svg('path', { d: `M${px + 9} ${py - 3} l5 9 h-10 z`, fill: '#B42318' }));
      });
      return el('figure', { class: 'chart-fig' }, s, el('figcaption', { class: 'note', text: t.chartLegend }));
    }

    // ---------- round -> units ----------
    renderRound(key, roundId) {
      const t = this.t();
      const trend = UrciHistory.buildTrend(this.sectionRecords(key), this.store.rounds, { roundLabel: (id) => this.roundLabel(id) });
      const r = trend.find((x) => x.roundId === roundId);
      this.mount.append(this.back(), el('h2', { class: 'block', text: r ? r.label : roundId }));
      if (!r) return;
      this.mount.append(el('p', { class: 'headline' }, `${t.mean} ${this.num(r.mean)} · `, this.band(r.mean), ` · ${t.coverage.replace('{n}', r.n).replace('{N}', r.N)}`));
      const ul = el('ul', { class: 'rows' });
      for (const u of r.units) {
        ul.append(el('li', {}, el('a', { class: 'row-link', href: `#/history/i/${encodeURIComponent(u.uuid)}` },
          el('span', { class: 'row-main' },
            el('span', { class: 'row-title', text: `SU${u.sampleUnit}` }),
            el('span', { class: 'row-sub' }, this.dateFmt(u.date), u.photos ? ` · ${u.photos} ${t.photosWord}` : '',
              u.outlier ? el('span', { class: 'warn-text' }, ' · ', icon('warning', '', 14), ` ${t.outlierShort}`) : '',
              this.store.conflicts.has(u.uuid) ? ` · ${t.conflictFlag}` : '')),
          el('span', { class: 'row-end' }, el('span', { class: 'big-num', text: this.num(u.urciRaw) }), this.band(u.urciRaw)))));
      }
      this.mount.append(ul);
    }

    // ---------- read-only detail ----------
    renderDetail(uuid) {
      const t = this.t();
      const r = this.store.records.get(uuid);
      this.mount.append(this.back());
      if (!r || r.deletedAt) { this.mount.append(el('p', { text: t.notFound })); return; }
      const h = r.header;
      this.mount.append(el('h2', { class: 'block', text: `${h.branch} / ${h.section} / SU${h.sampleUnit}` }),
        el('p', { class: 'headline' }, `${t.urci} ${this.num(urci(r))} · `, this.band(urci(r))),
        el('dl', { class: 'facts' },
          el('dt', { text: t.date }), el('dd', { text: this.dateFmt(h.date) }),
          el('dt', { text: t.sampleArea }), el('dd', { text: String(h.sampleArea).replace('.', this.getLang() === 'id' ? ',' : '.') }),
          h.inspector ? el('dt', { text: t.inspector }) : '', h.inspector ? el('dd', { text: h.inspector }) : '',
          el('dt', { text: 'TDV · q' }), el('dd', { class: 'mono', text: r.result ? `${Math.round(r.result.tdv)} · ${r.result.q}` : '—' })));
      if (this.store.conflicts.has(uuid)) this.mount.append(el('div', { class: 'banner warning' }, icon('warning', ''), el('p', { text: t.conflictFlag })));
      const list = el('ul', { class: 'rows' });
      for (const e of r.entries || []) {
        const d = t.distress[e.code];
        const unit = d.unit ? t.units[d.unit] : '';
        const li = el('li', { class: 'entry' }, el('div', { class: 'row-title', text: `${e.code} ${d.short} · ${t.sevName[e.sev]}` }),
          e.code === '84' ? '' : el('div', { class: 'row-sub mono', text: `${String(e.quantity).replace('.', this.getLang() === 'id' ? ',' : '.')} ${unit}` }));
        if (e.photos && e.photos.length) {
          const strip = el('div', { class: 'thumbs' });
          for (const p of e.photos) {
            const url = this.platform.media.folderUrl(`inspections/${r.folder}/${p.name}`);
            strip.append(el('div', { class: 'thumb' }, url ? el('img', { src: url, alt: p.name, loading: 'lazy' }) : el('span', { class: 'note', text: p.name })));
          }
          li.append(strip);
        }
        list.append(li);
      }
      this.mount.append(el('h3', { class: 'sub-h', text: t.distressFound }), (r.entries || []).length ? list : el('p', { class: 'note', text: t.noEntries }));
      const closed = this.store.isRoundClosed(r.roundId);
      if (closed) this.mount.append(el('div', { class: 'banner warning' }, icon('warning', ''), el('p', { text: t.roundClosed })));
      this.mount.append(el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn-tertiary', type: 'button', disabled: closed, text: t.del, onclick: () => this.del(r) }),
        el('button', { class: 'btn-secondary', type: 'button', id: 'make-pdf', text: t.pdfButton, onclick: (e) => this.makePdf(r, e.currentTarget) }),
        el('button', { class: 'btn-primary', type: 'button', disabled: closed, text: t.edit, onclick: () => this.onEdit(r) })));
    }

    // ---------- PDF (DA 7348-R layout) built in a Web Worker ----------
    pdfName(r) {
      const tok = (x) => this.S.sanitizeToken(x);
      return `URCI_${tok(r.header.branch)}_${tok(r.header.section)}_SU${r.header.sampleUnit}_${r.header.date.replace(/-/g, '')}.pdf`;
    }

    async makePdf(r, btn) {
      const t = this.t();
      if (this.pdfBusy) return;
      this.pdfBusy = true;
      if (btn) btn.disabled = true;
      const prog = el('p', { class: 'note', role: 'status', text: t.pdfMaking });
      const scrim = el('div', { class: 'scrim center' }, el('div', { class: 'dialog', role: 'alertdialog', 'aria-label': t.pdfMaking },
        el('h2', { text: t.pdfMaking }), el('div', { class: 'progress' }, el('div', { class: 'progress-bar' })), prog));
      document.body.append(scrim);
      const bar = scrim.querySelector('.progress-bar');
      try {
        const h = r.header;
        const entries = (r.entries || []).map((e) => (e.code === '84' ? { code: e.code, sev: e.sev } : { code: e.code, sev: e.sev, quantity: e.quantity }));
        const calc = this.engine.computeUrci(this.curves, { sampleArea: h.sampleArea, entries });
        const photos = [];
        for (const e of r.entries || []) for (const p of e.photos || []) photos.push({ code: e.code, sev: e.sev, name: p.name, sha256: p.sha256, takenAt: p.takenAt, gps: p.gps || null,
          url: new URL(this.platform.media.folderUrl(`inspections/${r.folder}/${p.name}`), location.href).href });
        const round = this.store.rounds.get(r.roundId);
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const data = {
          t, lang: this.getLang(), calc, rec: { header: h, entries: r.entries },
          roundLabel: (round && round.label) || this.roundLabel(r.roundId),
          gps: (photos.find((p) => p.gps) || {}).gps || null, photoCount: photos.length,
          band: this.engine.rate(calc.urci, this.lowers()), bandRanges: this.engine.bandRanges(this.lowers()),
          generatedAt: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
          conflict: this.store.conflicts.has(r.uuid),
        };
        const pdf = await new Promise((resolve, reject) => {
          const w = new Worker('export.worker.js');
          w.onmessage = (ev) => {
            const m = ev.data;
            if (m.type === 'progress') { bar.style.width = `${Math.round((m.done / Math.max(1, m.total)) * 100)}%`; prog.textContent = `${t.pdfPhotos}: ${m.done} / ${m.total}`; return; }
            w.terminate();
            if (m.type === 'done') resolve(m); else reject(new Error(m.error));
          };
          w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'worker error')); };
          w.postMessage({ data: JSON.parse(JSON.stringify(data)), photos });
        });
        bar.style.width = '100%';
        const saved = await this.platform.media.saveExport(new Blob([pdf.pdf], { type: 'application/pdf' }), this.pdfName(r));
        scrim.remove();
        this.pdfDone(saved, pdf.missing || []);
      } catch (e) {
        scrim.remove();
        const code = e && e.code;
        const msg = code === 'NO_SPACE' ? t.noSpace : code === 'NO_FOLDER' || code === 'PERMISSION_LOST' ? t.folderLost : String((e && (e.code || e.message)) || e);
        this.alert(t.pdfFailed, msg);
      } finally {
        this.pdfBusy = false;
        if (btn) btn.disabled = false;
      }
    }

    pdfDone(saved, missing) {
      const t = this.t();
      const media = this.platform.media;
      const close = () => scrim.remove();
      const actions = el('div', { class: 'dialog-actions' }, el('button', { class: 'btn-tertiary', type: 'button', text: t.close, onclick: close }));
      if (media.canShare) actions.append(el('button', { class: 'btn-primary', type: 'button', id: 'share-pdf', text: t.share, onclick: async () => { try { await media.share(saved, t.pdfTitle); } catch (e) { /* user closed the share sheet */ } close(); } }));
      const scrim = el('div', { class: 'scrim center' }, el('div', { class: 'dialog', role: 'dialog', 'aria-label': t.pdfSaved },
        el('h2', { text: t.pdfSaved }), el('p', { class: 'mono', text: saved.relPath }),
        missing.length ? el('p', { class: 'err-text', text: `${t.pdfMissingPhotos}: ${missing.join(', ')}` }) : '', actions));
      document.body.append(scrim);
      (actions.lastChild).focus();
    }

    alert(title, body) {
      const t = this.t();
      const ok = el('button', { class: 'btn-primary', type: 'button', text: t.close, onclick: () => scrim.remove() });
      const scrim = el('div', { class: 'scrim center' }, el('div', { class: 'dialog', role: 'alertdialog', 'aria-label': title }, el('h2', { text: title }), el('p', { text: body }), el('div', { class: 'dialog-actions' }, ok)));
      document.body.append(scrim);
      ok.focus();
    }

    async del(r) {
      const t = this.t();
      if (!(await this.confirm({ title: t.delTitle, body: t.delBody, ok: t.del, cancel: t.cancel, destructiveOk: true }))) return;
      await this.store.deleteInspection(r.uuid);
      this.toast(t.deleted);
      history.back();
    }
  }
  function urci(r) { return r.result ? r.result.urciRaw : null; }

  root.HistoryScreen = HistoryScreen;
})(typeof self !== 'undefined' ? self : this);

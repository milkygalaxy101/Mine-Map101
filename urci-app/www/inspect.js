// Inspect screen: DA 7348-R header, block-8 grid, sticky live-URCI bar, block-9 calc sheet.
// All record text goes through textContent (SEC-1). Decisions: IA-2, RA-1, RA-2, P7-1, M2, M3, D6, UJ-2, UJ-3, UX-1.
(function (root) {
  'use strict';
  const CODES = ['81', '82', '83', '84', '85', '86', '87'];
  const SEVS = ['L', 'M', 'H'];
  const DRAFT_KEY = 'urci-draft';

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }

  function today() {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // "83,7" or "83.7" -> 83.7 ; '' -> null ; junk -> NaN
  function parseNum(s) {
    const t = String(s == null ? '' : s).trim().replace(/\s/g, '');
    if (!t) return null;
    if (!/^\d+([.,]\d+)?$/.test(t)) return NaN;
    return Number(t.replace(',', '.'));
  }

  class InspectScreen {
    constructor({ mount, engine, curves, storeApi, store, content, getLang, setLang, kv, local, testMode }) {
      Object.assign(this, { mount, engine, curves, S: storeApi, store, content, getLang, setLang, kv, local, testMode });
      this.state = this.blank();
      this.errors = {};
      this.expanded = true;
      this.saving = false;
      this.lastUrci = null;
      this.pickers = { branch: [], section: [] };
    }

    t() {
      return this.content[this.getLang()];
    }
    fmt(n, dp = 1) {
      if (n === null || n === undefined || !Number.isFinite(n)) return '—';
      const s = (Math.round(n * 10 ** dp) / 10 ** dp).toFixed(dp);
      return this.getLang() === 'id' ? s.replace('.', ',') : s;
    }
    fmtQty(n) {
      if (n === null || n === undefined) return '';
      const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
      return this.getLang() === 'id' ? s.replace('.', ',') : s;
    }

    blank() {
      return { header: { branch: '', section: '', sampleUnit: '', date: today(), sampleArea: '', inspector: '' }, qty: {}, dust: null };
    }

    async start() {
      this.pickers = (await this.kv.get('pickers')) || { branch: [], section: [] };
      this.tipSeen = !!(await this.kv.get('tipSeen'));
      this.render();
      const raw = this.local.getItem(DRAFT_KEY);
      if (raw) {
        let draft = null;
        try { draft = JSON.parse(raw); } catch (e) { this.local.removeItem(DRAFT_KEY); }
        if (draft && draft.header) {
          const t = this.t();
          const keep = await this.confirm({ title: t.draftTitle, body: t.draftBody, ok: t.draftContinue, cancel: t.draftDiscard, destructiveCancel: true });
          if (keep) { this.state = draft; this.expanded = !this.hasEntries(); } else this.local.removeItem(DRAFT_KEY);
          this.render();
        }
      }
    }

    hasEntries() {
      return Object.keys(this.state.qty).length > 0 || !!this.state.dust;
    }

    saveDraft() {
      try {
        if (this.hasEntries() || this.state.header.branch || this.state.header.section || this.state.header.sampleArea) this.local.setItem(DRAFT_KEY, JSON.stringify(this.state));
        else this.local.removeItem(DRAFT_KEY);
      } catch (e) { /* storage full or blocked: draft is a convenience */ }
    }

    entries() {
      const out = [];
      for (const [k, v] of Object.entries(this.state.qty)) {
        const [code, sev] = k.split('-');
        out.push({ code, sev, quantity: v });
      }
      if (this.state.dust) out.push({ code: '84', sev: this.state.dust });
      return out;
    }

    area() {
      const a = parseNum(this.state.header.sampleArea);
      return a && a > 0 ? a : null;
    }

    compute() {
      const area = this.area();
      if (!area) return null;
      try {
        return this.engine.computeUrci(this.curves, { sampleArea: area, entries: this.entries() });
      } catch (e) {
        return null;
      }
    }

    roundId() {
      const h = this.state.header;
      if (!h.branch.trim() || !h.section.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(h.date)) return null;
      return this.S.roundIdFor(h.branch.trim().toUpperCase(), h.section.trim().toUpperCase(), h.date);
    }

    // ---------- render ----------
    render() {
      const t = this.t();
      this.mount.replaceChildren();
      if (this.testMode) this.mount.append(el('div', { class: 'banner info', role: 'note' }, icon('info', ''), el('p', { text: t.testStorage })));
      if (!this.tipSeen) this.mount.append(this.renderTip());
      this.bodyBox = el('div');
      this.mount.append(this.renderHeader(), this.bodyBox);
      this.renderBody();
      this.renderBar();
    }

    // One-time "how to fill in" card (ST-1 tip), reopened from the Bantuan button.
    renderTip() {
      const t = this.t();
      return el('section', { class: 'tip', 'aria-label': t.tipTitle },
        el('h2', { text: t.tipTitle }),
        el('ol', {}, ...t.tipSteps.map((x) => el('li', { text: x }))),
        el('p', { class: 'note', text: t.tipMore }),
        el('button', { class: 'btn-secondary', type: 'button', id: 'tip-ok', text: t.tipOk, onclick: async () => { this.tipSeen = true; await this.kv.set('tipSeen', true); this.render(); } }));
    }

    showTip() {
      this.tipSeen = false;
      this.render();
      window.scrollTo(0, 0);
    }

    // Everything below the header. Header inputs are never rebuilt while the user moves between them,
    // so focus and typed text survive (a full re-render on blur dropped the next field's input).
    renderBody() {
      const t = this.t();
      const rid = this.roundId();
      const closed = rid && this.store.isRoundClosed(rid);
      this.bodyBox.replaceChildren(
        closed ? el('div', { class: 'banner warning', role: 'status' }, icon('warning', ''), el('p', { text: t.roundClosed }),
          el('button', { class: 'btn-secondary', type: 'button', text: t.reopen, onclick: () => this.reopen(rid) })) : '',
        el('h2', { class: 'block', text: t.block8 }), el('p', { class: 'how', text: t.gridHow }), this.renderGrid(!!closed));
    }

    renderHeader() {
      const t = this.t();
      const h = this.state.header;
      const wrap = el('section', { 'aria-label': t.header });
      const rid = this.roundId();
      const round = rid ? this.store.rounds.get(rid) : null;
      const roundLabel = rid ? (round && round.label) || this.S.defaultRoundLabel(rid) : null;
      const closed = rid && this.store.isRoundClosed(rid);

      if (!this.expanded) {
        const parts = [`${h.branch || '?'} / ${h.section || '?'} / SU${h.sampleUnit || '?'}`, `${this.fmtQty(parseNum(h.sampleArea))} m²`];
        if (roundLabel) parts.push(roundLabel);
        wrap.append(el('button', { class: 'summary', type: 'button', 'aria-expanded': 'false', 'aria-label': t.showHeader, onclick: () => { this.expanded = true; this.render(); } },
          el('span', { class: 'text', text: parts.join(' · ') }), icon('expand_more', '')));
        return wrap;
      }
      const fields = el('div', { class: 'fields' });
      const field = (key, label, attrs = {}, wide = false, help = null) => {
        const id = 'f-' + key;
        const input = el('input', { id, name: key, value: h[key], placeholder: (t.ph && t.ph[key]) || null, 'aria-invalid': this.errors[key] ? 'true' : null, 'aria-describedby': this.errors[key] ? id + '-err' : null, ...attrs });
        input.value = h[key];
        input.addEventListener('input', () => {
          if ((key === 'branch' || key === 'section') && input.value !== input.value.toUpperCase()) {
            const pos = input.selectionStart; // UJ-2: names are uppercase; keep the caret where it was
            input.value = input.value.toUpperCase();
            try { input.setSelectionRange(pos, pos); } catch (e) { /* not a text input */ }
          }
          h[key] = input.value;
          delete this.errors[key];
          this.saveDraft();
          this.renderBar();
          if (key === 'branch' || key === 'section' || key === 'date') this.renderRoundChip();
        });
        input.addEventListener('change', () => { if (key === 'branch' || key === 'section' || key === 'date') { this.renderRoundChip(); this.renderBody(); } });
        const labelRow = el('div', { class: 'label-row' }, el('label', { for: id, text: label }),
          help ? el('button', { class: 'help-btn', type: 'button', onclick: () => this.notice(label, help) }, icon('info', label)) : null);
        return el('div', { class: 'field' + (wide ? ' wide' : '') }, labelRow, input,
          this.errors[key] ? el('div', { class: 'err', id: id + '-err', text: this.errors[key] }) : null,
          key === 'sampleArea' && !this.errors[key] ? el('div', { class: 'hint', text: t.areaHint }) : null);
      };
      const dl = (id, list) => el('datalist', { id }, ...list.map((v) => el('option', { value: v })));
      fields.append(
        field('branch', t.branch, { list: 'dl-branch', autocomplete: 'off', maxlength: 40, autocapitalize: 'characters' }),
        field('section', t.section, { list: 'dl-section', autocomplete: 'off', maxlength: 40, autocapitalize: 'characters' }),
        field('sampleUnit', t.sampleUnit, { inputmode: 'numeric', maxlength: 4 }),
        field('date', t.date, { type: 'date' }),
        field('sampleArea', t.sampleArea, { inputmode: 'decimal', maxlength: 8 }, false, t.sampleAreaHelp),
        field('inspector', t.inspector, { maxlength: 60, autocomplete: 'name' }),
        dl('dl-branch', this.pickers.branch), dl('dl-section', this.pickers.section));
      wrap.append(el('h2', { class: 'block', text: t.locationTitle }), fields, el('div', { class: 'chips', id: 'round-chips' }));
      queueMicrotask(() => this.renderRoundChip());
      return wrap;
    }

    renderRoundChip() {
      const box = document.getElementById('round-chips');
      if (!box) return;
      const t = this.t();
      const rid = this.roundId();
      box.replaceChildren();
      if (!rid) return;
      const round = this.store.rounds.get(rid);
      const label = (round && round.label) || this.S.defaultRoundLabel(rid);
      const closed = this.store.isRoundClosed(rid);
      box.append(el('span', { class: 'chip' + (closed ? ' closed' : ''), 'aria-label': `${t.round}: ${label}${closed ? ', ' + t.closed : ''}` },
        closed ? icon('lock', '', 16) : null, label, closed ? ` · ${t.closed}` : ''));
    }

    renderGrid(disabled) {
      const t = this.t();
      const grid = el('div', { class: 'grid', role: 'group', 'aria-label': t.block8 });
      grid.append(el('div', { class: 'grid-head', 'aria-hidden': 'true' }, el('span'), ...SEVS.map((s) => el('span', { text: t.sevName[s] }))));
      const result = this.compute();
      const flags = new Map((result ? result.rows : []).map((r) => [`${r.code}-${r.sev}`, r.flags]));
      for (const code of CODES) {
        const d = t.distress[code];
        const label = el('button', { class: 'row-label', type: 'button', 'aria-label': `${code} ${d.name}. ${t.helpSource}`, onclick: () => this.openHelp(code) },
          el('span', { class: 'head' }, el('span', { class: 'code', text: code }), icon('info', '', 16)),
          el('span', { class: 'short', text: d.short }), el('span', { class: 'full', text: d.name }),
          el('span', { class: 'measure', text: t.measure[d.unit || 'none'] }));
        const row = el('div', { class: 'grid-row' }, label);
        for (const sev of SEVS) {
          if (code === '84') {
            const on = this.state.dust === sev;
            row.append(el('button', { class: 'dust-chip', type: 'button', disabled, 'aria-pressed': on ? 'true' : 'false', 'aria-label': `${d.short}, ${t.sevName[sev]}`,
              text: t.sevName[sev], onclick: () => { this.state.dust = on ? null : sev; this.afterEntry(); } }));
            continue;
          }
          const key = `${code}-${sev}`;
          const v = this.state.qty[key];
          const unit = t.units[d.unit];
          const f = flags.get(key) || [];
          const text = v === undefined ? '' : this.fmtQty(v);
          const cell = el('button', {
            class: 'cell' + (v !== undefined ? ' filled' : '') + (text.length > 5 ? ' long' : ''), type: 'button', disabled,
            'aria-label': `${d.short}, ${t.sevName[sev]}, ${v === undefined ? '—' : text + ' ' + unit}${f.includes('offChartHigh') ? ', ' + t.offChart : ''}`,
            onclick: () => this.openKeypad(code, sev),
          }, text);
          if (f.includes('offChartHigh')) cell.append(el('span', { class: 'flag' }, icon('warning', t.offChart, 14)));
          row.append(cell);
        }
        grid.append(row);
      }
      return grid;
    }

    renderBar() {
      const t = this.t();
      let bar = document.getElementById('resultbar');
      if (!bar) {
        bar = el('div', { class: 'resultbar', id: 'resultbar' });
        document.body.append(bar);
      }
      const r = this.compute();
      const urci = r ? r.urci : null;
      const band = r ? this.engine.rate(r.urci, this.bandLowers()) : null;
      const num = el('span', { class: 'urci-num', id: 'urci-num', 'aria-live': 'polite', 'aria-label': `${t.urci} ${urci === null ? '—' : urci}`, text: urci === null ? '—' : String(urci) });
      const meta = el('span', { class: 'result-meta' },
        band === null ? el('span', { class: 'need', text: t.needArea }) : el('span', { class: `band band-${band}`, text: t.bands[band] }),
        r ? el('span', { class: 'tq', text: `${t.tdv} ${this.fmt(r.tdv, 0)} · ${t.q} ${r.q}` }) : null);
      bar.replaceChildren(
        el('button', { class: 'result-open', type: 'button', 'aria-label': `${t.urci} ${urci === null ? '—' : urci}. ${t.tapForCalc}`, onclick: () => this.openCalc() }, num, meta),
        el('button', { class: 'btn-primary', type: 'button', id: 'save', disabled: this.saving, onclick: () => this.save() }, this.saving ? t.saving : t.save));
      if (urci !== null && this.lastUrci !== null && urci !== this.lastUrci) {
        num.classList.add('flash');
        setTimeout(() => num.classList.remove('flash'), 150);
      }
      this.lastUrci = urci;
    }

    bandLowers() {
      return (this.settings && this.settings.bands) || this.engine.DEFAULT_BAND_LOWERS;
    }

    afterEntry() {
      if (this.hasEntries() && this.expanded && this.headerValid(false)) this.expanded = false;
      this.saveDraft();
      this.render();
    }

    // ---------- keypad sheet ----------
    openKeypad(code, sev) {
      const t = this.t();
      const d = t.distress[code];
      const key = `${code}-${sev}`;
      const unit = t.units[d.unit];
      const input = el('input', { id: 'qty', type: 'text', inputmode: code === '85' ? 'numeric' : 'decimal', 'aria-label': `${t.enterValue} (${unit})`, autocomplete: 'off' });
      input.value = this.state.qty[key] === undefined ? '' : this.fmtQty(this.state.qty[key]);
      const err = el('p', { class: 'err-text', role: 'alert' });
      const close = this.sheet(el('h2', { text: `${code} ${d.short} · ${t.sevName[sev]}` }),
        el('div', { class: 'sev-guide' }, el('span', { class: 'label', text: t.looksLike }), el('span', { text: d.sev[sev] })),
        this.moreSection(code, sev),
        el('label', { class: 'ask', for: 'qty', text: t.ask[d.unit] }),
        el('div', { class: 'qty-input' }, input, el('span', { class: 'unit', text: unit })), err,
        this.state.qty[key] !== undefined ? el('button', { class: 'btn-secondary btn-block', type: 'button', disabled: true, 'aria-describedby': 'photo-note' }, icon('photo_camera', ''), ' ', t.takePhoto) : null,
        this.state.qty[key] !== undefined ? el('p', { class: 'note', id: 'photo-note', text: t.photoLater }) : null,
        el('div', { class: 'sheet-actions' },
          el('button', { class: 'btn-tertiary', type: 'button', text: t.clearValue, onclick: () => { delete this.state.qty[key]; close(); this.afterEntry(); } }),
          el('button', { class: 'btn-primary', type: 'button', text: t.done, onclick: () => commit() })));
      const commit = () => {
        const v = parseNum(input.value);
        if (v === null) { delete this.state.qty[key]; close(); this.afterEntry(); return; }
        if (Number.isNaN(v) || (code === '85' && !Number.isInteger(v))) { err.textContent = t.badNumber; input.setAttribute('aria-invalid', 'true'); return; }
        if (v === 0) delete this.state.qty[key]; else this.state.qty[key] = v;
        close();
        this.afterEntry();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
      setTimeout(() => input.focus(), 50);
    }

    // TM 5-626 Table B-1 (metric): severity from maximum depth x average diameter. The cells for the
    // severity being entered are marked, so the inspector can check a measured pothole at a glance.
    potholeTable(sev) {
      const t = this.t();
      const pt = t.potholeTable;
      const GRID = [['L', 'L', 'M', 'M'], ['L', 'M', 'H', 'H'], ['M', 'H', 'H', 'H']];
      const table = el('table', { class: 'pothole-table' },
        el('caption', { text: pt.title }),
        el('thead', {},
          el('tr', {}, el('th', { scope: 'col', rowspan: '2', class: 'corner', text: pt.depthHead }), el('th', { scope: 'colgroup', colspan: '4', text: pt.diaHead })),
          el('tr', {}, ...pt.dias.map((x) => el('th', { scope: 'col', text: x })))),
        el('tbody', {}, ...GRID.map((row, i) => el('tr', {},
          el('th', { scope: 'row', text: pt.depths[i] }),
          ...row.map((s) => el('td', { class: s === sev ? 'mark' : '', 'aria-label': t.sevName[s], 'aria-current': s === sev ? 'true' : null, text: t.sevShort[s] }))))));
      return table;
    }

    // All three severity levels of one distress as a table; the row being entered (if any) is marked.
    levelsTable(code, sev) {
      const t = this.t();
      const d = t.distress[code];
      return el('table', { class: 'levels-table' }, el('caption', { text: t.levelsTitle }),
        el('tbody', {}, ...SEVS.map((s) => el('tr', { class: s === sev ? 'mark' : '', 'aria-current': s === sev ? 'true' : null },
          el('th', { scope: 'row', text: t.sevName[s] }), el('td', { text: d.sev[s] })))));
    }

    illus(code) {
      const t = this.t();
      return el('figure', { class: 'illus-fig' }, illustration(code, t.illus, `${t.distress[code].name}: ${t.distress[code].help}`));
    }

    // Same in every keypad: one link that opens the picture and the severity table (closed by default).
    moreSection(code, sev) {
      const t = this.t();
      const d = t.distress[code];
      const box = el('div', { class: 'more-body', id: 'more-body', hidden: true },
        this.illus(code),
        code === '85' ? this.potholeTable(sev) : this.levelsTable(code, sev),
        d.numbers ? null : el('p', { class: 'note', text: t.noNumbers }));
      const toggle = el('button', { class: 'btn-tertiary more-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'more-body', text: t.moreShow,
        onclick: () => { const open = box.hidden; box.hidden = !open; toggle.textContent = open ? t.moreHide : t.moreShow; toggle.setAttribute('aria-expanded', String(open)); } });
      return el('div', { class: 'more' }, toggle, box);
    }

    // Row-name help: picture, what it is, how to measure, do-not-confuse note, all levels, source.
    openHelp(code) {
      const t = this.t();
      const d = t.distress[code];
      let close;
      close = this.sheet(
        el('h2', { text: `${code} ${d.name}` }),
        this.illus(code),
        el('p', { text: d.help }),
        d.confuse ? el('div', { class: 'confuse' }, icon('warning', ''), el('p', {}, el('strong', { text: `${t.confuseTitle} ` }), d.confuse)) : null,
        el('h3', { class: 'sub-h', text: t.howTitle }), el('p', { text: d.how }),
        code === '85' ? this.potholeTable(null) : this.levelsTable(code, null),
        d.numbers ? null : el('p', { class: 'note', text: t.noNumbers }),
        el('p', { class: 'note', text: `${d.fig} · ${t.helpSource}` }),
        el('div', { class: 'sheet-actions' }, el('button', { class: 'btn-primary', type: 'button', text: t.close, onclick: () => close() })));
    }

    // ---------- calc sheet (UJ-3, H2) ----------
    openCalc() {
      const t = this.t();
      const r = this.compute();
      const kids = [el('h2', { text: t.calcTitle })];
      if (!r) {
        kids.push(el('p', { class: 'err-text', text: `${t.sampleArea}: ${t.required}` }));
      } else {
        if (!r.rows.length) kids.push(el('p', { class: 'note', text: t.noEntries }));
        for (const row of r.rows) {
          const d = t.distress[row.code];
          const line = row.code === '84'
            ? `${t.deduct} ${this.fmt(row.deduct, 0)}`
            : `${this.fmtQty(row.quantity)} ${t.units[d.unit]} → ${this.fmt(row.density, 1)} % → ${this.fmt(row.deduct, 1)}`;
          kids.push(el('div', { class: 'calc-row' },
            el('div', { class: 'title', text: `${row.code} ${d.short} · ${t.sevName[row.sev]}` }),
            el('div', { class: 'line' }, el('span', { text: line }), el('span', { class: 'chip', text: d.fig }),
              row.flags.includes('offChartHigh') ? el('span', { class: 'chip' }, icon('warning', '', 14), ' ', t.offChart) : null,
              row.flags.includes('belowFirstPoint') ? el('span', { class: 'chip', text: t.belowFirst }) : null)));
        }
        const band = this.engine.rate(r.urci, this.bandLowers());
        kids.push(el('div', { class: 'stamp' },
          el('div', { class: 'stamp-top' },
            el('div', { class: 'stamp-left' },
              el('div', { text: t.block9 }),
              el('div', { text: `${t.tdvLabel}: ${this.fmt(r.tdv, 1)}` }),
              el('div', { text: `${t.qLabel}: ${r.q}` }),
              el('div', { text: `${t.urci} ${this.fmt(r.urciRaw, 1)}` })),
            el('div', { class: 'stamp-num', 'aria-label': `${t.urci} ${r.urci}`, text: String(r.urci) })),
          el('div', { class: `stamp-band band-${band}`, text: `${t.bands[band]} · ${this.bandRange(band)}` })));
        const tbl = el('table', { class: 'bands-table' }, el('caption', { class: 'note', text: t.bandsNote }));
        this.engine.bandRanges(this.bandLowers()).forEach((b) => tbl.append(el('tr', {}, el('td', {}, el('span', { class: `band band-${b.band}`, text: t.bands[b.band] })), el('td', { text: `${b.lo}–${b.hi}` }))));
        kids.push(tbl);
      }
      let close;
      kids.push(el('div', { class: 'sheet-actions' }, el('button', { class: 'btn-primary', type: 'button', text: t.close, onclick: () => close() })));
      close = this.sheet(...kids);
    }

    bandRange(band) {
      const b = this.engine.bandRanges(this.bandLowers())[band];
      return `${b.lo}–${b.hi}`;
    }

    // ---------- save ----------
    headerValid(showErrors = true) {
      const t = this.t();
      const h = this.state.header;
      const e = {};
      if (!h.branch.trim()) e.branch = t.required;
      if (!h.section.trim()) e.section = t.required;
      const su = parseNum(h.sampleUnit);
      if (su === null) e.sampleUnit = t.required; else if (!Number.isInteger(su) || su < 1 || su > 9999) e.sampleUnit = t.mustBeWhole;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date)) e.date = t.required;
      const a = parseNum(h.sampleArea);
      if (a === null) e.sampleArea = t.required; else if (Number.isNaN(a)) e.sampleArea = t.badNumber; else if (!(a > 0)) e.sampleArea = t.mustBePositive;
      if (showErrors) this.errors = e;
      return Object.keys(e).length === 0;
    }

    async save() {
      if (this.saving) return;
      const t = this.t();
      if (!this.headerValid(true)) {
        this.expanded = true;
        this.render();
        this.toast(t.fixErrors);
        const first = this.mount.querySelector('[aria-invalid="true"]');
        if (first) first.focus();
        return;
      }
      const h = this.state.header;
      const header = {
        branch: h.branch.trim().toUpperCase(),
        section: h.section.trim().toUpperCase(),
        sampleUnit: Number(h.sampleUnit),
        date: h.date,
        sampleArea: parseNum(h.sampleArea),
        ...(h.inspector.trim() ? { inspector: h.inspector.trim() } : {}),
      };
      const entries = this.entries().map((e) => (e.code === '84' ? { code: e.code, sev: e.sev } : e));
      const r = this.compute();
      this.saving = true;
      this.renderBar();
      try {
        await this.store.saveInspection({ header, entries, result: { urciRaw: r.urciRaw, urci: r.urci, tdv: r.tdv, q: r.q } });
        await this.remember('branch', header.branch);
        await this.remember('section', header.section);
        this.local.removeItem(DRAFT_KEY);
        this.state = this.blank();
        this.errors = {};
        this.expanded = true;
        this.lastUrci = null;
        this.toast(t.saved);
      } catch (e) {
        if (e && e.code === 'ROUND_CLOSED') this.toast(t.roundClosed);
        else this.notice(t.save, String((e && (e.code || e.message)) || e));
      } finally {
        this.saving = false;
        this.render();
      }
    }

    async remember(kind, value) {
      const list = (this.pickers[kind] || []).filter((v) => v !== value);
      list.unshift(value);
      this.pickers[kind] = list.slice(0, 50);
      await this.kv.set('pickers', this.pickers);
    }

    async reopen(rid) {
      const t = this.t();
      const ok = await this.confirm({ title: t.reopen, body: t.roundClosed, ok: t.reopen, cancel: t.cancel });
      if (!ok) return;
      await this.store.reopenRound(rid);
      this.render();
    }

    // ---------- shared UI ----------
    sheet(...kids) {
      const prev = document.activeElement;
      const box = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, ...kids);
      const scrim = el('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(); } }, box);
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      document.body.append(scrim);
      function close() {
        document.removeEventListener('keydown', onKey);
        scrim.remove();
        if (prev && prev.isConnected) prev.focus();
      }
      return close;
    }

    notice(title, body) {
      const t = this.t();
      let close;
      const ok = el('button', { class: 'btn-primary', type: 'button', text: t.close, onclick: () => close() });
      const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        el('h2', { text: title }), ...String(body).split('\n\n').map((p) => el('p', { text: p })), el('div', { class: 'dialog-actions' }, ok));
      const scrim = el('div', { class: 'scrim center' }, box);
      document.body.append(scrim);
      close = () => scrim.remove();
      ok.focus();
    }

    // Confirm (primary + tertiary) or destructive cancel (red explicit verb). Default focus = safe choice.
    confirm({ title, body, ok, cancel, destructiveCancel = false }) {
      return new Promise((resolve) => {
        const done = (v) => { scrim.remove(); resolve(v); };
        const okBtn = el('button', { class: 'btn-primary', type: 'button', text: ok, onclick: () => done(true) });
        const cancelBtn = destructiveCancel
          ? el('button', { class: 'btn-primary danger', type: 'button', text: cancel, onclick: () => done(false) })
          : el('button', { class: 'btn-tertiary', type: 'button', text: cancel, onclick: () => done(false) });
        const box = el('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
          el('h2', { text: title }), el('p', { text: body }), el('div', { class: 'dialog-actions' }, cancelBtn, okBtn));
        const scrim = el('div', { class: 'scrim center' }, box);
        document.body.append(scrim);
        okBtn.focus(); // keeping the draft is the safe choice
      });
    }

    toast(msg) {
      const old = document.querySelector('.toast');
      if (old) old.remove();
      const n = el('div', { class: 'toast', role: 'status', text: msg });
      document.body.append(n);
      setTimeout(() => n.remove(), 3000);
    }
  }

  root.InspectScreen = InspectScreen;
  root.__urciParseNum = parseNum;
})(typeof self !== 'undefined' ? self : this);

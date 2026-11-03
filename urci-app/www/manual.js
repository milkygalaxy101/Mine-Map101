// Panduan / Manual: 5 sections, each citing its TM 5-626 paragraph, a source footnote on every page.
// Routes: #/manual (contents), #/manual/<s1..s5>, #/manual/s2/<code> (scrolls to one distress).
// Section 2 is built from the same content as the row-help sheet; section 3 runs the TM example through
// the real engine, so the manual can never disagree with the app's own numbers. textContent only (SEC-1).
(function (root) {
  'use strict';
  const SECTIONS = ['s1', 's2', 's3', 's4', 's5'];
  const CODES = ['81', '82', '83', '84', '85', '86', '87'];
  // TM 5-626 §3-4 worked example, sample unit FS101 (167.4 m²).
  const TM_EXAMPLE = { sampleArea: 167.4, entries: [
    { code: '81', sev: 'L', quantity: 30.5 }, { code: '83', sev: 'M', quantity: 83.7 },
    { code: '84', sev: 'M', quantity: null }, { code: '87', sev: 'M', quantity: 48.8 }] };

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    kids.forEach((c) => { if (c !== null && c !== undefined && c !== '') n.append(c); });
    return n;
  }

  class ManualScreen {
    constructor({ mount, content, getLang, engine, curves, helpers, getBands, onShowTip }) {
      Object.assign(this, { mount, content, getLang, engine, curves, helpers, getBands, onShowTip });
    }
    t() { return this.content[this.getLang()]; }
    num(x, dp) {
      const s = dp === undefined ? String(x) : x.toFixed(dp);
      return this.getLang() === 'id' ? s.replace('.', ',') : s;
    }

    render(r = {}) {
      const t = this.t();
      const sec = SECTIONS.includes(r.sec) ? r.sec : null;
      this.mount.replaceChildren();
      if (!sec) this.renderToc(t); else this.renderSection(t, sec);
      this.mount.append(el('p', { class: 'note manual-source', text: t.sourceFootnote }));
      if (sec && r.anchor) {
        const target = document.getElementById(`m-${r.anchor}`);
        if (target) setTimeout(() => target.scrollIntoView({ block: 'start' }), 0);
      }
    }

    renderToc(t) {
      this.mount.append(el('h2', { class: 'block', text: t.manualToc }),
        el('ul', { class: 'rows', id: 'manual-toc' }, ...SECTIONS.map((s) => el('li', {},
          el('a', { class: 'row-link', href: `#/manual/${s}` },
            el('span', { class: 'row-title', text: t.manual[s].title }),
            t.manual[s].ref ? el('span', { class: 'note', text: t.manual[s].ref }) : null)))));
    }

    renderSection(t, sec) {
      const m = t.manual[sec];
      const i = SECTIONS.indexOf(sec);
      this.mount.append(el('nav', { class: 'manual-nav' }, el('a', { href: '#/manual', text: `← ${t.manualToc}` })),
        el('h2', { class: 'block', id: `m-${sec}`, text: m.title }),
        m.ref ? el('p', { class: 'note', text: t.manualSourceRef.replace('{ref}', m.ref) }) : null);
      this[`body_${sec}`](t, m);
      const next = SECTIONS[i + 1];
      this.mount.append(el('nav', { class: 'manual-nav' },
        i > 0 ? el('a', { href: `#/manual/${SECTIONS[i - 1]}`, text: `← ${t.manual[SECTIONS[i - 1]].title}` }) : null,
        next ? el('a', { href: `#/manual/${next}`, text: `${t.manual[next].title} →` }) : null));
    }

    list(items) { return el('ul', { class: 'manual-list' }, ...items.map((x) => el('li', { text: x }))); }

    body_s1(t, m) {
      this.mount.append(el('p', { text: m.intro }), this.list(m.items), el('p', { text: m.when }), el('p', { text: m.tools }));
    }

    body_s2(t, m) {
      this.mount.append(el('p', { text: m.intro }),
        el('ul', { class: 'manual-chips' }, ...CODES.map((c) => el('li', {}, el('a', { href: `#/manual/s2/${c}`, text: `${c} ${t.distress[c].short}` })))));
      for (const code of CODES) {
        const d = t.distress[code];
        this.mount.append(el('section', { class: 'manual-distress', id: `m-${code}` },
          el('h3', { class: 'sub-h', text: `2.${code.slice(1)} · ${code} ${d.name}` }),
          this.helpers.illus(code),
          el('p', { text: d.help }),
          d.confuse ? el('p', {}, el('strong', { text: `${t.confuseTitle} ` }), d.confuse) : null,
          el('h4', { text: t.howTitle }), el('p', { text: d.how }),
          code === '85' ? this.helpers.levelsTable(code, null) : null,
          code === '85' ? this.helpers.potholeTable(null) : this.helpers.levelsTable(code, null),
          d.numbers ? null : el('p', { class: 'note', text: t.noNumbers }),
          el('p', { class: 'note', text: `${d.fig} · ${t.manualSourceRef.replace('{ref}', t.manual.s2.ref)}` })));
      }
    }

    body_s3(t, m) {
      const r = this.engine.computeUrci(this.curves, TM_EXAMPLE);
      const cols = t.manualCalcCols;
      const table = el('table', { class: 'levels-table manual-calc', id: 'manual-example' },
        el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', { scope: 'col', text: c })))),
        el('tbody', {}, ...r.rows.map((row) => el('tr', {},
          el('th', { scope: 'row', text: `${row.code}-${t.sevShort[row.sev]}` }),
          el('td', { text: row.quantity === null ? '—' : `${this.num(row.quantity)} ${t.units[t.distress[row.code].unit]}` }),
          el('td', { text: row.density === null ? '—' : `${this.num(row.density, 1)}%` }),
          el('td', { class: 'num', text: this.num(row.deduct, 1) })))));
      const tmName = (m.tmScale || t.manual.s5.tmScale).find(([, range]) => r.urci >= parseInt(range, 10))[0];
      this.mount.append(el('p', { text: m.intro }),
        el('p', { text: m.step1 }), el('p', { text: m.step2 }), table,
        el('p', { text: m.step3 }),
        el('p', { class: 'manual-result', id: 'manual-tdv', text: `TDV = ${this.num(r.tdv, 1)} · q = ${r.q}` }),
        el('p', { text: m.step4 }),
        el('p', { class: 'manual-result', id: 'manual-urci', text: `URCI = ${r.urci} · ${tmName} (TM)` }),
        el('p', { class: 'note', text: m.tmSays }), el('p', { text: m.section }));
    }

    body_s4(t, m) {
      this.mount.append(this.list(m.items),
        el('button', { class: 'btn-secondary btn-block', type: 'button', id: 'manual-show-tip', text: t.manualShowTip, onclick: () => this.onShowTip() }));
    }

    body_s5(t, m) {
      const twoCol = (rows, cols) => el('table', { class: 'levels-table' },
        cols ? el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', { scope: 'col', text: c })))) : null,
        el('tbody', {}, ...rows.map((row) => el('tr', {}, el('th', { scope: 'row', text: row[0] }), ...row.slice(1).map((x) => el('td', { text: x }))))));
      const site = this.engine.bandRanges(this.getBands()).map((b) => [t.bands[b.band], `${b.lo}–${b.hi}`]);
      this.mount.append(el('p', { text: m.bandsIntro }), twoCol(m.tmScale),
        el('p', { text: m.siteBands }), el('div', { id: 'manual-site-bands' }, twoCol(site)),
        el('h3', { class: 'sub-h', id: 'm-outlier', text: t.manualOutlierTitle }), el('p', { text: m.outlier }),
        el('h3', { class: 'sub-h', id: 'm-priority', text: t.manualPriorityTitle }), el('p', { text: m.priorityIntro }),
        twoCol(m.priority, m.priorityCols), el('p', { text: m.failed }), el('p', { class: 'note', text: m.mineNote }), el('p', { text: m.rateNote }));
    }
  }

  root.ManualScreen = ManualScreen;
  root.ManualScreen.SECTIONS = SECTIONS;
  root.ManualScreen.TM_EXAMPLE = TM_EXAMPLE;
})(typeof self !== 'undefined' ? self : this);

// Boot: platform (phone or browser test build), language, curves (validated at load), first run
// (choose the data folder, ST-1), store recovery + load, then the Inspect screen.
(function () {
  'use strict';
  const content = window.UrciContent;

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    kids.forEach((c) => n.append(c));
    return n;
  }

  function fatal(msg) {
    document.getElementById('app').replaceChildren(el('p', { class: 'err-text', text: msg }));
  }

  async function boot() {
    const platform = window.UrciPlatform.create();
    const io = platform.io;
    let lang = (await io.kv.get('lang')) || 'id';
    document.documentElement.lang = lang;
    const t = () => content[lang];
    const mount = document.getElementById('app');
    const titleEl = document.getElementById('title');
    const helpBtn = document.getElementById('help');
    const settingsBtn = document.getElementById('settings-btn');
    settingsBtn.append(icon('settings', ''));
    helpBtn.append(icon('menu_book', ''));
    UrciLog.init(io.local);
    let screen = null;

    function chrome() {
      titleEl.textContent = t().inspect;
      settingsBtn.setAttribute('aria-label', t().settingsLabel);
      helpBtn.setAttribute('aria-label', t().manualLabel);
    }
    async function setLang(l) {
      lang = l;
      await io.kv.set('lang', lang);
      document.documentElement.lang = lang;
      chrome();
      if (typeof route === 'function') route();
    }
    chrome();

    let curves;
    try {
      curves = await (await fetch('curves.json', { cache: 'no-store' })).json();
    } catch (e) {
      return fatal('curves.json: ' + (e.message || e));
    }
    const v = window.UrciEngine.validateCurves(curves);
    if (!v.ok) return fatal('curves.json rusak / invalid: ' + v.errors.slice(0, 3).join('; '));

    // ---- first run: choose the data folder (phone only) ----
    // Owner report: the gear could not open Settings here (routing starts after a folder exists), so a user who
    // does not read Indonesian was stuck. The language switch sits on this screen itself; the gear is hidden.
    async function chooseFolder() {
      helpBtn.hidden = true;
      settingsBtn.hidden = true;
      return new Promise((resolve) => {
        const draw = (retry = false, note = '') => {
          const msg = el('p', { class: 'note', role: 'status', text: note });
          const btn = el('button', { class: 'btn-primary btn-block', type: 'button', id: 'pick-folder', text: retry ? t().retry : t().pickFolder });
          btn.addEventListener('click', async () => {
            msg.textContent = '';
            try {
              await platform.pickFolder();
            } catch (e) {
              msg.textContent = e && e.code === 'NO_PICKER' ? t().noPicker : t().pickCancelled;
              btn.textContent = t().retry;
              retry = true;
              return;
            }
            msg.textContent = t().checkingFolder;
            settingsBtn.hidden = false;
            resolve();
          });
          const langRow = el('div', { class: 'seg', role: 'group', 'aria-label': `${content.id.language} / ${content.en.language}`, id: 'welcome-lang' },
            ...[['id', 'Bahasa Indonesia'], ['en', 'English']].map(([code, label]) => el('button', {
              class: 'seg-btn', type: 'button', lang: code, 'aria-pressed': lang === code ? 'true' : 'false', text: label,
              onclick: async () => {
                lang = code;
                await io.kv.set('lang', lang);
                document.documentElement.lang = lang;
                chrome();
                draw(retry, msg.textContent ? (retry ? t().pickCancelled : '') : '');
              } })));
          mount.replaceChildren(el('section', { class: 'welcome' }, langRow,
            el('h2', { text: t().welcomeTitle }), el('p', { text: t().welcomeBody }), el('p', { class: 'note', text: t().welcomeHint }), btn, msg));
        };
        draw();
      });
    }

    async function openStore() {
      const store = new window.UrciStore.Store({ fs: io.fs, kv: io.kv, newId: io.newId });
      await store.init();
      await store.loadAll(); // repairs interrupted saves (ERR-1) and lists broken files (LOCAL-1)
      if (await store.indexIsStale()) await store.writeIndex();
      return store;
    }

    let firstRunNote = null;
    if (platform.native) {
      const st = await platform.folderStatus();
      if (!st.hasFolder) {
        await chooseFolder();
        const s = await openStore();
        const n = s.live().length;
        firstRunNote = n ? t().foundN.replace('{n}', n) : t().newFolder;
      }
    }
    const store = await openStore();

    // site settings live in the data folder (settings.json) so a re-installed phone keeps them
    const settings = { bands: [...window.UrciEngine.DEFAULT_BAND_LOWERS] };
    try {
      const saved = JSON.parse(await io.fs.readText('settings.json'));
      if (saved && window.UrciEngine.validateBands(saved.bands).ok) settings.bands = saved.bands;
    } catch (e) { /* no settings yet: defaults */ }
    async function saveSettings(next) {
      Object.assign(settings, next);
      await io.fs.writeTextSafe('settings.json', JSON.stringify({ format: 'urci-settings', version: 1, bands: settings.bands }));
    }

    screen = new window.InspectScreen({
      mount, engine: window.UrciEngine, curves, storeApi: window.UrciStore, store, content,
      getLang: () => lang, kv: io.kv, local: io.local, testMode: !platform.native, platform, newId: io.newId,
      onFolderLost: async () => { await chooseFolder(); helpBtn.hidden = false; await store.loadAll(); route(); },
    });
    screen.settings = settings;
    const historyScreen = new window.HistoryScreen({
      mount, store, engine: window.UrciEngine, content, getLang: () => lang, platform, storeApi: window.UrciStore,
      toast: (m) => screen.toast(m), confirm: (o) => screen.confirm(o), curves,
      onEdit: (rec) => { screen.loadRecord(rec); location.hash = '#/inspect'; },
    });

    historyScreen.lowers = () => settings.bands;
    const settingsScreen = new window.SettingsScreen({
      mount, content, getLang: () => lang, setLang, platform, settings, saveSettings, engine: window.UrciEngine, curves, store,
      toast: (m) => screen.toast(m),
      onChangeFolder: async () => { await chooseFolder(); await store.loadAll(); location.hash = '#/inspect'; route(); },
    });
    const filesScreen = new window.FilesScreen({
      mount, store, content, getLang: () => lang, platform, storeApi: window.UrciStore, bundleApi: window.UrciBundle, kv: io.kv,
      toast: (m) => screen.toast(m),
    });

    const manualScreen = new window.ManualScreen({
      mount, content, getLang: () => lang, engine: window.UrciEngine, curves, helpers: screen, getBands: () => settings.bands,
      onShowTip: () => { location.hash = '#/inspect'; screen.showTip(); },
    });

    // ---- tabs + hash routes (the phone's back button walks back up the History levels) ----
    const tabs = document.getElementById('tabs');
    tabs.hidden = false;
    function parse(hash) {
      const p = (hash || '').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
      if (p[0] === 'files') return { tab: 'files' };
      if (p[0] === 'settings') return { tab: 'settings' };
      if (p[0] === 'manual') return { tab: 'manual', sec: p[1], anchor: p[2] };
      if (p[0] !== 'history') return { tab: 'inspect' };
      if (p[1] === 'conflicts') return { tab: 'history', view: 'conflicts' };
      if (p[1] === 's' && p[3] === 'r') return { tab: 'history', view: 'round', key: p[2], roundId: p[4] };
      if (p[1] === 's') return { tab: 'history', view: 'section', key: p[2] };
      if (p[1] === 'i') return { tab: 'history', view: 'detail', uuid: p[2] };
      return { tab: 'history', view: 'sections' };
    }
    function route() {
      const r = parse(location.hash);
      const oldToast = document.querySelector('.toast');
      if (oldToast && document.body.dataset.tab && document.body.dataset.tab !== r.tab) oldToast.remove(); // a toast belongs to the tab it came from
      document.body.dataset.tab = r.tab;
      const onInspect = r.tab === 'inspect';
      document.body.classList.toggle('on-inspect', onInspect);
      for (const [id, tab, label] of [['tab-inspect', 'inspect', 'tabInspect'], ['tab-history', 'history', 'tabHistory'], ['tab-files', 'files', 'tabFiles']]) {
        const a = document.getElementById(id);
        a.setAttribute('aria-current', r.tab === tab ? 'page' : 'false');
        a.textContent = t()[label];
      }
      helpBtn.hidden = r.tab === 'manual';
      titleEl.textContent = onInspect ? t().inspect : r.tab === 'files' ? t().filesTitle : r.tab === 'settings' ? t().settingsTitle : r.tab === 'manual' ? t().manualTitle : t().historyTitle;
      settingsBtn.hidden = r.tab === 'settings';
      const bar = document.getElementById('resultbar');
      if (bar) bar.hidden = !onInspect;
      if (onInspect) screen.render(); else if (r.tab === 'files') filesScreen.render(); else if (r.tab === 'settings') settingsScreen.render(); else if (r.tab === 'manual') manualScreen.render(r); else historyScreen.render(r);
      if (!onInspect) { const b = document.getElementById('resultbar'); if (b) b.hidden = true; }
      if (!(r.tab === 'manual' && r.anchor)) window.scrollTo(0, 0);
    }
    window.addEventListener('hashchange', route);

    // Android back button (MainActivity asks this first). Closes the top sheet or dialog the safe way and returns
    // true; returns false when nothing is open, and the phone then goes to the previous panel, or puts the app in
    // the background from the first screen. Back never presses a destructive button: a dialog without a plain
    // Batal/Tutup (Cancel/Close) is left open, and a long export keeps running.
    window.__urciBack = () => {
      const scrims = document.querySelectorAll('.scrim');
      const top = scrims[scrims.length - 1];
      if (!top) return false;
      if (top.querySelector('.sheet') && top.querySelector('.sheet').closest('.scrim') === top && !top.querySelector('.dialog')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); // Inspect sheets close on Escape
        if (top.isConnected) {
          const safe = [...top.querySelectorAll('button')].find((b) => [content.id.cancel, content.id.close, content.en.cancel, content.en.close].includes(b.textContent.trim()));
          if (safe) safe.click();
        }
        return true;
      }
      const safe = [...top.querySelectorAll('button')].find((b) => [content.id.cancel, content.id.close, content.en.cancel, content.en.close].includes(b.textContent.trim()));
      if (safe) safe.click();
      return true;
    };
    // tabs hide while the keyboard is up (an input has focus), so the result bar sits right above it
    document.addEventListener('focusin', (e) => { if (e.target.matches('input, textarea')) document.body.classList.add('kbd'); });
    document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement || !document.activeElement.matches('input, textarea')) document.body.classList.remove('kbd'); }, 50));

    route();
    await screen.start();
    route();
    if (firstRunNote) screen.toast(firstRunNote);
    // "Open with URCI Field": a bundle handed over by WhatsApp / Bluetooth / a file manager, at launch or later
    const handleIncoming = async () => {
      const inc = await platform.bundles.takeIncoming();
      if (!inc) return;
      if (location.hash !== '#/files') location.hash = '#/files';
      await filesScreen.importIncoming(inc);
    };
    platform.bundles.onIncoming(() => { handleIncoming(); });
    handleIncoming();
    window.__urci = { screen, store, curves, platform, historyScreen, filesScreen, settingsScreen, manualScreen, settings }; // test hook
  }
  boot().catch((e) => fatal('Gagal memulai / start failed: ' + (e && (e.message || e))));
})();

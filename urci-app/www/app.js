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
    const langBtn = document.getElementById('lang');
    let screen = null;

    function chrome() {
      titleEl.textContent = t().inspect;
      langBtn.textContent = t().lang;
      langBtn.setAttribute('aria-label', t().langLabel);
      helpBtn.textContent = t().help;
    }
    langBtn.addEventListener('click', async () => {
      lang = lang === 'id' ? 'en' : 'id';
      await io.kv.set('lang', lang);
      document.documentElement.lang = lang;
      chrome();
      if (screen) screen.render();
    });
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
    async function chooseFolder() {
      helpBtn.hidden = true;
      return new Promise((resolve) => {
        const msg = el('p', { class: 'note', role: 'status' });
        const btn = el('button', { class: 'btn-primary btn-block', type: 'button', id: 'pick-folder', text: t().pickFolder });
        btn.addEventListener('click', async () => {
          msg.textContent = '';
          try {
            await platform.pickFolder();
          } catch (e) {
            msg.textContent = e && e.code === 'NO_PICKER' ? t().noPicker : t().pickCancelled;
            btn.textContent = t().retry;
            return;
          }
          msg.textContent = t().checkingFolder;
          resolve();
        });
        mount.replaceChildren(el('section', { class: 'welcome' },
          el('h2', { text: t().welcomeTitle }), el('p', { text: t().welcomeBody }), el('p', { class: 'note', text: t().welcomeHint }), btn, msg));
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

    screen = new window.InspectScreen({
      mount, engine: window.UrciEngine, curves, storeApi: window.UrciStore, store, content,
      getLang: () => lang, kv: io.kv, local: io.local, testMode: !platform.native, platform, newId: io.newId,
      onFolderLost: async () => { await chooseFolder(); helpBtn.hidden = false; await store.loadAll(); screen.render(); },
    });
    helpBtn.hidden = false;
    helpBtn.addEventListener('click', () => screen.showTip());
    screen.render();
    await screen.start();
    if (firstRunNote) screen.toast(firstRunNote);
    window.__urci = { screen, store, curves, platform }; // test hook
  }
  boot().catch((e) => fatal('Gagal memulai / start failed: ' + (e && (e.message || e))));
})();

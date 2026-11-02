// Boot: language, curves (validated at load), storage (native UrciStorage when present, else the
// browser test store with a visible banner), then the Inspect screen.
(function () {
  'use strict';
  const C = window.Capacitor;
  const content = window.UrciContent;
  const dev = window.UrciDevStorage;

  function fatal(msg) {
    const box = document.getElementById('app');
    box.replaceChildren();
    const p = document.createElement('p');
    p.className = 'err-text';
    p.textContent = msg;
    box.append(p);
  }

  async function boot() {
    // Native storage plugin arrives with E-T4; until then the browser store is used everywhere.
    const nativeStorage = C && C.isPluginAvailable && C.isPluginAvailable('UrciStorage');
    const io = nativeStorage ? null : dev; // TODO(E-T4): wrap C.registerPlugin('UrciStorage') in the same fs/kv contract
    const testMode = !nativeStorage;

    let lang = (await io.kv.get('lang')) || 'id';
    const setLang = async (l) => { lang = l; await io.kv.set('lang', l); document.documentElement.lang = l; render(); };
    document.documentElement.lang = lang;

    let curves;
    try {
      const res = await fetch('curves.json', { cache: 'no-store' });
      curves = await res.json();
    } catch (e) {
      return fatal('curves.json: ' + (e.message || e));
    }
    const v = window.UrciEngine.validateCurves(curves);
    if (!v.ok) return fatal('curves.json rusak / invalid: ' + v.errors.slice(0, 3).join('; '));

    const store = new window.UrciStore.Store({ fs: io.fs, kv: io.kv, newId: io.newId });
    await store.init();
    await store.loadAll();

    const screen = new window.InspectScreen({
      mount: document.getElementById('app'), engine: window.UrciEngine, curves, storeApi: window.UrciStore, store, content,
      getLang: () => lang, setLang, kv: io.kv, local: io.local, testMode,
    });
    const langBtn = document.getElementById('lang');
    function render() {
      const t = content[lang];
      document.getElementById('title').textContent = t.inspect;
      langBtn.textContent = t.lang;
      document.getElementById('help').textContent = t.help;
      langBtn.setAttribute('aria-label', t.langLabel);
      screen.render();
    }
    langBtn.addEventListener('click', () => setLang(lang === 'id' ? 'en' : 'id'));
    document.getElementById('help').addEventListener('click', () => screen.showTip());
    render();
    await screen.start();
    window.__urci = { screen, store, curves }; // test hook
  }
  boot().catch((e) => fatal('Gagal memulai / start failed: ' + (e && (e.message || e))));
})();

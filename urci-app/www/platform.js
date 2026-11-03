// Platform layer: the only place that differs between the phone and the browser test build.
//   io    - { fs, kv, newId, local } in the store.js contract (UrciStorage on the phone, localStorage in the browser)
//   media - capture -> downscale -> draft photo -> copy into the data folder, plus display URLs
//   geo   - GPS watch + "fix for stamp" rule (last fix <= 60 s old, else wait up to 10 s; CEO D18)
// Native error codes come through unchanged (e.code), so store.js and the UI can react to them.
(function (root) {
  'use strict';
  const C = root.Capacitor;
  const isNative = !!(C && C.isNativePlatform && C.isNativePlatform() && C.isPluginAvailable && C.isPluginAvailable('UrciStorage'));

  function blobToBase64(blob) {
    return blob.arrayBuffer().then((buf) => {
      const b = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      return btoa(s);
    });
  }

  async function sha256Hex(blob) {
    const d = await root.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  // ---------------- native (phone) ----------------
  function nativePlatform() {
    const P = C.registerPlugin('UrciStorage');
    const Camera = C.registerPlugin('Camera');
    const Geo = C.registerPlugin('Geolocation');
    const Share = C.registerPlugin('Share');
    const dev = root.UrciDevStorage; // kv/local: WebView localStorage is app-private and excluded from backup

    const fs = {
      async list(dir) { return (await P.list({ path: dir })).entries; },
      async readText(path) { return (await P.readText({ path })).text; },
      writeTextSafe: (path, text) => P.writeTextSafe({ path, text }),
      createNew: (path, text) => P.writeTextSafe({ path, text }),
      delete: (path) => P.delete({ path }),
      rename: (path, newName) => P.rename({ path, newName }),
    };

    const media = {
      native: true,
      // Opens the camera; returns { blob, url } of a downscaled image, or null when the user cancels.
      async capture() {
        const photo = await Camera.takePhoto({ quality: 92, correctOrientation: true, saveToGallery: false });
        if (!photo || !photo.uri) return null;
        const ds = await P.downscale({ uri: photo.uri, maxEdge: 2048, quality: 92 });
        const url = C.convertFileSrc('file://' + ds.path);
        const blob = await (await fetch(url)).blob();
        return { blob, url };
      },
      // Gallery import: the original file via the system picker, downscaled natively; EXIF time/GPS passed raw
      // (inspect.js parses them). Returns null when the user cancels.
      async pickGallery() {
        let picked;
        try { picked = await P.pickPhoto(); } catch (e) { if (e && e.code === 'CANCELLED') return null; throw e; }
        const ds = await P.downscale({ uri: picked.uri, maxEdge: 2048, quality: 92 });
        const url = C.convertFileSrc('file://' + ds.path);
        const blob = await (await fetch(url)).blob();
        const gps = Number.isFinite(ds.exifLat) && Number.isFinite(ds.exifLon) && !(ds.exifLat === 0 && ds.exifLon === 0) ? { lat: ds.exifLat, lon: ds.exifLon } : null;
        return { blob, url, exifDto: ds.exifDateTimeOriginal || null, exifOffset: ds.exifOffsetTimeOriginal || null, exifGps: gps, fileTime: picked.lastModified || null };
      },
      async saveDraft(blob) { return (await P.writeDraftPhoto({ base64: await blobToBase64(blob) })).path; },
      draftUrl: (path) => C.convertFileSrc('file://' + path),
      folderUrl: (relPath) => `/_saf/${relPath.split('/').map(encodeURIComponent).join('/')}`,
      copyIn: (draftPath, relPath) => P.copyDraftIn({ from: draftPath, to: relPath }),
      deleteDraft: (path) => P.deleteDraftPhoto({ path }).catch(() => {}),
      // exports: saved into <data folder>/exports/ (never overwritten) + a cache copy that can be shared
      async saveExport(blob, name, mime = 'application/pdf') {
        return P.saveExport({ name, mime, base64: await blobToBase64(blob) });
      },
      canShare: true,
      share: (saved, title) => Share.share({ title, dialogTitle: title, files: ['file://' + saved.cachePath] }),
    };

    const geo = makeGeo({
      async start(onFix, onError) {
        try {
          const perm = await Geo.requestPermissions();
          if (perm && perm.location === 'denied') return onError({ code: 'DENIED' });
        } catch (e) { return onError({ code: 'DENIED' }); }
        Geo.watchPosition({ enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 }, (pos, err) => {
          if (pos) onFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, at: Date.now() });
          else if (err) onError({ code: /disabled|off|unavailable/i.test(String(err.message)) ? 'OFF' : 'ERROR', message: err.message });
        });
      },
    });

    const bundles = {
      exportZip: (paths, manifest, name) => P.exportZip({ paths, manifest: JSON.stringify(manifest), name }),
      pick: () => P.pickBundle(),
      inspect: async (picked) => { const r = await P.inspectZip({ uri: picked.uri }); return { entries: r.entries, texts: r.texts || {} }; },
      importPhotos: (picked, accept, bytes) => P.importZipPhotos({ uri: picked.uri, accept, bytes }),
      open: (relPath) => P.openExport({ relPath }),
      share: (relPath) => P.shareExport({ relPath }),
      listExports: async () => { try { return (await P.list({ path: 'exports' })).entries.filter((e) => !e.dir); } catch (e) { return []; } },
    };

    return {
      native: true,
      bundles,
      io: { fs, kv: dev.kv, newId: dev.newId, local: dev.local },
      media, geo,
      // R10 clock check: phone clock minus GPS time (ms), or null when no GPS fix came in time
      clock: {
        async gpsDrift() { try { const r = await P.nativeFix({ timeoutMs: 60000 }); return Number.isFinite(r.driftMs) ? r.driftMs : null; } catch (e) { return null; } },
        openDateSettings: () => P.openDateSettings().catch(() => {}),
      },
      folderStatus: () => P.folderStatus(),
      pickFolder: () => P.pickFolder(),
      freeSpace: () => P.freeSpace(),
    };
  }

  // ---------------- browser test build ----------------
  function browserPlatform() {
    const dev = root.UrciDevStorage;
    const drafts = new Map(); // path -> Blob (memory only: test mode)
    const filed = new Map(); // data-folder path -> Blob

    function pickFile(camera = true) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        if (camera) input.setAttribute('capture', 'environment');
        input.id = camera ? 'urci-camera-input' : 'urci-gallery-input';
        input.hidden = true;
        input.addEventListener('change', () => { resolve(input.files && input.files[0]); input.remove(); }, { once: true });
        input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
        document.body.append(input);
        input.click();
      });
    }

    async function downscale(file, maxEdge = 2048) {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k);
      cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      bmp.close && bmp.close();
      return new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.92));
    }

    const media = {
      native: false,
      async capture() {
        const file = await pickFile();
        if (!file) return null;
        const blob = await downscale(file);
        return { blob, url: URL.createObjectURL(blob) };
      },
      async pickGallery() {
        const file = await pickFile(false);
        if (!file) return null;
        const exif = root.UrciStamp.readExifTime(await file.arrayBuffer());
        const blob = await downscale(file);
        return { blob, url: URL.createObjectURL(blob), exifDto: exif ? exif.dto : null, exifOffset: exif ? exif.offset : null, exifGps: null, fileTime: file.lastModified || null };
      },
      async saveDraft(blob) {
        const path = `draft-photos/${dev.newId()}.jpg`;
        drafts.set(path, blob);
        return path;
      },
      draftUrl: (path) => (drafts.has(path) ? URL.createObjectURL(drafts.get(path)) : ''),
      folderUrl: (relPath) => (filed.has(relPath) ? URL.createObjectURL(filed.get(relPath)) : ''),
      async copyIn(draftPath, relPath) {
        const blob = drafts.get(draftPath);
        if (!blob) throw Object.assign(new Error('draft missing'), { code: 'NOT_FOUND' });
        try {
          await dev.fs.createNew(relPath, `jpeg ${blob.size} bytes (test mode)`); // marker so folder listing sees the photo
        } catch (e) {
          throw Object.assign(new Error('exists'), { code: 'NAME_CLASH' });
        }
        filed.set(relPath, blob);
      },
      async deleteDraft(path) { drafts.delete(path); },
      async saveExport(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.hidden = true;
        document.body.append(a);
        a.click();
        a.remove();
        root.__urciLastExport = { name, size: blob.size, blob }; // test hook
        return { relPath: `exports/${name}`, cachePath: null };
      },
      canShare: false,
      share: async () => {},
    };

    const geo = makeGeo({
      start(onFix, onError) {
        if (!navigator.geolocation) return onError({ code: 'OFF' });
        navigator.geolocation.watchPosition(
          (pos) => onFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, at: Date.now() }),
          (err) => onError({ code: err.code === 1 ? 'DENIED' : 'OFF', message: err.message }),
          { enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 });
      },
    });

    const exportsMem = new Map(); // name -> Blob (test build)
    function download(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.hidden = true;
      document.body.append(a);
      a.click();
      a.remove();
      root.__urciLastExport = { name, size: blob.size, blob }; // test hook
    }
    async function remember(blob, name) {
      let final = name;
      for (let i = 2; exportsMem.has(final); i++) final = name.replace(/(\.urci\.zip|\.pdf)$/, `-${i}$1`);
      exportsMem.set(final, blob);
      await dev.fs.writeTextSafe(`exports/${final}`, `export ${blob.size} bytes (test mode)`);
      return final;
    }
    const origSaveExport = media.saveExport;
    media.saveExport = async (blob, name) => { const final = await remember(blob, name); download(blob, final); return { relPath: `exports/${final}`, cachePath: null }; };
    void origSaveExport;
    const picked = new Map();
    const bundles = {
      async exportZip(paths, manifest, name) {
        const files = { 'manifest.json': root.fflate.strToU8(JSON.stringify(manifest)) };
        for (const p of paths) {
          if (filed.has(p)) files[p] = new Uint8Array(await filed.get(p).arrayBuffer());
          else { try { files[p] = root.fflate.strToU8(await dev.fs.readText(p)); } catch (e) { /* missing file: not packed */ } }
        }
        const blob = new Blob([root.fflate.zipSync(files, { level: 0 })], { type: 'application/zip' });
        const final = await remember(blob, name);
        download(blob, final);
        return { relPath: `exports/${final}`, cachePath: null, bytes: blob.size };
      },
      pick() {
        return new Promise((resolve, reject) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.zip,application/zip';
          input.id = 'urci-bundle-input';
          input.hidden = true;
          input.addEventListener('change', () => {
            const f = input.files && input.files[0];
            input.remove();
            if (!f) return reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
            const uri = `mem:${dev.newId()}`;
            picked.set(uri, f);
            resolve({ uri, name: f.name });
          }, { once: true });
          input.addEventListener('cancel', () => { input.remove(); reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })); }, { once: true });
          document.body.append(input);
          input.click();
        });
      },
      async inspect(p) {
        let files;
        try { files = root.fflate.unzipSync(new Uint8Array(await picked.get(p.uri).arrayBuffer())); } catch (e) { throw Object.assign(new Error('not a zip'), { code: 'BUNDLE_INVALID:NOT_A_BUNDLE' }); }
        const entries = [];
        const texts = {};
        for (const [name, bytes] of Object.entries(files)) {
          if (name.endsWith('/')) continue;
          entries.push({ name, size: bytes.length });
          if (name.endsWith('.json')) texts[name] = root.fflate.strFromU8(bytes);
        }
        p.files = files;
        return { entries, texts };
      },
      async importPhotos(p, accept) {
        let copied = 0, existed = 0;
        for (const name of accept) {
          if (filed.has(name)) { existed++; continue; }
          try { await dev.fs.createNew(name, `jpeg ${p.files[name].length} bytes (test mode)`); } catch (e) { existed++; continue; }
          filed.set(name, new Blob([p.files[name]], { type: 'image/jpeg' }));
          copied++;
        }
        return { copied, existed };
      },
      async open(relPath) { const n = relPath.replace(/^exports\//, ''); if (exportsMem.has(n)) download(exportsMem.get(n), n); },
      async share(relPath) { return this.open(relPath); },
      async listExports() { try { return (await dev.fs.list('exports')).filter((e) => !e.dir).map((e) => ({ ...e, size: exportsMem.has(e.name) ? exportsMem.get(e.name).size : 0 })); } catch (e) { return []; } },
    };

    // browser test build has no GPS time; a test sets localStorage 'urci.testDriftMs' to simulate a drifted phone
    const clock = {
      async gpsDrift() { let v = null; try { v = root.localStorage.getItem('urci.testDriftMs'); } catch (e) { /* none */ } return v === null ? null : Number(v); },
      async openDateSettings() { root.__urciOpenedDateSettings = true; },
    };
    return { native: false, bundles, io: { fs: dev.fs, kv: dev.kv, newId: dev.newId, local: dev.local }, media, geo, clock };
  }

  // GPS state shared by both platforms.
  function makeGeo(driver) {
    const listeners = new Set();
    const state = { status: 'idle', fix: null, error: null };
    let waiters = [];
    const emit = () => listeners.forEach((f) => f(state));
    let started = false;
    return {
      state,
      onChange(f) { listeners.add(f); return () => listeners.delete(f); },
      start() {
        if (started) return;
        started = true;
        state.status = 'searching';
        emit();
        driver.start(
          (fix) => { state.fix = fix; state.status = 'ok'; state.error = null; waiters.forEach((w) => w(fix)); waiters = []; emit(); },
          (err) => { state.error = err; if (!state.fix || err.code === 'DENIED') state.status = err.code === 'DENIED' ? 'denied' : 'off'; emit(); });
      },
      // Fix for a photo stamp: last fix if <= 60 s old, else wait up to 10 s for a new one, else null ("GPS: n/a").
      fixForStamp(maxAgeMs = 60000, waitMs = 10000) {
        const f = state.fix;
        if (f && Date.now() - f.at <= maxAgeMs) return Promise.resolve(f);
        if (state.status === 'denied' || state.status === 'off') return Promise.resolve(null);
        return new Promise((resolve) => {
          const timer = setTimeout(() => { waiters = waiters.filter((w) => w !== done); resolve(null); }, waitMs);
          function done(fix) { clearTimeout(timer); resolve(fix); }
          waiters.push(done);
        });
      },
    };
  }

  root.UrciPlatform = { create: () => (isNative ? nativePlatform() : browserPlatform()), isNative, sha256Hex, blobToBase64 };
})(typeof self !== 'undefined' ? self : this);

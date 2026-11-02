// Runs before spike.js and makes no native calls: proves JS runs and shows what the bridge exposes.
'use strict';
(function () {
  var el = document.getElementById('status');
  function show(msg, bad) {
    el.textContent = msg;
    el.className = bad ? 'bad' : '';
  }
  window.__bootShow = show;
  window.addEventListener('error', function (e) {
    show('ERROR skrip: ' + e.message + ' (' + (e.filename || '').split('/').pop() + ':' + e.lineno + ')', true);
  });
  var C = window.Capacitor;
  if (!C) {
    show('JS jalan, tetapi jembatan Capacitor TIDAK ADA (window.Capacitor kosong).', true);
    return;
  }
  var headers = (C.PluginHeaders || []).map(function (h) { return h.name; });
  var native = typeof C.isNativePlatform === 'function' ? C.isNativePlatform() : '?';
  show('JS jalan · jembatan ada · native ' + native + '\nplugin: ' + (headers.join(', ') || '(daftar kosong)'), headers.indexOf('UrciSpike') === -1);
})();

// Copies browser builds into www/vendor so the app loads nothing from the network.
// capacitor.js: the native bridge only creates a bare window.Capacitor; registerPlugin and the
// plugin proxies come from @capacitor/core, which a no-bundler app must load itself.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('www/vendor', { recursive: true });
copyFileSync('node_modules/jspdf/dist/jspdf.umd.min.js', 'www/vendor/jspdf.umd.min.js');
copyFileSync('node_modules/@capacitor/core/dist/capacitor.js', 'www/vendor/capacitor.js');
console.log('vendored jspdf, @capacitor/core');

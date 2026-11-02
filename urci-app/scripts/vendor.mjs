// Copies browser builds into www/vendor so the app loads nothing from the network.
// capacitor.js is required: Capacitor's native bridge only creates a bare window.Capacitor;
// registerPlugin comes from @capacitor/core, which a no-bundler app must load itself (spike lesson).
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('www/vendor', { recursive: true });
copyFileSync('node_modules/@capacitor/core/dist/capacitor.js', 'www/vendor/capacitor.js');
copyFileSync('node_modules/jspdf/dist/jspdf.umd.min.js', 'www/vendor/jspdf.umd.min.js');
console.log('vendored @capacitor/core, jspdf');

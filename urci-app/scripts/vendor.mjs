// Copies browser builds into www/vendor so the app loads nothing from the network.
// capacitor.js is required: Capacitor's native bridge only creates a bare window.Capacitor;
// registerPlugin comes from @capacitor/core, which a no-bundler app must load itself (spike lesson).
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('www/vendor', { recursive: true });
copyFileSync('node_modules/@capacitor/core/dist/capacitor.js', 'www/vendor/capacitor.js');
copyFileSync('node_modules/jspdf/dist/jspdf.umd.min.js', 'www/vendor/jspdf.umd.min.js');
// fflate: zip/unzip for the browser test build only (the phone uses java.util.zip in UrciStorage)
copyFileSync('node_modules/fflate/umd/index.js', 'www/vendor/fflate.js');
console.log('vendored @capacitor/core, jspdf, fflate');

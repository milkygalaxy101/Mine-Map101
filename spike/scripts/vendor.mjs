// Copies the jsPDF UMD build into www/vendor so the app loads nothing from the network.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('www/vendor', { recursive: true });
copyFileSync('node_modules/jspdf/dist/jspdf.umd.min.js', 'www/vendor/jspdf.umd.min.js');
console.log('vendored jspdf');

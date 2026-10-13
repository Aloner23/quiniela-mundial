/**
 * Construye la demo estática en demo/:
 *   - demo/index.html: apps-script/Index.html con Styles.html y Client.html
 *     incrustados (igual que hace incluir_() en Apps Script), más los scripts
 *     de la demo.
 *   - demo/servidor.js: el código real del servidor empaquetado.
 *   - demo/gas-mock.js y demo/fuentes/: mock de servicios y tipografías locales.
 *
 * Uso: npm run demo:build
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { codigoFabrica } = require('./empaquetar');

const RAIZ = path.join(__dirname, '..');
const GAS = path.join(RAIZ, 'apps-script');
const DEMO = path.join(RAIZ, 'demo');

function leer(f) {
  return fs.readFileSync(path.join(GAS, f), 'utf8');
}

let html = leer('Index.html');
// Plantillas de HtmlService: <?!= incluir_('X'); ?>
html = html.replace(/<\?!=\s*incluir_\('(\w+)'\);\s*\?>/g, (_, archivo) => leer(archivo + '.html'));
if (/<\?/.test(html)) throw new Error('Quedó una etiqueta de plantilla sin procesar en Index.html');

// En la demo las fuentes se sirven localmente (sin Google Fonts).
html = html
  .replace(/\s*<link rel="preconnect"[^>]*>/g, '')
  .replace(/\s*<link\s+rel="stylesheet"\s+href="https:\/\/fonts[^>]*\/>/s, '');
html = html.replace(
  '<base target="_top" />',
  [
    '<meta name="description" content="Demo de una quiniela del Mundial 2026 hecha en Google Apps Script. Datos ficticios, sin servidor." />',
    '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%2310241c%22/%3E%3Crect x=%2210%22 y=%228%22 width=%2212%22 height=%2216%22 rx=%222%22 fill=%22%23f2c230%22/%3E%3C/svg%3E" />',
    '<link rel="stylesheet" href="demo.css" />',
    '<script src="gas-mock.js"></script>',
    '<script src="servidor.js"></script>',
    '<script src="demo.js"></script>',
  ].join('\n    '),
);
html = html.replace('<title>Quiniela Mundial 2026</title>', '<title>Quiniela Mundial 2026 · Demo</title>');

const aviso = '<!-- Generado por tools/construir-demo.js a partir de apps-script/Index.html. No editar a mano. -->\n';
fs.writeFileSync(path.join(DEMO, 'index.html'), aviso + html);
fs.writeFileSync(
  path.join(DEMO, 'servidor.js'),
  '// Generado por tools/construir-demo.js a partir de apps-script/*.gs. No editar a mano.\n' + codigoFabrica() + '\n',
);
fs.copyFileSync(path.join(__dirname, 'gas-mock.js'), path.join(DEMO, 'gas-mock.js'));

const fuentes = path.join(DEMO, 'fuentes');
fs.mkdirSync(fuentes, { recursive: true });
const origenes = [
  ['@fontsource/big-shoulders-display', 'big-shoulders-display', [600, 700, 800]],
  ['@fontsource/instrument-sans', 'instrument-sans', [400, 500, 600, 700]],
];
for (const [paquete, nombre, pesos] of origenes) {
  for (const p of pesos) {
    const f = `${nombre}-latin-${p}-normal.woff2`;
    fs.copyFileSync(path.join(RAIZ, 'node_modules', paquete, 'files', f), path.join(fuentes, f));
  }
}
console.log('Demo lista en demo/ (abre demo/index.html o usa npm run demo:serve)');

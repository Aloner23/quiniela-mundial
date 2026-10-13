/**
 * Empaqueta el código del servidor (apps-script/*.gs + Core.js) en una fábrica
 * `crearServidor(entorno)` que recibe los servicios de Apps Script simulados.
 *
 * Así las pruebas y la demo ejecutan exactamente los mismos archivos que se
 * suben con clasp, sin copiar ni reescribir lógica.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'apps-script');
const ORDEN = [
  'Core.js',
  'Config.gs',
  'Hojas.gs',
  'Auth.gs',
  'Partidos.gs',
  'Pronosticos.gs',
  'Puntuacion.gs',
  'Bracket.gs',
  'Admin.gs',
  'Status.gs',
  'Setup.gs',
];
const SERVICIOS = [
  'SpreadsheetApp',
  'CacheService',
  'PropertiesService',
  'LockService',
  'Session',
  'Utilities',
  'HtmlService',
];

/** Nombres de las funciones de nivel superior sin "_" final: la API pública. */
function funcionesPublicas(fuente) {
  const nombres = [];
  const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let m;
  while ((m = re.exec(fuente))) if (!m[1].endsWith('_')) nombres.push(m[1]);
  return nombres;
}

function leerFuentes() {
  const presentes = fs.readdirSync(DIR).filter((f) => f.endsWith('.gs') || f === 'Core.js');
  const faltan = presentes.filter((f) => !ORDEN.includes(f));
  if (faltan.length) throw new Error('Agrega a ORDEN en tools/empaquetar.js: ' + faltan.join(', '));
  return ORDEN.map((f) => ({ archivo: f, codigo: fs.readFileSync(path.join(DIR, f), 'utf8') }));
}

/** Código fuente de la fábrica (string). */
function codigoFabrica() {
  const fuentes = leerFuentes();
  const codigo = fuentes
    .map((f) => '// ---- ' + f.archivo + ' ----\n' + f.codigo.replace(/^if \(typeof module.*$/m, ''))
    .join('\n');
  const publicas = fuentes.flatMap((f) => (f.archivo === 'Core.js' ? [] : funcionesPublicas(f.codigo)));
  return [
    'function crearServidor(entorno) {',
    '  "use strict";',
    SERVICIOS.map((s) => '  var ' + s + ' = entorno.' + s + ';').join('\n'),
    '  var console = { error: function () { if (entorno.console) entorno.console.error.apply(null, arguments); }, log: function () { if (entorno.console) entorno.console.log.apply(null, arguments); } };',
    codigo,
    '  // Reloj del servidor controlado por el entorno simulado.',
    '  ahora_ = function () { return new Date(entorno.reloj()); };',
    '  return {',
    '    publicas: {' + publicas.map((n) => ' ' + n + ': ' + n).join(',') + ' },',
    '    privadas: { QuinielaCore: QuinielaCore, CONFIG: CONFIG, calcularPuntosGlobales_: calcularPuntosGlobales_, hashCodigo_: hashCodigo_, agregarFilas_: agregarFilas_, leerTabla_: leerTabla_, partidosResueltos_: partidosResueltos_ },',
    '  };',
    '}',
  ].join('\n');
}

module.exports = { codigoFabrica, funcionesPublicas, leerFuentes };

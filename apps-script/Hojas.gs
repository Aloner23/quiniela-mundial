/**
 * Acceso a la hoja de cálculo. Todas las lecturas y escrituras pasan por aquí
 * y todas son privadas (terminan en "_").
 */

function libro_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  var libro = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!libro) throw error_('CONFIGURACION');
  return libro;
}

function hoja_(nombre) {
  var h = libro_().getSheetByName(nombre);
  if (!h) throw error_('CONFIGURACION', 'Falta la hoja "' + nombre + '". Ejecuta setupQuiniela().');
  return h;
}

/** Lee una hoja como arreglo de objetos según CONFIG.ENCABEZADOS. */
function leerTabla_(nombre) {
  var h = hoja_(nombre);
  var cols = CONFIG.ENCABEZADOS[nombre];
  var ultima = h.getLastRow();
  if (ultima < 2) return [];
  var valores = h.getRange(2, 1, ultima - 1, cols.length).getValues();
  var out = [];
  for (var i = 0; i < valores.length; i++) {
    var fila = valores[i];
    if (fila.every(esVacio_)) continue;
    var o = { _fila: i + 2 };
    for (var j = 0; j < cols.length; j++) o[cols[j]] = fila[j];
    out.push(o);
  }
  return out;
}

function aFila_(nombre, obj) {
  return CONFIG.ENCABEZADOS[nombre].map(function (k) {
    var v = obj[k];
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? QuinielaCore.textoSeguroParaHoja(v) : v;
  });
}

function actualizarFila_(nombre, numFila, obj) {
  var cols = CONFIG.ENCABEZADOS[nombre].length;
  hoja_(nombre)
    .getRange(numFila, 1, 1, cols)
    .setValues([aFila_(nombre, obj)]);
}

function agregarFilas_(nombre, objs) {
  if (!objs.length) return;
  var h = hoja_(nombre);
  var cols = CONFIG.ENCABEZADOS[nombre].length;
  var filas = objs.map(function (o) {
    return aFila_(nombre, o);
  });
  h.getRange(h.getLastRow() + 1, 1, filas.length, cols).setValues(filas);
}

function esVacio_(v) {
  return v === '' || v === null || v === undefined;
}

/** Entero >= 0 leído de una celda, o null si la celda está vacía o no es entero. */
function entero_(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v);
  return null;
}

function esVerdadero_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE' || v === 1 || v === '1';
}

/**
 * Bitácora de cambios (hoja "Historial"): pronósticos con su versión previa,
 * resultados capturados, altas, inicios de sesión fallidos y accesos
 * denegados. Sólo el administrador la consulta.
 */
function registrarHistorial_(actor, accion, detalle) {
  var texto = typeof detalle === 'string' ? detalle : JSON.stringify(detalle);
  agregarFilas_(CONFIG.HOJAS.HISTORIAL, [
    { fecha: ahora_(), actor: String(actor || 'anónimo'), accion: accion, detalle: texto.slice(0, 1000) },
  ]);
}

/**
 * Cálculo de puntos y tabla general.
 *
 * La tabla se recalcula cada vez que el admin captura un resultado y se guarda
 * en dos lugares: la hoja "Tabla" (para consultarla desde Sheets) y
 * CacheService (para que getAppStatus responda rápido).
 */

var CLAVE_CACHE_TABLA_ = 'tabla:v1';

/**
 * Recalcula la tabla completa. Privada: sólo la llaman funciones del servidor
 * que ya validaron permisos.
 * @return {Array} filas de la tabla (incluyen participanteId para uso interno)
 */
function calcularPuntosGlobales_() {
  var cfg = configEfectiva_();
  var porId = {};
  partidosResueltos_().forEach(function (p) {
    if (QuinielaCore.tieneMarcador(p)) porId[p.id] = p;
  });
  var activos = participantes_().filter(function (p) {
    return p.activo;
  });
  var tabla = QuinielaCore.tablaGeneral(activos, pronosticos_(), porId, cfg.puntos);

  var h = hoja_(CONFIG.HOJAS.TABLA);
  var cols = CONFIG.ENCABEZADOS.Tabla;
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, cols.length).clearContent();
  if (tabla.length) {
    h.getRange(2, 1, tabla.length, cols.length).setValues(
      tabla.map(function (f) {
        return [f.posicion, QuinielaCore.textoSeguroParaHoja(f.nombre), f.puntos, f.exactos, f.aciertos, f.jugados];
      }),
    );
  }
  cache_().put(CLAVE_CACHE_TABLA_, JSON.stringify(tabla), CONFIG.TABLA_CACHE_SEG);
  return tabla;
}

/** Tabla desde caché o recalculada. */
function tablaActual_() {
  var json = cache_().get(CLAVE_CACHE_TABLA_);
  if (json) {
    try {
      return JSON.parse(json);
    } catch (e) {
      // caché corrupta: se recalcula
    }
  }
  return calcularPuntosGlobales_();
}

/**
 * API pública (sólo admin): fuerza el recálculo de la tabla.
 * En la versión original esta función no tenía guardia: cualquiera podía
 * dispararla desde la consola (hallazgo 5).
 */
function calcularPuntosGlobales(token) {
  return responder_(function () {
    var admin = requiereAdmin_(token);
    var tabla = calcularPuntosGlobales_();
    registrarHistorial_(admin.id, 'RECALCULO', tabla.length + ' participantes');
    return { participantes: tabla.length };
  });
}

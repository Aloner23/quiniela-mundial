/**
 * Estado de la app para el cliente.
 *
 * Hallazgo 2 de docs/SEGURIDAD.md: la primera versión de getAppStatus
 * devolvía la lista completa de participantes con sus correos y todos sus
 * pronósticos. Cualquiera podía abrir la consola y ver qué marcador había
 * puesto cada compañero antes del partido (y copiarlo).
 *
 * Ahora la respuesta se arma con listas blancas de campos:
 *   - Tabla general: posición, nombre visible y totales. Sin correos ni ids.
 *   - Pronósticos: sólo los del propio usuario.
 *   - Partidos: datos públicos del calendario y resultados oficiales.
 */

function getAppStatus(token) {
  return responder_(function () {
    var u = requiereUsuario_(token);
    var nombres = nombresEquipos_();
    var partidos = partidosResueltos_().map(function (p) {
      return partidoPublico_(p, nombres);
    });

    var mios = pronosticosDe_(u.id).map(function (p) {
      return {
        partidoId: p.partidoId,
        golesLocal: p.golesLocal,
        golesVisitante: p.golesVisitante,
        version: p.version,
        actualizado: p.actualizado instanceof Date ? p.actualizado.toISOString() : null,
      };
    });

    var tabla = tablaActual_().map(function (f) {
      return {
        posicion: f.posicion,
        nombre: f.nombre,
        puntos: f.puntos,
        exactos: f.exactos,
        aciertos: f.aciertos,
        jugados: f.jugados,
        esYo: f.participanteId === u.id,
      };
    });

    var cfg = configEfectiva_();
    return {
      version: APP_VERSION,
      cambios: CHANGELOG,
      servidorAhora: ahora_().toISOString(),
      usuario: perfilPublico_(u),
      reglas: { puntos: cfg.puntos, golesMax: cfg.golesMax, minutosCierre: cfg.minutosCierre },
      partidos: partidos,
      misPronosticos: mios,
      tabla: tabla,
    };
  });
}

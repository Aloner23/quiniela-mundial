/**
 * Captura de pronósticos.
 */

function pronosticos_() {
  return leerTabla_(CONFIG.HOJAS.PRONOSTICOS).map(function (p) {
    return {
      _fila: p._fila,
      participanteId: String(p.participanteId),
      partidoId: String(p.partidoId),
      golesLocal: entero_(p.golesLocal),
      golesVisitante: entero_(p.golesVisitante),
      version: Number(p.version) || 1,
      actualizado: p.actualizado,
    };
  });
}

function pronosticosDe_(participanteId) {
  return pronosticos_().filter(function (p) {
    return p.participanteId === participanteId;
  });
}

/**
 * API pública: guarda varios pronósticos de una sola vez.
 *
 * @param {string} token sesión (en modo DOMINIO se ignora)
 * @param {Array<{partidoId:string, golesLocal:number, golesVisitante:number}>} lote
 *
 * Defensas, en orden:
 *   1. Identidad del servidor: el participante sale de la sesión, nunca de un
 *      email o id que venga en el lote (hallazgo 1).
 *   2. Forma: arreglo de 1 a 120 elementos, ids válidos, sin duplicados.
 *   3. Goles: enteros de 0 a 30 (hallazgo 4).
 *   4. Estado: el partido existe, sus equipos están definidos y no ha
 *      empezado según el kickoff de la hoja (hallazgo 3).
 *   5. Concurrencia: LockService evita que dos envíos simultáneos dupliquen
 *      filas.
 * Cada pronóstico se acepta o rechaza por separado; la respuesta dice cuáles.
 */
function guardarPronosticosLote(token, lote) {
  return responder_(function () {
    var u = requiereUsuario_(token);
    var cfg = configEfectiva_();
    var v = QuinielaCore.validarLote(lote, cfg);
    if (v.error) throw error_(v.error);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) throw error_('OCUPADO');
    try {
      var partidos = {};
      partidosResueltos_().forEach(function (p) {
        partidos[p.id] = p;
      });
      var existentes = {};
      pronosticosDe_(u.id).forEach(function (p) {
        existentes[p.partidoId] = p;
      });

      var guardados = [];
      var rechazados = v.rechazados.slice();
      var nuevos = [];
      var cambios = [];
      var ahora = ahora_();

      v.items.forEach(function (it) {
        var partido = partidos[it.partidoId];
        if (!partido) return rechazados.push({ partidoId: it.partidoId, motivo: 'PARTIDO_INEXISTENTE' });
        if (!partidoEstaAbierto_(partido))
          return rechazados.push({ partidoId: it.partidoId, motivo: 'PARTIDO_CERRADO' });
        if (!partido.local || !partido.visitante) {
          return rechazados.push({ partidoId: it.partidoId, motivo: 'EQUIPOS_POR_DEFINIR' });
        }
        var previo = existentes[it.partidoId];
        if (previo && previo.golesLocal === it.golesLocal && previo.golesVisitante === it.golesVisitante) {
          return guardados.push(it.partidoId); // sin cambios
        }
        var fila = {
          participanteId: u.id,
          partidoId: it.partidoId,
          golesLocal: it.golesLocal,
          golesVisitante: it.golesVisitante,
          version: previo ? previo.version + 1 : 1,
          actualizado: ahora,
        };
        if (previo) {
          actualizarFila_(CONFIG.HOJAS.PRONOSTICOS, previo._fila, fila);
          cambios.push(
            it.partidoId +
              ': ' +
              previo.golesLocal +
              '-' +
              previo.golesVisitante +
              ' → ' +
              it.golesLocal +
              '-' +
              it.golesVisitante,
          );
        } else {
          nuevos.push(fila);
          cambios.push(it.partidoId + ': nuevo ' + it.golesLocal + '-' + it.golesVisitante);
        }
        guardados.push(it.partidoId);
      });
      agregarFilas_(CONFIG.HOJAS.PRONOSTICOS, nuevos);
      if (cambios.length) registrarHistorial_(u.id, 'PRONOSTICOS', cambios.join('; '));
      return {
        guardados: guardados,
        rechazados: rechazados.map(function (r) {
          return { partidoId: r.partidoId, motivo: r.motivo, mensaje: MENSAJES_[r.motivo] || r.motivo };
        }),
      };
    } finally {
      lock.releaseLock();
    }
  });
}

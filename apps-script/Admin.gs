/**
 * Funciones de administración.
 *
 * Todas son públicas por necesidad (el panel admin las llama con
 * google.script.run), así que TODAS empiezan con requiereAdmin_(token). La
 * prueba tests/seguridad.test.js recorre cada función admin* y verifica que un
 * participante normal reciba NO_AUTORIZADO sin que se escriba nada en la hoja.
 */

/**
 * Captura el resultado oficial de un partido.
 * @param {string} token
 * @param {string} partidoId
 * @param {number} golesLocal
 * @param {number} golesVisitante
 * @param {string} [avanza] código del equipo que avanzó por penales (sólo
 *   eliminatorias empatadas)
 */
function adminRegistrarResultado(token, partidoId, golesLocal, golesVisitante, avanza) {
  return responder_(function () {
    var admin = requiereAdmin_(token);
    var id = QuinielaCore.normalizarId(partidoId);
    var gl = QuinielaCore.normalizarGoles(golesLocal);
    var gv = QuinielaCore.normalizarGoles(golesVisitante);
    if (id === null) throw error_('FORMATO_INVALIDO');
    if (gl === null || gv === null) throw error_('GOLES_INVALIDOS');

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) throw error_('OCUPADO');
    try {
      var partido = null;
      partidosResueltos_().forEach(function (p) {
        if (p.id === id) partido = p;
      });
      if (!partido) throw error_('PARTIDO_INEXISTENTE');
      if (partidoEstaAbierto_(partido)) throw error_('PARTIDO_NO_INICIADO');
      if (!partido.local || !partido.visitante) throw error_('EQUIPOS_POR_DEFINIR');

      var quienAvanza = '';
      if (partido.fase !== 'GRUPOS') {
        if (gl === gv) {
          if (avanza !== partido.local && avanza !== partido.visitante) throw error_('AVANZA_INVALIDO');
          quienAvanza = avanza;
        } else {
          quienAvanza = gl > gv ? partido.local : partido.visitante;
        }
      }

      var crudo = null;
      partidosCrudos_().forEach(function (p) {
        if (p.id === id) crudo = p;
      });
      var anterior = QuinielaCore.tieneMarcador(crudo)
        ? crudo.golesLocal + '-' + crudo.golesVisitante
        : 'sin resultado';
      hoja_(CONFIG.HOJAS.PARTIDOS)
        .getRange(crudo._fila, CONFIG.ENCABEZADOS.Partidos.indexOf('golesLocal') + 1, 1, 3)
        .setValues([[gl, gv, quienAvanza]]);
      registrarHistorial_(
        admin.id,
        'RESULTADO',
        'Partido ' +
          id +
          ': ' +
          anterior +
          ' → ' +
          gl +
          '-' +
          gv +
          (quienAvanza ? ' (avanza ' + quienAvanza + ')' : ''),
      );
      var tabla = calcularPuntosGlobales_();
      return {
        partidoId: id,
        golesLocal: gl,
        golesVisitante: gv,
        avanza: quienAvanza || null,
        participantes: tabla.length,
      };
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * Da de alta a un participante y devuelve su código de acceso (sólo esta vez:
 * en la hoja se guarda el hash, nunca el código).
 */
function adminAltaParticipante(token, nombre, email) {
  return responder_(function () {
    var admin = requiereAdmin_(token);
    var n = QuinielaCore.nombreVisible(nombre);
    var e = QuinielaCore.normalizarEmail(email);
    if (!n || !e) throw error_('FORMATO_INVALIDO', 'Escribe un nombre (máx. 40 caracteres) y un correo válido.');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) throw error_('OCUPADO');
    try {
      var existentes = participantes_();
      if (
        existentes.some(function (p) {
          return p.email === e;
        })
      )
        throw error_('DUPLICADO', 'Ese correo ya está inscrito.');
      var id = 'P' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
      var codigo = generarCodigo_();
      agregarFilas_(CONFIG.HOJAS.PARTICIPANTES, [
        {
          id: id,
          nombre: n,
          email: e,
          codigoHash: hashCodigo_(id, codigo, configEfectiva_().sal),
          activo: true,
          creado: ahora_(),
        },
      ]);
      registrarHistorial_(admin.id, 'ALTA', id + ' ' + n);
      cache_().remove(CLAVE_CACHE_TABLA_);
      return { participante: { id: id, nombre: n, email: e }, codigo: codigo };
    } finally {
      lock.releaseLock();
    }
  });
}

/** Genera un código nuevo para un participante (el anterior deja de servir). */
function adminRestablecerCodigo(token, participanteId) {
  return responder_(function () {
    var admin = requiereAdmin_(token);
    var p = buscarPorId_(QuinielaCore.normalizarId(participanteId));
    if (!p) throw error_('FORMATO_INVALIDO', 'Participante no encontrado.');
    var codigo = generarCodigo_();
    p.codigoHash = hashCodigo_(p.id, codigo, configEfectiva_().sal);
    actualizarFila_(CONFIG.HOJAS.PARTICIPANTES, p._fila, p);
    registrarHistorial_(admin.id, 'NUEVO_CODIGO', p.id);
    return { participanteId: p.id, codigo: codigo };
  });
}

/** Lista de participantes con correo (sólo el admin ve correos). */
function adminParticipantes(token) {
  return responder_(function () {
    requiereAdmin_(token);
    return {
      participantes: participantes_().map(function (p) {
        return { id: p.id, nombre: p.nombre, email: p.email, activo: p.activo };
      }),
    };
  });
}

/** Últimos movimientos de la bitácora. */
function adminHistorial(token, limite) {
  return responder_(function () {
    requiereAdmin_(token);
    var n = Math.min(Math.max(Number(limite) || 50, 1), 200);
    var filas = leerTabla_(CONFIG.HOJAS.HISTORIAL).slice(-n).reverse();
    return {
      movimientos: filas.map(function (f) {
        return {
          fecha: f.fecha instanceof Date ? f.fecha.toISOString() : String(f.fecha),
          actor: String(f.actor),
          accion: String(f.accion),
          detalle: String(f.detalle),
        };
      }),
    };
  });
}

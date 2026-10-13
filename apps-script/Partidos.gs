/**
 * Lectura de partidos y equipos, y reglas de cierre.
 */

function equipos_() {
  return leerTabla_(CONFIG.HOJAS.EQUIPOS).map(function (e) {
    return { codigo: String(e.codigo), nombre: String(e.nombre), grupo: String(e.grupo || '') };
  });
}

/** Partidos tal como están en la hoja, con tipos normalizados. */
function partidosCrudos_() {
  return leerTabla_(CONFIG.HOJAS.PARTIDOS).map(function (p) {
    return {
      _fila: p._fila,
      id: String(p.id),
      fase: String(p.fase || 'GRUPOS'),
      grupo: String(p.grupo || ''),
      jornada: p.jornada === '' ? '' : Number(p.jornada),
      local: String(p.local || ''),
      visitante: String(p.visitante || ''),
      kickoff: QuinielaCore.parseKickoff(p.kickoff, CONFIG.DESFASE_ZONA_MIN),
      sede: String(p.sede || ''),
      golesLocal: entero_(p.golesLocal),
      golesVisitante: entero_(p.golesVisitante),
      avanza: String(p.avanza || ''),
    };
  });
}

/**
 * Partidos con los códigos de posición ("1C", "2F", "3ABCDF", "G74")
 * resueltos a equipos cuando ya se puede. Ver Bracket.gs.
 */
function partidosResueltos_() {
  return QuinielaCore.resolverCuadro(equipos_(), partidosCrudos_()).partidos;
}

/**
 * ¿Se puede capturar o editar el pronóstico? Se decide SOLO con el kickoff
 * guardado en la hoja y el reloj del servidor (hallazgo 3). El cliente
 * muestra una cuenta regresiva, pero nunca es quien decide.
 */
function partidoEstaAbierto_(partido) {
  return QuinielaCore.partidoEstaAbierto(partido.kickoff, ahora_(), configEfectiva_().minutosCierre);
}

/** Vista pública de un partido (sin campos internos). */
function partidoPublico_(p, nombres) {
  var cierre = p.kickoff ? new Date(p.kickoff.getTime() - configEfectiva_().minutosCierre * 60000) : null;
  return {
    id: p.id,
    fase: p.fase,
    grupo: p.grupo,
    jornada: p.jornada,
    local: p.local || null,
    visitante: p.visitante || null,
    nombreLocal: p.local ? nombres[p.local] || p.local : QuinielaCore.etiquetaCodigo(p.codigoLocal),
    nombreVisitante: p.visitante ? nombres[p.visitante] || p.visitante : QuinielaCore.etiquetaCodigo(p.codigoVisitante),
    codigoLocal: p.codigoLocal || p.local,
    codigoVisitante: p.codigoVisitante || p.visitante,
    kickoff: p.kickoff ? p.kickoff.toISOString() : null,
    cierre: cierre ? cierre.toISOString() : null,
    sede: p.sede,
    abierto: partidoEstaAbierto_(p),
    golesLocal: p.golesLocal,
    golesVisitante: p.golesVisitante,
    avanza: p.avanza || null,
  };
}

function nombresEquipos_() {
  var m = {};
  equipos_().forEach(function (e) {
    m[e.codigo] = e.nombre;
  });
  return m;
}

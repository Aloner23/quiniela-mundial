/**
 * QuinielaCore: lógica de negocio pura.
 *
 * Este archivo no toca ningún servicio de Apps Script (SpreadsheetApp,
 * CacheService, Session...). Por eso corre igual en tres lugares:
 *   1. En Apps Script, como un archivo .gs más (clasp lo sube tal cual).
 *   2. En Node, con `require('./Core.js')`, para las pruebas automatizadas.
 *   3. En el navegador, dentro del demo estático.
 *
 * Todo vive dentro de un objeto. En Apps Script sólo las *funciones* de nivel
 * superior son invocables con google.script.run; los métodos de un objeto no.
 * Así, nada de lo que hay aquí se convierte por accidente en API pública.
 */
var QuinielaCore = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Reglas de puntuación
  // ---------------------------------------------------------------------------

  /**
   * Puntos por pronóstico (configurables desde Script Properties):
   *   - EXACTO:    acertar el marcador exacto (incluye acertar el resultado).
   *   - RESULTADO: acertar ganador o empate sin el marcador exacto.
   * Los puntos no se suman: un exacto vale EXACTO, no EXACTO + RESULTADO.
   * En eliminatorias cuenta el marcador al final del tiempo extra; los penales
   * sólo deciden quién avanza en el bracket.
   */
  var PUNTOS_DEFECTO = { EXACTO: 3, RESULTADO: 1 };

  var GOLES_MIN = 0;
  var GOLES_MAX = 30;

  var MOTIVOS = {
    NO_AUTENTICADO: 'NO_AUTENTICADO',
    NO_AUTORIZADO: 'NO_AUTORIZADO',
    FORMATO_INVALIDO: 'FORMATO_INVALIDO',
    LOTE_DEMASIADO_GRANDE: 'LOTE_DEMASIADO_GRANDE',
    GOLES_INVALIDOS: 'GOLES_INVALIDOS',
    PARTIDO_INEXISTENTE: 'PARTIDO_INEXISTENTE',
    PARTIDO_CERRADO: 'PARTIDO_CERRADO',
    EQUIPOS_POR_DEFINIR: 'EQUIPOS_POR_DEFINIR',
    DUPLICADO: 'DUPLICADO',
    AVANZA_INVALIDO: 'AVANZA_INVALIDO',
    CREDENCIALES_INVALIDAS: 'CREDENCIALES_INVALIDAS',
    DEMASIADOS_INTENTOS: 'DEMASIADOS_INTENTOS',
    OCUPADO: 'OCUPADO',
  };

  function signo(a, b) {
    return a > b ? 1 : a < b ? -1 : 0;
  }

  function tieneMarcador(p) {
    return !!p && Number.isInteger(p.golesLocal) && Number.isInteger(p.golesVisitante);
  }

  /**
   * @param {{golesLocal:number, golesVisitante:number}} pron
   * @param {{golesLocal:number, golesVisitante:number}} real
   * @param {{EXACTO:number, RESULTADO:number}} [puntos]
   * @return {{puntos:number, exacto:boolean, acierto:boolean}}
   */
  function puntuarPronostico(pron, real, puntos) {
    var P = puntos || PUNTOS_DEFECTO;
    var r = { puntos: 0, exacto: false, acierto: false };
    if (!tieneMarcador(pron) || !tieneMarcador(real)) return r;
    r.exacto = pron.golesLocal === real.golesLocal && pron.golesVisitante === real.golesVisitante;
    r.acierto = signo(pron.golesLocal, pron.golesVisitante) === signo(real.golesLocal, real.golesVisitante);
    if (r.exacto) r.puntos = P.EXACTO;
    else if (r.acierto) r.puntos = P.RESULTADO;
    return r;
  }

  /**
   * Tabla general de la quiniela.
   * Orden: puntos, luego marcadores exactos, luego resultados acertados.
   * Un empate total comparte posición (1, 2, 2, 4); el nombre sólo se usa
   * para que el orden en pantalla sea estable.
   *
   * @param {Array<{id:string, nombre:string}>} participantes
   * @param {Array<{participanteId:string, partidoId:string, golesLocal:number, golesVisitante:number}>} pronosticos
   * @param {Object<string, {golesLocal:number, golesVisitante:number}>} partidosPorId
   */
  function tablaGeneral(participantes, pronosticos, partidosPorId, puntos) {
    var filas = {};
    participantes.forEach(function (p) {
      filas[p.id] = { participanteId: p.id, nombre: p.nombre, puntos: 0, exactos: 0, aciertos: 0, jugados: 0 };
    });
    pronosticos.forEach(function (pr) {
      var fila = filas[pr.participanteId];
      var partido = partidosPorId[pr.partidoId];
      if (!fila || !tieneMarcador(partido)) return;
      var r = puntuarPronostico(pr, partido, puntos);
      fila.puntos += r.puntos;
      fila.jugados += 1;
      if (r.exacto) fila.exactos += 1;
      if (r.acierto) fila.aciertos += 1;
    });
    var lista = Object.keys(filas).map(function (k) {
      return filas[k];
    });
    lista.sort(function (a, b) {
      return (
        b.puntos - a.puntos ||
        b.exactos - a.exactos ||
        b.aciertos - a.aciertos ||
        String(a.nombre).localeCompare(String(b.nombre), 'es')
      );
    });
    lista.forEach(function (cur, i) {
      var prev = lista[i - 1];
      var empata = prev && prev.puntos === cur.puntos && prev.exactos === cur.exactos && prev.aciertos === cur.aciertos;
      cur.posicion = empata ? prev.posicion : i + 1;
    });
    return lista;
  }

  // ---------------------------------------------------------------------------
  // Validación de entradas (todo lo que llega del cliente es no confiable)
  // ---------------------------------------------------------------------------

  var RE_ID = /^[A-Za-z0-9_-]{1,16}$/;
  var RE_GOLES_TEXTO = /^\s*\d{1,2}\s*$/;
  var RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /**
   * Goles válidos: enteros entre 0 y 30. Acepta número o texto de 1-2 dígitos
   * (un <input> puede mandar "2"). Rechaza 311, -1, 1.5, "1e1", NaN, null,
   * Infinity, objetos y arreglos.
   * @return {number|null}
   */
  function normalizarGoles(valor, min, max) {
    var lo = min === undefined ? GOLES_MIN : min;
    var hi = max === undefined ? GOLES_MAX : max;
    var n;
    if (typeof valor === 'number') n = valor;
    else if (typeof valor === 'string' && RE_GOLES_TEXTO.test(valor)) n = Number(valor);
    else return null;
    if (!Number.isInteger(n) || n < lo || n > hi) return null;
    return n;
  }

  function normalizarId(valor) {
    if (typeof valor === 'number' && Number.isInteger(valor) && valor >= 0) return String(valor);
    if (typeof valor === 'string' && RE_ID.test(valor)) return valor;
    return null;
  }

  /**
   * Valida la *forma* de un lote de pronósticos. No consulta la hoja: las
   * reglas que dependen del estado (existe, está abierto) se aplican después.
   * Sólo se copian los campos conocidos: si el cliente manda `email` o
   * `participanteId` dentro del lote, se descartan aquí.
   *
   * @return {{error: (string|null), items: Array, rechazados: Array}}
   */
  function validarLote(lote, opciones) {
    var o = opciones || {};
    var maxLote = o.maxLote || 120;
    if (!Array.isArray(lote) || lote.length === 0) {
      return { error: MOTIVOS.FORMATO_INVALIDO, items: [], rechazados: [] };
    }
    if (lote.length > maxLote) return { error: MOTIVOS.LOTE_DEMASIADO_GRANDE, items: [], rechazados: [] };

    var vistos = {};
    var items = [];
    var rechazados = [];
    for (var i = 0; i < lote.length; i++) {
      var it = lote[i];
      if (!it || typeof it !== 'object' || Array.isArray(it)) {
        rechazados.push({ partidoId: null, motivo: MOTIVOS.FORMATO_INVALIDO });
        continue;
      }
      var id = normalizarId(it.partidoId);
      if (id === null) {
        rechazados.push({ partidoId: null, motivo: MOTIVOS.FORMATO_INVALIDO });
        continue;
      }
      if (vistos[id]) {
        rechazados.push({ partidoId: id, motivo: MOTIVOS.DUPLICADO });
        continue;
      }
      vistos[id] = true;
      var gl = normalizarGoles(it.golesLocal, o.golesMin, o.golesMax);
      var gv = normalizarGoles(it.golesVisitante, o.golesMin, o.golesMax);
      if (gl === null || gv === null) {
        rechazados.push({ partidoId: id, motivo: MOTIVOS.GOLES_INVALIDOS });
        continue;
      }
      items.push({ partidoId: id, golesLocal: gl, golesVisitante: gv });
    }
    return { error: null, items: items, rechazados: rechazados };
  }

  function normalizarEmail(valor) {
    if (typeof valor !== 'string') return null;
    var e = valor.trim().toLowerCase();
    if (e.length > 254 || !RE_EMAIL.test(e)) return null;
    return e;
  }

  /** ¿El correo está en la lista blanca de administradores (CSV)? */
  function esAdmin(email, listaCsv) {
    var e = normalizarEmail(email);
    if (!e) return false;
    return (
      String(listaCsv || '')
        .split(',')
        .map(function (x) {
          return x.trim().toLowerCase();
        })
        .indexOf(e) !== -1
    );
  }

  /** Nombre visible: colapsa espacios, 1 a 40 caracteres. */
  function nombreVisible(valor) {
    if (typeof valor !== 'string') return null;
    var n = valor.replace(/\s+/g, ' ').trim();
    if (!n || n.length > 40) return null;
    return n;
  }

  /**
   * Evita inyección de fórmulas en Sheets: un texto que empieza con = + - @
   * se guarda como literal.
   */
  function textoSeguroParaHoja(valor) {
    var s = String(valor === null || valor === undefined ? '' : valor);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }

  // ---------------------------------------------------------------------------
  // Fechas y cierre de partidos
  // ---------------------------------------------------------------------------

  var RE_FECHA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

  /**
   * Convierte el kickoff que viene de la hoja en un instante absoluto.
   * - Date (lo que devuelve getValues() para celdas con fecha): se usa tal cual.
   * - Texto "yyyy-MM-dd HH:mm": se interpreta con el desfase de la zona de la
   *   quiniela (por defecto -06:00, hora del centro de México, sin horario de
   *   verano desde 2022).
   * - Cualquier otra cosa: null.
   */
  function parseKickoff(valor, desfaseMin) {
    if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
    if (typeof valor !== 'string') return null;
    var m = RE_FECHA_LOCAL.exec(valor.trim());
    if (!m) return null;
    var off = desfaseMin === undefined ? -360 : desfaseMin;
    var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - off * 60000;
    var d = new Date(utc);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * ¿Se puede todavía capturar o editar el pronóstico de este partido?
   * Falla cerrado: si el kickoff o el reloj no son fechas válidas, está cerrado.
   * @param {Date} kickoff
   * @param {Date} ahora reloj del *servidor* (nunca el del cliente)
   * @param {number} [minutosCierre] minutos antes del inicio en que se cierra
   */
  function partidoEstaAbierto(kickoff, ahora, minutosCierre) {
    if (!(kickoff instanceof Date) || isNaN(kickoff.getTime())) return false;
    if (!(ahora instanceof Date) || isNaN(ahora.getTime())) return false;
    return ahora.getTime() < kickoff.getTime() - (minutosCierre || 0) * 60000;
  }

  // ---------------------------------------------------------------------------
  // Formato 2026: 48 equipos, 12 grupos (A-L), 8 mejores terceros, 32avos
  // ---------------------------------------------------------------------------

  var GRUPOS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  var TERCEROS_CLASIFICAN = 8;
  var FASES = ['GRUPOS', 'R32', 'R16', 'QF', 'SF', '3P', 'FINAL'];
  var NOMBRE_FASE = {
    GRUPOS: 'Fase de grupos',
    R32: 'Dieciseisavos',
    R16: 'Octavos',
    QF: 'Cuartos',
    SF: 'Semifinales',
    '3P': 'Tercer lugar',
    FINAL: 'Final',
  };

  /**
   * Cuadro de eliminatorias del Mundial 2026 (partidos 73 a 104), con los
   * códigos de posición que usa la hoja:
   *   "1C"      ganador del grupo C
   *   "2F"      segundo del grupo F
   *   "3ABCDF"  uno de los mejores terceros, de alguno de los grupos A, B, C, D o F
   *   "G74"     ganador del partido 74
   *   "P101"    perdedor del partido 101
   * Basado en el calendario publicado por FIFA; conviene verificarlo contra la
   * fuente oficial antes de usarlo en un torneo real.
   */
  var CUADRO_2026 = [
    ['73', 'R32', '2A', '2B'],
    ['74', 'R32', '1E', '3ABCDF'],
    ['75', 'R32', '1F', '2C'],
    ['76', 'R32', '1C', '2F'],
    ['77', 'R32', '1I', '3CDFGH'],
    ['78', 'R32', '2E', '2I'],
    ['79', 'R32', '1A', '3CEFHI'],
    ['80', 'R32', '1L', '3EHIJK'],
    ['81', 'R32', '1D', '3BEFIJ'],
    ['82', 'R32', '1G', '3AEHIJ'],
    ['83', 'R32', '2K', '2L'],
    ['84', 'R32', '1H', '2J'],
    ['85', 'R32', '1B', '3EFGIJ'],
    ['86', 'R32', '1J', '2H'],
    ['87', 'R32', '1K', '3DEIJL'],
    ['88', 'R32', '2D', '2G'],
    ['89', 'R16', 'G74', 'G77'],
    ['90', 'R16', 'G73', 'G75'],
    ['91', 'R16', 'G76', 'G78'],
    ['92', 'R16', 'G79', 'G80'],
    ['93', 'R16', 'G83', 'G84'],
    ['94', 'R16', 'G81', 'G82'],
    ['95', 'R16', 'G86', 'G88'],
    ['96', 'R16', 'G85', 'G87'],
    ['97', 'QF', 'G89', 'G90'],
    ['98', 'QF', 'G93', 'G94'],
    ['99', 'QF', 'G91', 'G92'],
    ['100', 'QF', 'G95', 'G96'],
    ['101', 'SF', 'G97', 'G98'],
    ['102', 'SF', 'G99', 'G100'],
    ['103', '3P', 'P101', 'P102'],
    ['104', 'FINAL', 'G101', 'G102'],
  ].map(function (r) {
    return { id: r[0], fase: r[1], local: r[2], visitante: r[3] };
  });

  var RE_CODIGO_GRUPO = /^([12])([A-L])$/;
  var RE_CODIGO_TERCERO = /^3([A-L]{2,12})$/;
  var RE_CODIGO_PARTIDO = /^([GP])(\d{1,3})$/;

  function esCodigoPosicion(codigo) {
    var c = String(codigo || '');
    return RE_CODIGO_GRUPO.test(c) || RE_CODIGO_TERCERO.test(c) || RE_CODIGO_PARTIDO.test(c);
  }

  /** Texto corto para mostrar un código sin resolver: "1C" -> "1.º C". */
  function etiquetaCodigo(codigo) {
    var c = String(codigo || '');
    var m;
    if ((m = RE_CODIGO_GRUPO.exec(c))) return m[1] + '.º ' + m[2];
    if ((m = RE_CODIGO_TERCERO.exec(c))) return '3.º ' + m[1].split('').join('/');
    if ((m = RE_CODIGO_PARTIDO.exec(c))) return (m[1] === 'G' ? 'Gan. ' : 'Perd. ') + m[2];
    return c;
  }

  /**
   * Tabla de un grupo. Desempate: puntos -> diferencia de goles -> goles a
   * favor -> código del equipo (sólo para que el orden sea determinista; el
   * reglamento real sigue con enfrentamiento directo y juego limpio, que el
   * admin puede reflejar corrigiendo el orden en la hoja si hiciera falta).
   *
   * @param {string[]} equipos códigos de los equipos del grupo
   * @param {Array} partidos partidos del grupo (con o sin resultado)
   */
  function tablaGrupo(equipos, partidos) {
    var t = {};
    equipos.forEach(function (c) {
      t[c] = { equipo: c, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, dg: 0, pts: 0 };
    });
    var jugados = 0;
    partidos.forEach(function (m) {
      if (!tieneMarcador(m) || !t[m.local] || !t[m.visitante]) return;
      jugados++;
      var a = t[m.local];
      var b = t[m.visitante];
      a.pj++;
      b.pj++;
      a.gf += m.golesLocal;
      a.gc += m.golesVisitante;
      b.gf += m.golesVisitante;
      b.gc += m.golesLocal;
      var s = signo(m.golesLocal, m.golesVisitante);
      if (s > 0) {
        a.g++;
        b.p++;
        a.pts += 3;
      } else if (s < 0) {
        b.g++;
        a.p++;
        b.pts += 3;
      } else {
        a.e++;
        b.e++;
        a.pts++;
        b.pts++;
      }
    });
    var filas = Object.keys(t).map(function (k) {
      var f = t[k];
      f.dg = f.gf - f.gc;
      return f;
    });
    filas.sort(compararPosicion);
    filas.forEach(function (f, i) {
      f.posicion = i + 1;
    });
    var esperados = (equipos.length * (equipos.length - 1)) / 2;
    return { filas: filas, completo: jugados >= esperados && esperados > 0, jugados: jugados };
  }

  function compararPosicion(a, b) {
    return b.pts - a.pts || b.dg - a.dg || b.gf - a.gf || String(a.equipo).localeCompare(String(b.equipo));
  }

  /**
   * Los 8 mejores terceros, con el mismo criterio que los grupos.
   * @param {Object<string, {filas:Array}>} tablas tabla por grupo
   */
  function mejoresTerceros(tablas, n) {
    var terceros = [];
    Object.keys(tablas).forEach(function (g) {
      var f = tablas[g].filas[2];
      if (f) terceros.push(Object.assign({ grupo: g }, f));
    });
    terceros.sort(compararPosicion);
    terceros.forEach(function (f, i) {
      f.rankTerceros = i + 1;
      f.clasifica = i < (n || TERCEROS_CLASIFICAN);
    });
    return terceros;
  }

  /**
   * Asigna los grupos de los terceros clasificados a los ocho cruces "3XXXXX".
   *
   * FIFA publica una tabla con las 495 combinaciones posibles. Aquí se resuelve
   * como un emparejamiento: cada cruce acepta terceros de ciertos grupos, y se
   * busca (en orden de partido y orden alfabético) la primera asignación en la
   * que todos quedan cubiertos. Si se configura `tablaOficial`
   * ({ "ABCDEFGH": { "74": "C", ... } }) se usa esa tabla en su lugar.
   *
   * @param {string[]} gruposClasificados p. ej. ['A','B','C','D','E','F','G','H']
   * @param {Array<{id:string, opciones:string}>} cruces
   * @return {Object<string,string>|null} partidoId -> grupo
   */
  function asignarTerceros(gruposClasificados, cruces, tablaOficial) {
    var clave = gruposClasificados.slice().sort().join('');
    if (tablaOficial && tablaOficial[clave]) return Object.assign({}, tablaOficial[clave]);
    var orden = cruces.slice().sort(function (a, b) {
      return Number(a.id) - Number(b.id);
    });
    var usados = {};
    var asignacion = {};
    function buscar(i) {
      if (i === orden.length) return true;
      var cruce = orden[i];
      var opciones = cruce.opciones.split('').sort();
      for (var k = 0; k < opciones.length; k++) {
        var g = opciones[k];
        if (usados[g] || clave.indexOf(g) === -1) continue;
        usados[g] = true;
        asignacion[cruce.id] = g;
        if (buscar(i + 1)) return true;
        delete usados[g];
        delete asignacion[cruce.id];
      }
      return false;
    }
    return buscar(0) ? asignacion : null;
  }

  /** Quién avanzó en una eliminatoria ya jugada (o null). */
  function ganadorEliminatoria(m) {
    if (!tieneMarcador(m) || !m.local || !m.visitante) return null;
    if (m.golesLocal > m.golesVisitante) return m.local;
    if (m.golesVisitante > m.golesLocal) return m.visitante;
    return m.avanza === m.local || m.avanza === m.visitante ? m.avanza : null;
  }

  function perdedorEliminatoria(m) {
    var g = ganadorEliminatoria(m);
    if (!g) return null;
    return g === m.local ? m.visitante : m.local;
  }

  /**
   * Resuelve los códigos de posición del cuadro a equipos concretos.
   *
   * Un código "1C"/"2F" se resuelve cuando el grupo terminó; "3XXXXX" cuando
   * terminaron los 12 grupos; "G74"/"P74" cuando el partido 74 tiene ganador.
   * Con `provisional: true` se resuelven también los grupos incompletos con la
   * tabla actual (sirve para mostrar "si hoy terminara la fase de grupos...").
   *
   * @param {Array<{codigo:string, grupo:string}>} equipos
   * @param {Array} partidos todos los partidos, con `local`/`visitante` crudos
   * @return {{partidos:Array, tablas:Object, terceros:Array, gruposCompletos:boolean}}
   */
  function resolverCuadro(equipos, partidos, opciones) {
    var o = opciones || {};
    var porGrupo = {};
    equipos.forEach(function (e) {
      if (!e.grupo) return;
      (porGrupo[e.grupo] = porGrupo[e.grupo] || []).push(e.codigo);
    });
    var tablas = {};
    Object.keys(porGrupo)
      .sort()
      .forEach(function (g) {
        var delGrupo = partidos.filter(function (m) {
          return m.fase === 'GRUPOS' && m.grupo === g;
        });
        tablas[g] = tablaGrupo(porGrupo[g], delGrupo);
      });
    var grupos = Object.keys(tablas);
    var gruposCompletos =
      grupos.length > 0 &&
      grupos.every(function (g) {
        return tablas[g].completo;
      });
    var terceros = mejoresTerceros(tablas, o.tercerosClasifican);

    var cruces = [];
    partidos.forEach(function (m) {
      [m.local, m.visitante].forEach(function (c) {
        var t = RE_CODIGO_TERCERO.exec(String(c || ''));
        if (t) cruces.push({ id: String(m.id), opciones: t[1] });
      });
    });
    var asignacion = null;
    if (cruces.length && (gruposCompletos || o.provisional)) {
      var clasificados = terceros
        .filter(function (f) {
          return f.clasifica;
        })
        .map(function (f) {
          return f.grupo;
        });
      asignacion = asignarTerceros(clasificados, cruces, o.tablaTerceros);
    }

    var porId = {};
    var resueltos = partidos.map(function (m) {
      var r = Object.assign({}, m, { codigoLocal: m.local, codigoVisitante: m.visitante });
      porId[String(m.id)] = r;
      return r;
    });

    function resolver(codigo, partidoId) {
      var c = String(codigo || '');
      var m;
      if ((m = RE_CODIGO_GRUPO.exec(c))) {
        var tg = tablas[m[2]];
        if (!tg || !(tg.completo || o.provisional)) return null;
        var fila = tg.filas[Number(m[1]) - 1];
        return fila ? fila.equipo : null;
      }
      if (RE_CODIGO_TERCERO.test(c)) {
        if (!asignacion || !asignacion[partidoId]) return null;
        var tabla = tablas[asignacion[partidoId]];
        return tabla && tabla.filas[2] ? tabla.filas[2].equipo : null;
      }
      if ((m = RE_CODIGO_PARTIDO.exec(c))) {
        var previo = porId[m[2]];
        if (!previo) return null;
        return m[1] === 'G' ? ganadorEliminatoria(previo) : perdedorEliminatoria(previo);
      }
      return c || null; // ya es un código de equipo
    }

    // Los partidos llegan en orden de id, así que un "G74" siempre se resuelve
    // después del 74. Se ordena por si la hoja viene desordenada.
    resueltos
      .slice()
      .sort(function (a, b) {
        return Number(a.id) - Number(b.id);
      })
      .forEach(function (r) {
        if (r.fase === 'GRUPOS') return;
        r.local = resolver(r.codigoLocal, String(r.id));
        r.visitante = resolver(r.codigoVisitante, String(r.id));
        r.provisional = !!o.provisional && !gruposCompletos;
      });

    return { partidos: resueltos, tablas: tablas, terceros: terceros, gruposCompletos: gruposCompletos };
  }

  /**
   * Calendario de ejemplo con el formato 2026: 72 partidos de grupos en tres
   * jornadas y los 32 de eliminatorias, repartidos en horarios fijos por día.
   * Fechas, horarios y sedes son ilustrativos (no el calendario oficial).
   *
   * @param {Array<{codigo:string, grupo:string}>} equipos 48 equipos, 4 por grupo
   * @param {string} fechaInicio "yyyy-MM-dd" del primer día
   * @param {{horarios?:number[], desfaseMin?:number}} [opciones]
   */
  function generarCalendario(equipos, fechaInicio, opciones) {
    var o = opciones || {};
    var horarios = o.horarios || [11, 14, 17, 20];
    var desfase = o.desfaseMin === undefined ? -360 : o.desfaseMin;
    var sedes = [
      'Ciudad de México',
      'Guadalajara',
      'Monterrey',
      'Toronto',
      'Vancouver',
      'Los Ángeles',
      'Dallas',
      'Houston',
      'Atlanta',
      'Miami',
      'Nueva York/Nueva Jersey',
      'Boston',
      'Filadelfia',
      'Kansas City',
      'Seattle',
      'San Francisco',
    ];
    var base = parseKickoff(fechaInicio + ' 00:00', desfase);
    if (!base) throw new Error('fechaInicio inválida');
    var dia = 0;
    var slot = 0;
    function siguiente(cambioDeFase) {
      if (cambioDeFase) {
        // Un día de descanso entre fases.
        if (slot > 0) dia++;
        slot = 0;
        dia++;
      }
      var d = new Date(base.getTime() + dia * 86400000 + horarios[slot] * 3600000);
      slot++;
      if (slot === horarios.length) {
        slot = 0;
        dia++;
      }
      return d;
    }
    var porGrupo = {};
    equipos.forEach(function (e) {
      (porGrupo[e.grupo] = porGrupo[e.grupo] || []).push(e.codigo);
    });
    var jornadas = [
      [
        [0, 1],
        [2, 3],
      ],
      [
        [0, 2],
        [3, 1],
      ],
      [
        [3, 0],
        [1, 2],
      ],
    ];
    var out = [];
    var n = 0;
    jornadas.forEach(function (pares, j) {
      GRUPOS.forEach(function (g) {
        var eq = porGrupo[g] || [];
        pares.forEach(function (par) {
          n++;
          out.push({
            id: String(n),
            fase: 'GRUPOS',
            grupo: g,
            jornada: j + 1,
            local: eq[par[0]],
            visitante: eq[par[1]],
            kickoff: siguiente(false),
            sede: sedes[n % sedes.length],
          });
        });
      });
    });
    var faseAnterior = 'GRUPOS';
    CUADRO_2026.forEach(function (c) {
      var cambio = c.fase !== faseAnterior;
      faseAnterior = c.fase;
      out.push({
        id: c.id,
        fase: c.fase,
        grupo: '',
        jornada: '',
        local: c.local,
        visitante: c.visitante,
        kickoff: siguiente(cambio),
        sede: sedes[Number(c.id) % sedes.length],
      });
    });
    return out;
  }

  return {
    PUNTOS_DEFECTO: PUNTOS_DEFECTO,
    GOLES_MIN: GOLES_MIN,
    GOLES_MAX: GOLES_MAX,
    MOTIVOS: MOTIVOS,
    GRUPOS: GRUPOS,
    FASES: FASES,
    NOMBRE_FASE: NOMBRE_FASE,
    CUADRO_2026: CUADRO_2026,
    TERCEROS_CLASIFICAN: TERCEROS_CLASIFICAN,
    puntuarPronostico: puntuarPronostico,
    tablaGeneral: tablaGeneral,
    tieneMarcador: tieneMarcador,
    normalizarGoles: normalizarGoles,
    normalizarId: normalizarId,
    validarLote: validarLote,
    normalizarEmail: normalizarEmail,
    esAdmin: esAdmin,
    nombreVisible: nombreVisible,
    textoSeguroParaHoja: textoSeguroParaHoja,
    parseKickoff: parseKickoff,
    partidoEstaAbierto: partidoEstaAbierto,
    esCodigoPosicion: esCodigoPosicion,
    etiquetaCodigo: etiquetaCodigo,
    tablaGrupo: tablaGrupo,
    mejoresTerceros: mejoresTerceros,
    asignarTerceros: asignarTerceros,
    ganadorEliminatoria: ganadorEliminatoria,
    perdedorEliminatoria: perdedorEliminatoria,
    resolverCuadro: resolverCuadro,
    generarCalendario: generarCalendario,
  };
})();

// Node / Vitest. En Apps Script `module` no existe y esta línea no hace nada.
if (typeof module !== 'undefined' && module.exports) module.exports = QuinielaCore;

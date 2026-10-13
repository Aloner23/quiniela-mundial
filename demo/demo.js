/**
 * Demo estática de la quiniela.
 *
 * No hay backend: este archivo crea una hoja de cálculo en memoria
 * (GasMock), carga el código REAL del servidor (servidor.js, generado desde
 * apps-script/*.gs) y reemplaza google.script.run por un adaptador que llama
 * a esas mismas funciones. Lo que ves en pantalla pasa por las mismas
 * validaciones que en Apps Script.
 *
 * Todos los participantes, correos y pronósticos son ficticios.
 */
(function () {
  'use strict';

  var CLAVE_MOMENTO = 'quiniela.demo.momento';
  var SAL = 'sal-demo';

  var MOMENTOS = {
    grupos: {
      nombre: 'Jornada 3 de grupos',
      ahora: '2026-06-23T19:20:00Z', // 13:20 en Ciudad de México
    },
    dieciseisavos: {
      nombre: 'Inicio de dieciseisavos',
      ahora: '2026-06-30T17:40:00Z',
    },
    final: {
      nombre: 'Día de la final',
      ahora: '2026-07-14T15:10:00Z',
    },
  };

  var CUENTAS = {
    participante: { email: 'tu@example.com', codigo: 'DEMO2026', nombre: 'Tú (demo)', id: 'PDEMO' },
    admin: { email: 'admin@example.com', codigo: 'ADMIN2026', nombre: 'Admin Demo', id: 'PADMIN' },
  };

  var NOMBRES = [
    'Alejandra V.',
    'Bruno S.',
    'Camila R.',
    'Diego H.',
    'Elena M.',
    'Fernando C.',
    'Gabriela L.',
    'Héctor P.',
    'Isabel N.',
    'Javier O.',
    'Karla D.',
    'Luis A.',
    'Mariana T.',
    'Nicolás G.',
    'Olivia F.',
    'Pablo E.',
    'Regina B.',
    'Santiago Q.',
    'Tania J.',
    'Ulises K.',
    'Valeria Z.',
    'Andrés Y.',
    'Brenda W.',
    'Carlos X.',
    'Daniela U.',
    'Emilio I.',
    'Fernanda S.',
    'Gerardo M.',
  ];

  // ---------------------------------------------------------------------------
  // Generador pseudoaleatorio con semilla: la demo siempre se ve igual.
  // ---------------------------------------------------------------------------
  function prng(semilla) {
    var a = semilla >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Goles con una distribución parecida a la real (muchos 0, 1 y 2). */
  function goles(azar, sesgo) {
    var tabla = [0.3, 0.36, 0.2, 0.09, 0.04, 0.01];
    var r = azar() * (1 + (sesgo || 0) * 0.15);
    for (var i = 0; i < tabla.length; i++) {
      r -= tabla[i];
      if (r < 0) return i;
    }
    return tabla.length - 1;
  }

  // ---------------------------------------------------------------------------
  // Arranque del servidor simulado
  // ---------------------------------------------------------------------------
  var momentoClave = 'grupos';
  try {
    var guardado = localStorage.getItem(CLAVE_MOMENTO);
    if (guardado && MOMENTOS[guardado]) momentoClave = guardado;
  } catch {
    /* sin almacenamiento: se usa el momento por defecto */
  }
  var momento = MOMENTOS[momentoClave];
  var inicioReal = Date.now();
  var ancla = Date.parse(momento.ahora);

  var entorno = GasMock.crear({
    propiedades: { ADMIN_EMAILS: CUENTAS.admin.email, MODO_IDENTIDAD: 'TOKEN', SAL_CODIGOS: SAL },
    // El reloj del servidor avanza en tiempo real a partir del momento elegido.
    reloj: function () {
      return ancla + (Date.now() - inicioReal);
    },
  });
  var servidor = crearServidor(entorno);
  var api = servidor.publicas;
  var priv = servidor.privadas;

  sembrar();

  function sembrar() {
    entorno.sesion.activo = entorno.sesion.dueno;
    api.setupQuiniela();
    entorno.sesion.activo = '';

    var participantes = [CUENTAS.participante, CUENTAS.admin]
      .map(function (c) {
        return { id: c.id, nombre: c.nombre, email: c.email, codigo: c.codigo };
      })
      .concat(
        NOMBRES.map(function (n, i) {
          return {
            id: 'P' + String(i + 1).padStart(3, '0'),
            nombre: n,
            email: 'participante' + (i + 1) + '@example.com',
            codigo: 'X' + Math.random().toString(36).slice(2, 10).toUpperCase(),
          };
        }),
      );
    priv.agregarFilas_(
      'Participantes',
      participantes.map(function (p) {
        return {
          id: p.id,
          nombre: p.nombre,
          email: p.email,
          codigoHash: priv.hashCodigo_(p.id, p.codigo, SAL),
          activo: true,
          creado: new Date(ancla - 30 * 86400000),
        };
      }),
    );

    var ahora = entorno.reloj();
    var hoja = entorno.libro.getSheetByName('Partidos');
    var cols = priv.CONFIG.ENCABEZADOS.Partidos;
    var colGL = cols.indexOf('golesLocal') + 1;
    var azar = prng(2026);

    // Resultados: todos los partidos que terminaron antes de "ahora", en orden,
    // resolviendo el cuadro con el código real para saber quién juega.
    var crudos = priv.leerTabla_('Partidos');
    crudos.forEach(function (fila) {
      var kick = priv.QuinielaCore.parseKickoff(String(fila.kickoff), -360);
      if (!kick || kick.getTime() + 2 * 3600000 > ahora) return;
      var gl = goles(azar, 1);
      var gv = goles(azar);
      var avanza = '';
      if (fila.fase !== 'GRUPOS') {
        var resuelto = priv.partidosResueltos_().filter(function (p) {
          return p.id === String(fila.id);
        })[0];
        if (gl === gv) avanza = azar() < 0.5 ? resuelto.local : resuelto.visitante;
        else avanza = gl > gv ? resuelto.local : resuelto.visitante;
      }
      hoja.getRange(fila._fila, colGL, 1, 3).setValues([[gl, gv, avanza]]);
    });

    // Pronósticos de todos. Los demás también pronostican partidos futuros
    // (así se puede comprobar que getAppStatus no los filtra).
    var partidos = priv.leerTabla_('Partidos');
    var filas = [];
    participantes.forEach(function (p, idx) {
      var az = prng(100 + idx);
      var tino = 0.25 + az() * 0.35; // qué tan buen pronosticador es
      partidos.forEach(function (m) {
        var kick = priv.QuinielaCore.parseKickoff(String(m.kickoff), -360).getTime();
        var esDemo = p.id === CUENTAS.participante.id;
        if (esDemo && kick > ahora - 3600000 && kick < ahora + 2 * 86400000 && m.id !== '51') return;
        if (kick > ahora + 3 * 86400000) return;
        if (az() < (esDemo ? 0.08 : 0.12)) return; // a veces se les olvida
        var gl, gv;
        var jugado = typeof m.golesLocal === 'number';
        if (jugado && az() < tino) {
          gl = m.golesLocal;
          gv = m.golesVisitante;
          if (az() < 0.5) {
            // acierta el resultado pero no el marcador
            if (gl > gv) gl += 1;
            else if (gv > gl) gv += 1;
            else {
              gl += 1;
              gv += 1;
            }
          }
        } else {
          gl = goles(az, 1);
          gv = goles(az);
        }
        filas.push({
          participanteId: p.id,
          partidoId: String(m.id),
          golesLocal: gl,
          golesVisitante: gv,
          version: az() < 0.15 ? 2 : 1,
          actualizado: new Date(kick - (1 + Math.floor(az() * 40)) * 3600000),
        });
      });
    });
    priv.agregarFilas_('Pronosticos', filas);
    priv.calcularPuntosGlobales_();
  }

  // ---------------------------------------------------------------------------
  // google.script.run simulado
  // ---------------------------------------------------------------------------
  var tokenActual = null;

  function contieneFecha(v) {
    if (v instanceof Date) return true;
    if (v && typeof v === 'object') {
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k) && contieneFecha(v[k])) return true;
    }
    return false;
  }

  function crearCorredor(exito, fallo) {
    var objetivo = {
      withSuccessHandler: function (fn) {
        return crearCorredor(fn, fallo);
      },
      withFailureHandler: function (fn) {
        return crearCorredor(exito, fn);
      },
    };
    return new Proxy(objetivo, {
      get: function (t, nombre) {
        if (nombre in t) return t[nombre];
        return function () {
          // Como en Apps Script: los argumentos se serializan y la llamada es asíncrona.
          var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
          setTimeout(
            function () {
              if (typeof api[nombre] !== 'function') {
                if (fallo) fallo(new Error('Función de script no encontrada: ' + String(nombre)));
                return;
              }
              var r;
              try {
                r = api[nombre].apply(null, args);
              } catch (e) {
                if (fallo) fallo(e);
                return;
              }
              if (contieneFecha(r)) {
                // Apps Script no deja devolver objetos Date al cliente.
                if (fallo) fallo(new Error('Valor de retorno ilegal (Date) en ' + String(nombre)));
                return;
              }
              if (nombre === 'loginUsuario' && r && r.ok) tokenActual = r.token;
              if (nombre === 'cerrarSesion') tokenActual = null;
              if (exito) exito(JSON.parse(JSON.stringify(r)));
            },
            120 + Math.random() * 180,
          );
        };
      },
    });
  }

  window.google = { script: { run: crearCorredor(null, null) } };

  // ---------------------------------------------------------------------------
  // Interfaz propia de la demo: franja superior, cuentas y pentest
  // ---------------------------------------------------------------------------
  function el(etiqueta, atributos) {
    var n = document.createElement(etiqueta);
    Object.keys(atributos || {}).forEach(function (k) {
      if (k === 'class') n.className = atributos[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), atributos[k]);
      else n.setAttribute(k, atributos[k]);
    });
    var hijos = [];
    for (var i = 2; i < arguments.length; i++) hijos = hijos.concat(arguments[i]);
    hijos.forEach(function (h) {
      if (h === null || h === undefined) return;
      n.appendChild(h instanceof Node ? h : document.createTextNode(String(h)));
    });
    return n;
  }

  function leerToken() {
    if (tokenActual) return tokenActual;
    try {
      return localStorage.getItem('quiniela.token');
    } catch {
      return null;
    }
  }

  window.QUINIELA_DEMO = {
    /** Botones para entrar con las cuentas de prueba (los usa Client.html). */
    ayudaLogin: function (email, codigo) {
      function usar(c) {
        return function () {
          email.value = c.email;
          codigo.value = c.codigo;
          email.form.requestSubmit();
        };
      }
      return el(
        'div',
        { class: 'demo-cuentas' },
        el('p', null, 'Es una demo con datos ficticios. Entra con una cuenta de prueba:'),
        el(
          'div',
          { class: 'demo-cuentas__botones' },
          el(
            'button',
            { type: 'button', class: 'boton boton--sec', onclick: usar(CUENTAS.participante) },
            'Participante',
          ),
          el('button', { type: 'button', class: 'boton boton--sec', onclick: usar(CUENTAS.admin) }, 'Administrador'),
        ),
        el(
          'p',
          { class: 'demo-cuentas__datos' },
          'Participante: ' + CUENTAS.participante.email + ' / ' + CUENTAS.participante.codigo,
          el('br'),
          'Administrador: ' + CUENTAS.admin.email + ' / ' + CUENTAS.admin.codigo,
        ),
      );
    },
  };

  function franja() {
    var selector = el(
      'select',
      {
        id: 'demo-momento',
        'aria-label': 'Momento del torneo',
        onchange: function () {
          try {
            localStorage.setItem(CLAVE_MOMENTO, this.value);
            localStorage.removeItem('quiniela.token');
          } catch {
            /* ignorado */
          }
          location.reload();
        },
      },
      Object.keys(MOMENTOS).map(function (k) {
        var o = el('option', { value: k }, MOMENTOS[k].nombre);
        if (k === momentoClave) o.selected = true;
        return o;
      }),
    );
    return el(
      'div',
      { class: 'demo-franja', role: 'region', 'aria-label': 'Controles de la demo' },
      el(
        'div',
        { class: 'demo-franja__interior' },
        el('span', { class: 'demo-franja__marca' }, 'Demo sin servidor, con datos ficticios'),
        el('label', { class: 'demo-franja__momento' }, el('span', null, 'Momento '), selector),
        el('button', { type: 'button', class: 'demo-franja__boton', onclick: abrirPentest }, 'Probar ataques'),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Panel de pentest: los mismos ataques de docs/SEGURIDAD.md
  // ---------------------------------------------------------------------------
  var dialogo = null;

  function partidoCerrado() {
    var ahora = entorno.reloj();
    var lista = priv.leerTabla_('Partidos').filter(function (m) {
      return priv.QuinielaCore.parseKickoff(String(m.kickoff), -360).getTime() < ahora;
    });
    return String(lista[lista.length - 1].id);
  }

  function partidoAbierto() {
    var ahora = entorno.reloj();
    var m = priv.partidosResueltos_().filter(function (p) {
      return p.kickoff.getTime() > ahora && p.local && p.visitante;
    })[0];
    return m ? m.id : '1';
  }

  var ATAQUES = [
    {
      titulo: 'Suplantar a otro participante',
      explica:
        'La versión original recibía el correo del usuario como primer argumento. Aquí se manda el correo de otra persona en lugar del token.',
      codigo: function () {
        return (
          "google.script.run.guardarPronosticosLote('participante1@example.com', [{ partidoId: '" +
          partidoAbierto() +
          "', golesLocal: 0, golesVisitante: 9 }])"
        );
      },
      correr: function () {
        return api.guardarPronosticosLote('participante1@example.com', [
          { partidoId: partidoAbierto(), golesLocal: 0, golesVisitante: 9 },
        ]);
      },
      veredicto: function (r) {
        return !r.ok && r.error === 'NO_AUTENTICADO';
      },
    },
    {
      titulo: 'Editar un partido que ya empezó',
      explica: 'El cliente bloquea los campos, pero la consola puede llamar al servidor directamente.',
      codigo: function () {
        return (
          "google.script.run.guardarPronosticosLote(token, [{ partidoId: '" +
          partidoCerrado() +
          "', golesLocal: 2, golesVisitante: 1 }])"
        );
      },
      correr: function (token) {
        return api.guardarPronosticosLote(token, [{ partidoId: partidoCerrado(), golesLocal: 2, golesVisitante: 1 }]);
      },
      veredicto: function (r) {
        return r.ok && r.guardados.length === 0 && r.rechazados[0] && r.rechazados[0].motivo === 'PARTIDO_CERRADO';
      },
    },
    {
      titulo: 'Mandar un marcador de 311-16',
      explica: 'Sin validación, un marcador absurdo se guardaba y rompía la tabla.',
      codigo: function () {
        return (
          "google.script.run.guardarPronosticosLote(token, [{ partidoId: '" +
          partidoAbierto() +
          "', golesLocal: 311, golesVisitante: 16 }])"
        );
      },
      correr: function (token) {
        return api.guardarPronosticosLote(token, [
          { partidoId: partidoAbierto(), golesLocal: 311, golesVisitante: 16 },
        ]);
      },
      veredicto: function (r) {
        return r.ok && r.guardados.length === 0 && r.rechazados[0].motivo === 'GOLES_INVALIDOS';
      },
    },
    {
      titulo: 'Capturar un resultado sin ser admin',
      explica: 'Las funciones de administrador son públicas para google.script.run; cada una valida la lista blanca.',
      codigo: function () {
        return "google.script.run.adminRegistrarResultado(token, '" + partidoCerrado() + "', 9, 0)";
      },
      correr: function (token) {
        return api.adminRegistrarResultado(token, partidoCerrado(), 9, 0);
      },
      veredicto: function (r, cuenta) {
        return cuenta === 'admin' ? r.ok || r.error !== 'NO_AUTORIZADO' : !r.ok && r.error === 'NO_AUTORIZADO';
      },
      notaAdmin:
        'Entraste como administrador, así que esta llamada sí está permitida. Entra como participante para ver el rechazo.',
    },
    {
      titulo: 'Espiar getAppStatus',
      explica:
        'La versión original devolvía correos y pronósticos de todos. Se revisa la respuesta completa buscando datos ajenos.',
      codigo: function () {
        return 'google.script.run.getAppStatus(token)';
      },
      correr: function (token) {
        var r = api.getAppStatus(token);
        if (!r.ok) return r;
        var json = JSON.stringify(r);
        return {
          ok: true,
          correosEncontrados: (json.match(/@example\.com/g) || []).length,
          participantesEnTabla: r.tabla.length,
          camposPorFila: Object.keys(r.tabla[0] || {}),
          pronosticosDevueltos: r.misPronosticos.length,
          todosSonMios: true,
          pronosticosDeOtrosEnLaHoja: priv.leerTabla_('Pronosticos').length - r.misPronosticos.length,
        };
      },
      veredicto: function (r) {
        return r.ok && r.correosEncontrados === 0 && r.camposPorFila.indexOf('participanteId') === -1;
      },
    },
  ];

  function cuentaActual() {
    var t = leerToken();
    if (!t) return null;
    var r = api.quienSoy(t);
    if (!r.ok) return null;
    return r.usuario.esAdmin ? 'admin' : 'participante';
  }

  function abrirPentest() {
    if (dialogo) dialogo.remove();
    var cuenta = cuentaActual();
    var lista = el(
      'ol',
      { class: 'pentest__lista' },
      ATAQUES.map(function (a) {
        var salida = el('pre', { class: 'pentest__salida', hidden: '' });
        var resultado = el('p', { class: 'pentest__veredicto', hidden: '' });
        var boton = el(
          'button',
          {
            type: 'button',
            class: 'boton boton--chico',
            onclick: function () {
              var r = a.correr(leerToken());
              salida.textContent = '// respuesta del servidor\n' + JSON.stringify(r, null, 2);
              salida.removeAttribute('hidden');
              var ok = a.veredicto(r, cuenta);
              resultado.textContent =
                cuenta === 'admin' && a.notaAdmin
                  ? a.notaAdmin
                  : ok
                    ? 'Bloqueado por el servidor'
                    : 'Resultado inesperado';
              resultado.className = 'pentest__veredicto ' + (ok ? 'pentest__veredicto--ok' : 'pentest__veredicto--mal');
              resultado.removeAttribute('hidden');
            },
          },
          'Ejecutar',
        );
        return el(
          'li',
          null,
          el('h3', null, a.titulo),
          el('p', null, a.explica),
          el('code', { class: 'pentest__codigo' }, a.codigo()),
          el('div', { class: 'pentest__accion' }, boton, resultado),
          salida,
        );
      }),
    );
    dialogo = el(
      'dialog',
      { class: 'pentest', 'aria-labelledby': 'pentest-titulo' },
      el(
        'div',
        { class: 'pentest__cabeza' },
        el('h2', { id: 'pentest-titulo' }, 'Prueba de penetración'),
        el(
          'button',
          {
            type: 'button',
            class: 'pentest__cerrar',
            'aria-label': 'Cerrar',
            onclick: function () {
              dialogo.close();
            },
          },
          '×',
        ),
      ),
      el(
        'p',
        null,
        'Cada botón hace la misma llamada que un usuario curioso podría escribir en la consola del navegador. La responde el código real del servidor.',
      ),
      cuenta
        ? null
        : el(
            'p',
            { class: 'error' },
            'Entra primero con una cuenta de prueba: varios ataques usan tu token de sesión.',
          ),
      lista,
    );
    document.body.appendChild(dialogo);
    dialogo.showModal();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.body.insertBefore(franja(), document.body.firstChild);
  });
})();

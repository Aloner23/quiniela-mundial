/**
 * Pruebas de seguridad: reproducen los ataques de la prueba de penetración
 * (docs/SEGURIDAD.md) contra los handlers REALES de apps-script/*.gs, con
 * SpreadsheetApp, CacheService, Session, etc. simulados en memoria.
 *
 * Cada `describe` corresponde a un hallazgo del documento.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { crearQuiniela, ADMIN, ANA, BETO, KICKOFF_PARTIDO_1 } from './helpers.js';

const require = createRequire(import.meta.url);
const { funcionesPublicas } = require('../tools/empaquetar.js');

const UNA_HORA = 3600000;

describe('Hallazgo 1: suplantación de identidad', () => {
  let q;
  beforeEach(() => {
    q = crearQuiniela();
  });

  it('el ataque original (mandar el email de otra persona) ya no funciona', () => {
    // Antes: google.script.run.guardarPronosticosLote('beto@example.com', [...])
    const r = q.api.guardarPronosticosLote(BETO.email, [{ partidoId: '1', golesLocal: 0, golesVisitante: 5 }]);
    expect(r).toMatchObject({ ok: false, error: 'NO_AUTENTICADO' });
    expect(q.pronosticosDe(BETO.id)).toHaveLength(0);
  });

  it('los campos email / participanteId dentro del lote se ignoran', () => {
    const token = q.login(ANA);
    const r = q.api.guardarPronosticosLote(token, [
      { partidoId: '1', golesLocal: 2, golesVisitante: 0, email: BETO.email, participanteId: BETO.id },
    ]);
    expect(r.ok).toBe(true);
    expect(q.pronosticosDe(BETO.id)).toHaveLength(0);
    expect(q.pronosticosDe(ANA.id)).toHaveLength(1);
  });

  it('un token inventado o con formato raro se rechaza', () => {
    for (const falso of ['00000000-0000-4000-8000-000000000000', 'admin', '', null, { token: 'x' }, ['a']]) {
      const r = q.api.getAppStatus(falso);
      expect(r).toMatchObject({ ok: false, error: 'NO_AUTENTICADO' });
    }
  });

  it('cerrar sesión invalida el token en el servidor', () => {
    const token = q.login(ANA);
    expect(q.api.quienSoy(token).ok).toBe(true);
    q.api.cerrarSesion(token);
    expect(q.api.quienSoy(token)).toMatchObject({ ok: false, error: 'NO_AUTENTICADO' });
  });

  it('el token expira a las 6 horas', () => {
    const r = q.api.loginUsuario(ANA.email, ANA.codigo);
    expect(r.expiraEnSeg).toBe(6 * 3600);
    const token = q.login(ANA);
    q.entorno.moverReloj(6 * UNA_HORA + 1000);
    expect(q.api.quienSoy(token)).toMatchObject({ ok: false, error: 'NO_AUTENTICADO' });
  });

  it('el login no revela si un correo está inscrito', () => {
    const noExiste = q.api.loginUsuario('nadie@example.com', 'ABCDEFGH');
    const codigoMalo = q.api.loginUsuario(ANA.email, 'ABCDEFGH');
    expect(noExiste.error).toBe('CREDENCIALES_INVALIDAS');
    expect(codigoMalo).toEqual(noExiste);
  });

  it('bloquea el correo tras 5 intentos fallidos, aunque luego llegue el código correcto', () => {
    for (let i = 0; i < 5; i++) q.api.loginUsuario(ANA.email, 'MAL' + i + 'XXXX');
    expect(q.api.loginUsuario(ANA.email, ANA.codigo)).toMatchObject({ ok: false, error: 'DEMASIADOS_INTENTOS' });
    q.entorno.moverReloj(16 * 60000);
    expect(q.api.loginUsuario(ANA.email, ANA.codigo).ok).toBe(true);
  });

  it('la hoja guarda el hash del código, nunca el código', () => {
    const filas = q.filas('Participantes');
    const texto = JSON.stringify(filas);
    for (const p of [ADMIN, ANA, BETO]) expect(texto).not.toContain(p.codigo);
    expect(filas[0].codigoHash).toMatch(/^[0-9a-f]{64}$/);
  });

  describe('modo DOMINIO (Session.getActiveUser)', () => {
    it('la identidad sale de la cuenta de Google, no del argumento', () => {
      const q2 = crearQuiniela({ modo: 'DOMINIO', usuarioActivo: ANA.email });
      // Ana intenta pasar el email de Beto como si fuera su "token".
      const r = q2.api.guardarPronosticosLote(BETO.email, [{ partidoId: '1', golesLocal: 1, golesVisitante: 0 }]);
      expect(r.ok).toBe(true);
      expect(q2.pronosticosDe(BETO.id)).toHaveLength(0);
      expect(q2.pronosticosDe(ANA.id)).toHaveLength(1);
    });

    it('una cuenta del dominio que no está inscrita no entra', () => {
      const q2 = crearQuiniela({ modo: 'DOMINIO', usuarioActivo: 'intruso@example.com' });
      expect(q2.api.loginUsuario().ok).toBe(false);
      expect(q2.api.getAppStatus()).toMatchObject({ ok: false, error: 'NO_AUTENTICADO' });
    });
  });
});

describe('Hallazgo 2: fuga de información en getAppStatus', () => {
  let q, tokenAna, estado;
  beforeEach(() => {
    q = crearQuiniela();
    tokenAna = q.login(ANA);
    const tokenBeto = q.login(BETO);
    q.api.guardarPronosticosLote(tokenAna, [{ partidoId: '1', golesLocal: 1, golesVisitante: 1 }]);
    // Beto pone un marcador muy reconocible.
    q.api.guardarPronosticosLote(tokenBeto, [
      { partidoId: '1', golesLocal: 27, golesVisitante: 13 },
      { partidoId: '2', golesLocal: 19, golesVisitante: 17 },
    ]);
    estado = q.api.getAppStatus(tokenAna);
  });

  it('no incluye correos de nadie (ni el propio)', () => {
    const json = JSON.stringify(estado);
    expect(estado.ok).toBe(true);
    expect(json).not.toMatch(/@example\.com/);
  });

  it('no incluye ids internos de otros participantes', () => {
    const json = JSON.stringify(estado);
    expect(json).not.toContain(BETO.id);
    expect(json).not.toContain(ADMIN.id);
  });

  it('no incluye los marcadores pronosticados por otros', () => {
    const json = JSON.stringify(estado);
    expect(json).not.toMatch(/"golesLocal":27|"golesLocal":19/);
    expect(estado.misPronosticos.map((p) => p.partidoId)).toEqual(['1']);
  });

  it('la tabla sólo expone campos públicos (lista blanca)', () => {
    estado.tabla.forEach((fila) => {
      expect(Object.keys(fila).sort()).toEqual([
        'aciertos',
        'esYo',
        'exactos',
        'jugados',
        'nombre',
        'posicion',
        'puntos',
      ]);
    });
    expect(estado.tabla.filter((f) => f.esYo).map((f) => f.nombre)).toEqual(['Ana']);
  });

  it('sin sesión no devuelve nada', () => {
    expect(q.api.getAppStatus()).toEqual({ ok: false, error: 'NO_AUTENTICADO', mensaje: expect.any(String) });
    expect(q.api.getBracket()).toMatchObject({ ok: false, error: 'NO_AUTENTICADO' });
  });

  it('un error inesperado no filtra el stack ni detalles internos', () => {
    q.entorno.libro.getSheetByName('Partidos').getRange = () => {
      throw new Error('detalle interno /ruta/secreta');
    };
    const r = q.api.getAppStatus(tokenAna);
    expect(r).toEqual({ ok: false, error: 'ERROR_INTERNO', mensaje: expect.any(String) });
    expect(JSON.stringify(r)).not.toContain('secreta');
  });
});

describe('Hallazgo 3: edición de partidos cerrados', () => {
  let q, token;
  beforeEach(() => {
    q = crearQuiniela();
    token = q.login(ANA);
    q.api.guardarPronosticosLote(token, [{ partidoId: '1', golesLocal: 1, golesVisitante: 0 }]);
  });

  it('antes del kickoff se puede editar y la versión sube', () => {
    const r = q.api.guardarPronosticosLote(token, [{ partidoId: '1', golesLocal: 2, golesVisitante: 0 }]);
    expect(r).toMatchObject({ ok: true, guardados: ['1'], rechazados: [] });
    expect(q.pronosticosDe(ANA.id)[0]).toMatchObject({ golesLocal: 2, version: 2 });
  });

  it('en el segundo exacto del kickoff ya está cerrado', () => {
    q.fijarReloj(KICKOFF_PARTIDO_1);
    const r = q.api.guardarPronosticosLote(token, [{ partidoId: '1', golesLocal: 3, golesVisitante: 3 }]);
    expect(r.rechazados).toEqual([{ partidoId: '1', motivo: 'PARTIDO_CERRADO', mensaje: expect.any(String) }]);
    expect(q.pronosticosDe(ANA.id)[0]).toMatchObject({ golesLocal: 1, golesVisitante: 0, version: 1 });
  });

  it('mandar "abierto: true" o un kickoff falso desde el cliente no cambia nada', () => {
    q.fijarReloj(KICKOFF_PARTIDO_1 + 45 * 60000);
    const r = q.api.guardarPronosticosLote(token, [
      { partidoId: '1', golesLocal: 3, golesVisitante: 3, abierto: true, kickoff: '2099-01-01 00:00' },
    ]);
    expect(r.rechazados[0].motivo).toBe('PARTIDO_CERRADO');
  });

  it('en un lote mixto se guardan los abiertos y se rechazan los cerrados', () => {
    q.fijarReloj(KICKOFF_PARTIDO_1 + 60000);
    const r = q.api.guardarPronosticosLote(token, [
      { partidoId: '1', golesLocal: 0, golesVisitante: 0 },
      { partidoId: '2', golesLocal: 2, golesVisitante: 2 },
    ]);
    expect(r.guardados).toEqual(['2']);
    expect(r.rechazados.map((x) => x.partidoId)).toEqual(['1']);
  });

  it('no se puede pronosticar una eliminatoria con equipos por definir', () => {
    const r = q.api.guardarPronosticosLote(token, [{ partidoId: '89', golesLocal: 1, golesVisitante: 0 }]);
    expect(r.rechazados[0].motivo).toBe('EQUIPOS_POR_DEFINIR');
  });

  it('un partido que no existe se rechaza', () => {
    const r = q.api.guardarPronosticosLote(token, [{ partidoId: '999', golesLocal: 1, golesVisitante: 0 }]);
    expect(r.rechazados[0].motivo).toBe('PARTIDO_INEXISTENTE');
  });
});

describe('Hallazgo 4: goles sin validar', () => {
  let q, token;
  beforeEach(() => {
    q = crearQuiniela();
    token = q.login(ANA);
  });

  it('311-16 se rechaza y no se escribe nada', () => {
    const r = q.api.guardarPronosticosLote(token, [{ partidoId: '1', golesLocal: 311, golesVisitante: 16 }]);
    expect(r.rechazados).toEqual([{ partidoId: '1', motivo: 'GOLES_INVALIDOS', mensaje: expect.any(String) }]);
    expect(q.pronosticosDe(ANA.id)).toHaveLength(0);
  });

  it.each([
    [-1, 0],
    [1.5, 0],
    ['1e1', 0],
    [null, 0],
    [0, '=1+1'],
    [Infinity, 0],
    [31, 0],
  ])('rechaza %j - %j', (gl, gv) => {
    const r = q.api.guardarPronosticosLote(token, [{ partidoId: '1', golesLocal: gl, golesVisitante: gv }]);
    expect(r.rechazados[0].motivo).toBe('GOLES_INVALIDOS');
  });

  it('acepta el rango completo 0-30', () => {
    const r = q.api.guardarPronosticosLote(token, [
      { partidoId: '1', golesLocal: 0, golesVisitante: 30 },
      { partidoId: '2', golesLocal: '7', golesVisitante: 3 },
    ]);
    expect(r.guardados).toEqual(['1', '2']);
  });

  it('un lote que no es arreglo o es enorme se rechaza completo', () => {
    expect(q.api.guardarPronosticosLote(token, 'DROP TABLE')).toMatchObject({ ok: false, error: 'FORMATO_INVALIDO' });
    const enorme = Array.from({ length: 500 }, (_, i) => ({
      partidoId: String(i + 1),
      golesLocal: 0,
      golesVisitante: 0,
    }));
    expect(q.api.guardarPronosticosLote(token, enorme)).toMatchObject({ ok: false, error: 'LOTE_DEMASIADO_GRANDE' });
  });

  it('el admin tampoco puede capturar un resultado absurdo', () => {
    q.fijarReloj(KICKOFF_PARTIDO_1 + 3 * UNA_HORA);
    const tokenAdmin = q.login(ADMIN);
    expect(q.api.adminRegistrarResultado(tokenAdmin, '1', 311, 16)).toMatchObject({
      ok: false,
      error: 'GOLES_INVALIDOS',
    });
  });
});

describe('Hallazgo 5: funciones de administrador sin guardia', () => {
  const admin = Object.keys(crearQuiniela().api).filter((n) => n.startsWith('admin') || n === 'calcularPuntosGlobales');
  const argumentos = {
    adminRegistrarResultado: ['1', 2, 1],
    adminAltaParticipante: ['Intruso', 'intruso@example.com'],
    adminRestablecerCodigo: [BETO.id],
    adminParticipantes: [],
    adminHistorial: [50],
    calcularPuntosGlobales: [],
  };

  it('la lista de funciones admin está cubierta por esta prueba', () => {
    expect(admin.sort()).toEqual(Object.keys(argumentos).sort());
  });

  it.each(admin)('%s: un participante normal recibe NO_AUTORIZADO y no cambia nada', (nombre) => {
    const q = crearQuiniela();
    q.fijarReloj(KICKOFF_PARTIDO_1 + 3 * UNA_HORA);
    const token = q.login(ANA);
    const antes = JSON.stringify([q.filas('Partidos'), q.filas('Participantes'), q.filas('Tabla')]);
    const r = q.api[nombre](token, ...argumentos[nombre]);
    expect(r).toMatchObject({ ok: false, error: 'NO_AUTORIZADO' });
    expect(JSON.stringify([q.filas('Partidos'), q.filas('Participantes'), q.filas('Tabla')])).toBe(antes);
    // El intento queda en la bitácora.
    expect(q.filas('Historial').some((h) => h.accion === 'ACCESO_DENEGADO' && h.actor === ANA.id)).toBe(true);
  });

  it.each(admin)('%s: sin sesión recibe NO_AUTENTICADO', (nombre) => {
    const q = crearQuiniela();
    expect(q.api[nombre](undefined, ...argumentos[nombre])).toMatchObject({ ok: false, error: 'NO_AUTENTICADO' });
  });

  it('el admin sí puede capturar resultados y la tabla se recalcula', () => {
    const q = crearQuiniela();
    const tAna = q.login(ANA);
    q.api.guardarPronosticosLote(tAna, [{ partidoId: '1', golesLocal: 2, golesVisitante: 1 }]);
    q.fijarReloj(KICKOFF_PARTIDO_1 + 2 * UNA_HORA);
    const tAdmin = q.login(ADMIN);
    expect(q.api.adminRegistrarResultado(tAdmin, '1', 2, 1).ok).toBe(true);
    // El token de Ana (de hace 7 h) ya expiró: vuelve a entrar.
    expect(q.api.getAppStatus(tAna)).toMatchObject({ ok: false, error: 'NO_AUTENTICADO' });
    const tabla = q.api.getAppStatus(q.login(ANA)).tabla;
    expect(tabla.find((f) => f.esYo)).toMatchObject({ puntos: 3, exactos: 1, posicion: 1 });
  });

  it('el admin no puede capturar el resultado de un partido que no ha empezado', () => {
    const q = crearQuiniela();
    const tAdmin = q.login(ADMIN);
    expect(q.api.adminRegistrarResultado(tAdmin, '1', 2, 1)).toMatchObject({ ok: false, error: 'PARTIDO_NO_INICIADO' });
  });

  it('el alta de participantes neutraliza fórmulas en el nombre', () => {
    const q = crearQuiniela();
    const tAdmin = q.login(ADMIN);
    const r = q.api.adminAltaParticipante(tAdmin, '=HYPERLINK("http://x","clic")', 'nuevo@example.com');
    expect(r.ok).toBe(true);
    const fila = q.filas('Participantes').find((p) => p.email === 'nuevo@example.com');
    expect(fila.nombre.startsWith("'=")).toBe(true);
    // Y puede entrar con el código que se le entregó una sola vez.
    expect(q.api.loginUsuario('nuevo@example.com', r.codigo).ok).toBe(true);
  });

  it('setupQuiniela llamada desde la web app por un no-admin se rechaza', () => {
    const q = crearQuiniela();
    q.entorno.sesion.activo = ANA.email; // visitante de la web app
    expect(q.api.setupQuiniela()).toMatchObject({ ok: false, error: 'NO_AUTORIZADO' });
  });
});

describe('Hallazgo 6: superficie de API pública', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'apps-script');
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.gs'));
  const publicas = archivos.flatMap((f) => funcionesPublicas(fs.readFileSync(path.join(dir, f), 'utf8')));

  it('sólo estas funciones son invocables con google.script.run', () => {
    // Si agregas una función pública, esta prueba falla a propósito: decide si
    // debe ser privada (termina en "_") o agrega su guardia y su prueba.
    expect(publicas.sort()).toEqual(
      [
        'adminAltaParticipante',
        'adminHistorial',
        'adminParticipantes',
        'adminRegistrarResultado',
        'adminRestablecerCodigo',
        'calcularPuntosGlobales',
        'cerrarSesion',
        'doGet',
        'getAppStatus',
        'getBracket',
        'guardarPronosticosLote',
        'loginUsuario',
        'quienSoy',
        'setupQuiniela',
      ].sort(),
    );
  });

  it('cada función pública admin* empieza con requiereAdmin_', () => {
    for (const f of archivos) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const re =
        /^function\s+(admin\w+|calcularPuntosGlobales)\s*\(([^)]*)\)\s*\{\s*return responder_\(function \(\) \{\s*(?:var \w+ = )?(\w+)\(/gm;
      let m;
      while ((m = re.exec(src))) expect([m[1], m[3]]).toEqual([m[1], 'requiereAdmin_']);
    }
    const src = archivos.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const cuantas = (src.match(/^function\s+(admin\w+|calcularPuntosGlobales)\s*\(/gm) || []).length;
    const conGuardia = (
      src.match(
        /^function\s+(admin\w+|calcularPuntosGlobales)\s*\([^)]*\)\s*\{\s*return responder_\(function \(\) \{\s*(?:var \w+ = )?requiereAdmin_\(/gm,
      ) || []
    ).length;
    expect(conGuardia).toBe(cuantas);
  });

  it('Core.js no declara funciones de nivel superior (todo vive en QuinielaCore)', () => {
    const core = fs.readFileSync(path.join(dir, 'Core.js'), 'utf8');
    expect(funcionesPublicas(core)).toEqual([]);
  });
});

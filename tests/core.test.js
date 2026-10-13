import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../apps-script/Core.js');

function equipos48() {
  const out = [];
  C.GRUPOS.forEach((g) => {
    for (let i = 1; i <= 4; i++) out.push({ codigo: g + i, grupo: g });
  });
  return out;
}

/** Calendario en el que el equipo X1 gana todo, X2 gana a X3 y X4, X3 gana a X4. */
function calendarioConGrupos(marcadorTercero) {
  const cal = C.generarCalendario(equipos48(), '2026-06-11');
  cal.forEach((m) => {
    if (m.fase !== 'GRUPOS') return;
    const n = (c) => Number(c.slice(1));
    const [a, b] = [n(m.local), n(m.visitante)];
    const g = m.grupo;
    let gl = a < b ? 2 : 0;
    let gv = a < b ? 0 : 2;
    // El tercero de cada grupo (X3) gana a X4 por un marcador distinto por grupo
    // para que la tabla de terceros tenga un orden claro.
    if ((a === 3 && b === 4) || (a === 4 && b === 3)) {
      const goles = marcadorTercero(g);
      gl = a === 3 ? goles : 0;
      gv = a === 3 ? 0 : goles;
    }
    m.golesLocal = gl;
    m.golesVisitante = gv;
  });
  return cal;
}

describe('puntuarPronostico', () => {
  it('marcador exacto vale 3 puntos (no se suma el punto de resultado)', () => {
    expect(C.puntuarPronostico({ golesLocal: 2, golesVisitante: 1 }, { golesLocal: 2, golesVisitante: 1 })).toEqual({
      puntos: 3,
      exacto: true,
      acierto: true,
    });
  });

  it('resultado correcto sin marcador exacto vale 1 punto', () => {
    expect(C.puntuarPronostico({ golesLocal: 3, golesVisitante: 0 }, { golesLocal: 1, golesVisitante: 0 }).puntos).toBe(
      1,
    );
    expect(C.puntuarPronostico({ golesLocal: 1, golesVisitante: 1 }, { golesLocal: 2, golesVisitante: 2 }).puntos).toBe(
      1,
    );
    expect(C.puntuarPronostico({ golesLocal: 0, golesVisitante: 2 }, { golesLocal: 1, golesVisitante: 4 }).puntos).toBe(
      1,
    );
  });

  it('resultado equivocado vale 0', () => {
    expect(C.puntuarPronostico({ golesLocal: 2, golesVisitante: 1 }, { golesLocal: 1, golesVisitante: 1 }).puntos).toBe(
      0,
    );
  });

  it('sin resultado oficial no da puntos', () => {
    expect(
      C.puntuarPronostico({ golesLocal: 2, golesVisitante: 1 }, { golesLocal: null, golesVisitante: null }).puntos,
    ).toBe(0);
  });

  it('los puntos son configurables', () => {
    const P = { EXACTO: 5, RESULTADO: 2 };
    expect(
      C.puntuarPronostico({ golesLocal: 1, golesVisitante: 0 }, { golesLocal: 1, golesVisitante: 0 }, P).puntos,
    ).toBe(5);
    expect(
      C.puntuarPronostico({ golesLocal: 2, golesVisitante: 0 }, { golesLocal: 1, golesVisitante: 0 }, P).puntos,
    ).toBe(2);
  });
});

describe('tablaGeneral', () => {
  const participantes = [
    { id: 'a', nombre: 'Ana' },
    { id: 'b', nombre: 'Beto' },
    { id: 'c', nombre: 'Caro' },
    { id: 'd', nombre: 'Dani' },
  ];
  const partidos = {
    1: { golesLocal: 2, golesVisitante: 1 },
    2: { golesLocal: 0, golesVisitante: 0 },
    3: { golesLocal: null, golesVisitante: null },
  };

  it('ordena por puntos, exactos y aciertos, y comparte posición en empate total', () => {
    const pron = [
      { participanteId: 'a', partidoId: '1', golesLocal: 2, golesVisitante: 1 }, // 3
      { participanteId: 'a', partidoId: '2', golesLocal: 1, golesVisitante: 0 }, // 0
      { participanteId: 'b', partidoId: '1', golesLocal: 1, golesVisitante: 0 }, // 1
      { participanteId: 'b', partidoId: '2', golesLocal: 1, golesVisitante: 1 }, // 1 -> 2 pts, 0 exactos
      { participanteId: 'c', partidoId: '1', golesLocal: 3, golesVisitante: 0 }, // 1
      { participanteId: 'c', partidoId: '2', golesLocal: 2, golesVisitante: 2 }, // 1 -> 2 pts, 0 exactos
      { participanteId: 'd', partidoId: '3', golesLocal: 5, golesVisitante: 5 }, // sin jugar
    ];
    const t = C.tablaGeneral(participantes, pron, partidos);
    expect(t.map((f) => [f.nombre, f.puntos, f.posicion])).toEqual([
      ['Ana', 3, 1],
      ['Beto', 2, 2],
      ['Caro', 2, 2],
      ['Dani', 0, 4],
    ]);
    expect(t[0]).toMatchObject({ exactos: 1, aciertos: 1, jugados: 2 });
    expect(t[3].jugados).toBe(0);
  });

  it('ignora pronósticos de participantes que no existen', () => {
    const t = C.tablaGeneral(
      participantes,
      [{ participanteId: 'zz', partidoId: '1', golesLocal: 2, golesVisitante: 1 }],
      partidos,
    );
    expect(t.every((f) => f.puntos === 0)).toBe(true);
  });
});

describe('normalizarGoles', () => {
  it.each([0, 1, 7, 30, '0', '12', ' 3 '])('acepta %j', (v) => {
    expect(C.normalizarGoles(v)).toBe(Number(v));
  });

  it.each([
    311,
    31,
    -1,
    1.5,
    NaN,
    Infinity,
    '311',
    '1e1',
    '-2',
    '0x1',
    '',
    ' ',
    null,
    undefined,
    true,
    {},
    [],
    [2],
    'dos',
  ])('rechaza %j', (v) => {
    expect(C.normalizarGoles(v)).toBeNull();
  });
});

describe('validarLote', () => {
  it('rechaza lotes que no son arreglo, vacíos o enormes', () => {
    expect(C.validarLote(null).error).toBe('FORMATO_INVALIDO');
    expect(C.validarLote({}).error).toBe('FORMATO_INVALIDO');
    expect(C.validarLote([]).error).toBe('FORMATO_INVALIDO');
    expect(C.validarLote(new Array(121).fill({ partidoId: '1', golesLocal: 0, golesVisitante: 0 })).error).toBe(
      'LOTE_DEMASIADO_GRANDE',
    );
  });

  it('separa válidos de rechazados y descarta campos desconocidos', () => {
    const r = C.validarLote([
      { partidoId: '1', golesLocal: 2, golesVisitante: '1', email: 'otro@example.com', participanteId: 'P2' },
      { partidoId: '1', golesLocal: 0, golesVisitante: 0 },
      { partidoId: '2', golesLocal: 311, golesVisitante: 16 },
      { partidoId: '<script>', golesLocal: 1, golesVisitante: 1 },
      'basura',
    ]);
    expect(r.error).toBeNull();
    expect(r.items).toEqual([{ partidoId: '1', golesLocal: 2, golesVisitante: 1 }]);
    expect(r.rechazados.map((x) => x.motivo)).toEqual([
      'DUPLICADO',
      'GOLES_INVALIDOS',
      'FORMATO_INVALIDO',
      'FORMATO_INVALIDO',
    ]);
  });
});

describe('partidoEstaAbierto y parseKickoff', () => {
  it('interpreta el texto de la hoja en hora del centro de México (UTC-6)', () => {
    expect(C.parseKickoff('2026-06-11 13:00').toISOString()).toBe('2026-06-11T19:00:00.000Z');
    expect(C.parseKickoff('11/06/2026')).toBeNull();
    expect(C.parseKickoff(42)).toBeNull();
  });

  it('cierra exactamente al kickoff y falla cerrado con fechas inválidas', () => {
    const k = new Date('2026-06-11T19:00:00Z');
    expect(C.partidoEstaAbierto(k, new Date('2026-06-11T18:59:59Z'))).toBe(true);
    expect(C.partidoEstaAbierto(k, new Date('2026-06-11T19:00:00Z'))).toBe(false);
    expect(C.partidoEstaAbierto(null, new Date())).toBe(false);
    expect(C.partidoEstaAbierto(new Date('x'), new Date())).toBe(false);
  });

  it('respeta los minutos de cierre anticipado', () => {
    const k = new Date('2026-06-11T19:00:00Z');
    expect(C.partidoEstaAbierto(k, new Date('2026-06-11T18:50:00Z'), 15)).toBe(false);
  });
});

describe('esAdmin', () => {
  it('compara contra la lista blanca sin distinguir mayúsculas', () => {
    expect(C.esAdmin('Admin@Example.com', 'otro@example.com, admin@example.com')).toBe(true);
    expect(C.esAdmin('admin@example.com.mx', 'admin@example.com')).toBe(false);
    expect(C.esAdmin('min@example.com', 'admin@example.com')).toBe(false);
    expect(C.esAdmin('admin@example.co', 'admin@example.com')).toBe(false);
    expect(C.esAdmin('', 'admin@example.com')).toBe(false);
    expect(C.esAdmin('a@example.com', '')).toBe(false);
    expect(C.esAdmin(['admin@example.com'], 'admin@example.com')).toBe(false);
  });
});

describe('textoSeguroParaHoja', () => {
  it('neutraliza fórmulas', () => {
    expect(C.textoSeguroParaHoja('=IMPORTXML("http://x")')).toBe('\'=IMPORTXML("http://x")');
    expect(C.textoSeguroParaHoja('+1')).toBe("'+1");
    expect(C.textoSeguroParaHoja('Ana')).toBe('Ana');
  });
});

describe('tablaGrupo: desempates', () => {
  it('puntos, luego diferencia de goles, luego goles a favor', () => {
    const partidos = [
      { local: 'A', visitante: 'B', golesLocal: 1, golesVisitante: 0 },
      { local: 'C', visitante: 'D', golesLocal: 3, golesVisitante: 0 },
      { local: 'A', visitante: 'C', golesLocal: 0, golesVisitante: 1 },
      { local: 'D', visitante: 'B', golesLocal: 0, golesVisitante: 2 },
      { local: 'D', visitante: 'A', golesLocal: 0, golesVisitante: 4 },
      { local: 'B', visitante: 'C', golesLocal: 3, golesVisitante: 2 },
    ];
    // A: 6 pts, dg +4, gf 5 | C: 6 pts, dg +3, gf 6 | B: 6 pts, dg +2, gf 5 | D: 0
    const t = C.tablaGrupo(['A', 'B', 'C', 'D'], partidos);
    expect(t.completo).toBe(true);
    expect(t.filas.map((f) => f.equipo)).toEqual(['A', 'C', 'B', 'D']);
    expect(t.filas[0]).toMatchObject({ pts: 6, dg: 4, gf: 5, g: 2, p: 1 });
  });

  it('con misma diferencia decide goles a favor', () => {
    const partidos = [
      { local: 'A', visitante: 'B', golesLocal: 3, golesVisitante: 3 },
      { local: 'C', visitante: 'D', golesLocal: 0, golesVisitante: 0 },
      { local: 'A', visitante: 'C', golesLocal: 1, golesVisitante: 1 },
      { local: 'D', visitante: 'B', golesLocal: 1, golesVisitante: 1 },
    ];
    const t = C.tablaGrupo(['A', 'B', 'C', 'D'], partidos);
    expect(t.completo).toBe(false);
    expect(t.filas.map((f) => f.equipo)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('cuadro 2026', () => {
  it('tiene 32 partidos de eliminatoria y 8 cruces con terceros', () => {
    expect(C.CUADRO_2026).toHaveLength(32);
    const terceros = C.CUADRO_2026.flatMap((m) => [m.local, m.visitante]).filter((c) => /^3/.test(c));
    expect(terceros).toHaveLength(8);
  });

  it('cada ganador y segundo de grupo aparece exactamente una vez en dieciseisavos', () => {
    const codigos = C.CUADRO_2026.filter((m) => m.fase === 'R32').flatMap((m) => [m.local, m.visitante]);
    C.GRUPOS.forEach((g) => {
      expect(codigos.filter((c) => c === '1' + g)).toHaveLength(1);
      expect(codigos.filter((c) => c === '2' + g)).toHaveLength(1);
    });
  });

  it('cualquier combinación de 8 grupos con tercero clasificado tiene asignación válida', () => {
    const cruces = C.CUADRO_2026.flatMap((m) =>
      [m.local, m.visitante].filter((c) => /^3/.test(c)).map((c) => ({ id: m.id, opciones: c.slice(1) })),
    );
    let combinaciones = 0;
    let sinSolucion = 0;
    const G = C.GRUPOS;
    (function elegir(desde, sel) {
      if (sel.length === 8) {
        combinaciones++;
        const a = C.asignarTerceros(sel, cruces);
        if (!a) {
          sinSolucion++;
          return;
        }
        const usados = Object.values(a);
        expect(new Set(usados).size).toBe(8);
        cruces.forEach((c) => expect(c.opciones).toContain(a[c.id]));
        return;
      }
      for (let i = desde; i < G.length; i++) elegir(i + 1, sel.concat(G[i]));
    })(0, []);
    expect(combinaciones).toBe(495);
    expect(sinSolucion).toBe(0);
  });

  it('usa la tabla oficial si se configura', () => {
    const tabla = { ABCDEFGH: { 74: 'X' } };
    expect(C.asignarTerceros(['H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'], [], tabla)).toEqual({ 74: 'X' });
  });
});

describe('resolverCuadro', () => {
  it('no resuelve "1C" mientras el grupo no termine', () => {
    const cal = C.generarCalendario(equipos48(), '2026-06-11');
    const r = C.resolverCuadro(equipos48(), cal);
    expect(r.gruposCompletos).toBe(false);
    const m76 = r.partidos.find((m) => m.id === '76');
    expect(m76).toMatchObject({ codigoLocal: '1C', codigoVisitante: '2F', local: null, visitante: null });
  });

  it('resuelve 1.º, 2.º, mejores terceros y ganadores de partido', () => {
    // Goles del 3.º sobre el 4.º: A=1, B=2, ..., L=12 -> los mejores terceros son E..L.
    const cal = calendarioConGrupos((g) => C.GRUPOS.indexOf(g) + 1);
    const r = C.resolverCuadro(equipos48(), cal);
    expect(r.gruposCompletos).toBe(true);
    expect(r.tablas.C.filas.map((f) => f.equipo)).toEqual(['C1', 'C2', 'C3', 'C4']);

    const clasificados = r.terceros.filter((t) => t.clasifica).map((t) => t.grupo);
    expect(clasificados.sort()).toEqual(['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']);

    const porId = Object.fromEntries(r.partidos.map((m) => [m.id, m]));
    expect(porId['76']).toMatchObject({ local: 'C1', visitante: 'F2' }); // 1C vs 2F
    expect(porId['73']).toMatchObject({ local: 'A2', visitante: 'B2' }); // 2A vs 2B

    // Cada tercero clasificado aparece una sola vez en dieciseisavos.
    const terceros = r.partidos
      .filter((m) => m.fase === 'R32')
      .flatMap((m) => [m.local, m.visitante])
      .filter((e) => /3$/.test(e));
    expect(terceros.sort()).toEqual(['E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3', 'L3']);
    // Y viene de uno de los grupos permitidos por su código.
    r.partidos
      .filter((m) => /^3/.test(m.codigoVisitante))
      .forEach((m) => expect(m.codigoVisitante.slice(1)).toContain(m.visitante[0]));

    // Octavos: G74 vs G77, sin jugar todavía.
    expect(porId['89']).toMatchObject({ local: null, visitante: null });
  });

  it('propaga ganadores y perdedores, incluidos penales', () => {
    const cal = calendarioConGrupos((g) => C.GRUPOS.indexOf(g) + 1);
    const m73 = cal.find((m) => m.id === '73');
    Object.assign(m73, { golesLocal: 1, golesVisitante: 1, avanza: 'B2' }); // A2 vs B2, pasa B2 en penales
    const m75 = cal.find((m) => m.id === '75');
    Object.assign(m75, { golesLocal: 0, golesVisitante: 2 }); // F1 vs C2
    const r = C.resolverCuadro(equipos48(), cal);
    const m90 = r.partidos.find((m) => m.id === '90');
    expect(m90).toMatchObject({ codigoLocal: 'G73', local: 'B2', codigoVisitante: 'G75', visitante: 'C2' });
  });

  it('un empate de eliminatoria sin "avanza" válido no resuelve al ganador', () => {
    expect(
      C.ganadorEliminatoria({ local: 'A', visitante: 'B', golesLocal: 1, golesVisitante: 1, avanza: 'Z' }),
    ).toBeNull();
    expect(C.perdedorEliminatoria({ local: 'A', visitante: 'B', golesLocal: 2, golesVisitante: 1 })).toBe('B');
  });

  it('modo provisional muestra la tabla actual aunque falten partidos', () => {
    const cal = C.generarCalendario(equipos48(), '2026-06-11');
    const r = C.resolverCuadro(equipos48(), cal, { provisional: true });
    const m76 = r.partidos.find((m) => m.id === '76');
    expect(m76.local).toBeTruthy();
    expect(m76.provisional).toBe(true);
  });
});

describe('etiquetaCodigo', () => {
  it('describe los códigos de posición', () => {
    expect(C.etiquetaCodigo('1C')).toBe('1.º C');
    expect(C.etiquetaCodigo('2F')).toBe('2.º F');
    expect(C.etiquetaCodigo('3ABCDF')).toBe('3.º A/B/C/D/F');
    expect(C.etiquetaCodigo('G74')).toBe('Gan. 74');
    expect(C.etiquetaCodigo('P101')).toBe('Perd. 101');
    expect(C.esCodigoPosicion('MEX')).toBe(false);
  });
});

describe('generarCalendario', () => {
  it('genera 104 partidos con el formato de 48 equipos', () => {
    const cal = C.generarCalendario(equipos48(), '2026-06-11');
    expect(cal).toHaveLength(104);
    expect(cal.filter((m) => m.fase === 'GRUPOS')).toHaveLength(72);
    // cada equipo juega 3 partidos de grupo
    const cuenta = {};
    cal
      .filter((m) => m.fase === 'GRUPOS')
      .forEach((m) => {
        cuenta[m.local] = (cuenta[m.local] || 0) + 1;
        cuenta[m.visitante] = (cuenta[m.visitante] || 0) + 1;
      });
    expect(Object.values(cuenta).every((n) => n === 3)).toBe(true);
    expect(Object.keys(cuenta)).toHaveLength(48);
    // orden cronológico
    for (let i = 1; i < cal.length; i++) expect(cal[i].kickoff.getTime()).toBeGreaterThan(cal[i - 1].kickoff.getTime());
  });
});

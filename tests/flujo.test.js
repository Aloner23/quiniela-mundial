/**
 * Flujo completo contra el servidor real: fase de grupos, cuadro resuelto,
 * eliminatoria con penales y tabla general.
 */
import { describe, it, expect } from 'vitest';
import { crearQuiniela, ADMIN, ANA, BETO } from './helpers.js';

function jugarGrupos(q) {
  const partidos = q.filas('Partidos').filter((p) => p.fase === 'GRUPOS');
  const ultimo = partidos.reduce((max, p) => Math.max(max, Date.parse(p.kickoff.replace(' ', 'T') + ':00-06:00')), 0);
  q.fijarReloj(ultimo + 3 * 3600000);
  const t = q.login(ADMIN);
  partidos.forEach((p, i) => {
    // Marcador determinista: gana el local en 2/3 de los partidos.
    const r = q.api.adminRegistrarResultado(t, String(p.id), i % 3 === 2 ? 0 : 2, i % 3 === 2 ? 0 : i % 2);
    expect(r.ok).toBe(true);
  });
  return t;
}

describe('flujo del torneo', () => {
  it('al terminar la fase de grupos el cuadro tiene 32 equipos distintos', () => {
    const q = crearQuiniela();
    const t = jugarGrupos(q);
    const b = q.api.getBracket(t);
    expect(b.ok).toBe(true);
    expect(b.gruposCompletos).toBe(true);
    const r32 = b.eliminatorias.filter((m) => m.fase === 'R32');
    const equipos = r32.flatMap((m) => [m.local, m.visitante]);
    expect(equipos.every(Boolean)).toBe(true);
    expect(new Set(equipos).size).toBe(32);
    expect(b.terceros.filter((x) => x.clasifica)).toHaveLength(8);
    // Las respuestas públicas nunca llevan correos.
    expect(JSON.stringify(b)).not.toMatch(/@/);
  });

  it('empate en eliminatoria exige indicar quién avanzó y propaga al siguiente partido', () => {
    const q = crearQuiniela();
    const t = jugarGrupos(q);
    const m73 = q.api.getBracket(t).eliminatorias.find((m) => m.id === '73');
    // Pronóstico de Ana sobre la eliminatoria, antes del partido.
    const kick = Date.parse(m73.kickoff);
    q.fijarReloj(kick - 3600000);
    const tAna = q.login(ANA);
    expect(
      q.api.guardarPronosticosLote(tAna, [{ partidoId: '73', golesLocal: 1, golesVisitante: 1 }]).guardados,
    ).toEqual(['73']);

    q.fijarReloj(kick + 3 * 3600000);
    const tAdmin = q.login(ADMIN);
    expect(q.api.adminRegistrarResultado(tAdmin, '73', 1, 1)).toMatchObject({ ok: false, error: 'AVANZA_INVALIDO' });
    expect(q.api.adminRegistrarResultado(tAdmin, '73', 1, 1, 'XXX')).toMatchObject({
      ok: false,
      error: 'AVANZA_INVALIDO',
    });
    expect(q.api.adminRegistrarResultado(tAdmin, '73', 1, 1, m73.visitante)).toMatchObject({
      ok: true,
      avanza: m73.visitante,
    });

    const m90 = q.api.getBracket(tAdmin).eliminatorias.find((m) => m.id === '90');
    expect(m90.local).toBe(m73.visitante);
    // Ana acertó el 1-1 exacto.
    const fila = q.api.getAppStatus(q.login(ANA)).tabla.find((f) => f.esYo);
    expect(fila.exactos).toBe(1);
  });

  it('el historial registra cambios de pronóstico con la versión anterior', () => {
    const q = crearQuiniela();
    const t = q.login(BETO);
    q.api.guardarPronosticosLote(t, [{ partidoId: '5', golesLocal: 1, golesVisitante: 0 }]);
    q.api.guardarPronosticosLote(t, [{ partidoId: '5', golesLocal: 2, golesVisitante: 2 }]);
    const h = q.api.adminHistorial(q.login(ADMIN), 10);
    expect(h.movimientos.some((m) => m.accion === 'PRONOSTICOS' && m.detalle.includes('1-0 → 2-2'))).toBe(true);
  });
});

/**
 * Cuadro de eliminatorias.
 *
 * En la hoja "Partidos" las eliminatorias se capturan con códigos de posición
 * en lugar de equipos:
 *   "1C"     ganador del grupo C
 *   "2F"     segundo del grupo F
 *   "3ABCDF" uno de los 8 mejores terceros (de los grupos A, B, C, D o F)
 *   "G89"    ganador del partido 89     "P101"  perdedor del partido 101
 *
 * QuinielaCore.resolverCuadro los convierte en equipos cuando ya se puede:
 * un grupo terminado resuelve sus "1X"/"2X"; los terceros se asignan cuando
 * terminan los 12 grupos; "G/P" cuando el partido previo tiene resultado.
 */

/** API pública: cuadro de eliminatorias y tablas de grupos (datos públicos). */
function getBracket(token) {
  return responder_(function () {
    requiereUsuario_(token);
    var nombres = nombresEquipos_();
    var r = QuinielaCore.resolverCuadro(equipos_(), partidosCrudos_(), { provisional: true });
    var grupos = {};
    Object.keys(r.tablas).forEach(function (g) {
      grupos[g] = {
        completo: r.tablas[g].completo,
        filas: r.tablas[g].filas.map(function (f) {
          return Object.assign({ nombre: nombres[f.equipo] || f.equipo }, f);
        }),
      };
    });
    return {
      gruposCompletos: r.gruposCompletos,
      grupos: grupos,
      terceros: r.terceros.map(function (t) {
        return {
          grupo: t.grupo,
          equipo: t.equipo,
          nombre: nombres[t.equipo] || t.equipo,
          pts: t.pts,
          dg: t.dg,
          gf: t.gf,
          clasifica: t.clasifica,
        };
      }),
      eliminatorias: r.partidos
        .filter(function (p) {
          return p.fase !== 'GRUPOS';
        })
        .map(function (p) {
          var vista = partidoPublico_(p, nombres);
          vista.provisional = !!p.provisional;
          return vista;
        }),
    };
  });
}

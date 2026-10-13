/**
 * Arma una quiniela en memoria lista para atacar: hojas creadas, 104
 * partidos, un administrador y dos participantes con códigos conocidos.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { crearServidorDePrueba } = require('../tools/servidor-node.js');

/** El primer partido es el 2026-06-11 a las 11:00 (CDMX) = 17:00 UTC. */
export const ANTES_DEL_PRIMER_PARTIDO = Date.parse('2026-06-11T12:00:00Z');
export const KICKOFF_PARTIDO_1 = Date.parse('2026-06-11T17:00:00Z');

export const ADMIN = { id: 'PADMIN', nombre: 'Admin Demo', email: 'admin@example.com', codigo: 'ADMIN234' };
export const ANA = { id: 'PANA', nombre: 'Ana', email: 'ana@example.com', codigo: 'ANA23456' };
export const BETO = { id: 'PBETO', nombre: 'Beto', email: 'beto@example.com', codigo: 'BETO2345' };

export function crearQuiniela(opciones = {}) {
  let t = opciones.ahora ?? ANTES_DEL_PRIMER_PARTIDO;
  const s = crearServidorDePrueba({
    propiedades: {
      ADMIN_EMAILS: ADMIN.email,
      MODO_IDENTIDAD: opciones.modo || 'TOKEN',
      SAL_CODIGOS: 'sal-de-prueba',
    },
    reloj: () => t,
    usuarioActivo: opciones.usuarioActivo || '',
  });
  s.entorno.sesion.dueno = 'dueno@example.com';
  // setupQuiniela se ejecuta "desde el editor": activo === dueño.
  const activoOriginal = s.entorno.sesion.activo;
  s.entorno.sesion.activo = s.entorno.sesion.dueno;
  const r = s.api.setupQuiniela();
  s.entorno.sesion.activo = activoOriginal;
  if (!r.ok) throw new Error('setup falló: ' + JSON.stringify(r));

  const { agregarFilas_, hashCodigo_ } = s.privadas;
  agregarFilas_(
    'Participantes',
    [ADMIN, ANA, BETO].map((p) => ({
      id: p.id,
      nombre: p.nombre,
      email: p.email,
      codigoHash: hashCodigo_(p.id, p.codigo, 'sal-de-prueba'),
      activo: true,
      creado: new Date(t),
    })),
  );

  const login = (p) => {
    const res = s.api.loginUsuario(p.email, p.codigo);
    if (!res.ok) throw new Error('login falló: ' + JSON.stringify(res));
    return res.token;
  };

  return {
    ...s,
    login,
    /** Mueve el reloj del servidor a un instante absoluto (ms). */
    fijarReloj: (ms) => {
      t = ms;
    },
    filas: (hoja) => s.privadas.leerTabla_(hoja),
    pronosticosDe: (id) => s.privadas.leerTabla_('Pronosticos').filter((p) => String(p.participanteId) === id),
  };
}

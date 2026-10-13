/**
 * Configuración global.
 *
 * Convención que sigue todo el proyecto (ver docs/SEGURIDAD.md, hallazgo 6):
 *   - Una función de nivel superior SIN guion bajo final es API pública:
 *     cualquiera que abra la web app puede llamarla desde la consola del
 *     navegador con google.script.run.<nombre>(...). Por eso cada una valida
 *     la identidad y sus argumentos.
 *   - Una función que termina en "_" es privada: Apps Script no la expone a
 *     google.script.run ni la muestra en el menú "Ejecutar" del editor.
 *
 * Los valores sensibles (administradores, sal de los códigos, modo de
 * identidad) se leen de Script Properties, nunca del código fuente.
 */

var APP_VERSION = '2.3.0';

/** Bitácora de versiones de la app (se muestra en el pie de la web app). */
var CHANGELOG = [
  { version: '2.3.0', cambios: 'Bracket visual con códigos de posición y mejores terceros.' },
  { version: '2.2.0', cambios: 'Endurecimiento tras prueba de penetración propia (ver SEGURIDAD.md).' },
  { version: '2.1.0', cambios: 'Panel de administración y bitácora de cambios de pronósticos.' },
  { version: '2.0.0', cambios: 'Captura de pronósticos por lote y tabla general.' },
];

var CONFIG = {
  ZONA_HORARIA: 'America/Mexico_City',
  /** Desfase fijo de la zona (min). México centro no usa horario de verano. */
  DESFASE_ZONA_MIN: -360,
  MINUTOS_CIERRE: 0,
  MAX_LOTE: 120,
  MODO_IDENTIDAD: 'TOKEN',
  SESION_TTL_SEG: 21600, // 6 h: el máximo de CacheService
  MAX_INTENTOS_LOGIN: 5,
  BLOQUEO_LOGIN_SEG: 900,
  LOCK_TIMEOUT_MS: 10000,
  TABLA_CACHE_SEG: 3600,

  HOJAS: {
    EQUIPOS: 'Equipos',
    PARTIDOS: 'Partidos',
    PARTICIPANTES: 'Participantes',
    PRONOSTICOS: 'Pronosticos',
    HISTORIAL: 'Historial',
    TABLA: 'Tabla',
  },

  ENCABEZADOS: {
    Equipos: ['codigo', 'nombre', 'grupo'],
    Partidos: [
      'id',
      'fase',
      'grupo',
      'jornada',
      'local',
      'visitante',
      'kickoff',
      'sede',
      'golesLocal',
      'golesVisitante',
      'avanza',
    ],
    Participantes: ['id', 'nombre', 'email', 'codigoHash', 'activo', 'creado'],
    Pronosticos: ['participanteId', 'partidoId', 'golesLocal', 'golesVisitante', 'version', 'actualizado'],
    Historial: ['fecha', 'actor', 'accion', 'detalle'],
    Tabla: ['posicion', 'nombre', 'puntos', 'exactos', 'aciertos', 'jugados'],
  },
};

/**
 * Configuración efectiva: CONFIG + Script Properties.
 * Propiedades reconocidas: MODO_IDENTIDAD (DOMINIO | TOKEN), ADMIN_EMAILS
 * (CSV), PUNTOS_EXACTO, PUNTOS_RESULTADO, MINUTOS_CIERRE, SPREADSHEET_ID,
 * SAL_CODIGOS.
 */
function configEfectiva_() {
  var props = PropertiesService.getScriptProperties();
  function num(clave, defecto) {
    var v = props.getProperty(clave);
    if (v === null || v === undefined || v === '') return defecto;
    var n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : defecto;
  }
  var modo = String(props.getProperty('MODO_IDENTIDAD') || CONFIG.MODO_IDENTIDAD).toUpperCase();
  return {
    modoIdentidad: modo === 'DOMINIO' ? 'DOMINIO' : 'TOKEN',
    adminEmails: String(props.getProperty('ADMIN_EMAILS') || ''),
    sal: String(props.getProperty('SAL_CODIGOS') || ''),
    puntos: {
      EXACTO: num('PUNTOS_EXACTO', QuinielaCore.PUNTOS_DEFECTO.EXACTO),
      RESULTADO: num('PUNTOS_RESULTADO', QuinielaCore.PUNTOS_DEFECTO.RESULTADO),
    },
    minutosCierre: num('MINUTOS_CIERRE', CONFIG.MINUTOS_CIERRE),
    golesMin: QuinielaCore.GOLES_MIN,
    golesMax: QuinielaCore.GOLES_MAX,
    maxLote: CONFIG.MAX_LOTE,
  };
}

/** Reloj del servidor. Aislado para poder fijarlo en pruebas. */
function ahora_() {
  return new Date();
}

/** Error esperado: se convierte en { ok:false, error, mensaje } para el cliente. */
function ErrorQuiniela_(codigo, mensaje) {
  this.codigo = codigo;
  this.message = mensaje || codigo;
}

var MENSAJES_ = {
  NO_AUTENTICADO: 'Tu sesión no es válida o expiró. Vuelve a entrar.',
  NO_AUTORIZADO: 'No tienes permiso para esta acción.',
  CREDENCIALES_INVALIDAS: 'Correo o código de acceso incorrectos.',
  DEMASIADOS_INTENTOS: 'Demasiados intentos. Espera 15 minutos y vuelve a intentar.',
  FORMATO_INVALIDO: 'La solicitud no tiene el formato esperado.',
  LOTE_DEMASIADO_GRANDE: 'Demasiados pronósticos en un solo envío.',
  GOLES_INVALIDOS: 'Los goles deben ser números enteros entre 0 y 30.',
  PARTIDO_INEXISTENTE: 'Ese partido no existe.',
  PARTIDO_CERRADO: 'El partido ya empezó; los pronósticos están cerrados.',
  PARTIDO_NO_INICIADO: 'No se puede capturar el resultado de un partido que no ha empezado.',
  EQUIPOS_POR_DEFINIR: 'Los equipos de este partido aún no están definidos.',
  AVANZA_INVALIDO: 'En un empate de eliminatoria indica qué equipo avanzó por penales.',
  DUPLICADO: 'Ya existe un registro con esos datos.',
  OCUPADO: 'El servidor está ocupado. Intenta de nuevo en unos segundos.',
  CONFIGURACION: 'La quiniela no está configurada. Avisa al administrador.',
};

function error_(codigo, mensaje) {
  return new ErrorQuiniela_(codigo, mensaje || MENSAJES_[codigo]);
}

/**
 * Envuelve cada función pública: convierte errores esperados en respuestas
 * { ok:false } y oculta los inesperados (nunca se manda un stack al cliente).
 */
function responder_(fn) {
  try {
    var r = fn() || {};
    r.ok = true;
    return r;
  } catch (e) {
    if (e instanceof ErrorQuiniela_) return { ok: false, error: e.codigo, mensaje: e.message };
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado. Intenta de nuevo.' };
  }
}

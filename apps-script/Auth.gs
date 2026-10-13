/**
 * Identidad y autorización.
 *
 * Regla de oro (hallazgo 1 de docs/SEGURIDAD.md): el servidor NUNCA acepta del
 * cliente quién es el usuario. Ninguna función pública recibe un email para
 * decidir a nombre de quién actúa. La identidad sale de una de dos fuentes:
 *
 *   MODO_IDENTIDAD = DOMINIO
 *     La web app se despliega con "Ejecutar como: yo" y "Acceso: usuarios del
 *     dominio". Session.getActiveUser().getEmail() devuelve la cuenta de Google
 *     Workspace que está viendo la página; Google ya la autenticó.
 *
 *   MODO_IDENTIDAD = TOKEN
 *     Para cuentas personales (donde getActiveUser() llega vacío). El usuario
 *     entra con su correo + un código de acceso que le entregó el admin. El
 *     servidor verifica el hash del código y emite un token aleatorio (UUID v4)
 *     que se guarda en CacheService con vigencia de 6 h. El cliente sólo
 *     conserva ese token; el servidor lo traduce a un participante en cada
 *     llamada.
 */

var PREFIJO_SESION_ = 'sesion:';
var PREFIJO_INTENTOS_ = 'intentos:';

function cache_() {
  return CacheService.getScriptCache();
}

/** SHA-256 en hexadecimal. */
function sha256Hex_(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes
    .map(function (b) {
      var h = (b & 0xff).toString(16);
      return h.length === 1 ? '0' + h : h;
    })
    .join('');
}

/** Hash del código de acceso, con sal global y el id del participante. */
function hashCodigo_(participanteId, codigo, sal) {
  return sha256Hex_(String(sal) + ':' + String(participanteId) + ':' + String(codigo));
}

/** Comparación de longitud constante para evitar filtrar información por tiempo. */
function igualesSeguro_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Código de acceso legible de 8 caracteres (sin 0/O/1/I para dictarlo fácil). */
function generarCodigo_() {
  var alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var semilla = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var out = '';
  for (var i = 0; i < 8; i++) out += alfabeto[parseInt(semilla.substr(i * 2, 2), 16) % alfabeto.length];
  return out;
}

function participantes_() {
  return leerTabla_(CONFIG.HOJAS.PARTICIPANTES).map(function (p) {
    return {
      _fila: p._fila,
      id: String(p.id),
      nombre: String(p.nombre),
      email: QuinielaCore.normalizarEmail(String(p.email)) || '',
      codigoHash: String(p.codigoHash || ''),
      activo: esVerdadero_(p.activo),
      creado: p.creado,
    };
  });
}

function buscarPorEmail_(email) {
  var e = QuinielaCore.normalizarEmail(email);
  if (!e) return null;
  var lista = participantes_();
  for (var i = 0; i < lista.length; i++) if (lista[i].email === e && lista[i].activo) return lista[i];
  return null;
}

function buscarPorId_(id) {
  var lista = participantes_();
  for (var i = 0; i < lista.length; i++) if (lista[i].id === String(id) && lista[i].activo) return lista[i];
  return null;
}

/**
 * Participante que hace la llamada, o null.
 * @param {string} token sólo se usa en modo TOKEN; en modo DOMINIO se ignora.
 */
function usuarioActual_(token) {
  var cfg = configEfectiva_();
  if (cfg.modoIdentidad === 'DOMINIO') {
    return buscarPorEmail_(Session.getActiveUser().getEmail());
  }
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) return null;
  var participanteId = cache_().get(PREFIJO_SESION_ + token);
  if (!participanteId) return null;
  return buscarPorId_(participanteId);
}

/** Igual que usuarioActual_, pero lanza NO_AUTENTICADO si no hay sesión. */
function requiereUsuario_(token) {
  var u = usuarioActual_(token);
  if (!u) throw error_('NO_AUTENTICADO');
  return u;
}

/**
 * Guardia de administrador (hallazgo 5). Se llama en la PRIMERA línea de cada
 * función admin*. La lista blanca vive en Script Properties (ADMIN_EMAILS) y
 * se compara contra el correo del participante resuelto en el servidor.
 */
function requiereAdmin_(token) {
  var u = usuarioActual_(token);
  if (!u) throw error_('NO_AUTENTICADO');
  if (!QuinielaCore.esAdmin(u.email, configEfectiva_().adminEmails)) {
    registrarHistorial_(u.id, 'ACCESO_DENEGADO', 'Intento de función de administrador');
    throw error_('NO_AUTORIZADO');
  }
  return u;
}

function perfilPublico_(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    esAdmin: QuinielaCore.esAdmin(u.email, configEfectiva_().adminEmails),
  };
}

/**
 * API pública: iniciar sesión.
 *
 * Modo TOKEN: verifica correo + código y devuelve un token de sesión.
 * Modo DOMINIO: los argumentos se ignoran; la identidad es la cuenta de Google.
 *
 * Límite de intentos: 5 fallos por correo bloquean ese correo 15 minutos.
 * El mensaje de error es el mismo si el correo no existe o si el código está
 * mal, para no confirmar qué correos están inscritos.
 */
function loginUsuario(email, codigo) {
  return responder_(function () {
    var cfg = configEfectiva_();
    if (cfg.modoIdentidad === 'DOMINIO') {
      var u = usuarioActual_();
      if (!u)
        throw error_('NO_AUTENTICADO', 'Tu cuenta no está inscrita en la quiniela. Pide acceso al administrador.');
      return { modo: 'DOMINIO', usuario: perfilPublico_(u) };
    }

    var e = QuinielaCore.normalizarEmail(email);
    if (!e || typeof codigo !== 'string' || codigo.length < 4 || codigo.length > 64) {
      throw error_('CREDENCIALES_INVALIDAS');
    }
    var claveIntentos = PREFIJO_INTENTOS_ + e;
    var intentos = Number(cache_().get(claveIntentos) || 0);
    if (intentos >= CONFIG.MAX_INTENTOS_LOGIN) throw error_('DEMASIADOS_INTENTOS');

    var p = buscarPorEmail_(e);
    var codigoNorm = codigo.trim().toUpperCase();
    var valido = !!p && !!p.codigoHash && igualesSeguro_(hashCodigo_(p.id, codigoNorm, cfg.sal), p.codigoHash);
    if (!valido) {
      cache_().put(claveIntentos, String(intentos + 1), CONFIG.BLOQUEO_LOGIN_SEG);
      registrarHistorial_(e, 'LOGIN_FALLIDO', 'Intento ' + (intentos + 1));
      throw error_('CREDENCIALES_INVALIDAS');
    }
    cache_().remove(claveIntentos);
    var token = Utilities.getUuid();
    cache_().put(PREFIJO_SESION_ + token, p.id, CONFIG.SESION_TTL_SEG);
    return { modo: 'TOKEN', token: token, expiraEnSeg: CONFIG.SESION_TTL_SEG, usuario: perfilPublico_(p) };
  });
}

/** API pública: cerrar sesión (invalida el token en el servidor). */
function cerrarSesion(token) {
  return responder_(function () {
    if (typeof token === 'string' && /^[0-9a-f-]{36}$/i.test(token)) cache_().remove(PREFIJO_SESION_ + token);
    return {};
  });
}

/** API pública: ¿quién soy? Útil al recargar la página con un token guardado. */
function quienSoy(token) {
  return responder_(function () {
    return { modo: configEfectiva_().modoIdentidad, usuario: perfilPublico_(requiereUsuario_(token)) };
  });
}

/**
 * Simulación en memoria de los servicios de Apps Script que usa la quiniela:
 * SpreadsheetApp, CacheService, PropertiesService, LockService, Session y
 * Utilities.
 *
 * Se usa en dos lugares:
 *   - tests/: las pruebas cargan los .gs reales en un contexto de Node con
 *     estos objetos como globales.
 *   - demo/: el navegador carga los mismos .gs y estos objetos, de modo que la
 *     demo ejecuta el código del servidor real contra una hoja en memoria.
 *
 * Sólo implementa lo que el proyecto necesita; no pretende ser completo.
 */
(function (raiz, fabrica) {
  if (typeof module !== 'undefined' && module.exports) module.exports = fabrica();
  else raiz.GasMock = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // SHA-256 (sincrónico, sin dependencias) para Utilities.computeDigest
  // ---------------------------------------------------------------------------
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ];

  function utf8(texto) {
    var s = unescape(encodeURIComponent(String(texto)));
    var out = new Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function sha256(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length;
    var m = bytes.slice();
    m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    var bits = l * 8;
    for (var s = 7; s >= 0; s--) m.push(s >= 4 ? 0 : (bits >>> (s * 8)) & 0xff);
    var w = new Array(64);
    for (var off = 0; off < m.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        w[t] = (m[off + t * 4] << 24) | (m[off + t * 4 + 1] << 16) | (m[off + t * 4 + 2] << 8) | m[off + t * 4 + 3];
      }
      for (t = 16; t < 64; t++) {
        var x = w[t - 15];
        var y = w[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = H[0],
        b = H[1],
        c = H[2],
        d = H[3],
        e = H[4],
        f = H[5],
        g = H[6],
        h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      H = [H[0] + a, H[1] + b, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + h].map(function (v) {
        return v | 0;
      });
    }
    var out = [];
    H.forEach(function (v) {
      out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    });
    return out;
  }

  function uuid() {
    var b = new Array(16);
    var c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
    if (c) {
      var arr = new Uint8Array(16);
      c.getRandomValues(arr);
      for (var i = 0; i < 16; i++) b[i] = arr[i];
    } else {
      for (var j = 0; j < 16; j++) b[j] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = b.map(function (v) {
      return (v < 16 ? '0' : '') + v.toString(16);
    });
    return [hex.slice(0, 4), hex.slice(4, 6), hex.slice(6, 8), hex.slice(8, 10), hex.slice(10)]
      .map(function (p) {
        return p.join('');
      })
      .join('-');
  }

  // ---------------------------------------------------------------------------
  // Hoja de cálculo en memoria
  // ---------------------------------------------------------------------------

  function columnaA1(letras) {
    var n = 0;
    for (var i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64);
    return n;
  }

  function crearHoja(nombre, libro) {
    var datos = [];
    function asegurar(fila, col) {
      while (datos.length < fila) datos.push([]);
      var r = datos[fila - 1];
      while (r.length < col) r.push('');
    }
    function rango(fila, col, nf, nc) {
      return {
        getValues: function () {
          var out = [];
          for (var i = 0; i < nf; i++) {
            var r = datos[fila - 1 + i] || [];
            var linea = [];
            for (var j = 0; j < nc; j++) {
              var v = r[col - 1 + j];
              linea.push(v === undefined ? '' : v instanceof Date ? new Date(v.getTime()) : v);
            }
            out.push(linea);
          }
          return out;
        },
        setValues: function (vals) {
          if (
            !vals ||
            vals.length !== nf ||
            vals.some(function (r) {
              return r.length !== nc;
            })
          ) {
            throw new Error('Las dimensiones de los datos no coinciden con el rango.');
          }
          libro.escrituras++;
          for (var i = 0; i < nf; i++) {
            asegurar(fila + i, col + nc - 1);
            for (var j = 0; j < nc; j++) datos[fila - 1 + i][col - 1 + j] = vals[i][j];
          }
          return this;
        },
        clearContent: function () {
          libro.escrituras++;
          for (var i = 0; i < nf; i++) {
            var r = datos[fila - 1 + i];
            if (!r) continue;
            for (var j = 0; j < nc; j++) if (col - 1 + j < r.length) r[col - 1 + j] = '';
          }
          return this;
        },
        setFontWeight: function () {
          return this;
        },
        setNumberFormat: function () {
          return this;
        },
      };
    }
    return {
      getName: function () {
        return nombre;
      },
      getLastRow: function () {
        for (var i = datos.length - 1; i >= 0; i--) {
          if (
            datos[i].some(function (v) {
              return v !== '' && v !== null && v !== undefined;
            })
          )
            return i + 1;
        }
        return 0;
      },
      getRange: function (fila, col, nf, nc) {
        if (typeof fila === 'string') {
          var m = /^([A-Z]+):([A-Z]+)$/.exec(fila);
          if (!m) throw new Error('Notación A1 no soportada en el mock: ' + fila);
          var c1 = columnaA1(m[1]);
          return rango(1, c1, Math.max(datos.length, 1), columnaA1(m[2]) - c1 + 1);
        }
        return rango(fila, col, nf || 1, nc || 1);
      },
      setFrozenRows: function () {},
      _datos: datos,
    };
  }

  function crearLibro() {
    var hojas = {};
    var libro = {
      escrituras: 0,
      getSheetByName: function (n) {
        return hojas[n] || null;
      },
      insertSheet: function (n) {
        hojas[n] = crearHoja(n, libro);
        return hojas[n];
      },
      getSheets: function () {
        return Object.keys(hojas).map(function (k) {
          return hojas[k];
        });
      },
    };
    return libro;
  }

  // ---------------------------------------------------------------------------
  // Entorno completo
  // ---------------------------------------------------------------------------

  /**
   * @param {{propiedades?:Object, usuarioActivo?:string, dueno?:string, reloj?:function():number}} [opciones]
   */
  function crear(opciones) {
    var o = opciones || {};
    var desfaseReloj = 0;
    var reloj = function () {
      return (o.reloj ? o.reloj() : Date.now()) + desfaseReloj;
    };
    var libro = crearLibro();
    var props = Object.assign({}, o.propiedades || {});
    var cache = {};
    var sesion = { activo: o.usuarioActivo || '', dueno: o.dueno || 'dueno@example.com' };
    var candado = { disponible: true };

    var entorno = {
      reloj: reloj,
      /** Adelanta o atrasa el reloj simulado (ms). */
      moverReloj: function (ms) {
        desfaseReloj += ms;
      },
      libro: libro,
      cache: cache,
      sesion: sesion,
      candado: candado,
      propiedades: props,
      SpreadsheetApp: {
        getActiveSpreadsheet: function () {
          return libro;
        },
        openById: function () {
          return libro;
        },
      },
      CacheService: {
        getScriptCache: function () {
          return {
            get: function (k) {
              var e = cache[k];
              if (!e) return null;
              if (e.expira <= reloj()) {
                delete cache[k];
                return null;
              }
              return e.valor;
            },
            put: function (k, v, seg) {
              cache[k] = { valor: String(v), expira: reloj() + Math.min(seg || 600, 21600) * 1000 };
            },
            remove: function (k) {
              delete cache[k];
            },
          };
        },
      },
      PropertiesService: {
        getScriptProperties: function () {
          return {
            getProperty: function (k) {
              return Object.prototype.hasOwnProperty.call(props, k) ? String(props[k]) : null;
            },
            setProperty: function (k, v) {
              props[k] = String(v);
              return this;
            },
            getProperties: function () {
              return Object.assign({}, props);
            },
          };
        },
      },
      LockService: {
        getScriptLock: function () {
          return {
            tryLock: function () {
              return candado.disponible;
            },
            releaseLock: function () {},
          };
        },
      },
      Session: {
        getActiveUser: function () {
          return {
            getEmail: function () {
              return sesion.activo;
            },
          };
        },
        getEffectiveUser: function () {
          return {
            getEmail: function () {
              return sesion.dueno;
            },
          };
        },
      },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'SHA_256' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: function (alg, texto) {
          if (alg !== 'SHA_256') throw new Error('Algoritmo no soportado en el mock');
          return sha256(utf8(texto)).map(function (b) {
            return b > 127 ? b - 256 : b; // Apps Script devuelve bytes con signo
          });
        },
        getUuid: uuid,
        formatDate: function (fecha, zona, formato) {
          // Sólo la zona de la quiniela (UTC-6 fijo) y "yyyy-MM-dd HH:mm".
          var d = new Date(fecha.getTime() - 6 * 3600000);
          var p = function (n) {
            return (n < 10 ? '0' : '') + n;
          };
          return formato
            .replace('yyyy', d.getUTCFullYear())
            .replace('MM', p(d.getUTCMonth() + 1))
            .replace('dd', p(d.getUTCDate()))
            .replace('HH', p(d.getUTCHours()))
            .replace('mm', p(d.getUTCMinutes()));
        },
      },
    };
    return entorno;
  }

  return { crear: crear, sha256: sha256, utf8: utf8, uuid: uuid };
});

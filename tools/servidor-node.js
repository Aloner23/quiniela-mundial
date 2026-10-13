/**
 * Carga el servidor empaquetado en Node con un entorno de Apps Script simulado.
 * Lo usan las pruebas y el script que genera los datos de la demo.
 */
'use strict';

const { codigoFabrica } = require('./empaquetar');
const GasMock = require('./gas-mock');

let fabrica = null;

/**
 * @param {Parameters<typeof GasMock.crear>[0]} [opciones]
 * @return {{entorno: object, api: object, privadas: object}}
 */
function crearServidorDePrueba(opciones) {
  if (!fabrica) fabrica = new Function(codigoFabrica() + '\nreturn crearServidor;')();
  const entorno = GasMock.crear(opciones);
  const s = fabrica(entorno);
  return { entorno, api: s.publicas, privadas: s.privadas };
}

module.exports = { crearServidorDePrueba };

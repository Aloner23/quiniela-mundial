# Prueba de penetración de la quiniela

Este documento cuenta cómo ataqué mi propia aplicación, qué encontré y cómo lo corregí. Cada hallazgo termina con la prueba automatizada que demuestra que el arreglo funciona, para que no vuelva a pasar sin que nadie se entere.

> **Contexto.** La quiniela original la construí en Google Apps Script para un grupo de unas 30 personas. Ese código pertenece a mi empleador y no está aquí. Este repositorio es una **reconstrucción desde cero** con las mismas ideas y las mismas correcciones. Los nombres de funciones (`guardarPronosticosLote`, `getAppStatus`, `loginUsuario`, `calcularPuntosGlobales`, `partidoEstaAbierto`) se conservan porque son parte de la historia. Los fragmentos de "código vulnerable" de abajo son ilustrativos: muestran el patrón, no el código original.

## Índice

1. [Modelo de amenazas](#modelo-de-amenazas)
2. [Cómo se ataca una web app de Apps Script](#cómo-se-ataca-una-web-app-de-apps-script)
3. [Hallazgo 1: suplantación de identidad](#hallazgo-1-suplantación-de-identidad) (crítico)
4. [Hallazgo 2: fuga de información en `getAppStatus`](#hallazgo-2-fuga-de-información-en-getappstatus) (alto)
5. [Hallazgo 3: edición de partidos cerrados](#hallazgo-3-edición-de-partidos-cerrados) (ya estaba controlado)
6. [Hallazgo 4: goles sin validar](#hallazgo-4-goles-sin-validar) (medio)
7. [Hallazgo 5: funciones de administrador sin guardia](#hallazgo-5-funciones-de-administrador-sin-guardia) (crítico)
8. [Hallazgo 6: toda función de nivel superior es API pública](#hallazgo-6-toda-función-de-nivel-superior-es-api-pública) (causa raíz)
9. [Defensas adicionales](#defensas-adicionales)
10. [Cómo correr las pruebas](#cómo-correr-las-pruebas)
11. [Riesgos que acepto](#riesgos-que-acepto)

---

## Modelo de amenazas

**Qué se protege**

| Activo                            | Por qué importa                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| La tabla general                  | Es lo único que de verdad le importa a la gente. Si se puede manipular, la quiniela pierde sentido. |
| Los pronósticos antes del partido | Si puedo ver el marcador que puso el líder, lo copio o lo contrarresto.                             |
| Los correos de los participantes  | Son datos personales de compañeros de trabajo.                                                      |
| Los resultados oficiales          | Quien los capture decide los puntos de todos.                                                       |

**Quién ataca**

No pensé en un atacante sofisticado de internet: la web app sólo es accesible para cuentas del dominio. El atacante realista es **un participante curioso o competitivo**, con una cuenta legítima, que sabe abrir las herramientas de desarrollador del navegador. Tiene tiempo (el torneo dura un mes), tiene motivo (presumir el primer lugar) y no necesita ninguna herramienta especial.

**Supuestos**

- Google autentica correctamente la cuenta que abre la web app. No intento romper Google.
- El editor del script y la hoja de cálculo sólo los ve el administrador.
- Todo lo que corre en el navegador está bajo control del usuario: el HTML, el JavaScript, el reloj y los argumentos de cada llamada.

Ese último punto es el que más importa. **El cliente es territorio enemigo.**

## Cómo se ataca una web app de Apps Script

Una web app de Apps Script se comunica con el servidor con `google.script.run`. La página real hace algo así:

```js
google.script.run
  .withSuccessHandler(pintar)
  .guardarPronosticosLote(token, [{ partidoId: '12', golesLocal: 2, golesVisitante: 1 }]);
```

El detalle que mucha gente no considera: **ese mismo objeto existe en la consola del navegador**. La página corre dentro de un iframe (`*.googleusercontent.com`); basta con elegir ese contexto en el selector de la consola de DevTools y escribir:

```js
google.script.run.withSuccessHandler(console.log).getAppStatus();
```

Con eso se puede llamar **cualquier función de nivel superior** de cualquier archivo `.gs` del proyecto, con los argumentos que uno quiera. No hace falta interceptar tráfico ni usar un proxy. Todo mi pentest se hizo así: abrir la consola, listar las funciones del proyecto y probar qué pasa si les mando lo que no esperan.

---

## Hallazgo 1: suplantación de identidad

**Severidad: crítica.** Cualquier participante podía guardar pronósticos a nombre de cualquier otro.

### El problema

La primera versión identificaba al usuario con un correo que mandaba el propio cliente. El correo salía de un formulario de login que sólo comparaba contra la hoja de participantes, y después se quedaba en una variable de JavaScript que se mandaba en cada llamada:

```js
// Patrón vulnerable (ilustrativo)
function guardarPronosticosLote(email, lote) {
  var participante = buscarPorEmail(email); // el servidor confía en el cliente
  lote.forEach(function (p) {
    escribirPronostico(participante.id, p);
  });
}
```

### El ataque

```js
google.script.run.guardarPronosticosLote('companero@dominio', [{ partidoId: '12', golesLocal: 0, golesVisitante: 7 }]);
```

Funcionaba. Podía arruinarle los pronósticos al líder justo antes del partido, y para él sería imposible saber quién fue.

### La corrección

**Ninguna función pública recibe "quién soy".** La identidad se obtiene siempre en el servidor, de una de dos fuentes según el despliegue (`MODO_IDENTIDAD` en Script Properties):

| Modo      | Cuándo usarlo                                               | De dónde sale la identidad                                                                                                      |
| --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DOMINIO` | Google Workspace, web app con acceso "usuarios del dominio" | `Session.getActiveUser().getEmail()`: Google ya autenticó a quien abre la página. Los argumentos del cliente se ignoran.        |
| `TOKEN`   | Cuentas personales (ahí `getActiveUser()` llega vacío)      | `loginUsuario(correo, código)` verifica el hash del código y emite un UUID v4 aleatorio guardado en `CacheService` por 6 horas. |

En modo `TOKEN` el cliente sólo guarda un identificador opaco y sin significado. El servidor lo traduce a un participante en cada llamada ([`Auth.gs`](../apps-script/Auth.gs)):

```js
function usuarioActual_(token) {
  if (configEfectiva_().modoIdentidad === 'DOMINIO') {
    return buscarPorEmail_(Session.getActiveUser().getEmail());
  }
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) return null;
  var participanteId = cache_().get('sesion:' + token);
  return participanteId ? buscarPorId_(participanteId) : null;
}
```

Detalles que también importan:

- **Los campos que el cliente mete de más se descartan.** `QuinielaCore.validarLote` copia sólo `partidoId`, `golesLocal` y `golesVisitante`. Si alguien agrega `email` o `participanteId` dentro del lote, se ignoran.
- **El código de acceso nunca se guarda.** La hoja tiene `SHA-256(sal + id + código)`. La sal vive en Script Properties, fuera de la hoja.
- **Se limitan los intentos.** Cinco fallos bloquean ese correo 15 minutos, y el mensaje es el mismo si el correo no existe o si el código está mal, para no confirmar quién está inscrito.
- **Cerrar sesión borra el token en el servidor**, no sólo en el navegador.

### La prueba que lo demuestra

[`tests/seguridad.test.js`, "Hallazgo 1"](../tests/seguridad.test.js):

- Repite el ataque original (correo ajeno como primer argumento): `NO_AUTENTICADO` y cero filas escritas a nombre de la víctima.
- Mete `email` y `participanteId` ajenos dentro del lote: se guarda a nombre de quien tiene la sesión.
- Prueba tokens inventados, vacíos, `null`, objetos y arreglos.
- Comprueba que el token expira a las 6 h y que `cerrarSesion` lo invalida.
- Confirma que el login responde exactamente lo mismo para "correo inexistente" y "código incorrecto", y que el bloqueo por intentos funciona.
- En modo `DOMINIO`, simula a una persona que manda el correo de otra: se ignora y se usa `Session.getActiveUser()`.

---

## Hallazgo 2: fuga de información en `getAppStatus`

**Severidad: alta.** Cualquiera podía ver el correo y todos los pronósticos de todos los participantes, incluidos los de partidos que aún no empezaban.

### El problema

`getAppStatus` era una sola llamada que traía "todo lo que la página necesita". Era cómodo: una sola ida al servidor. Pero "todo" incluía la lista completa de participantes con correo y sus pronósticos, porque la tabla general se calculaba en el cliente:

```js
// Patrón vulnerable (ilustrativo)
function getAppStatus() {
  return {
    participantes: leerHoja('Participantes'), // id, nombre, email...
    pronosticos: leerHoja('Pronosticos'), // de TODOS
    partidos: leerHoja('Partidos'),
  };
}
```

La interfaz sólo mostraba nombres y puntos. Pero lo que la interfaz no muestra no está oculto: viaja en la respuesta.

### El ataque

```js
google.script.run
  .withSuccessHandler(function (r) {
    console.table(r.pronosticos.filter((p) => p.partidoId === '12'));
  })
  .getAppStatus();
```

Una tabla con el marcador que puso cada persona para el partido de hoy, una hora antes de que cerrara la captura.

### La corrección

La respuesta se arma con **listas blancas de campos**, nunca devolviendo filas completas de la hoja ([`Status.gs`](../apps-script/Status.gs)):

| Dato                  | Quién lo ve                                    | Qué campos                                                               |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| Tabla general         | Todos los autenticados                         | `posicion`, `nombre`, `puntos`, `exactos`, `aciertos`, `jugados`, `esYo` |
| Pronósticos           | Sólo el dueño                                  | Los suyos: `partidoId`, goles, `version`, `puntos` obtenidos             |
| Partidos              | Todos los autenticados                         | Calendario, sedes, resultados oficiales                                  |
| Correos               | Nadie (sólo el admin, en `adminParticipantes`) | -                                                                        |
| Ids internos de otros | Nadie                                          | -                                                                        |

La tabla general se calcula **en el servidor** y se guarda en caché. Así el cliente no necesita los pronósticos ajenos para nada.

También se cuidan los errores: `responder_()` convierte cualquier excepción inesperada en `{ ok: false, error: 'ERROR_INTERNO' }` y manda el detalle sólo a los logs de Apps Script. Un stack trace con nombres de hojas o rutas internas también es información.

### La prueba que lo demuestra

[`tests/seguridad.test.js`, "Hallazgo 2"](../tests/seguridad.test.js): otro participante guarda marcadores reconocibles (27-13, 19-17) y luego se revisa la respuesta **serializada completa** de `getAppStatus`:

- No contiene ninguna cadena `@example.com`, ni siquiera el correo propio.
- No contiene los ids internos de otros participantes.
- No contiene los marcadores ajenos.
- Cada fila de la tabla tiene exactamente las siete llaves permitidas.
- Un error interno forzado responde `ERROR_INTERNO` sin el mensaje original.

Buscar en el JSON completo y no en campos específicos es deliberado: si mañana alguien agrega un campo nuevo que filtre datos, la prueba lo detecta.

---

## Hallazgo 3: edición de partidos cerrados

**Severidad: ninguna (control que ya funcionaba).** Lo incluyo porque el pentest también sirve para confirmar lo que sí está bien.

### Lo que esperaba encontrar

El cliente muestra una cuenta regresiva y deshabilita los campos cuando empieza el partido. Si esa fuera la única defensa, bastaría con llamar a `guardarPronosticosLote` desde la consola, o adelantar el reloj de la computadora, para cambiar un pronóstico con el partido ya en curso (o terminado).

### Lo que encontré

No funcionó: desde la primera versión, `partidoEstaAbierto` leía el kickoff **de la hoja** y lo comparaba con el reloj **del servidor**. El cliente no participa en la decisión.

```js
function partidoEstaAbierto_(partido) {
  return QuinielaCore.partidoEstaAbierto(partido.kickoff, ahora_(), configEfectiva_().minutosCierre);
}
```

En la reconstrucción conservé el control y lo hice más estricto:

- **Falla cerrado.** Si el kickoff en la hoja no es una fecha válida, el partido se considera cerrado.
- **Zona horaria explícita.** El kickoff se guarda como texto `yyyy-MM-dd HH:mm` en hora del centro de México y se interpreta con un desfase fijo (UTC-6; México eliminó el horario de verano en 2022). Así no depende de la configuración regional de la hoja.
- **Eliminatorias sin equipos definidos** ("Gan. 74 vs Gan. 77") no aceptan pronósticos.
- **Lotes mixtos**: cada partido se acepta o se rechaza por separado, y la respuesta dice cuál y por qué.

### La prueba que lo demuestra

[`tests/seguridad.test.js`, "Hallazgo 3"](../tests/seguridad.test.js): con el reloj del servidor simulado, el pronóstico se rechaza **en el segundo exacto del kickoff**. Mandar `abierto: true` o un `kickoff` del año 2099 en el lote no cambia nada. Un lote con un partido cerrado y uno abierto guarda sólo el abierto.

---

## Hallazgo 4: goles sin validar

**Severidad: media.** Se podían guardar marcadores absurdos que rompían la tabla y la interfaz.

### El ataque

```js
google.script.run.guardarPronosticosLote(token, [{ partidoId: '12', golesLocal: 311, golesVisitante: 16 }]);
```

Se guardaba. El `<input type="number" max="20">` de la página no protege nada: es una sugerencia para el navegador. Con la misma idea se podía mandar `-1`, `1.5`, `"=IMPORTXML(...)"`, `null` o un objeto. Algunos valores rompían el cálculo de puntos (un `NaN` contagia toda la suma) y el texto que empieza con `=` se convertía en **fórmula** al escribirse en Sheets.

### La corrección

`QuinielaCore.normalizarGoles` ([`Core.js`](../apps-script/Core.js)) acepta sólo **enteros de 0 a 30**, como número o como texto de 1-2 dígitos (un `<input>` puede mandar `"2"`). Rechaza todo lo demás: negativos, decimales, `"1e1"`, `"0x1"`, `NaN`, `Infinity`, `null`, booleanos, objetos y arreglos.

El lote completo también tiene límites: tiene que ser un arreglo de 1 a 120 elementos, ids con formato válido y sin partidos repetidos. Y aunque los goles ya son enteros, **todo texto** que se escribe en la hoja pasa por `textoSeguroParaHoja`, que antepone `'` a lo que empiece con `= + - @` (por ejemplo, el nombre de un participante).

La regla aplica también al administrador: `adminRegistrarResultado` usa la misma validación.

### La prueba que lo demuestra

[`tests/seguridad.test.js`, "Hallazgo 4"](../tests/seguridad.test.js) y [`tests/core.test.js`](../tests/core.test.js): `311-16` se rechaza con `GOLES_INVALIDOS` y no se escribe ninguna fila; una tabla de valores hostiles se rechaza uno por uno; `0-30` y `"7"` se aceptan; un lote que es texto o que trae 500 elementos se rechaza completo; el administrador tampoco puede capturar `311-16`.

---

## Hallazgo 5: funciones de administrador sin guardia

**Severidad: crítica.** Cualquier participante podía capturar resultados oficiales.

### El problema

El panel de administración sólo se **mostraba** a los administradores: el cliente revisaba una bandera `esAdmin` y ocultaba la pestaña. Pero las funciones del servidor que usaba el panel no revisaban nada:

```js
// Patrón vulnerable (ilustrativo)
function registrarResultado(partidoId, golesLocal, golesVisitante) {
  escribirResultado(partidoId, golesLocal, golesVisitante);
  calcularPuntosGlobales();
}
```

### El ataque

```js
google.script.run.registrarResultado('12', 0, 7);
```

Con un resultado inventado que coincidiera con mi pronóstico, me daba 3 puntos y recalculaba la tabla para todos. `calcularPuntosGlobales()` también se podía llamar libremente: no daba puntos, pero sí permitía forzar recálculos pesados a voluntad.

### La corrección

Cada función de administración empieza con `requiereAdmin_(token)` **como primera instrucción** ([`Admin.gs`](../apps-script/Admin.gs)):

```js
function requiereAdmin_(token) {
  var u = usuarioActual_(token); // identidad del servidor (hallazgo 1)
  if (!u) throw error_('NO_AUTENTICADO');
  if (!QuinielaCore.esAdmin(u.email, configEfectiva_().adminEmails)) {
    registrarHistorial_(u.id, 'ACCESO_DENEGADO', 'Intento de función de administrador');
    throw error_('NO_AUTORIZADO');
  }
  return u;
}
```

- La lista blanca (`ADMIN_EMAILS`) vive en **Script Properties**, no en el código ni en la hoja que leen los participantes.
- Se compara contra el correo **resuelto en el servidor**, así que depende del hallazgo 1: sin identidad confiable no hay autorización confiable.
- Los intentos denegados quedan en la bitácora, visibles para el administrador.
- Todas las funciones de admin siguen la convención `admin*`, para que sea fácil revisarlas y probarlas en bloque.
- `setupQuiniela` (que aparece en el editor) también se protege: si la llama desde la web app alguien que no es el dueño ni admin, se rechaza.

### La prueba que lo demuestra

[`tests/seguridad.test.js`, "Hallazgo 5"](../tests/seguridad.test.js) **descubre** automáticamente las funciones públicas que empiezan con `admin` (más `calcularPuntosGlobales`) y, para cada una:

1. Un participante normal la llama: recibe `NO_AUTORIZADO`.
2. Las hojas `Partidos`, `Participantes` y `Tabla` quedan **idénticas**.
3. El intento queda registrado como `ACCESO_DENEGADO`.
4. Sin sesión recibe `NO_AUTENTICADO`.

Otra prueba revisa el **código fuente**: cada `function admin…(` debe tener `requiereAdmin_(` como primera llamada. Si alguien agrega `adminBorrarTodo` sin guardia, la suite falla aunque nadie haya escrito una prueba para esa función.

---

## Hallazgo 6: toda función de nivel superior es API pública

**Severidad: causa raíz de los hallazgos 1 y 5.**

### El problema

En Apps Script, **cualquier función declarada en el nivel superior de cualquier archivo `.gs` se puede llamar con `google.script.run`**. No importa si la página la usa o no, ni en qué archivo esté. Una función auxiliar como `escribirResultado(partidoId, gl, gv)`, pensada para usarse sólo dentro del servidor, era tan pública como `doGet`.

### La corrección

Apps Script tiene una regla poco conocida: **las funciones cuyo nombre termina en guion bajo (`_`) son privadas**. No se pueden llamar desde `google.script.run` y no aparecen en el menú "Ejecutar" del editor. El proyecto sigue esta convención sin excepciones:

- Sin `_` al final = API pública = valida identidad, permisos y argumentos.
- Con `_` al final = auxiliar privada.
- La lógica pura vive en un objeto (`var QuinielaCore = (function () { ... })()`). Los métodos de un objeto no son funciones de nivel superior, así que tampoco se exponen.

La superficie pública completa son estas 14 funciones:

| Función                   | Requiere          |
| ------------------------- | ----------------- |
| `doGet`                   | (sirve la página) |
| `loginUsuario`            | nada              |
| `cerrarSesion`            | nada              |
| `quienSoy`                | sesión            |
| `getAppStatus`            | sesión            |
| `getBracket`              | sesión            |
| `guardarPronosticosLote`  | sesión            |
| `calcularPuntosGlobales`  | admin             |
| `adminRegistrarResultado` | admin             |
| `adminAltaParticipante`   | admin             |
| `adminRestablecerCodigo`  | admin             |
| `adminParticipantes`      | admin             |
| `adminHistorial`          | admin             |
| `setupQuiniela`           | dueño o admin     |

### La prueba que lo demuestra

[`tests/seguridad.test.js`, "Hallazgo 6"](../tests/seguridad.test.js) lee todos los `.gs`, extrae las funciones de nivel superior sin `_` final y compara contra esa lista exacta. **Agregar una función pública rompe la prueba a propósito**: obliga a decidir si debe ser privada o si necesita guardia y prueba propia. Otra prueba verifica que `Core.js` no declare ninguna función de nivel superior.

---

## Defensas adicionales

Además de los seis hallazgos, aproveché la reconstrucción para reforzar:

| Defensa                                                                                                               | Dónde                        |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `LockService` en toda escritura, para que dos envíos simultáneos no dupliquen filas                                   | `Pronosticos.gs`, `Admin.gs` |
| Bitácora (`Historial`) de pronósticos con la versión anterior, resultados, altas, logins fallidos y accesos denegados | `Hojas.gs`                   |
| El cliente nunca usa `innerHTML` con datos del servidor (nombres de participantes y equipos van como texto)           | `Client.html`                |
| El código de acceso se muestra una sola vez al darlo de alta                                                          | `Admin.gs`, `Client.html`    |
| Comparación de hashes en tiempo constante                                                                             | `Auth.gs`                    |
| Alcances OAuth mínimos (`spreadsheets.currentonly`, `userinfo.email`)                                                 | `appsscript.json`            |
| El admin no puede capturar el resultado de un partido que no ha empezado                                              | `Admin.gs`                   |

## Cómo correr las pruebas

```bash
npm install
npm test
```

Las pruebas **no** reimplementan la lógica del servidor: [`tools/empaquetar.js`](../tools/empaquetar.js) carga los mismos `.gs` que se suben con `clasp` dentro de una función, y [`tools/gas-mock.js`](../tools/gas-mock.js) aporta versiones en memoria de `SpreadsheetApp`, `CacheService`, `PropertiesService`, `LockService`, `Session` y `Utilities` (incluido un SHA-256 real). El reloj del servidor es controlable, así que se puede probar "un segundo antes" y "justo al kickoff".

La [demo](../demo/) usa el mismo mecanismo en el navegador, y su botón **Probar ataques** ejecuta los ataques de este documento contra el código real del servidor.

## Riesgos que acepto

Ser honesto sobre lo que **no** cubre esto también es parte del trabajo:

- **El mock no es Apps Script.** Las pruebas validan la lógica, no el comportamiento exacto de Google (cuotas, tipos que devuelve `getValues()` con formatos raros, latencia de `CacheService`). Antes de un torneo real hay que hacer una pasada manual en un despliegue de prueba.
- **`CacheService` no es almacenamiento garantizado.** Google puede desalojar entradas antes de que expiren; en ese caso el usuario sólo tiene que volver a entrar. Es una molestia, no un hueco de seguridad.
- **El código de acceso es un secreto compartido** entregado por el administrador. En un dominio de Workspace, el modo `DOMINIO` es mejor y no necesita códigos.
- **El administrador tiene acceso total a la hoja.** Puede ver todos los pronósticos y editarlos a mano. La bitácora registra lo que pasa por la app, no lo que se edita directamente en Sheets. Para un grupo de amigos o compañeros es aceptable; para algo con dinero de por medio no lo sería.
- **Los nombres de la tabla son visibles para todos.** Es una decisión de producto: una quiniela sin tabla pública no tiene chiste.
- **Los desempates de grupo** se simplifican a puntos, diferencia y goles a favor. El reglamento de FIFA sigue con enfrentamiento directo y juego limpio; el admin puede reflejarlo corrigiendo el orden en la hoja si hiciera falta.

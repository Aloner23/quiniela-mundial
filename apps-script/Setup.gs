/**
 * Instalación. Se ejecuta UNA vez desde el editor de Apps Script
 * (menú Ejecutar → setupQuiniela). Es pública en el sentido de que aparece en
 * el editor, pero si alguien la invoca desde google.script.run se rechaza:
 * sólo procede si quien la ejecuta es el dueño del script o un admin.
 */

/**
 * Crea las hojas con sus encabezados, los 48 equipos de ejemplo y el
 * calendario completo (104 partidos). No borra datos existentes: si una hoja
 * ya tiene filas, la deja como está.
 */
function setupQuiniela() {
  var quien = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var activo = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  var props = PropertiesService.getScriptProperties();
  // Desde el editor, activo === efectivo (el dueño). Desde la web app con
  // "Ejecutar como: yo", el usuario activo es el visitante: debe ser admin.
  if (activo && activo !== quien && !QuinielaCore.esAdmin(activo, props.getProperty('ADMIN_EMAILS'))) {
    return { ok: false, error: 'NO_AUTORIZADO', mensaje: MENSAJES_.NO_AUTORIZADO };
  }

  if (!props.getProperty('SAL_CODIGOS')) props.setProperty('SAL_CODIGOS', Utilities.getUuid());
  if (!props.getProperty('MODO_IDENTIDAD')) props.setProperty('MODO_IDENTIDAD', CONFIG.MODO_IDENTIDAD);

  var libro = libro_();
  Object.keys(CONFIG.ENCABEZADOS).forEach(function (nombre) {
    var h = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
    var cols = CONFIG.ENCABEZADOS[nombre];
    h.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    h.setFrozenRows(1);
  });

  if (hoja_(CONFIG.HOJAS.EQUIPOS).getLastRow() < 2) {
    agregarFilas_(CONFIG.HOJAS.EQUIPOS, EQUIPOS_EJEMPLO_());
  }
  if (hoja_(CONFIG.HOJAS.PARTIDOS).getLastRow() < 2) {
    var cal = QuinielaCore.generarCalendario(EQUIPOS_EJEMPLO_(), '2026-06-11');
    agregarFilas_(
      CONFIG.HOJAS.PARTIDOS,
      cal.map(function (p) {
        return Object.assign({}, p, {
          kickoff: Utilities.formatDate(p.kickoff, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd HH:mm'),
        });
      }),
    );
    // Texto plano para que Sheets no reinterprete fechas ni códigos como "1E".
    hoja_(CONFIG.HOJAS.PARTIDOS).getRange('A:G').setNumberFormat('@');
  }
  registrarHistorial_(quien || 'editor', 'SETUP', 'Hojas verificadas, versión ' + APP_VERSION);
  return { ok: true };
}

/**
 * 48 equipos de ejemplo repartidos en 12 grupos. Son marcadores de posición
 * para probar la app: el admin los reemplaza por el sorteo real en la hoja.
 */
function EQUIPOS_EJEMPLO_() {
  var lista = [
    ['MEX', 'México'],
    ['RSA', 'Sudáfrica'],
    ['KOR', 'Corea del Sur'],
    ['DEN', 'Dinamarca'],
    ['CAN', 'Canadá'],
    ['SUI', 'Suiza'],
    ['QAT', 'Catar'],
    ['ITA', 'Italia'],
    ['BRA', 'Brasil'],
    ['MAR', 'Marruecos'],
    ['HAI', 'Haití'],
    ['SCO', 'Escocia'],
    ['USA', 'Estados Unidos'],
    ['PAR', 'Paraguay'],
    ['AUS', 'Australia'],
    ['TUR', 'Turquía'],
    ['GER', 'Alemania'],
    ['CUW', 'Curazao'],
    ['CIV', 'Costa de Marfil'],
    ['ECU', 'Ecuador'],
    ['NED', 'Países Bajos'],
    ['JPN', 'Japón'],
    ['SWE', 'Suecia'],
    ['TUN', 'Túnez'],
    ['BEL', 'Bélgica'],
    ['EGY', 'Egipto'],
    ['IRN', 'Irán'],
    ['NZL', 'Nueva Zelanda'],
    ['ESP', 'España'],
    ['CPV', 'Cabo Verde'],
    ['KSA', 'Arabia Saudita'],
    ['URU', 'Uruguay'],
    ['FRA', 'Francia'],
    ['SEN', 'Senegal'],
    ['NOR', 'Noruega'],
    ['IRQ', 'Irak'],
    ['ARG', 'Argentina'],
    ['ALG', 'Argelia'],
    ['AUT', 'Austria'],
    ['JOR', 'Jordania'],
    ['POR', 'Portugal'],
    ['COD', 'RD Congo'],
    ['UZB', 'Uzbekistán'],
    ['COL', 'Colombia'],
    ['ENG', 'Inglaterra'],
    ['CRO', 'Croacia'],
    ['GHA', 'Ghana'],
    ['PAN', 'Panamá'],
  ];
  return lista.map(function (e, i) {
    return { codigo: e[0], nombre: e[1], grupo: QuinielaCore.GRUPOS[Math.floor(i / 4)] };
  });
}

/** Página principal de la web app. */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Quiniela Mundial 2026')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Inserta Styles.html / Client.html dentro de Index.html. */
function incluir_(archivo) {
  return HtmlService.createHtmlOutputFromFile(archivo).getContent();
}

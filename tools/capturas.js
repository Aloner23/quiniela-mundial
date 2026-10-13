/**
 * Genera las capturas de docs/capturas/ a partir de la demo.
 *
 * Requiere playwright-core y un Chromium. No se instalan con el proyecto:
 *   npm i --no-save playwright-core
 *   CHROMIUM_PATH=/ruta/a/chromium npm run screenshots
 * (o `npx playwright install chromium` y omitir CHROMIUM_PATH).
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

async function main() {
  let pw;
  try {
    pw = require('playwright-core');
  } catch {
    console.error('Falta playwright-core: npm i --no-save playwright-core');
    process.exit(1);
  }
  const raiz = path.join(__dirname, '..');
  execFileSync(process.execPath, [path.join(__dirname, 'construir-demo.js')], { stdio: 'inherit' });
  const salida = path.join(raiz, 'docs', 'capturas');
  fs.mkdirSync(salida, { recursive: true });
  const url = pathToFileURL(path.join(raiz, 'demo', 'index.html')).href;

  const browser = await pw.chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: (process.env.CHROMIUM_ARGS || '').split(' ').filter(Boolean),
  });
  const movil = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

  async function pagina(opciones, momento, cuenta) {
    const ctx = await browser.newContext(opciones);
    const page = await ctx.newPage();
    await page.goto(url);
    if (momento) {
      await page.selectOption('#demo-momento', momento);
      await page.waitForLoadState();
    }
    await page.waitForSelector('.login');
    if (cuenta) {
      await page.click(`.demo-cuentas button:has-text("${cuenta}")`);
      await page.waitForSelector('.partido');
    }
    return page;
  }
  const foto = (page, nombre, extra) => page.screenshot({ path: path.join(salida, nombre), ...extra });

  let p = await pagina(movil);
  await foto(p, 'login.png');

  p = await pagina(movil, 'grupos', 'Participante');
  const inputs = await p.$$('.partido input:not([disabled])');
  await inputs[0].fill('2');
  await inputs[1].fill('1');
  await p.waitForTimeout(250);
  await foto(p, 'partidos.png');
  await p.click('.nav__boton:has-text("Tabla")');
  await foto(p, 'tabla.png');
  await p.click('text=Probar ataques');
  for (const b of await p.$$('.pentest button:has-text("Ejecutar")')) await b.click();
  await p.evaluate(() => document.querySelectorAll('.pentest__lista li')[2].scrollIntoView());
  await foto(p, 'pentest.png');

  p = await pagina(movil, 'dieciseisavos', 'Administrador');
  await p.click('.nav__boton:has-text("Admin")');
  await p.waitForSelector('.historial li time');
  await foto(p, 'admin.png');

  p = await pagina({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }, 'final', 'Participante');
  await p.click('.nav__boton:has-text("Bracket")');
  await p.waitForSelector('.cuadro');
  await p.evaluate(() => document.querySelector('.nav').remove());
  await foto(p, 'bracket.png', { clip: { x: 0, y: 0, width: 1280, height: 1260 } });

  await browser.close();
  console.log('Capturas en docs/capturas/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

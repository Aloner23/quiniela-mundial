/**
 * La demo se construye a partir de los mismos archivos de apps-script/. Esta
 * prueba asegura que el empaquetado funciona y que no hay datos reales.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

describe('demo estática', () => {
  it('se construye con las plantillas incrustadas y el servidor real', () => {
    execFileSync(process.execPath, [path.join(raiz, 'tools', 'construir-demo.js')], { stdio: 'pipe' });
    const html = fs.readFileSync(path.join(raiz, 'demo', 'index.html'), 'utf8');
    expect(html).not.toMatch(/<\?/);
    expect(html).toContain('function guardarLote()');
    expect(html).toContain('--pizarra');
    expect(html).not.toContain('fonts.googleapis.com');
    const servidor = fs.readFileSync(path.join(raiz, 'demo', 'servidor.js'), 'utf8');
    expect(servidor).toContain('function guardarPronosticosLote(');
    expect(servidor).toContain('function requiereAdmin_(');
  });

  it('sólo usa correos de example.com', () => {
    const archivos = ['demo/demo.js', ...fs.readdirSync(path.join(raiz, 'apps-script')).map((f) => 'apps-script/' + f)];
    for (const f of archivos) {
      const texto = fs.readFileSync(path.join(raiz, f), 'utf8');
      const correos = texto.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
      correos.forEach((c) => expect(c, f).toMatch(/@example\.com$/));
    }
  });
});

import js from '@eslint/js';
import globals from 'globals';

/** Servicios de Apps Script disponibles como globales en los .gs. */
const appsScript = Object.fromEntries(
  [
    'SpreadsheetApp',
    'CacheService',
    'PropertiesService',
    'LockService',
    'Session',
    'Utilities',
    'HtmlService',
    'QuinielaCore',
  ].map((g) => [g, 'readonly']),
);

export default [
  { ignores: ['node_modules/', 'coverage/', 'demo/servidor.js', 'demo/gas-mock.js', 'demo/index.html', 'src/'] },
  js.configs.recommended,
  {
    files: ['apps-script/Core.js'],
    languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: { module: 'writable' } },
  },
  {
    // Los .gs se lintean como scripts: cada archivo comparte el ámbito global
    // con los demás, así que "no definido" y "sin usar" no aplican entre archivos.
    files: ['apps-script/**/*.gs'],
    languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: { ...appsScript, console: 'readonly' } },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off' },
  },
  {
    files: ['tools/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['tests/**/*.js', 'eslint.config.mjs', 'vitest.config.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  {
    files: ['demo/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, GasMock: 'readonly', crearServidor: 'readonly', QuinielaCore: 'readonly' },
    },
  },
];

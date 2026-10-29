const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
const ts = require('typescript-eslint');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  { ignores: ['dist/**', 'node_modules/**', 'doc/**', 'examples/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  { files: ['test/**/*.ts'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  prettier,
]);

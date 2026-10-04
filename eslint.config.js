'use strict';
const js = require('@eslint/js');
const globals = require('globals');
module.exports = [
  { ignores: ['node_modules/**', 'outputs/**', 'output/**', 'coverage/**', 'cli/publish/**'] },
  {
    files: ['cli/**/*.js', 'scripts/prepare-cli-publish.js', 'scripts/test-cli-package.js', 'scripts/verify-cli-package.js'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      strict: ['error', 'global'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
    },
  },
];

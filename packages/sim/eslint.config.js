// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import eslintConfigPrettier from 'eslint-config-prettier'

import no_silent_failures from '../../scripts/eslint-rules/no_silent_failures.mjs'

const unchanged_input_guard_baseline = JSON.parse(
  fs.readFileSync(
    new URL(
      '../../scripts/eslint-rules/unchanged_input_guard.baseline.json',
      import.meta.url,
    ),
    'utf8',
  ),
)

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tseslint.parser,
      parserOptions: {
        requireConfigFile: false,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      camelcase: 'off',
      'no-var': 'error',
      'no-undef': 'off',
      'object-shorthand': 'error',
      'prefer-const': ['error', { destructuring: 'any' }],
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'prefer-object-spread': 'error',
      'prefer-destructuring': 'error',
      'prefer-numeric-literals': 'error',
      'import/order': ['error', { 'newlines-between': 'always' }],
      'no-dupe-class-members': 'off',
      'no-labels': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'variableLike', format: ['snake_case', 'UPPER_CASE'] },
        {
          selector: 'class',
          format: ['PascalCase'],
          leadingUnderscore: 'forbid',
        },
        { selector: 'variable', modifiers: ['destructured'], format: null },
        { selector: 'parameter', modifiers: ['destructured'], format: null },
        {
          selector: 'parameter',
          leadingUnderscore: 'allowSingleOrDouble',
          format: ['snake_case', 'UPPER_CASE'],
        },
      ],
      // DETERMINISM IS LAW in @aresrpg/sim — no wall-clock, no Math.random.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Determinism: thread a seeded PRNG (prng.js) through state, never Math.random.',
        },
        {
          object: 'Date',
          property: 'now',
          message:
            'Determinism: time is a command input, never Date.now in @aresrpg/sim.',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'Determinism: no wall-clock in @aresrpg/sim.',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'Determinism: time is a command input; no Date in @aresrpg/sim.',
        },
      ],
    },
  },
  {
    // Package-local half of the #1689 silent-refusal ratchet. Only reducer/fold homes are judged; any bare
    // unchanged-input guard above the measured shared baseline is a new silent refusal and therefore an ERROR.
    files: ['src/**/*{fold,reduce,reducer}*.{js,ts,tsx}'],
    plugins: { 'no-silent-failures': no_silent_failures },
    rules: {
      'no-silent-failures/no-unchanged-input-guard': [
        'error',
        { baseline: unchanged_input_guard_baseline },
      ],
    },
  },
  {
    ignores: ['dist/*', 'node_modules/*', 'types/*'],
  },
]

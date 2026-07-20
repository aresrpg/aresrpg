// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import eslintConfigPrettier from 'eslint-config-prettier'

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
        {
          selector: 'variableLike',
          format: ['snake_case', 'UPPER_CASE'],
        },
        {
          selector: 'class',
          format: ['PascalCase'],
          leadingUnderscore: 'forbid',
        },
        {
          selector: 'variable',
          modifiers: ['destructured'],
          format: null,
        },
        {
          selector: 'parameter',
          modifiers: ['destructured'],
          format: null,
        },
        {
          selector: 'parameter',
          leadingUnderscore: 'allowSingleOrDouble',
          format: ['snake_case', 'UPPER_CASE'],
        },
      ],
    },
  },
  {
    ignores: ['dist/*', 'node_modules/*', 'types/*'],
  },
]

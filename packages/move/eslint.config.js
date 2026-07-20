import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import eslintConfigPrettier from 'eslint-config-prettier'

/** @type {import('eslint').Linter.Config[]} */
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
        // @ts-expect-error - import.meta.dirname requires Node 20.11+
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // Disable naming convention for migration
      '@typescript-eslint/naming-convention': 'off',

      // Standard overrides
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

      // Import rules
      'import/order': ['error', { 'newlines-between': 'always' }],

      // Disable strict TypeScript rules for migration
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'no-unsafe-optional-chaining': 'off',
      'no-dupe-class-members': 'off',
      'no-labels': 'off',
    },
  },
  {
    ignores: ['dist/*', 'node_modules/*', 'types/*'],
  },
]

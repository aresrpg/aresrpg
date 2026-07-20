import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import eslintConfigPrettier from 'eslint-config-prettier'

import one_pipeline from './scripts/eslint-rules/one_pipeline.mjs'
import fp_law_layer from './scripts/eslint-rules/fp_law.config.mjs'
import typed_fp_layer from './scripts/eslint-rules/typed_fp.config.mjs'

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
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      '@typescript-eslint/naming-convention': 'off',
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
      // eslint-config-prettier disables this, but in a no-semicolon codebase it's the ONLY gate
      // against the ASI return-then-`(` trap (2026-07-14 prod crash: `return undefined` followed by
      // a JSDoc-cast line parsed as `return undefined(window)…` — crashed prod, invisible in dev).
      'no-unexpected-multiline': 'error',
    },
  },
  {
    // The HUD/game tree is first-party (the "own pipeline" it never had was a fossil claim) — it
    // stays under CORRECTNESS lint; only the two bulk style rules are parked until the janitor
    // sweep (110 import/order + 50 prefer-destructuring as of 2026-07-14, zero correctness hits).
    files: ['packages/frontend/src/game/**'],
    rules: {
      'import/order': 'off',
      'prefer-destructuring': 'off',
    },
  },
  {
    // Gameplay spell truth enters through the authored chain-corpus door. The SDK JSON remains a generated
    // encyclopedia/simulator view, but it may never feed the fight reducer or its live cast adapter again.
    files: [
      'packages/fight/src/**/*.{js,ts,tsx}',
      'packages/frontend/src/game/core/modules/fight.js',
      'packages/frontend/src/game/screens/hud/world/DungeonBoard.jsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@aresrpg/sdk/spells',
              message: 'Live fight truth must use the normalized chain spell corpus.',
            },
          ],
        },
      ],
    },
  },
  {
    // THE ONE-REDUCER TRIPWIRE (CLAUDE.md CLIENT-INDEPENDENCE/ONE-PIPELINE + the v1.12.28 crash class): no async
    // callback (timer / promise chain / listener / await continuation) writes a zustand store directly, and store
    // modules keep no second clock — async results and time re-enter as INPUTS through the reducer door. Warn
    // across frontend logic modules (existing hits are findings being burned down), ERROR on the fight core where
    // the law is law. Tests choreograph stores directly — exempt. .tsx joined the net with the typed tier
    // (2026-07-17; census: 1 hit, components/sponsor_runout_modal.tsx); .jsx remains out — its 15 stale
    // `react-hooks/*` disable comments error on opt-in (F-1 janitor ticket).
    files: ['packages/frontend/src/**/*.{js,ts,tsx}'],
    ignores: ['**/*.test.*'],
    plugins: { 'one-pipeline': one_pipeline },
    rules: {
      'one-pipeline/no-async-store-write': 'warn',
      'one-pipeline/no-settimeout-in-stores': 'warn',
    },
  },
  {
    // The promoted cores (fight · world): the one-reducer law is ERROR here, and the plugin
    // registers in THIS block — the frontend-wide registration above is scoped to packages/frontend files.
    files: ['packages/fight/src/**/*.{js,ts,tsx}', 'packages/world/src/**/*.{js,ts,tsx}'],
    ignores: ['**/*.test.*'],
    plugins: { 'one-pipeline': one_pipeline },
    rules: {
      'one-pipeline/no-async-store-write': 'error',
      'one-pipeline/no-settimeout-in-stores': 'error',
    },
  },
  {
    // The promoted domain cores are born clean — the one-pipeline law is ERROR there from
    // day one, never a warn-tier burn-down. Plugin registered in-block: the warn block above only
    // covers packages/frontend paths.
    files: ['packages/party/src/**/*.js', 'packages/inventory/src/**/*.js'],
    ignores: ['**/*.test.*'],
    plugins: { 'one-pipeline': one_pipeline },
    rules: {
      'one-pipeline/no-async-store-write': 'error',
      'one-pipeline/no-settimeout-in-stores': 'error',
    },
  },
  // THE FP-LAW LAYER (docs/CODE_LAW.md) — naming/purity/immutability/composition tripwires.
  // Tiering + severity rationale live in the layer file; rules in scripts/eslint-rules/fp_law.mjs.
  ...fp_law_layer,
  // THE TYPED-FP TIER (docs/CODE_LAW.md, 2026-07-17) — type-aware strict-FP enforcement over every
  // surface a ts.Program covers: alias-blind mutation (functional/immutable-data), fire-and-forget
  // promises (L-P5), union exhaustiveness (L-D3), boundary immutability (L-I6). Surfaces, tiers and
  // the not-wired verdicts live in the layer file.
  ...typed_fp_layer,
  {
    // Vendored game source + migrated sim/sdk packages keep their own lint/format/typecheck
    // pipelines (run inside each package); the indexer is Rust. Keep them out of the companion lint.
    ignores: [
      '**/dist/*',
      'node_modules/*',
      '**/generated/*',
      'test/gold/.build/**', // the gold rig's copied ceremony workspace — regenerated every localnet boot
      'test/gold/out/**', // rig run outputs (playwright artifacts, rendered files)
      'packages/sim/**',
      'packages/sdk/**',
      'packages/move/**',
      'packages/rpc/indexer/**',
      '.claude/**',
      'public/draco/**',
      'packages/engine/public/draco/**',
      'packages/frontend/public/draco/**',
    ],
  },
]

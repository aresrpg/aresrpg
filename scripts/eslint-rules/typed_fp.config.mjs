// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// scripts/eslint-rules/typed_fp.config.mjs — THE TYPED-FP TIER (docs/CODE_LAW.md).
//
// Type-aware strict-FP enforcement, layered AFTER the untyped fp_law tiers. Census 2026-07-17
// (typed candidates at warn over every typed surface): immutable-data 1770 · prefer-immutable-types
// 980 · no-floating-promises 45 (all frontend src) · prefer-tacit 33 · no-misused-promises 22 ·
// await-thenable 4 · switch-exhaustiveness-check 0 · prefer-readonly 0. Severities follow the
// ratchet: ERROR only where measured clean (and probe-proven non-vacuous), WARN on mass.
//
// Typed surfaces (each block wires a ts.Program source):
//   TT1 frontend src   — packages/frontend/tsconfig.json via projectService (allowJs: the .js game
//                        tree rides the same program for free; tests are excluded THERE, so the
//                        block must exclude them too or the parse fatals)
//   TT2 out-of-project — /tsconfig.lint.json (gold rig, frontend e2e/dev, api sponsor, rpc api +
//                        gas-pool): `files` globs here MUST mirror that tsconfig's `include`
//   TT3 strong-typed clean surfaces — the promise family promoted to ERROR where measured 0
//   TT4 tests          — typed mutation family off (choreography, mirrors fp_law T5); the promise
//                        family STAYS ON in tests: a missing await is a false-green generator
//
// NOT wired (verdicts, evidence in the lane report):
//   functional/no-expression-statements — its only honest mode (ignoreVoid) crashes upstream in
//     v10.0.0 (`returnType.typeArguments.length`, typeArguments optional — repro:
//     packages/frontend/src/hooks/use_navigate_page.ts:10); no-floating-promises covers the
//     valuable subset (a discarded non-void that matters is almost always a promise).
//   packages/engine — its tsconfig excludes 60+ files (project-mode parse fatals) and the engine
//     is T4 mutation-exempt by law; scripts/seed/test-bots — no tsconfig, sparse JSDoc, tooling.
//   packages/sdk|sim|move — own lint/typecheck pipelines by design (root config ignores them).
import path from 'node:path'

import tseslint from 'typescript-eslint'
import functional from 'eslint-plugin-functional'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')

// Base severities — mass = WARN burn-down; measured-clean = ERROR ratchet.
const typed_rules = {
  // L-I1/L-I2 typed teeth: mutation reached through aliases, property/index writes on shared
  // values — what the syntactic fp-law/no-mutating-methods cannot see. Freshness allowances
  // mirror L-I3: immediate mutation of a just-created value is construction; `let` declarations
  // opted into mutability (L-I4 owns those); Map/Set are explicit mutable contracts (L-I5).
  'functional/immutable-data': [
    'warn',
    {
      ignoreImmediateMutation: true,
      ignoreMapsAndSets: true,
      ignoreClasses: 'fieldsOnly',
      ignoreNonConstDeclarations: { treatParametersAsConst: true },
    },
  ],
  // L-I6: declare immutability at the boundary — an explicitly-typed parameter is a contract;
  // type it Readonly so the signature promises what L-I2 enforces. Inferred params are exempt
  // (JS + lambdas would drown the signal). Fixer proven inert by default (--fix-dry-run: 0 fixes
  // emitted on 34 findings), so `bun run format` cannot rewrite signatures.
  'functional/prefer-immutable-types': [
    'warn',
    {
      enforcement: 'None',
      parameters: { enforcement: 'ReadonlyShallow', ignoreInferredTypes: true },
    },
  ],
  // L-C2: `x => f(x)` is `f` — mechanized ONLY here on typed surfaces, where the checker proves
  // the arity trap away (the untyped tier keeps wrapper elimination as judgment).
  'functional/prefer-tacit': 'warn',
  // L-P5: a fire-and-forget promise is an unobserved effect AND a swallowed failure.
  // `void promise` is the sanctioned explicit discard.
  '@typescript-eslint/no-floating-promises': ['warn', { ignoreVoid: true }],
  // L-P5: an async function handed to a void slot (condition, forEach, prop) leaks its rejection.
  // JSX attributes exempt: React event handlers are the platform's own effect edge.
  '@typescript-eslint/no-misused-promises': ['warn', { checksVoidReturn: { attributes: false } }],
  // L-P5: awaiting a non-thenable is a lie about where the effect boundary sits.
  '@typescript-eslint/await-thenable': 'warn',
  // L-D3 ratchet: a switch over a union handles every member (or declares a default) — measured
  // 0 repo-wide, probe-proven. Totality, mechanized.
  '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
  // L-I6 ratchet: a never-reassigned class member in the sanctioned class seams declares
  // `readonly` — measured 0 repo-wide, probe-proven.
  '@typescript-eslint/prefer-readonly': 'error',
}

const typed_plugins = { functional, '@typescript-eslint': tseslint.plugin }

export default [
  {
    // TT1 — frontend src: .ts/.tsx AND the .js game tree (allowJs puts it in the same program;
    // the marginal cost of harvesting it is rule execution only). Tests are outside the tsconfig
    // program — they MUST stay ignored here.
    files: ['packages/frontend/src/**/*.{js,jsx,ts,tsx}'],
    ignores: ['**/*.test.*'],
    plugins: typed_plugins,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: REPO_ROOT },
    },
    rules: typed_rules,
  },
  {
    // TT2 — surfaces no package tsconfig covers, typed via /tsconfig.lint.json. Globs mirror its
    // `include` — extend both together or project-mode parsing fatals on the stray file.
    files: [
      'test/gold/**/*.ts',
      'packages/frontend/e2e/**/*.ts',
      'packages/frontend/dev/**/*.ts',
      'api/**/*.{js,mjs}',
      'packages/rpc/api/**/*.js',
      'packages/rpc/gas-pool/**/*.{js,mjs}',
    ],
    plugins: typed_plugins,
    languageOptions: {
      parserOptions: { project: ['tsconfig.lint.json'], tsconfigRootDir: REPO_ROOT },
    },
    rules: typed_rules,
  },
  {
    // TT3 — the promise family at ERROR where measured 0 on strong-typed .ts surfaces
    // (gold rig, frontend e2e + dev plugins). The JS surfaces (api, rpc, frontend src) stay WARN:
    // their 0s ride weaker inference, and a later JSDoc improvement surfacing latent hits must not
    // redden someone else's lane — promote per the burn-down protocol instead.
    files: [
      'test/gold/**/*.ts',
      'packages/frontend/e2e/**/*.ts',
      'packages/frontend/dev/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    // TT3b — fe-dev carve-out: no-misused-promises measured 2 there (vite dev plugins hand async
    // handlers to void middleware hooks) — WARN burn-down; floating/await stay ERROR (measured 0).
    files: ['packages/frontend/dev/**/*.ts'],
    rules: {
      '@typescript-eslint/no-misused-promises': ['warn', { checksVoidReturn: { attributes: false } }],
    },
  },
  {
    // TT4 — tests/benches choreograph state (mirrors fp_law T5): typed mutation family off.
    // The promise family deliberately STAYS ON — an unawaited assertion is a false green.
    files: ['**/*.test.*', '**/*.spec.*', '**/e2e/**', '**/bench/**'],
    rules: {
      'functional/immutable-data': 'off',
      'functional/prefer-immutable-types': 'off',
    },
  },
]

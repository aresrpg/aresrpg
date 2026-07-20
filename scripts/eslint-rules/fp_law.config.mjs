// scripts/eslint-rules/fp_law.config.mjs — THE FP-LAW LAYER (docs/CODE_LAW.md).
//
// Importable flat-config layer, spread into eslint.config.js after the base blocks. Severity design
// (census 2026-07-17, 7559 findings measured before wiring): ERROR where the repo is already clean
// (a free ratchet), WARN where violations are mass (a burn-down, not an unrunnable red gate).
// Every rule id maps to a law row in docs/CODE_LAW.md; the census + ranked worklist live in the
// FP_LAW lane report.
//
// Tiers:
//   T1 base      — every linted .js/.ts file: naming, no-classes, size/complexity ceilings, ratchets
//   T2 product   — packages/** + api/**: the mutation family + module-load purity
//   T3 loops     — api/** + packages/rpc/**: near-clean today, loop-free stays visible
//   T4 engine    — perf-sacred mutable core (Three.js scene graph, voxel hot paths): mutation family off
//   T5 tests     — tests/benches/e2e choreograph state by design: mutation family + purity off
//
// .tsx joined the net with the typed tier (2026-07-17 census: eqeqeq + prefer-arrow-callback still
// 0 on .tsx — the ratchets extend; ~96 new warns, no-param-reassign 53 the largest). .jsx remains
// out (F-1: its 15 stale react-hooks disable comments error on opt-in; janitor ticket).
import functional from 'eslint-plugin-functional'

import fp_law from './fp_law.mjs'

// Module-load effect edges: entry files, workers (a worker IS its thread's entry), demos, benches,
// dev/build tooling, CLI scripts. Everything else must be pure to import (L-P3).
const EFFECT_EDGES = [
  '/main.',
  '_main.',
  '_worker.',
  '/demo/',
  '/bench/',
  '/dev/',
  '/e2e/',
  '/scripts/',
  'vite.config',
  'generate-config',
]

const mutation_family_off = {
  'fp-law/no-mutating-methods': 'off',
  'no-param-reassign': 'off',
  'functional/no-let': 'off',
  'functional/no-this-expressions': 'off',
}

export default [
  {
    // T1 — the base FP tier
    files: ['**/*.{js,ts,tsx,mjs,cjs}'],
    plugins: { functional, 'fp-law': fp_law },
    rules: {
      // ratchets — measured CLEAN repo-wide on 2026-07-17, never let them regress
      eqeqeq: ['error', 'smart'], // L-P2: sound equality keeps referential reasoning honest
      'prefer-arrow-callback': 'error', // L-C2: callbacks are lambdas, not `function` machinery
      // burn-downs
      'fp-law/snake-case': 'warn', // L-N1
      'functional/no-classes': [
        'warn', // L-F1 — three sanctioned platform seams, everything else is a factory/closure
        {
          ignoreIdentifierPattern: ['ErrorBoundary$'], // React has no functional componentDidCatch
          ignoreCodePattern: ['extends\\s+Error\\b', 'extends\\s+PhysicalLightingModel\\b'],
        },
      ],
      complexity: ['warn', 30], // L-C3 ceiling; the law's target is far lower — see CODE_LAW.md
      'max-depth': ['warn', 5], // L-C3
      'max-lines': ['warn', { max: 600 }], // house law: files ≤600 LoC (CLAUDE.md Agent Standard #7)
    },
  },
  {
    // T2 — product code: the mutation family + module-load purity
    files: ['packages/**/*.{js,ts,tsx,mjs,cjs}', 'api/**/*.{js,ts,tsx,mjs,cjs}'],
    rules: {
      'fp-law/no-mutating-methods': 'warn', // L-I1/L-I2
      'no-param-reassign': ['warn', { props: true }], // L-I2: the caller's value is not yours
      'functional/no-let': ['warn', { allowInFunctions: true, allowInForLoopInit: true }], // L-I4: no mutable module bindings
      'functional/no-this-expressions': 'warn', // L-F1's other half
      'fp-law/no-module-scope-effects': ['warn', { allow: EFFECT_EDGES }], // L-P3
    },
  },
  {
    // T3 — loop-free where the repo already is (api: 7 hits, rpc: 17 at census)
    files: ['api/**/*.{js,ts,mjs,cjs}', 'packages/rpc/**/*.{js,ts,mjs,cjs}'],
    rules: {
      'functional/no-loop-statements': 'warn', // L-C4: fold, don't iterate — where honest
    },
  },
  {
    // T4 — the engine is a perf-sacred mutable core: scene graphs and voxel hot paths mutate by
    // design (measured: 2590 loop / 242 param-mutation sites). The law stops at this boundary;
    // naming, classes, size and complexity (T1) still apply.
    files: ['packages/engine/**'],
    rules: mutation_family_off,
  },
  {
    // T5 — tests/benches choreograph state and fixtures by design (LAST: wins over T2/T3)
    files: ['**/*.test.*', '**/*.spec.*', '**/e2e/**', '**/bench/**'],
    rules: {
      ...mutation_family_off,
      'fp-law/no-module-scope-effects': 'off',
      'functional/no-loop-statements': 'off',
    },
  },
]

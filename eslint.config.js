// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import eslintConfigPrettier from 'eslint-config-prettier'
import react_hooks from 'eslint-plugin-react-hooks'

import one_pipeline from './scripts/eslint-rules/one_pipeline.mjs'
import no_silent_failures from './scripts/eslint-rules/no_silent_failures.mjs'
import test_isolation from './scripts/eslint-rules/test_isolation.mjs'
import fp_law_layer from './scripts/eslint-rules/fp_law.config.mjs'
import typed_fp_layer from './scripts/eslint-rules/typed_fp.config.mjs'

const unchanged_input_guard_baseline = JSON.parse(
  fs.readFileSync(new URL('./scripts/eslint-rules/unchanged_input_guard.baseline.json', import.meta.url), 'utf8')
)

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: {
      import: importPlugin,
    },
    settings: {
      // The gold rig links its Playwright dependency here at boot. Keep it classified as external
      // whether the link exists or not so import/order has one stable verdict.
      'import/external-module-folders': ['node_modules', 'test/gold/node_modules'],
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
    // THE ONE-REDUCER TRIPWIRE (CLAUDE.md CLIENT-INDEPENDENCE/ONE-PIPELINE + the v1.12.28 crash class): no async
    // callback (timer / promise chain / listener / await continuation) writes a zustand store directly, and store
    // modules keep no second clock — async results and time re-enter as INPUTS through the reducer door. Warn
    // across frontend logic modules (existing hits are findings being burned down), ERROR on the fight core where
    // the law is law. Tests choreograph stores directly — exempt. .tsx joined the net with the typed tier
    // (2026-07-17; census: 1 hit, components/sponsor_runout_modal.tsx); .jsx remains out — its 15 stale
    // `react-hooks/*` disable comments error on opt-in (F-1 janitor ticket).
    files: ['packages/frontend/src/**/*.{js,jsx,ts,tsx}'],
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
    files: ['packages/fight/src/**/*.{js,jsx,ts,tsx}', 'packages/world/src/**/*.{js,jsx,ts,tsx}'],
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
  {
    // THE SILENT-FAILURE TRIPWIRE (docs/CODE_LAW.md L-D1; Agent Standard #3 "no silent failure, ever").
    // The house law — instruments THROW, never coerce — pointed at PRODUCT code for the first time. A failure
    // handler that erases its failure (`.catch(() => null)`, `catch { return DEFAULT }`) leaves the break
    // recorded nowhere, and every caller downstream reads a coerced success. The board class census
    // (2026-07-30) measured that class at 16.6% of the open board — 26/157 rows: swallowed catches, bare-null
    // returns, unexplained refusals, cached negatives, raw errors reaching players. A handler must SPEAK:
    // re-throw · return the failure as data · report through a sanctioned sink (the registry is the rule's
    // `sinks` option, censused from the real channels: game_log 358, console.error 112, console.warn 57,
    // report_* 52, toast 29, Sentry.captureException 4).
    //
    // SEVERITY: WARN repo-wide — a burn-down, not an unrunnable red gate, exactly as the fp-law layer landed.
    // BASELINE 2026-07-30 (this net, measured pre-wiring): 414 hits / 193 files. Per package —
    // frontend 397, engine 19, api 7, rpc 7, fight 4, world 1, inventory 1, party 0. Severity only ratchets
    // up: `packages/party/src` is CLEAN today and is the first free ERROR ratchet; the promoted cores
    // (fight/world/inventory, 6 hits between them) are the next promotion once burned down.
    //
    // SCOPE NOTES — both deliberate, both measured, neither a carve-out:
    //   · `.jsx` is out for the same reason every tier above keeps it out: matching it activates the 15 stale
    //     `react-hooks/*` disable comments those files carry, which ERROR against an unregistered rule (the
    //     F-1 janitor ticket). Cost of the exclusion: 25 hits / 14 files. Widen when F-1 lands.
    //   · tests/e2e are out of THIS net: 189 hits there are dominated by the legitimate Playwright probe idiom
    //     (`isVisible().catch(() => false)`), a boolean probe rather than an erased failure. The instrument
    //     half of the law (a swallowed `page.screenshot(…).catch(() => undefined)` that lied about artifacts)
    //     wants its own tier with a probe-aware option — a follow-up, not this gate.
    files: ['packages/*/src/**/*.{js,jsx,ts,tsx}', 'api/**/*.{js,mjs}'],
    ignores: ['**/*.test.*', '**/*.spec.*'],
    plugins: { 'no-silent-failures': no_silent_failures },
    rules: { 'no-silent-failures/no-swallowed-failure': 'warn' },
  },
  {
    // THE SILENT-REFUSAL RATCHET (#1689): a reducer/fold guard that returns its input unchanged without
    // failure-as-data or a report makes an incomplete read indistinguishable from a successful no-op. Keep this
    // narrow to the fight reducer homes; helper transforms elsewhere legitimately retain accumulator identity.
    // @aresrpg/sim mirrors this block in its package-local ESLint config. The JSON is the measured 32-hit floor.
    // It only shrinks as refusals learn to speak; an unlisted reducer file has a zero floor, and any finding above
    // a file's allowance is an ERROR.
    files: [
      'packages/fight/src/**/*{fold,reduce,reducer,inbox,ingest}*.{js,jsx,ts,tsx}',
      'packages/fight/src/inputs.js',
      'packages/fight/src/store.js',
    ],
    plugins: { 'no-silent-failures': no_silent_failures },
    rules: {
      'no-silent-failures/no-unchanged-input-guard': ['error', { baseline: unchanged_input_guard_baseline }],
    },
  },
  {
    // THE CROSS-FILE TEST-POISON GATE (2026-08-07). `bun test` runs a package's whole suite in ONE process,
    // so an unrestored top-level `spyOn(namespace, …)` rewrites that export for every file loaded AFTERWARDS —
    // and "afterwards" is decided by readdir order, which differs per machine. WorldTravelModal.test.jsx's
    // `react-i18next` spy made the same commit green on macOS and 16-red in CI. The written law already covered
    // `mock.module`; this is the same hazard through the namespace door. Born clean (the one pre-existing
    // violation, auto_search_adapter.test.js, is fixed in the same commit), so it arms at ERROR with no baseline.
    files: ['**/*.test.{js,jsx,ts,tsx,mjs}', '**/*.spec.{js,jsx,ts,tsx,mjs}'],
    plugins: { 'test-isolation': test_isolation },
    rules: { 'test-isolation/no-unrestored-namespace-spy': 'error' },
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
    // THE REFERENCE-ERROR GATE (P0 2026-07-25). A refactor deleted a `const rig_class` binding and left one
    // reference behind in a log template three statements below; `create_player` threw `ReferenceError:
    // rig_class is not defined` at world boot, so the roam avatar, the character controller and the camera
    // bind never mounted — terrain streamed with no player to follow and the live world was unplayable.
    // Nothing caught it: the frontend's plain-JS corpus is `checkJs: false`, so tsc never sees an undefined
    // identifier there, and the base block turns `no-undef` off for the whole repo. That left the game's
    // LARGEST source tree with zero undefined-identifier checking. `no-undef` is the only mechanical gate
    // for that class, so it is armed here for every non-TS source. TypeScript files keep it off — the
    // compiler owns the check there and the rule reports false positives on type-only identifiers.
    // `.jsx` is deliberately NOT in this net: matching it activates the 15 stale `react-hooks/*` disable
    // comments those files carry, which error against an unregistered rule (the pre-existing F-1 janitor
    // ticket the one-pipeline block below already documents). The defect class this gate exists for lives
    // in the plain-JS game logic corpus, which is fully covered here.
    files: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        ...globals.worker,
        Bun: 'readonly', // the test/script runtime global (bun:test suites, api/sponsor.mjs)
        __APP_VERSION__: 'readonly', // vite `define` build-time constants (packages/frontend/vite.config.ts:188)
        __GIT_SHA__: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },
  {
    // THE TEMPORAL-DEAD-ZONE GATE (P0 2026-07-29, #1563) — the sibling of the reference-error gate above.
    // `optimistic_vacated`'s useMemo factory in DungeonBoard.jsx read a `const` declared 25 lines BELOW it.
    // React runs a memo factory synchronously during render, so every seated fighter's board threw
    // `ReferenceError: Cannot access 'resolve_ref' before initialization` and the whole HUD fell into the
    // error boundary — one click wedged a character out of the game. `no-undef` cannot see it (the binding
    // IS defined, just later) and the boundary swallowed the throw, so nothing mechanical caught the class.
    // `variables: true` is the TDZ tooth; `functions: false` spares legal hoisted-function style.
    // SCOPE: the fight-board tree — the render surface where a TDZ is a total client death, and the
    // widest net that is CLEAN today. Repo-wide the rule reports ~220 pre-existing (overwhelmingly benign
    // late-const reads from bodies that only run later) and the wider HUD tree trips the F-1 stale
    // `react-hooks/*` disable directives the reference-error gate above already documents — both are
    // janitor burn-downs, not this gate. Severity only ratchets up: widen as those land, never narrow.
    // hack_radio.js is a MUTUALLY RECURSIVE closure pair (gesture-retry ↔ play), unsatisfiable by
    // reordering alone — burn-down, not carve-out.
    files: ['packages/frontend/src/game/screens/hud/world/**/*.{js,jsx,ts,tsx}'],
    ignores: ['packages/frontend/src/game/screens/hud/world/hack_radio.js'],
    rules: {
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
    },
  },
  {
    // THE HOOK-LAW TIER (#2070) — the React team's own plugin, never wired until now. The repo has
    // carried `react-hooks/*` disable directives since before React 19 landed, but no block ever
    // registered the plugin, so `rules-of-hooks` and `exhaustive-deps` had literally never executed
    // on the only package that uses hooks (census: 162 hook-using files, all under packages/frontend;
    // every other package is zero). An unenforced hook law is how a conditional hook or a stale
    // closure ships silently — the same invisible-gate class #2059 measured for .jsx itself.
    //
    // rules-of-hooks is ERROR: hook ORDER is not a style opinion, it is the invariant React's
    // renderer is built on, and a violation is a runtime crash, not a smell.
    // exhaustive-deps is WARN — measured, then decided (the idiom the tiers above use): the first
    // run reported 47 hits repo-wide, 6 of which were already the documented deliberate-omission
    // sites #2059 had turned into plain comments (restored to real directives in this commit).
    // The remaining 41 are stale-closure candidates each needing a read of the effect's intent —
    // a burn-down, not an unrunnable red gate.
    files: ['packages/frontend/**/*.{js,jsx,ts,tsx}'],
    plugins: { 'react-hooks': react_hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Vendored game source + migrated sim/sdk packages keep their own lint/format/typecheck
    // pipelines (run inside each package); the indexer is Rust. Keep them out of the companion lint.
    ignores: [
      '**/dist/*',
      'node_modules/*',
      '**/generated/*',
      'test/gold/.build/**', // the gold rig's copied ceremony workspace — regenerated every localnet boot
      'test/gold/out/**', // rig run outputs (playwright artifacts, rendered files)
      // The arch gates' self-test corpus: deliberately-malformed snippets pinned to semgrep/scan
      // behavior, not source. Linting them can only pressure someone into "fixing" a RED fixture,
      // which is exactly the change that breaks the gate's self-test.
      'scripts/arch/fixtures/**',
      'packages/sim/**',
      'packages/sdk/**',
      'packages/move/**',
      'packages/rpc/indexer/**',
      '.claude/**',
      'public/draco/**',
      'packages/engine/public/draco/**',
    ],
  },
]

# CODE LAW — the FP constitution

The law lint messages cite. Sources: **[MAG]** Professor Frisby's Mostly Adequate Guide (ch01–05,
ch08) · **[CS]** Eric Elliott's Composing Software series · **[HOUSE]** `AGENTS.md` conventions.
Enforcement: an eslint rule id (layer: `scripts/eslint-rules/fp_law.config.mjs`) or **judgment**
(reviewed, not mechanized). Severities are a ratchet: ERROR where the repo is clean, WARN where
the census found mass — a cleaned domain gets promoted, never the reverse.

## Purity

- **L-P1 — Pure by default.** Same input → same output, no observable side effect; core logic is
  transforms over plain data. _Why:_ cacheable, portable, testable, reasonable, parallel — purity
  is what makes code equational. [MAG ch03; CS Pure Functions] → judgment.
- **L-P2 — Sound equality.** `===` everywhere `==` isn't provably safe. _Why:_ coercion breaks the
  substitution reasoning purity buys. → `eqeqeq` ('smart') **ERROR**.
- **L-P3 — Importing a module is pure.** Timers/network/listeners/DOM fire from entries, workers,
  and lifecycle edges — never from module load. _Why:_ a load-time effect runs at an uncontrolled
  time, order, and count. [MAG ch08] → `fp-law/no-module-scope-effects` **WARN**, edges allow-listed.
- **L-P4 — Effects at the edges; ONE reducer per domain.** Async results re-enter as INPUTS
  through the reducer door; no callback writes a store — at any call depth. [MAG ch08 IO/Task;
  HOUSE ONE-PIPELINE] → `one-pipeline/no-async-store-write` + `no-settimeout-in-stores`
  (ERROR on fight core); anything deeper is review judgment.
- **L-P5 — Every promise is handled or explicitly voided.** A fire-and-forget promise is an
  unobserved effect AND a swallowed failure; `void promise` is the sanctioned explicit discard.
  → `@typescript-eslint/no-floating-promises` + `no-misused-promises` + `await-thenable` on the
  typed surfaces — stays ON in tests (an unawaited assertion is a false green).
- **L-P6 — Observe deltas, not arrivals.** A presentation or side effect fires from an OBSERVED
  STATE CHANGE, never from the arrival of the message that caused it: authoritative truth reaches
  a client redundantly (receipt + poll + relay), so an arrival-keyed effect double-fires. An
  observer folds ONE PROJECTED SLICE (a primitive copied by value) and acts only on a real delta;
  collections diff by ID SET. Events ENRICH a delta, they never TRIGGER one. → judgment + the
  replay/idempotence tests in the owning domain.

## Immutability

- **L-I1 — Never mutate shared state.** No `.push/.sort/.splice/…`, `Object.assign`, or `delete`
  on a value this function did not just create. [MAG ch01/ch03] → `fp-law/no-mutating-methods`
  **WARN** + `functional/immutable-data` WARN on typed surfaces.
- **L-I2 — Parameters are the caller's.** Return new values; never reassign or write through a
  parameter. [CS Pure Functions] → `no-param-reassign` {props: true} **WARN**.
- **L-I3 — Construction is local.** Mutating a value in the function that created it — including a
  `reduce` accumulator — is construction, not mutation. Copy-first (`[...x].sort()`, `toSorted`)
  makes freshness visible. → encoded as `fp-law/no-mutating-methods`' allowances.
- **L-I4 — No mutable module bindings.** A top-level `let` is hidden global state. →
  `functional/no-let` (module scope) **WARN**.
- **L-I5 — Map/Set are explicitly mutable contracts.** Allowed as local machinery; a long-lived one
  is a store and belongs behind a reducer door (L-P4). → judgment.
- **L-I6 — Declare immutability at the boundary.** Type explicit parameters `Readonly`; a
  never-reassigned class member (sanctioned seams only) declares `readonly`. →
  `functional/prefer-immutable-types` WARN · `@typescript-eslint/prefer-readonly` **ERROR**.

## Composition

- **L-C1 — Compose, don't orchestrate.** Build features as pipelines of small functions whose
  outputs feed inputs; the import graph stays a DAG — any cycle is red. [MAG ch05; CS] → judgment.
- **L-C2 — Functions are values.** First-class, lambda-shaped; no `function` callback machinery, no
  needless wrappers (`x => f(x)` is `f`). → `prefer-arrow-callback` **ERROR** +
  `functional/prefer-tacit` WARN (typed tier).
- **L-C3 — Small composable units.** Prefer cognitive complexity ≤10 and cyclomatic complexity
  ≤8; new code never exceeds 15/12. The exact inherited hotspot distribution is a downward-only
  baseline: a score increase reds, a reduction must ratchet the baseline, and a new soft hotspot
  needs explicit review. Nesting is normally ≤3 and never exceeds 4; files remain ≤600 LoC.
  Moving the same decisions into helpers is not a reduction. → `complexity-gate/cognitive` ·
  `complexity-gate/cyclomatic` · `max-depth` **ERROR**; `max-lines` **WARN**; judgment verifies
  that branches or concepts actually disappeared.
- **L-C4 — Fold, don't iterate — where honest.** `map/filter/reduce` express intent; a loop is a
  perf tool, not a default. Engine hot paths (voxel meshing, gen) are sanctioned loop country. →
  `functional/no-loop-statements` WARN on api/; judgment elsewhere.
- **L-C5 — Pointfree is seasoning, not law.** Use it where it clarifies. [MAG ch05] → judgment.
- **L-C6 — Data last, curry to specialize.** Order params specializer-first/data-last so partial
  application composes. [MAG ch04] → judgment.

## Paradigm

- **L-F1 — No classes, no `this`.** Factories, closures, and plain data. Three sanctioned platform
  seams: React error boundaries (`*ErrorBoundary`), `extends Error`, Three.js
  `extends PhysicalLightingModel`. [CS; MAG ch02; HOUSE] → `functional/no-classes` +
  `functional/no-this-expressions` **WARN**.
- **L-F2 — Favor object composition over inheritance.** Mix behaviors by composing
  functions/objects, never by hierarchy. → L-F1's rules + judgment.

## Data & errors

- **L-D1 — Nulls and failures flow as data.** Reducer-shaped returns (`{state, events}`,
  `{ok, error}`) over thrown control flow; throw only at boundaries, decode once. [MAG ch08
  Maybe/Either] → judgment; no silent failure, ever.
- **L-D2 — Containers obey the functor laws.** `map` composes; no side effects smuggled into
  `map`. [CS Functors] → judgment.
- **L-D3 — Sum types are handled totally.** A `switch` over a union covers every member or
  declares an explicit `default`. → `@typescript-eslint/switch-exhaustiveness-check` **ERROR**.
- **L-D4 — Decode tests assert CAPTURED WIRE BYTES, never self-round-trip alone.** A codec test
  that encodes with the same model it decodes with proves only internal consistency. Every
  BCS/wire decode surface pins at least one REAL captured payload (provenance comment: source
  object id/version + capture date). _Why:_ the 2026-07-17 XP incident — a model missing one
  hidden byte stayed green on self-round-trip while every character's XP silently failed to
  project. → review judgment at the seam; the fixture files themselves are the ratchet.

## Naming

- **L-N1 — Dev-chosen bindings are snake_case.** camelCase is a library's name, never a
  declaration choice; PascalCase = components; SCREAMING_SNAKE = constants. React custom hooks
  are DECLARED `useX` (`rules-of-hooks` matches `/^use[A-Z0-9]/` — a snake_case hook is invisible
  to the rule that enforces hook order). → `fp-law/snake-case` **WARN**.
- **L-N2 — Name by meaning, generically.** Data-tied names shrink reuse; if the honest name is
  awkward, the design is. [MAG ch02] → judgment.

## Layout

- **L-L1 — Tests live in `test/`; `src/` is source only.** Every `*.test.*` / `*.spec.*` file
  lives under the package's sibling `test/`, mirroring the source subpath. _Why:_ `src/` is the
  tree consumers read and globs reason about; a path that means two things quietly covers the
  wrong set. Frontend's remaining in-src tests are measured debt, not a carve-out.
  `packages/frontend/e2e` (Playwright) and `packages/engine/bench` are their own genres. → judgment.

## Operating the law

- Escape hatches: rule option `allow: ['path-fragment']` (repo-relative) per module class;
  `// eslint-disable-next-line <rule> -- reason` per line. Every disable carries its reason.
- Burn-down protocol: clean a domain → flip it to **ERROR** with a `files` block in
  `scripts/eslint-rules/fp_law.config.mjs` / `typed_fp.config.mjs`.
- The typed tier (`scripts/eslint-rules/typed_fp.config.mjs`): type-aware rules run on frontend
  source plus the root `tsconfig.lint.json` e2e/dev surfaces. Other packages use their own
  typecheck pipelines.
- Tests/benches choreograph state: mutation-family rules are off there; naming, classes, and size
  laws still apply — and L-P5 deliberately stays ON.

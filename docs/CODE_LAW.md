# CODE LAW — the FP constitution

The law lint messages cite. Sources: **[MAG]** Professor Frisby's Mostly Adequate Guide (ch01–05,
ch08, read 2026-07-17) · **[CS]** Eric Elliott's Composing Software series + related posts (the
Geoff-Ford curated list; the pillar articles read 2026-07-17) · **[HOUSE]** CLAUDE.md conventions.
Enforcement: an eslint rule id (layer: `scripts/eslint-rules/fp_law.config.mjs`), a gate, or
**judgment** (reviewed, not mechanized). Severities are a ratchet: ERROR where the repo is clean,
WARN where the census found mass — a cleaned domain gets promoted, never the reverse.

## Purity

- **L-P1 — Pure by default.** Same input → same output, no observable side effect; core logic is
  transforms over plain data. _Why:_ cacheable, portable, testable, reasonable, parallel — purity
  is what makes code equational. [MAG ch03: "given the same input, will always return the same
  output… no observable side effect"; CS Pure Functions] → judgment + the reducer gates (below).
- **L-P2 — Sound equality.** `===` everywhere `==` isn't provably safe. _Why:_ coercion breaks the
  substitution reasoning purity buys. [CS Pure Functions: referential transparency] →
  `eqeqeq` ('smart') **ERROR** (clean 2026-07-17).
- **L-P3 — Importing a module is pure.** Timers/network/listeners/DOM fire from entries, workers,
  and lifecycle edges — never from module load. _Why:_ "the wise think before acting" — a load-time
  effect runs at an uncontrolled time, order, and count. [Dao of Immutability; MAG ch08: pure code
  builds effect descriptions, the boundary executes them] → `fp-law/no-module-scope-effects`
  **WARN** (3 sites), edges allow-listed.
- **L-P4 — Effects at the edges; ONE reducer per domain.** Async results re-enter as INPUTS
  through the reducer door; no callback writes a store. [MAG ch08 IO/Task; HOUSE ONE-PIPELINE] →
  `one-pipeline/no-async-store-write` + `no-settimeout-in-stores` (ERROR on fight core); deep
  tier: codeql `js/aresrpg/laundered-store-write` (interprocedural — any call depth, named
  helpers included; 157 baselined) + `js/aresrpg/effect-escapes-the-edge` (the fight fold is
  measured pure — 0 findings, empty baseline = hard ratchet); composite tier (semgrep, in
  `bun run lint`): `arch-laundered-store-write` (1-hop name join, provenance-filtered — the
  5-site high-confidence cut, .jsx included) + `arch-fight-effect-free` (zero promise machinery
  in fight/; txs.js's ONE commit edge baselined at 3, every other core file hard-zero).
- **L-P5 — Every promise is handled or explicitly voided.** A fire-and-forget promise is an
  unobserved effect AND a swallowed failure; `void promise` is the sanctioned explicit discard.
  _Why:_ effects are values you must run at the boundary — dropping one on the floor is a silent
  failure. [MAG ch08: IO/Task hold effects as values, the boundary executes them; HOUSE Agent
  Standard #3: no silent failure, ever] → `@typescript-eslint/no-floating-promises` +
  `no-misused-promises` + `await-thenable`: **ERROR** on the strong-typed clean surfaces
  (validation, gold rig, frontend e2e/dev), WARN on frontend src (45/22/4) — stays ON in tests
  (an unawaited assertion is a false green).
- **L-P6 — Observe deltas, not arrivals.** A presentation or side effect fires from an OBSERVED
  STATE CHANGE, never from the arrival of the message that caused it. Authoritative truth reaches a
  client redundantly — one fact carried by a receipt, a poll, and a relay — so an effect keyed on
  arrival fires two or three times for one change (a kill re-animated, a toast doubled). The
  discipline: an observer folds ONE PROJECTED SLICE of the state — a primitive copied BY VALUE (a
  number, a string, an id), never a reference to a mutable object — and acts only on a real delta:

  ```js
  const observe = (last_slice, state) => {
    const slice = project(state) // e.g. a fighter's health — a number, taken by value
    if (last_slice !== slice) effect() // fire ONLY on a real change
    return slice // the accumulator holds the FACT, not the thing carrying it
  }
  ```

  `dead === dead` changes nothing, so a replayed input can never re-trigger; the by-value copy makes
  `!==` both cheap and correct even when the underlying object is mutated in place. A COLLECTION
  churns its container reference on every append, so it diffs by ID SET (added/removed) rather than
  `!==` — same principle, the operator the shape demands. Events ENRICH a delta (they carry its
  amount, its id), they never TRIGGER one. _Why:_ at-least-once delivery is the norm, not the
  exception — an arrival-triggered effect is a latent double-fire. [HOUSE #281] → enforced by the
  `presenter-beat-boundary` depcruise gate (beat emitters reachable only through the presenter seam)
  and the replay-idempotence property (`packages/fight/harness/replay_idempotence.js`: any scenario
  delivered once vs. each authoritative input 2-3× ⇒ byte-identical presentation).

## Immutability

- **L-I1 — Never mutate shared state.** No `.push/.sort/.splice/…`, `Object.assign`, or `delete`
  on a value this function did not just create. _Why:_ "Mutation hides change. Hidden change
  manifests chaos." [Dao; MAG ch01 seagull, ch03 slice-vs-splice] → `fp-law/no-mutating-methods`
  **WARN** (142) + typed teeth on every ts.Program surface: `functional/immutable-data` WARN
  (1,576) — catches what syntax can't see: writes through aliases, property/index assignment on
  shared values (freshness allowances mirror L-I3/L-I4/L-I5).
- **L-I2 — Parameters are the caller's.** Return new values; never reassign or write through a
  parameter. [CS Pure Functions: "Never mutate external state or object parameters"] →
  `no-param-reassign` {props: true} **WARN** (139) + the rule above's param verdict; deep tier:
  codeql `js/aresrpg/boundary-mutation` (alias- and call-chain-aware, cross-module boundary
  params only; 125 baselined).
- **L-I3 — Construction is local.** Mutating a value in the function that created it — including a
  `reduce` accumulator — is construction, not mutation. Copy-first (`[...x].sort()`, `toSorted`,
  spread) makes freshness visible. [MAG ch03: purity is about the observable; CS Reduce] → encoded
  as `fp-law/no-mutating-methods`' allowances.
- **L-I4 — No mutable module bindings.** A top-level `let` is hidden global state. [Dao: "the wise
  embrace history"] → `functional/no-let` (module scope) **WARN** (142).
- **L-I5 — Map/Set are explicitly mutable contracts.** Allowed as local machinery; a long-lived one
  is a store and belongs behind a reducer door (L-P4). → judgment.
- **L-I6 — Declare immutability at the boundary.** An explicitly-typed parameter is a contract:
  type it `Readonly` so the signature promises what L-I2 enforces; a never-reassigned class member
  (sanctioned seams only) declares `readonly`. _Why:_ "Mutation hides change" — a signature that
  admits mutation it never performs hides the opposite. [Dao; CS Pure Functions: "never mutate…
  object parameters"] → `functional/prefer-immutable-types` (params, shallow, inferred exempt)
  WARN (752) · `@typescript-eslint/prefer-readonly` **ERROR** (clean, probe-proven).

## Composition

- **L-C1 — Compose, don't orchestrate.** Build features as pipelines of small functions whose
  outputs feed inputs; composition is associative, so refactors are regroupings. [MAG ch05
  `compose`; CS Introduction: "the essence of software development is composition"] → judgment;
  ceilings below keep units composable; the import graph stays a DAG — depcruise `no-circular`
  (hard-zero after issue #95 burned down the 2026-07-17 census; any cycle is red).
- **L-C2 — Functions are values.** First-class, lambda-shaped; no `function` callback machinery, no
  needless wrappers (`x => f(x)` is `f`). [MAG ch02; CS Higher Order Functions] →
  `prefer-arrow-callback` **ERROR** (clean) + existing `prefer-rest-params`/`prefer-spread`;
  wrapper elimination is judgment on untyped surfaces (arity traps) and mechanized where the
  checker proves the trap away: `functional/prefer-tacit` WARN (33, typed tier).
- **L-C3 — Small composable units.** Cyclomatic complexity ≤30 (target far lower), nesting ≤5,
  files ≤600 LoC (HOUSE Agent Standard #7). [CS: "less code = less surface area for bugs"] →
  `complexity` **WARN** (66) · `max-depth` **WARN** (29) · `max-lines` **WARN** (62).
- **L-C4 — Fold, don't iterate — where honest.** `map/filter/reduce` express intent; a loop is a
  perf tool, not a default. Engine hot paths (voxel meshing, gen) are sanctioned loop country.
  [CS Reduce: map/filter derive from reduce; MAG ch05] → `functional/no-loop-statements` **WARN**
  on api/ + packages/rpc (near-clean); judgment elsewhere.
- **L-C5 — Pointfree is seasoning, not law.** Use it where it clarifies; "pointfree is a
  double-edged sword and can sometimes obfuscate intention". [MAG ch05] → judgment.
- **L-C6 — Data last, curry to specialize.** Order params specializer-first/data-last so partial
  application composes. [MAG ch04; CS Curry] → judgment (not lintable untyped).

## Paradigm

- **L-F1 — No classes, no `this`.** Factories, closures, and plain data. "Class inheritance is the
  tightest form of coupling available" — you wanted a banana, you got the gorilla and the jungle.
  Three sanctioned platform seams: React error boundaries (`*ErrorBoundary`), `extends Error`,
  Three.js `extends PhysicalLightingModel`. [CS Why-Composition-Is-Harder-with-Classes, Factory
  Functions; MAG ch02: avoid `this` "like a dirty nappy"; HOUSE: no classes] →
  `functional/no-classes` **WARN** (6) · `functional/no-this-expressions` **WARN** (4, product).
- **L-F2 — Favor object composition over inheritance.** Mix behaviors by composing
  functions/objects, never by hierarchy. [CS Introduction, quoting GoF] → L-F1's rules + judgment.

## Data & errors

- **L-D1 — Nulls and failures flow as data.** Reducer-shaped returns (`{state, events}`,
  `{ok, error}`) over thrown control flow; throw only at boundaries, decode once (HOUSE error
  decoder law). [MAG ch08 Maybe/Either: no silent failure, handling forced at the seam] →
  judgment + `arch-foreach-async-dropped-promises` (an await inside `.forEach` = promises nobody
  holds; clean 2026-07-17, hard-zero ratchet).
- **L-D2 — Containers obey the functor laws.** `map` composes (`F.map(g).map(f)` ≡
  `F.map(f∘g)`); chains of array/promise transforms stay lawful — no side effects smuggled into
  `map`. [CS Functors & Categories; Monads Made Simple; MAG ch08] → judgment +
  `arch-map-smuggled-store-write` (store write inside map/filter/flatMap; clean 2026-07-17,
  hard-zero ratchet — also covers the .jsx files outside the eslint net).
- **L-D3 — Sum types are handled totally.** A `switch` over a union covers every member or
  declares an explicit `default`. _Why:_ Maybe/Either work because the seam is FORCED to handle
  both branches — an unhandled union member is a silent fall-through. [MAG ch08: handling forced
  at the seam; CS Monads Made Simple] → `@typescript-eslint/switch-exhaustiveness-check`
  **ERROR** (clean repo-wide, probe-proven; typed tier).
- **L-D4 — Decode tests assert CAPTURED WIRE BYTES, never self-round-trip alone.** A codec test
  that encodes with the same model it decodes with proves only internal consistency — it encodes
  the bug on both sides by construction. Every BCS/wire decode surface pins at least one REAL
  captured payload (provenance comment: source object id/version + capture date) and asserts the
  decoded fields against independently known truth. _Why:_ the 2026-07-17 XP incident — the
  indexer's ProgressionField model missed one hidden byte; its self-round-trip test stayed green
  while every character's XP/HP silently failed to project since genesis (session lying-green #2;
  #1 was the SDK localnet claim). [house; reference implementation:
  packages/rpc/indexer progression real-wire fixtures] → review judgment at the seam; the
  fixture files themselves are the ratchet (a model drift reds them).

## Naming

- **L-N1 — Dev-chosen bindings are snake_case.** camelCase is a library's name, never a
  declaration choice; PascalCase = components; SCREAMING_SNAKE = constants. React custom hooks
  are DECLARED `useX`: `rules-of-hooks` identifies a hook by a hard-coded `/^use[A-Z0-9]/`, so
  the prefix is the library's contract and a snake_case hook is invisible to the rule that
  enforces hook order (#2080). Declaration position only — a `useThing` parameter or catch
  binding is still a dev choice. [HOUSE] → `fp-law/snake-case` **WARN** (616).
- **L-N2 — Name by meaning, generically.** Data-tied names shrink reuse ("compact", not
  "validArticles"); if the honest name is awkward, the design is. [MAG ch02] → judgment.

## Layout

- **L-L1 — Tests live in `test/`; `src/` is source only.** A package's `src/` holds shipped
  source and nothing else; every `*.test.*` / `*.spec.*` file lives under the package's sibling
  `test/`, mirroring the source subpath. _Why:_ `src/` is the tree consumers read, bundlers walk
  and lint scopes name — interleaving tests doubles the surface every glob has to reason about,
  and a path that means two things is a gate input that quietly covers the wrong set. [HOUSE —
  standing order; codified 2026-07-26 (#844) after it had already bound four packages and two
  gate inputs while living in no rule file] → **judgment**, backed by the gate inputs already
  keyed on the split: `eslint.config.js` extends the fight `no-restricted-imports` scope to
  `packages/fight/test/**` so a relocation cannot shrink coverage; `scripts/ares.mjs`
  `unit_test_files` points the party/inventory rows at their `test/` dirs and the fight/world
  core legs run `bun test` from the package root. `scripts/relocate-tests.mjs` is the one codemod
  that performs a migration (`git mv` + resolved-path specifier rewrite; 10 self-test probes gate
  every run, `--self-test` refuses to touch the tree if they fail). Mechanized since #1795 by
  `scripts/check-test-location.mjs` in root `lint`: the exact-path baseline IS the tree's in-src
  set, so a file with no row and a row with no file are both red, and `MAX_IN_SRC_TESTS` — the
  ceiling's one home — only ever shrinks.

  **Migration state, measured at `edge`** (tracked `*.test.*`/`*.spec.*`): COMPLETE — `fight` 122,
  `sim` 60, `sdk` 42, `world` 10, `party` 6, `inventory` 5, `engine` 143 (relocated whole under
  #2183), all with zero in `src/`. PENDING — `frontend` 515 in `src/`, the last package on the
  losing side of the law until its lanes run; the debt is written here rather than pretended away,
  and the gate now keeps it from growing. Out of scope, deliberately: `packages/frontend/e2e`
  (35 Playwright specs) and `packages/engine/bench` (5) are their own genres, and `packages/rpc`
  has no `src/` tree at all (its JS lives in `api/` and `gas-pool/`, 16 colocated tests).

## Operating the law

- Fixture adjudication (#1101): every PR commit that mutates an existing
  `packages/*/test/fixtures/**` file or `*.json` under a package/root `test/` tree carries a
  non-author `Adjudicated-by: Name <email>` trailer; new fixtures are exempt — a fixture mutation
  can let a wrong fix hide its own evidence, the lying-green class at its root
  (`scripts/check-constraints.sh`).
- Escape hatches: rule option `allow: ['path-fragment']` (repo-relative) per module class;
  `// eslint-disable-next-line <rule> -- reason` per line. Every disable carries its reason.
- The deep tier (CodeQL): eslint is the keystroke tripwire; `scripts/codeql/gate.sh` is the
  interprocedural pass — a fresh database of the tree, the `scripts/codeql/aresrpg-fp` query
  pack, and a fingerprint ratchet against `scripts/codeql/baseline/aresrpg-fp.baseline.txt`
  (exit 0 = no NEW findings; baselined mass is the burn-down worklist; `--rebaseline` is an
  explicit, reviewed act). Query semantics red/green-proven by `codeql test run
scripts/codeql/aresrpg-fp-tests --additional-packs=scripts/codeql`. Run it at the deep/CI
  cadence (~55s typical), not per keystroke. Coverage map: JS/TS = whole repo (fresh DB per run);
  Rust = packages/rpc/indexer via the standard `codeql/rust-queries` security suite (DB rebuilt
  only when the crate changed, ~1m50s); **Move has NO CodeQL extractor** — the contracts stay
  under the D321 grep gates. CLI note: CodeQL is licensed free for OSS/research; private
  automated CI use falls under GitHub Advanced Security terms — confirm licensing before CI wiring.
- The dual-home gate (`scripts/single-home-gate.sh`, wired into `bun run lint` via
  check-constraints, ~4s, repo bytes only — no analyzer binary, so it cannot flake): the class gate
  behind "one home per fact". It derives what to protect from the tree instead of a kill-list —
  every exported name, plus every `path:line` home named in `docs/REGISTRY.md` — and reports six
  lanes: `duplicate-export` (one exported name, two files), `registry-fact` (a registry-owned name
  declared off-home, exported or laundered into a function body), `registry-anchor` (a registry row
  whose anchor no longer declares anything — the registry drifting off the code it governs),
  `registry-surface` and `registry-importer` (the GENERATED import fence, issue #2222: one rule per
  registry row whose anchor is an importable module — no second importable surface for the fact, no
  consumer binding it from a specifier that misses its home; rows anchored on Move sources generate
  nothing and are reported as unfenceable rather than counted as covered), and
  `store-writers` (one store field written by two modules). Self-tests red AND green on
  `scripts/arch/fixtures/single_home` before it judges the tree, proves the registry parser still
  sees by planting a synthetic row in a copy of the registry, ratchets against
  `scripts/arch/single_home.baseline.json`, and carries its own negative control:
  `--negative-control` writes fresh dual homes into real packages, proves every lane reds, removes
  them, and proves the verdict reverses. Name-only detection cannot tell two facts that share a
  name from one fact copied twice; the ratchet holds that noise at its measured count instead of
  special-casing it.
- The arch gates (semgrep + dependency-cruiser — `scripts/semgrep-gate.sh` /
  `scripts/depcruise-gate.sh`, both wired into `bun run lint` via check-constraints, ~9s): the
  composite-speed cross-function tier between the eslint tripwire and the CodeQL deep pass.
  Semgrep rules (`scripts/arch/arch_law.yml` + the laundered-write extraction join) self-test on
  `scripts/arch/fixtures` (pinned red/green counts — a semgrep upgrade that shifts matching fails
  there first) and ratchet the tree against `scripts/arch/semgrep_baseline.json`; import law lives
  in `.dependency-cruiser.cjs` — `fight-core-hermetic` (resolved ALLOWLIST generalizing
  `ares test fightcore` gate a), `engine-quarantine` (engine3 only under game/ + world-shell/,
  both clean = hard-zero), `no-circular` — zero debt is represented by no baseline file (issue
  #95 burned down the 2026-07-17 census). Non-empty baselines ARE burn-down worklists;
  `--write-baseline` tightens
  after a fix, never absorbs new debt unreviewed. An absent semgrep, dependency-cruiser, or bun
  binary is always a loud failure because an unavailable check has no verdict. Install semgrep
  with `uv tool install semgrep` or `brew install semgrep`; depcruise runs under bun (node 25 is
  outside its support matrix).
- Burn-down protocol: clean a domain → flip it to **ERROR** with a `files` block in
  `scripts/eslint-rules/fp_law.config.mjs` / `typed_fp.config.mjs` (the fight core's one-pipeline
  block is the template).
- The typed tier (`scripts/eslint-rules/typed_fp.config.mjs`, 2026-07-17): type-aware rules run
  wherever a ts.Program covers the file — frontend src (its tsconfig, `allowJs` carries the .js
  game tree), validation (src+test), and gold rig / frontend e2e+dev / api sponsor / rpc api +
  gas-pool via the lint-only `/tsconfig.lint.json` (its `include` and the layer's TT3 globs move
  together). Not typed: engine (its tsconfig excludes 60+ files; mutation-exempt by T4 anyway),
  scripts/seed/test-bots (no tsconfig, sparse JSDoc), sdk/sim/move (own pipelines by design).
  `functional/no-expression-statements` is rejected as enforcement: its one honest mode
  (`ignoreVoid`) crashes upstream in v10.0.0 — L-P1 keeps it covered by judgment, and L-P5 catches
  the discarded-promise subset that matters.
- Scope debt: `.tsx` joined the net with the typed tier (eqeqeq/prefer-arrow-callback ratchets
  held at 0 on opt-in). `.jsx` remains outside (pre-existing F-1: 15 stale react-hooks disable
  comments error on opt-in) — cleaning those comments and opting `.jsx` in is a standing janitor
  ticket.
- Tests/benches (`*.test.*`, `*.spec.*`, e2e/, bench/) choreograph state: mutation-family rules are
  off there (typed ones included: `immutable-data`, `prefer-immutable-types`); naming, classes, and
  size laws still apply — and L-P5 deliberately stays ON (an unawaited assertion is a false green).
  The engine tier (packages/engine) is exempt from the mutation family by design — L-C4's
  sanctioned loop country.

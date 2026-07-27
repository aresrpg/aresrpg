# GATES — the enforcement ladder

What runs, when, and what a red means. Every gate here already exists in the tree; this file is
the index, not a new rule. The full FP constitution (each law, its why, its enforcement) is
`docs/CODE_LAW.md`; `FROZEN.md` lists the rules no gate may weaken.

## Keystroke tier — `bun run lint`, every time

Fires locally on demand and in `checks.yml`'s `ladder` job on every PR/push to `edge`/`master`.

- **eslint** (`eslint.config.js`) — the FP rule set: `scripts/eslint-rules/fp_law.config.mjs`
  (untyped tier) and `scripts/eslint-rules/typed_fp.config.mjs` (type-aware tier, wherever a
  `ts.Program` covers the file). Catches purity/mutation/naming/class violations lexically, one
  file at a time. A red cites a rule id — look it up in `docs/CODE_LAW.md`'s law-id column.
- **prettier** (`.prettierrc`, `.prettierignore`) — formatting only. `bun run format` fixes it in
  place; never worth debating by hand.

## Commit tier — `scripts/check-constraints.sh`, wired into `bun run lint`

Every leg below runs as part of `check-constraints.sh` (~9s for the fast legs); a red on any leg
fails `bun run lint` as a whole.

| Leg | Catches | A red means |
|---|---|---|
| `scripts/check-chain-ids.mjs` | hardcoded chain/object ids outside `@aresrpg/sdk/deployment` | a live id got typed by hand instead of resolved from the pinned deployment |
| Move public-surface gate (D756) | `V2`/`_old`/`legacy`/`deprecated` in a Move module/fn/struct/event name | on-chain names are generationless — republish clean, never version-suffix |
| App clean-name gate | `_v2`-suffixed identifiers in `packages/*/src` | the same D756 law, extended to the off-chain residue class |
| Test-reachability gate | a `*.test.*`/`*.spec.*` file no `ares test` selector reaches | a test that runs nowhere is false coverage — wire it in, or baseline it with a one-line reason |
| SPDX header gate | a tracked source file missing its license header | run `node scripts/stamp_copyright.mjs` |
| Secret-leak gate | a hardcoded `suiprivkey1` literal, or reappearance of a previously-rotated leaked address | keys live only in an untracked `.env`, read via `process.env` — never a literal in a tracked file |
| Move security-pattern gate | hand-rolled `mul_mod`/`div_rem` (hard fail), `u256` narrowing casts (hard fail), deprecated `type_name::get` (warn), divide-before-multiply in value math (warn) | the two hard-fail patterns match a known exploit-family shape — see the script's own comments for the incident class |
| `scripts/check-move-field-limits.mjs` | struct-field counts over the `LimitsVerifier` cap | a Move struct grew past what the publish pipeline tolerates — FAILS (never skips) when `sui` or fresh `sui move build` output is missing; CI arms it in the `ladder` job |
| i18n coverage gate (`scripts/i18n_coverage.mjs`) | a used `t()`/`i18nKey` missing from any of the 6 locale files, or a locale's key set drifted from `en.json` | every player-facing string ships in all 6 locales in the same commit — no exceptions |
| Arch gate — semgrep (`scripts/semgrep-gate.sh`) | dataflow patterns: laundered store writes, fight-package effect purity | FAILS if `semgrep` is absent; `ARESRPG_ALLOW_MISSING_ARCH_TOOLS=1` is the explicit local-only SKIP |
| Arch gate — dependency-cruiser (`scripts/depcruise-gate.sh`) | fight-core import hermeticity, engine quarantine, any NEW import cycle | FAILS if `depcruise` or `bun` is absent; the same local-only opt-out SKIPs loudly |

Every gate above is a **ratchet**: a baseline file holds today's known debt, and only a NEW
finding fails the build. Baselines only shrink — `--write-baseline`/`--rebaseline` flags exist on
the relevant scripts and are an explicit, reviewed act, never a silent debt-absorption.

## Deep tier — CodeQL, pre-ship / CI / after a big wave

- **Local**: `scripts/codeql/gate.sh`, the last leg of `check-constraints.sh`. Builds a fresh
  CodeQL database of the tree and runs the custom `scripts/codeql/aresrpg-fp` query pack
  (interprocedural: a store write reached through ANY call depth from a timer/promise/listener,
  effects escaping the fight fold, cross-module boundary mutation), plus the standard Rust
  security suite over `packages/rpc/indexer`. Ratchets against
  `scripts/codeql/baseline/aresrpg-fp.baseline.txt`. SKIPs loudly (never lies green) when the
  `codeql` binary or its docker image is absent, or when running under CI — native scanning
  takes over there instead.
- **CI**: `checks.yml` → `fp-codeql` runs the same query pack as native GitHub code scanning
  (`github/codeql-action`), category `aresrpg-fp`. This is the tier that actually gates PRs; the
  local leg is the pre-ship sanity pass.

## CI workflows

| Workflow | Job | Fires on | Checks |
|---|---|---|---|
| `.github/workflows/gate.yml` | `gate` | PR + push to `edge`/`master` | the deterministic fight-replay gate (`packages/sim/test/replay_gate.test.js`) — the sim/Move twin's captured-capsule replay must still match |
| `.github/workflows/checks.yml` | `ladder` | PR + push to `edge`/`master` | `bun run lint` in full — eslint + prettier + every `check-constraints.sh` leg above |
| `.github/workflows/checks.yml` | `smoke` | PR + push to `edge`/`master` | builds the frontend and drives the logged-out landing headless — fails on any uncaught page error or non-allowlisted `console.error` at boot |
| `.github/workflows/checks.yml` | `fp-codeql` | PR + push to `edge`/`master` | the CodeQL deep tier as native code scanning (above) |

All four are **fork-safe by construction** — no secrets in any of these workflows (`FROZEN.md`
rule 8). A red on any of them blocks the merge; nothing in this ladder is advisory.

## What a red does not mean

A red gate is a fact about the diff, not a verdict on the contributor. Every gate above documents
its own fix path in its script comments or `docs/CODE_LAW.md`'s law-id column — read the script
before arguing with it. If the gate itself looks wrong, that's a separate issue to file, not a
reason to route around it.

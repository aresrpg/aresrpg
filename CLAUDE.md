# AresRPG

AresRPG is a fully on-chain MMORPG: a 3D voxel world in the browser, a deterministic turn-based
combat system, and a Sui Move backend where the chain itself is the game server. This repo is the
whole game — client, engine, sim, Move sources, SDK, the keyless read layer, and the transaction
sponsor. The only thing not here is content: the seed corpus (items, mobs, balance) lives in a
private sibling repo and reaches the game through published chain state.

Load these before working — they are the operating rules of this codebase:

@.claude/rules/craft.md
@.claude/rules/code-law.md

## The two-repo structure

**aresrpg** (this repo, public) owns the game. **aresrpg-seed** (private) owns content, balance,
and publish-ceremony custody. Neither reaches into the other's tree: cross-repo needs travel as
GitHub issues on the target repo, written for a cold reader (exact paths, current state, expected
output, success criteria). Each repo protects its own domain and its own simplicity — a
well-argued refusal is a first-class answer to any feature request.

## Architecture

```
packages/
├── engine/      # Three.js voxel engine (procedural worlds, LOD streaming)
├── frontend/    # React 19, Tailwind v4, Enoki zkLogin, Zustand — a renderer of chain truth
├── sim/         # deterministic combat reducer: reduce(state, command, ctx) → {state, events}
├── move/        # Sui Move sources — the on-chain game (sim and move are a twin: same math)
├── fight/       # headless fight core (fold, transport, projection)
├── sdk/         # composes PTBs over the Move package; deployment/ pins live ids
├── rpc/         # keyless read layer: Rust indexer → /v1 read API + gas station
└── inventory/ party/ world/  # pure reducer cores
api/             # stateless sponsored-transaction service
```

- **The chain is the source of truth.** Live game state is Sui objects; the client predicts,
  renders, reconciles — never authoritative. Reads via `/v1`; every state change is an SDK PTB.
- **The deterministic twin.** Sim and Move produce identical outcomes — client prediction and
  chain resolution are the same math. A change touching one touches both, same commit, with
  parity fixtures (`packages/sim/test/fixtures/replay/`).
- **One reducer per stateful domain.** Every async result re-enters as an input through the
  reducer door; no callback ever writes a store. The fight timeline is recorded and replayable —
  see `packages/sim/src/timeline.js` for the capsule format the whole correctness story rides on.

## Workflow — edge and master

Work is PR-shaped, always: one branch per feature/fix → **PR into `edge`** (the CI gate must
pass — `.github/workflows/gate.yml`) → `edge` soaks → a promotion PR from `edge` to `master`
triggers the production deploy. Nobody pushes `master` — including maintainers. Hotfixes ride
edge. The promotion PR carries the `package.json` version bump — the only human-touched version
artifact; on merge, CI tags `vX.Y.Z` and publishes the GitHub Release while Vercel deploys off
the same push. Tags are never created locally (a ruleset enforces it). `FROZEN.md` lists the
rules no one may tune and the measurements no one may argue with;
changing it is a reviewed, visible act. The soak instrumentation (staging deploy, nightly
measurement loops, production invariant telemetry) is rolling out — the gate ladder in CI only
grows, never shrinks.

The repo is also designed around **loops** — scheduled workflows that measure (coverage,
mutation, drift, production truth) and file issues, with judgment passes whose committed rubrics
live in `.claude/loops/` (already in-tree; the scheduled workflows land incrementally). Issues
labeled `good-first-issue` are self-contained starter tasks.

## Principles

1. **Simplicity over sophistication** — the best code is no code; if you can't explain a design
   in one sentence, it's too complex.
2. **Root causes only** — no band-aids; two failed fixes means your model of the system is wrong.
3. **YAGNI** — complexity waits for a real limit hit by a real player.
4. **One home per fact** — knowledge written twice is a future bug; derive, don't copy.
5. **RED-FIRST** — a reported bug's first artifact is a failing test that reproduces it for the
   reported reason; then the fix; both runs in the PR.
6. **The FP constitution** (`docs/CODE_LAW.md`) — pure functions, snake_case, no classes,
   immutability by default, effects at the edges. Enforced mechanically (ESLint, semgrep,
   dependency-cruiser, CodeQL); severities only ratchet up.

## Conventions

- **State**: Zustand stores, no prop drilling. **Frontend**: functional React, Tailwind
  utilities, no component library. **Deps**: minimal — every dependency is a marriage.
- **Design system**: gothic terminal — near-black, gold/cyan accents, JetBrains Mono, uppercase
  micro-labels, sharp corners, slow atmospheric motion. New UI matches the existing tokens.
- **i18n**: every player-facing string ships in all six locales
  (`packages/frontend/src/i18n/locales/`) in the same commit.
- **Commits**: conventional subject, body ≤5 lines, atomic — one concern, exactly its files.
- **Models**: this codebase is agent-friendly by construction — rules, rubrics, and gates ship in
  the repo. Use the strongest model available to you for judgment-dense work (architecture,
  money paths, the sim); anything weaker earns its keep on mechanical tasks only.

## Run

```bash
bun install
bun run dev            # Vite frontend (localhost:5173) against live testnet
bun run test           # the one test truth — same command CI runs
bun run lint           # eslint + prettier + constraint gates
```

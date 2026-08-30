# Contributing to AresRPG

## Setup

```bash
bun install
bun run dev        # Vite frontend against live testnet (localhost:5173)
bun run test       # the one test truth — same command CI runs
bun run lint       # eslint + prettier + the constraint gates
```

## The flow — LINEAR EVERYWHERE

History is linear by law; nothing ever rewrites what landed.

1. Branch off `edge`, one branch per feature/fix.
2. **Always rebase** — keep your branch rebased on the latest `edge`; merge commits never enter
   the branch. The ruleset requires a current branch and linear signed history.
3. Every contributor change reaches `edge` through a pull request. It needs the owner's CODEOWNER
   approval, approval after the latest push, resolved conversations, and every required CI check.
4. `edge` is the only persistent branch and repository default. The owner is its sole human bypass
   and may push signed commits directly.
5. Landed branches are deleted automatically the moment they land (GitHub's
   `delete_branch_on_merge` setting doesn't cover this flow, since a landing is a fast-forward
   push, never a merge-button click). Every feature/fix branch is disposable once merged.
6. **Issue closing is commit-native.** A commit that resolves an issue says so in its message
   body — `Closes #N` — and GitHub closes the issue when that commit reaches the default `edge`
   branch. A bare `#N` mention links but never closes; use the keyword. One issue
   per closing line; the keyword rides the commit that actually contains the fix.

## Releases & rollback

Every `edge` commit deploys to `edge.aresrpg.world`. Production changes only from an owner-created
semver tag; a normal `edge` push never moves `aresrpg.world`.

1. Populate and commit `changelog/NEXT.md`. When Move changed, prepare compatible upgrades or a
   testnet republish first, then commit the receipt-derived hardcoded `pins.json` values to `edge`.
2. From a clean, current `edge`, run `bun pm version patch` (or `minor`/`major`). Its lifecycle
   validates the branch, creates the numbered player changelog, commits and tags the root version,
   then pushes `edge` and the tag with `--follow-tags`.
3. The tag triggers `release.yml`. It waits for the exact SHA's green gate, builds only changed
   server/indexer images into public GHCR, and creates a production-variable Vercel deployment
   with `--skip-domain`. The GitHub Release remains draft and production stays unchanged.
4. During the maintenance window, the owner reconciles changed content and applies the prepared
   Kubernetes Helmfile diff. The composite game+seed projection identity chooses a store-preserving
   roll or a fresh repin.
5. The owner manually triggers `activate-production.yml` with the prepared version. It verifies the
   retained manifest, promotes the staged Vercel deployment without rebuilding, checks production,
   publishes the GitHub Release, and announces on Discord. Gameplay resumes only after these checks
   pass.

**AUDIENCE LAW** (maintainer ruling 2026-07-21): `changelog/NNN-RELEASE-vX.Y.Z.md` is not
internal release notes — GitHub Releases and Discord post it **verbatim**, so it's written for
players, not for us. Players care about new content and new features; bug fixes get one line;
infrastructure, CI, and repository internals stay out entirely.

Structure: H1 title, then **New content** and/or **New features** first (skip a section only if
it's truly empty — if both are empty, say plainly this is a maintenance release), optionally one
highlighted fix players actually felt (a crash, not a refactor), then exactly one closing line
pointing at the rest. Nothing else. Target ≤25 lines:

```md
# vX.Y.Z — short title

## New features

- Whatever players can now do.

Also: 4 bug fixes and stability improvements — full notes → <compare URL>
```

Technical detail — pipeline changes, refactors, dependency bumps — lives in the compare link the
closing line points to, never in the announce body.

**Rollback:** every production deployment maps 1:1 to a release tag. Roll back with Vercel's
instant rollback (dashboard → Deployments, or `vercel rollback`) to alias production onto the
previous tag's deployment — no revert commit, no re-promotion needed. Diff two releases with
`git diff vX.Y.Z..vA.B.C`.

## The quality bar

- `ARCHITECTURE.md` owns the system model; `AGENTS.md` owns the working agreement;
  `.claude/rules/code-law.md` explains the executable TypeScript law.
- **RED-FIRST**: a bug fix's first artifact is a failing test reproducing it; the PR carries
  both runs.
- Every player-facing string ships in all six locales in the same commit.
- The gate (`.github/workflows/gate.yml`) is required and only ever grows.
- Coverage is language-native and aggregate: Bun JS/TS 60% lines + 75% functions; Rust indexer 65%
  LLVM lines; Move control/seed/math/game 60%/30%/30%/25%. Tests and generated JS/TS are excluded,
  but no authored module is hidden. CI and pre-commit route each changed language through its gate;
  `bun run coverage:all` runs the complete local set. Every lane targets more than 80%; meaningful
  gains raise that lane's floor in the same change, and floors never decrease.
- Cognitive/cyclomatic hotspots are exact-score ratchets. Run `bun run complexity:baseline` only
  after reviewing a real reduction or accepting a new below-ceiling soft hotspot; it refuses score
  increases and new functions above the 15/12 hard ceilings.

## Scope

Welcome: client bugs, performance, UX, engine work, contracts, server/indexer work, docs, and
authored content. Content identity and balance changes start as issues because published rows can
affect live objects and fights; follow `CONTENT_UPGRADES.md` before implementation.

## License

Contributions require the CLA (`CLA.md`) — the bot asks on your first PR. Every source file
carries the SPDX header; `scripts/stamp_copyright.mjs` stamps new files.

# Contributing to AresRPG

## Setup

```bash
bun install
bun run dev        # Vite dev server at 127.0.0.1:5173 (network from VITE_NETWORK)
bun run test       # the one test truth — same command CI runs
bun run lint       # eslint + prettier + the constraint gates
```

Commits run ESLint and Prettier on staged source files only. Pushes do not rerun repository-wide
checks. Run focused tests while developing; CI owns the complete required verification.

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

1. When Move changed, the owner's release operator prepares the compatible upgrades first.
2. From a clean, current `edge`, the release operator commits the root version (patch, minor or major)
   with the receipt-derived `pins.json`, tags it, and pushes `edge` and the tag atomically.
3. The release operator dispatches preparation (`release.yml`) on the tag. It certifies on the first
   green `edge` gate of the tag commit or of its parent when the two trees differ only in the root
   version line, builds only the changed server, bot, Discord and indexer images into public GHCR,
   and stages a production Vercel deployment with `--skip-domain`. The GitHub Release stays a draft and production stays unchanged.
4. During the maintenance window, the owner reconciles changed content. When Move, server, or
   indexer changed, review and apply the prepared backend changes through private operations procedures.
   The composite game+seed projection identity chooses a store-preserving roll or a fresh repin.
5. The release operator dispatches `activate-production.yml` with the prepared version. It verifies the
   retained manifest, promotes the staged Vercel deployment without rebuilding, checks production,
   and publishes the generated GitHub Release. Gameplay resumes only after these checks pass.
6. Discord communication is separate from release mechanics. It happens only through the
   owner-triggered manual announcement workflow with explicitly reviewed player-facing text.

**Rollback:** every production deployment maps 1:1 to a release tag. Roll back with Vercel's
instant rollback (dashboard → Deployments, or `vercel rollback`) to alias production onto the
previous tag's deployment — no revert commit, no re-promotion needed. Diff two releases with
`git diff vX.Y.Z..vA.B.C`.

## The quality bar

- `ARCHITECTURE.md` owns the system model; `AGENTS.md` owns the working agreement and explains
  the executable TypeScript law.
- **RED-FIRST**: a bug fix starts with a failing scenario that reproduces it, kept in the package's
  core suite as `AGENTS.md` "Definition of done" states; the PR carries both runs.
- Every player-facing string ships in all supported locales in the same commit.
- The gate (`.github/workflows/gate.yml`) is required. Remove superseded or redundant checks; preserve behavioral guarantees and coverage floors.
- Coverage floors are stated once, in `AGENTS.md` "Commands and gates"; Move floors live only in
  `scripts/coverage_move.sh`. `bun run coverage:all` runs the complete local set, and floors never
  decrease.
- No function exceeds cognitive complexity 15 or cyclomatic complexity 12 (stock ESLint rules).
  Files that held a hotspot when the rules landed are listed in `INHERITED_COMPLEXITY_FILES`
  (`scripts/eslint-rules/fp_law.config.mjs`); a file leaves that list when reduced and none is added.

## Scope

Welcome: client bugs, performance, UX, engine work, contracts, server/indexer work, docs, and
authored content. Content identity and balance changes start as issues because published rows can
affect live objects and fights; follow `CONTENT_UPGRADES.md` before implementation.

## License

Contributions require the CLA (`CLA.md`) — the bot asks on your first PR. Every source file
carries the SPDX header. Add the header when creating a source file.

Contract contributions under the public license are limited to bug and security fixes. Compile and
run unit tests without deployment; publishing or redeploying contracts requires separate written
permission from the Licensor. See `LICENSE` for the binding terms.

Maintainer-authorized testnet deployment data stays in ignored `.dev/pins.json`. Committed `pins.json` always
describes the current mainnet deployment; testnet deployments are never pushed or released.

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
2. **Always rebase** — keep your branch rebased on the latest `edge`; a merge commit never
   enters a branch. **This is enforced by construction:** landings are fast-forward pushes, and
   an unrebased branch cannot fast-forward. `/promote` is a one-time REQUEST — it labels the PR
   `promote-requested`, and a land-on-green queue fast-forwards it the moment it is a green
   ancestor of its base. If your branch is behind, the bot posts the exact one-line rebase
   command; rebase locally (your commits stay signed) and force-push, and it lands automatically
   on the next green run — you never `/promote` twice.
3. Landings on BOTH hops are `/promote` — the repository owner's explicit word (on his own
   PRs the comment itself is the approval, since GitHub forbids self-review; on contributor
   PRs his approving review is required first). The **master hop is deploy-class**; the edge
   hop is routine integration. The bot pushes the
   exact approved SHA — your commits land byte-identical, so your signatures survive
   untouched (the merge buttons are ceremonial; UI rebase-merge would re-create commits
   unsigned — and so would a server-side API rebase, which is exactly why the queue never
   rebases for you: your local rebase is the one that keeps them signed).
4. `edge` → `master` is the same mechanic — the rebase discipline's terminal form — and each
   master promotion re-aligns `edge` so the branches never drift at release points.
5. Feature work reaches `edge` exclusively via a pull request + `/promote` — never a direct
   push. Direct pushes to `edge` are reserved for operator alignment acts (branch recreation,
   post-squash alignment) and are expected to be rare and always signed.
6. Landed branches are deleted automatically the moment they land (GitHub's
   `delete_branch_on_merge` setting doesn't cover this flow, since a landing is a fast-forward
   push, never a merge-button click). Only `master` and `edge` persist — every feature/fix
   branch is disposable once promoted.

## Releases & rollback

`master` deploys to Vercel **production** — and only on a release. Interim work and hotfixes
accumulate on `edge` until a release promotes them; nothing else ever reaches production.

1. The publisher bumps `packages/frontend/package.json` and adds
   `changelog/NNN-RELEASE-vX.Y.Z.md` as `edge`'s **final** commit, titled `release: vX.Y.Z`.
2. `/promote` the standing edge→master draft PR (opened automatically after the previous
   release — see `promote.yml`). The bot refuses the hop unless the promoted commit's subject
   matches `release: vX.Y.Z` — master cannot carry a non-release tip.
3. The push triggers `release.yml`: it tags `vX.Y.Z` from `package.json`, publishes the GitHub
   Release (notes = the newest changelog file), and announces on Discord.
4. Vercel builds **production** from that same push. `packages/frontend/vercel.json`'s
   `ignoreCommand` skips the build whenever `$VERCEL_ENV=production` and the head commit isn't
   release-tipped — the two gates (this one and step 2's) enforce the same law independently.
   Preview deployments (every PR, every branch) are unaffected; the check only activates in
   production.

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

- `.claude/rules/craft.md` + `docs/CODE_LAW.md` are the operating rules — pure functions,
  snake_case, no classes, immutability by default, effects at the edges.
- **RED-FIRST**: a bug fix's first artifact is a failing test reproducing it; the PR carries
  both runs.
- Every player-facing string ships in all six locales in the same commit.
- The gate (`.github/workflows/gate.yml`) is required and only ever grows.

## Scope

Welcome: client bugs, performance, UX, engine work, docs. Game content and balance are not
part of this repository — proposals touching them start as issues (design conversations,
not PRs).

## License

Contributions require the CLA (`CLA.md`) — the bot asks on your first PR. Every source file
carries the SPDX header; `scripts/stamp_copyright.mjs` stamps new files.

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
   enters a branch. PRs merge into `edge` by **rebase-merge only** (the other buttons are
   disabled).
3. `edge` → `master` is never a merge: the owner comments `/promote` and a bot
   **fast-forwards** master to the approved head — the rebase discipline's terminal form.
   Master's commits are byte-identical to edge's, so signatures survive untouched.
4. Signing note: the GitHub UI's rebase-merge re-creates commits (re-signed by GitHub, not
   you). If you sign your commits, prefer keeping your branch rebased yourself so the final
   fast-forward carries YOUR signatures end-to-end.

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

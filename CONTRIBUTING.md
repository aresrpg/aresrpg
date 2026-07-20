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
   enters a branch. **This is enforced by construction:** landings happen via the `/promote`
   fast-forward bot, and an unrebased branch cannot fast-forward — the bot refuses it.
3. Landings on BOTH hops are `/promote` — the repository owner's explicit word (on his own
   PRs the comment itself is the approval, since GitHub forbids self-review; on contributor
   PRs his approving review is required first). The **master hop is deploy-class**; the edge
   hop is routine integration. The bot pushes the
   exact approved SHA — your commits land byte-identical, so your signatures survive
   untouched (the merge buttons are ceremonial; UI rebase-merge would re-create commits
   unsigned, which is exactly why the bot exists).
4. `edge` → `master` is the same mechanic — the rebase discipline's terminal form — and each
   master promotion re-aligns `edge` so the branches never drift at release points.
5. Feature work reaches `edge` exclusively via a pull request + `/promote` — never a direct
   push. Direct pushes to `edge` are reserved for operator alignment acts (branch recreation,
   post-squash alignment) and are expected to be rare and always signed.

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

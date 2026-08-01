<!-- SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available -->

# ADR 002 — how a chain-money PR is held, and what releases it

Status: PROPOSED (2026-08-02, retroactive — the practice has been running since the first
upgrade train and has never been written down).

## Context

This repository's promotion pipeline is fast-forward-only and fully mechanical: a green PR lands
on `edge`, `edge` soaks, `/promote` fast-forwards `master`, CI tags and deploys. That pipeline
moves CODE. It does not move CHAIN STATE.

A PR that changes `packages/move/**` therefore has two landings, not one: it lands in the tree
like any other PR, and it reaches players only at a Move ceremony (upgrade or republish). Between
those two moments the code is live on `edge`, green on every gate, deployed to the frontend — and
the chain is still running the previous bytecode.

The practice that manages that gap exists and is followed. Its entire written form is a GitHub
label description:

> `upgrade-train` — "Rides the next Move package upgrade ceremony — never promoted to the live
> lineage before it"

`git grep -l "upgrade-train"` over `*.md` and `.github/` returns **nothing**. No rule file, no
workflow, no CONTRIBUTING section, no gate. The protocol is a label, a habit, and PR bodies —
e.g. PR #1833: "This lands the shrink in-tree; the on-chain package updates at the next republish
ceremony. That is why the row is referenced and not closed."

## Decision (as practised — this record states it, it does not change it)

1. **A Move change is not done when it lands.** Its issue stays OPEN after merge, carrying
   `upgrade-train`, until the ceremony that publishes it. Closing on merge would mark chain work
   done that the chain has never seen.
2. **The cargo manifest is the ledger.** `TRAIN_CARGO.txt` records `<sha> <lane> <subject>` per
   train member; a `chore(train): train-NN cargo manifest` commit seals each batch.
3. **The ceremony is the release event**, and it is owner-gated: it signs, publishes, and
   re-pins `packages/sdk/src/deployment/release.json`. No automation performs it.
4. **Between landing and ceremony, the money path runs the OLD bytecode.** A fix to a chain money
   door is not in force until its ceremony, however green the PR was.

## Consequences

**The one that is biting now.** After `75c4a3537` (see ADR 001) the live `aresrpg` lineage cannot
be upgraded at all, so the hold is no longer "until the next train" but "until a republish that
has no ticket and no date". Held behind it: `#1571` (P0 grant doors), `#387`, and `#1842`'s
restoration of the global emergency freeze on `shop::buy`/`buy_many` — a kill-switch that
measurably did not reach a money path. A hold protocol with no queue depth, no age, and no
escalation rule is indistinguishable from a leak while the queue is short, and this is the window
where it stopped being short.

**The record is invisible to everyone who is not already inside it.** A contributor reading
`CLAUDE.md`'s "Workflow — edge and master" section learns the code pipeline and would reasonably
conclude a merged Move fix is shipped. Nothing corrects that. An assistant session reading the
same file inherits the same wrong model.

**The label is load-bearing and unenforced.** Nothing mechanically checks that a PR touching
`packages/move/**` carries `upgrade-train`, that its issue survives the merge, or that its sha
reached `TRAIN_CARGO.txt`. Rows have already been observed to reach a ceremony without appearing
in the manifest that was supposed to list them (#639, #657).

## Alternatives considered

- **Say nothing and keep the label** — the status quo. Refused here only in the sense that this
  ADR asks for the practice to be written where a stranger reads it; it does not ask for new
  machinery.
- **Close Move issues on merge and track the ceremony separately** — refused: it re-creates the
  "green on edge, absent on chain" gap the label exists to name.

## Smallest durable fix (a gate, not this page)

A CI check on `pull_request`: if the diff touches `packages/move/**`, require the PR to carry
`upgrade-train` (or `no-chain-effect`), and require each member sha to reach `TRAIN_CARGO.txt`
before the ceremony's stamp step. Plus one paragraph in `CLAUDE.md`'s workflow section: a Move PR
has two landings, and merging is the first one.

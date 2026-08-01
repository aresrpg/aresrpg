<!-- SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available -->

# ADR 003 — a baseline needs a seal, or FROZEN rule 3 is prose

Status: PROPOSED (2026-08-02, retroactive — the convention appeared in `ecfe0d58c` /
`276e3e93e` and has never been named).

## Context

FROZEN rule 3: _"Baselines only shrink. Every ratchet (CodeQL, semgrep, depcruise, mutation
score, coverage) moves one way; `--rebaseline` is an explicit reviewed act with a written
adjudication."_

Every ratchet in this tree enforces the first half — no KEY may exceed its floor — and, with one
exception, none enforces the second: nothing detects the baseline FILE growing. `--write-baseline`
regenerates the floor from whatever the tree currently contains, so absorbing a new finding is one
flag away and reads as a normal diff.

Measured at `276e3e93e` (`edge` tip):

| baseline                                             | per-key floor                           | growth detected? | how                                                                                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/arch/in_src_tests.baseline.txt`             | exact path rows                         | **yes**          | `check-test-location.mjs:17` `EXPECTED_BASELINE_ROWS = 659`; `:62` fails with _"the in-src baseline grew by N row(s); FROZEN baselines only shrink"_; `prove_synthetic_red()` proves the gate can go red |
| `scripts/arch/single_home.baseline.json`             | yes (`single_home_verdict.mjs:104-108`) | no               | `--write` rewrites the file from the tree                                                                                                                                                                |
| `scripts/arch/semgrep_baseline.json`                 | yes (`semgrep_verdict.mjs:152-179`)     | no               | `scripts/semgrep-gate.sh:59` `--write-baseline`; the only guard is the comment at `:16` — _"never ABSORB a new finding unless the debt is deliberate and reviewed"_                                      |
| `scripts/arch/sim_protocol_constants.baseline.json`  | yes (`sim_constants_verdict.mjs`)       | no               | `--write-baseline`                                                                                                                                                                                       |
| `SIZE_BUDGETS` (`ceremony_preflight_compat.mjs:110`) | yes                                     | no               | a hand-edited integer literal; raised twice this window (99,239 → 99,260 → 99,347), each with a written adjudication in the same block                                                                   |

The one working tooth is also the newest, and it arrived by accident: `276e3e93e` exists because
deleting two in-src suites left the pinned count two rows high and _broke the gate's own
shrink-only self-proof_. The seal fired on its author.

Contrast FROZEN rule 5, which has a real tooth: a non-author `Adjudicated-by` trailer over the
fixture pathspecs, enforced in `scripts/check-constraints.sh:629-870` and tested in
`scripts/check-fixture-adjudication.test.mjs`.

## Decision

Name the convention and apply it to every ratchet: **a baseline file is sealed by a count pinned
OUTSIDE the file** (in the gate that reads it), and the gate fails when the file exceeds the seal.
Lowering the seal is the ratchet; raising it is the adjudicated act rule 3 already describes, and
it becomes visible because it is a second line in the diff that a reviewer cannot miss.

## Consequences

**Cost.** One integer per gate, hand-maintained, changed in the same commit as the baseline —
a deliberate second home. It is not a dual-home violation: a seal that derives from the thing it
seals seals nothing. That reasoning should be written at each seal, or the next single-home pass
will correctly flag it and wrongly delete it.

**What it does not fix.** A seal counts rows; it does not know which rows. A ratchet that swaps
a fixed finding for a new one at equal count passes. Per-key floors already cover most of that;
the residual is accepted.

**What it makes honest.** `ceremony_preflight_compat.mjs:89` currently states, flatly, _"Budgets
only SHRINK (FROZEN.md: baselines only shrink…)"_ — and the twenty lines directly beneath it are
two raises. Rule 3 permits both, so the raises are legal; the sentence above them is not the rule.
The record should read: budgets shrink by default; a raise is an adjudicated act, recorded here,
and the entries below are that record.

## Alternatives considered

- **Trust the reviewer.** The status quo for four of five baselines. Refused on this repo's own
  evidence: `#1101`, `#895` and the doctrine's own line — _a law that stays prose will eventually
  be broken under pressure_.
- **Ban `--write-baseline`.** Refused: regeneration is how a ratchet tightens; removing it makes
  the common good act expensive and the rare bad act no harder.
- **Sign baselines (hash + trailer), like rule 5's fixtures.** Stronger and heavier. Worth it if a
  seal is ever observed to be edited in the same commit as its baseline without comment; not yet.

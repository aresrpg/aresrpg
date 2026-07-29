# The Fight Pipeline — one journal, prediction overlays, a diffing presenter

Status: ADOPTED (2026-07-22). This is the architecture decision record for the combat
client/chain pipeline. Code that contradicts this document is wrong; changing this document
is a reviewed, deliberate act.

## The problem this design answers

The fight authority is a blockchain with seconds of finality, not an in-process server. A
client that merely renders chain state feels dead; a client that predicts must reconcile its
guesses against chain truth arriving late, duplicated, and interleaved. Every historical
combat bug class in this repo — replayed damage, double deaths, ghost turns, rolled-back
casts — came from one original sin: reconstructing fight history by DIFFING PERIODIC
SNAPSHOTS instead of reading an ordered log.

## The model (three ideas, no more)

1. **One journal, one writer.** The chain is the only author of canonical fight history. The
   indexer serves it as an ordered, per-fight event log (`/v1/fights/{id}/events`): `seq`
   contiguous from 0, immutable pages, `journal_head` on snapshots. Nothing client-side ever
   writes canon.
2. **One pure fold.** Committed fight truth is produced by the headless core fold
   (`packages/fight/src/core_fold.js`) and by nothing else. Every consumer reads it through ONE
   door — `committed_truth` in `packages/fight/src/store.js`, where its two inputs live
   (`core`, the fold fed by the write door; `retired`, the append-only death floor) — and
   `project.js` re-exports that door for the board. The door is TOTAL: there is no second
   derivation, no switch, and no fallback arm to answer from when the core is absent.
   PACED PRESENTATION is a different question and still derives from the settlement machinery
   (`presented_state` / `display_state` / `claimed_budget_state` in `fold.js`), which is why
   that module holds no committed fold at all. All canonical inputs — tx receipts (an early copy
   of journal content) and journal pages — normalize into ONE batch vocabulary and enter through
   ONE accept door with three laws:
   - **Contiguity**: a gap is resolved by fetching the missing range, never by skipping,
     never by adopting a snapshot.
   - **Idempotence**: a seq already accepted with identical content is a silent no-op —
     any input delivered twice produces byte-identical state.
   - **Protocol fault as data**: same seq, different content is surfaced as a fault event,
     never thrown, and accepted truth is never overwritten.
   - u64 values (seq, versions) compare as BigInt/strings, never coerced to Number.
     Snapshots are demoted to bootstrap (join/reload base + a `journal_head` watermark) and
     liveness signals. A snapshot never mutates a live fold.
3. **Prediction is an overlay that retires by claim.** Locally drafted actions (and
   sim-validated peer actions) paint immediately as predictions carrying a claim key. When
   the canonical event arrives: byte-equivalent outcome ⇒ the prediction retires silently
   (it was simply early); a true mismatch on the same claim ⇒ exactly one forward-only
   correction. An unrelated canonical event NEVER touches a pending prediction. There is no
   purge verb.

## Presentation: the transition principle

Presentation beats derive from VERSIONED STATE TRANSITIONS of the presented fold — an
alive→dead edge, a cell change, an HP change across a version range — which are once-only by
construction (monotonic versions; replayed inputs cause no new transition). The event stream
enriches beats (cause, path, spell identity); it never triggers them. Observers fold one
projected slice, compare by value, and emit only on real change (law L-P6 in
`docs/CODE_LAW.md`). Death is a corpse state, not an animation event.

## The two channels

- **Canonical**: receipts + journal pages → the accept door → the fold. Correctness lives
  here exclusively.
- **Courtesy (p2p)**: every player streams their committed actions to the fight room in
  real time, over the peer data channel (`fstream`, never visible chat history) — a PREVIEW only,
  which is why the standing "fights never ride p2p" law is not broken by it: losing every one of
  these messages changes no outcome. A receiving client validates each peer action through its OWN local sim before
  painting; an illegal action is never displayed and is flagged. Painted peer beats claim
  their identity so the canonical replay skips them. Loss of the courtesy channel costs
  latency only — never correctness.

## The turn cycle (normative)

```
MY TURN      drafted actions pre-paint locally + stream over the courtesy channel
END TURN     one transaction commits the whole drafted batch
RECEIPT      canonical events (my resolved actions + the mob turn) apply in seq order;
             byte-matches retire silently; the mob turn paces through the serial queue
NEXT PLAYER  their courtesy stream pre-paints (sim-validated), buffered behind any gap
             …repeat
```

The deterministic twin (sim ≡ Move, same math, parity fixtures) makes one further feed
possible and sanctioned: pre-simulating the mob turn the moment a commit is signed, retiring
it against the receipt like any prediction.

## The oracle set: how the one fold is held honest

One fold means the fold cannot be graded against a twin of itself. Every standing oracle below
puts something OUTSIDE the fold on the right-hand side — chain bytes, a second composition, or a
coordinate law — and each is a normal-suite check with no network at run time.

- **Chain-anchored committed truth.** `packages/fight/test/parity.test.js` folds a captured REAL
  testnet receipt through the core and requires it to equal the receipt's own chain ground truth,
  not merely a second fold of the same events.
- **Chain-anchored prediction.** `packages/fight/test/predict_chain_parity.test.js` pins
  `predict_cast` to a cast the deployed package actually resolved — stat blocks, board, spell row
  and `Hit` all chain bytes — including the branch the chain did NOT take, so a fixture that
  matched either way fails. `packages/sim/test/zone_chain_parity.test.js` does the same for zone
  derivation over every row of both streams.
- **Fixture staleness has an expiry.** Both chain fixtures assert their recorded `_provenance`
  package id IS `release.json`'s `latest` for the captured network (#1189), so a republish or an
  upgrade turns a silently-downgraded oracle into a re-capture ticket. A companion row runs the
  same predicate over the packages' retired ids so the binding cannot go vacuous.
- **One composition.** The zero-drift gate (`scripts/zero-drift-gate.mjs`, run by
  `scripts/check-constraints.sh`) resolves the world fight and the simulator fight from their
  roots and diffs them module by module: the two surfaces are one game or the gate is red (#914).
- **The coordinate law.** `packages/fight/test/journal_ordinal_law.test.js` pins that a version
  straddling a page boundary keeps one continuous ordinal run — the ordinal is the chain's `seq`,
  re-derived over the whole received set, never a row's position in the page that carried it
  (#866). Its companion `packages/fight/test/reconcile_properties.test.js` pins order-independence:
  committed truth is a function of the SET of reads, never their order.
- **The historical corpus.** `packages/fight/test/core_corpus_replay.test.js` replays the recorded
  capsule corpus through ingress → fold and requires every projection to be a LEGAL board,
  including the starve state where the eye lags the truth frontier.

What is NOT an oracle, named so nobody mistakes it for one:
`predict_build_internal_consistency.test.js` drives prediction and resolution through our own two
modules. That is internal consistency (`docs/CODE_LAW.md` L-D4) and it stayed green through a live
divergence; it earns its place by catching input drift between the halves, never by proving the
game is right.

## Forbidden forever

- Deriving events by diffing snapshots, at any layer, for any reason.
- A snapshot overwriting live fold state.
- Purging predictions on unrelated receipts.
- A second committed derivation for fight state, anywhere, for any purpose — parallel
  entity/death/position caches, a shadow fold kept for comparison, or a fallback arm that folds
  its own inputs when the core is missing. §2 admits ONE fold and no switch, and a shadow
  implementation maintained as a permanent oracle re-creates exactly the dual-home cost the one
  fold removed (#946, #1027). Truth is pinned against the CHAIN, never against a second copy of
  ourselves — the oracle set above is how.
- Effect machinery (promises, fetches, timers) inside the fight core — effects are injected
  at the edges; results re-enter as inputs (law L-P4).
- An effect kind published in content that the sim cannot resolve: the totality gate holds a
  closed effect-id → handler table; unknown kinds fail loudly at fixture time.

## Provenance

Adopted from the converged verdict of three independent architecture passes over the
production system, the recorded-trace replay corpus that reproduced every live defect class
deterministically, and the reference behavior of long-lived tactical-combat servers whose
fight cores stay small precisely because clients replay one ordered, authoritative stream.

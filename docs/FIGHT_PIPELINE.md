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
2. **A pure fold.** Fight state is produced by folding the ordered log through one reducer.
   All canonical inputs — tx receipts (an early copy of journal content) and journal pages —
   normalize into ONE batch vocabulary and enter through ONE accept door with three laws:
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
- **Courtesy (WebRTC)**: every player streams their committed actions to the fight room in
  real time. A receiving client validates each peer action through its OWN local sim before
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

## Forbidden forever

- Deriving events by diffing snapshots, at any layer, for any reason.
- A snapshot overwriting live fold state.
- Purging predictions on unrelated receipts.
- A second home for fight state (parallel entity/death/position caches outside the fold).
- Effect machinery (promises, fetches, timers) inside the fight core — effects are injected
  at the edges; results re-enter as inputs (law L-P4).
- An effect kind published in content that the sim cannot resolve: the totality gate holds a
  closed effect-id → handler table; unknown kinds fail loudly at fixture time.

## Provenance

Adopted from the converged verdict of three independent architecture passes over the
production system, the recorded-trace replay corpus that reproduced every live defect class
deterministically, and the reference behavior of long-lived tactical-combat servers whose
fight cores stay small precisely because clients replay one ordered, authoritative stream.

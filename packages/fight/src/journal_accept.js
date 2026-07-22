// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/journal_accept.js — THE ACCEPT MACHINE (M2a, #291): a pure reducer over the ordered journal
// that turns two ingress transports (receipts + journal pages, normalized by journal_normalize.js)
// into ONE contiguous, deduped, fault-checked accept stream.
//
// `state` is the ingress CURSOR — never a copy of the fight (that is the store's job downstream):
//   head    — the highest ACCEPTED seq (decimal string) or null (nothing yet). Invariant: every seq
//             in [0, head] has been accepted, so `head + 1` is the ONE next-expected seq.
//   digests — { [seq]: content_key } for the event-INGESTED accepted seqs. A snapshot-seeded seq
//             (seed_accept_state) carries none: the decoded object already folded it, so a later
//             re-delivery of it is trusted, not re-verified.
//
// accept_batch(state, batch) -> { state, effects } — three laws, all emitted as DATA, never thrown:
//   CONTIGUITY   the first seq beyond `head + 1` is a GAP: leave state untouched and emit
//                { type:'fetch_gap', from: head+1 } — the paginator's cue. Nothing is applied past a
//                gap (a re-walk from `from` re-delivers the missing range then this one, contiguously).
//   IDEMPOTENCE  a seq <= head whose content_key matches what was accepted is a silent no-op — the
//                same crash-replay / reconnect-catch-up safety the indexer's idempotent ZADD has.
//   FAULT        a seq <= head whose content_key DIFFERS emits { type:'protocol_fault', ... } and
//                NEVER overwrites accepted truth: prediction corrects forward, it never rewrites a page.
// Newly accepted events ride out as ONE { type:'apply', events } effect — the ordered, gap-free,
// dedup'd stream M2b folds through the store door.

import { content_key } from './journal_normalize.js'
import { u64 } from './journal_u64.js'

/** The initial cursor — nothing accepted; the first expected seq is 0. */
export const empty_accept_state = () => ({ head: null, digests: {} })

/**
 * Seed the cursor from a snapshot's `journalHead`. A decoded object at head N has already folded
 * events [0, N-1], so the cursor resumes at head = N-1 and only the tail (seq >= N) is ingested.
 * The seeded seqs carry no content_key — a later re-delivery of one is trusted (the object was
 * authoritative chain truth), so it is a silent no-op, never a fault.
 * @param {string|number|bigint} journal_head total event count the snapshot reflects
 */
export const seed_accept_state = (journal_head) => {
  const n = u64(journal_head)
  return n == null || n <= 0n ? empty_accept_state() : { head: (n - 1n).toString(), digests: {} }
}

/**
 * Fold one normalized batch into the cursor.
 * @param {{ head: string|null, digests: Record<string,string> }} state
 * @param {{ fight_id: string|null, events: Array<{ seq: string, kind: string, data: any, source?: string }> }} batch
 * @returns {{ state: { head: string|null, digests: Record<string,string> }, effects: any[] }}
 */
export const accept_batch = (state, batch) => {
  const fight_id = batch?.fight_id ?? null
  const digests = { ...(state?.digests ?? {}) }
  const applied = []
  const effects = []
  let head = u64(state?.head) // BigInt | null — the accepted frontier

  for (const event of batch?.events ?? []) {
    const seq = u64(event.seq)
    if (seq == null) continue // a malformed ordinal is not orderable — drop it (never crash)
    if (seq >= 1_000_000n) {
      effects.push({
        type: 'protocol_fault',
        fight_id,
        seq: event.seq,
        accepted: null,
        received: content_key(event),
        source: event.source,
      })
      break
    }
    const expected = head == null ? 0n : head + 1n
    if (seq === expected) {
      // NEW and contiguous — accept, record its content identity, advance the frontier.
      digests[event.seq] = content_key(event)
      applied.push(event)
      head = seq
    } else if (seq < expected) {
      // ALREADY ACCEPTED — idempotence vs protocol fault, decided by content identity.
      const prior = digests[event.seq]
      const received = content_key(event)
      if (prior != null && prior !== received)
        effects.push({
          type: 'protocol_fault',
          fight_id,
          seq: event.seq,
          accepted: prior,
          received,
          source: event.source,
        })
      // prior == null (snapshot-seeded) or prior === received → silent no-op.
    } else {
      // GAP — seq is beyond head+1. Never apply past a gap: request the fill and stop; any later
      // events ride behind the same gap and re-deliver contiguously once it is walked.
      effects.push({ type: 'fetch_gap', fight_id, from: expected.toString() })
      break
    }
  }

  if (applied.length) effects.unshift({ type: 'apply', fight_id, events: applied })
  return { state: { head: head == null ? null : head.toString(), digests }, effects }
}

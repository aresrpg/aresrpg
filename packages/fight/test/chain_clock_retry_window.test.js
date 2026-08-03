// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2118 — THE RETRY/MISSED VERDICT READS THE SAME CLOCK THE FLOOR AND THE HATCH READ.
//
// #2113 moved the submit window's two derivations into chain time (`chain_clock_submit_window.test.js`). The
// THIRD comparison over the same deadline — `auto_commit_decision`'s "is there still turn left for this
// in-flight commit to land?" — was left on the raw client clock, so a skewed client answered it in a frame the
// floor and the hatch had already left.
//
// THE DIRECTION IS ASYMMETRIC AND THAT IS THE WHOLE RULING: the residual leans RETRY, because the two errors are
// not equal. A doomed retry costs ONE wasted sponsored attempt (capped, and the chain's own ETurnTooFast floor
// already guards an early send). A premature `missed` forfeits a turn the chain would still have accepted —
// player-visible and irrecoverable. So the RAW offset is applied with no added margin: the estimator converges
// from BELOW, so the residual itself already leans toward the recoverable error.

import { beforeEach, describe, expect, test } from 'bun:test'

import { auto_commit_decision } from '../src/turn_commit.js'
import { fight_store } from '../src/store.js'
import { normalize_journal_page } from '../src/journal_normalize.js'

const ME = '0xme'
const FIGHT = '0xf1'
const TURN_MS = 45_000
const MOB_RESOLVE_MS = 3_000 // turns.move MOB_TURN_EXTRA_MS
const MOBS = 4

const CHAIN_T0 = 1_700_000_000_000
const CHAIN_HANDOVER = CHAIN_T0 + MOBS * MOB_RESOLVE_MS
const CHAIN_DEADLINE = CHAIN_T0 + TURN_MS + MOBS * MOB_RESOLVE_MS

/** The last local instant at which an UNCORRECTED client still answers `retry` — the pre-#2118 boundary. */
const UNCORRECTED_LAST_RETRY = CHAIN_DEADLINE - 1_500 - 1

/** The client's wall clock at chain instant `chain`, for a client skewed by `skew` (+ = ahead of the chain). */
const local_at = (chain, skew) => chain + skew

const in_flight = (now_ms, chain_offset_ms) =>
  auto_commit_decision({
    enabled: true,
    busy: true, // the retry/missed fork only exists while a commit is in flight
    now_ms,
    deadline_ms: CHAIN_DEADLINE,
    latch: null,
    turn_key: `${FIGHT}@${ME}@${CHAIN_DEADLINE}`,
    chain_offset_ms,
  })

describe('#2118 — the in-flight commit verdict is answered in chain time', () => {
  test('no observation ⇒ the pre-#2118 boundary, byte for byte', () => {
    expect(in_flight(UNCORRECTED_LAST_RETRY, null)).toBe('retry')
    expect(in_flight(UNCORRECTED_LAST_RETRY + 1, null)).toBe('missed')
    // An absent offset is not a zero the caller may invent — it reads identically either way, deliberately.
    expect(in_flight(UNCORRECTED_LAST_RETRY, 0)).toBe('retry')
    expect(in_flight(UNCORRECTED_LAST_RETRY + 1, 0)).toBe('missed')
  })

  test('client BEHIND the chain ⇒ `missed` lands EARLIER by exactly the offset', () => {
    // skew −8s ⇒ offset +8000: the chain is 8s further into this turn than this clock believes. The honest
    // answer is that the window closed 8s ago, and the uncorrected read would have kept retrying into a turn
    // the chain had already taken back.
    const offset = 8_000
    expect(in_flight(UNCORRECTED_LAST_RETRY - offset, offset)).toBe('retry')
    expect(in_flight(UNCORRECTED_LAST_RETRY - offset + 1, offset)).toBe('missed')
    // and at the uncorrected boundary it is long since decided
    expect(in_flight(UNCORRECTED_LAST_RETRY, offset)).toBe('missed')
  })

  test('client AHEAD of the chain ⇒ `retry` is held LONGER by exactly the offset', () => {
    // skew +8s ⇒ offset −8000. THIS is the irrecoverable arm: uncorrected, the client declares the turn missed
    // while the chain still holds 8 seconds of it, forfeiting a commit that was going to land.
    const offset = -8_000
    expect(in_flight(UNCORRECTED_LAST_RETRY, offset)).toBe('retry')
    expect(in_flight(UNCORRECTED_LAST_RETRY + 1, offset), 'uncorrected this is a forfeited turn').toBe('retry')
    expect(in_flight(UNCORRECTED_LAST_RETRY - offset, offset)).toBe('retry')
    expect(in_flight(UNCORRECTED_LAST_RETRY - offset + 1, offset)).toBe('missed')
  })

  test('the two arms are exactly one offset apart — no margin is added on either side', () => {
    for (const offset of [-8_000, -1_500, -1, 0, 1, 1_500, 8_000]) {
      const boundary = UNCORRECTED_LAST_RETRY - offset
      expect(in_flight(boundary, offset), `offset ${offset}`).toBe('retry')
      expect(in_flight(boundary + 1, offset), `offset ${offset}`).toBe('missed')
    }
  })
})

// ── THE WIRING ────────────────────────────────────────────────────────────────────────────────────────────────
// The pure verdict above is only worth its ink if the tick actually hands it the offset it already holds.

const fight_object = (deadline_ms) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: ME,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: 100,
      ready: false,
    },
  ],
  mobs: Array.from({ length: MOBS }, (_, i) => ({
    template: '0xabc',
    hp: 30,
    max_hp: 30,
    cell: 105 + i,
    ap: 4,
    mp: 3,
    level: 1,
  })),
  queue: [{ is_mob: false, idx: 0 }, ...Array.from({ length: MOBS }, (_, i) => ({ is_mob: true, idx: i }))],
  turn_ptr: 0,
  turn_ms: TURN_MS,
  turn_deadline_ms: deadline_ms,
  turn_entropy: 0,
  turn_ordinal: 0,
  placement_deadline_ms: 0,
  start_cells_a: [],
  start_cells_b: [],
  invisibility_statuses: [],
})

/** A live handed-over turn of mine on a client skewed by `skew`, with a drafted move in flight. */
const drafted_turn_in_flight = (skew) => {
  const store = fight_store
  store.getState().input({ type: 'init', fight_id: null })
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: ME, beat_ctx: { grid_width: 20 } },
  })
  store
    .getState()
    .input({ type: 'snapshot', version: 1, fight: fight_object(CHAIN_DEADLINE) }, local_at(CHAIN_T0, skew))
  const chain_now_ms = CHAIN_T0 + MOB_RESOLVE_MS
  store.getState().input(
    {
      type: 'journal',
      fight_id: FIGHT,
      batch: normalize_journal_page({ fight: FIGHT, events: [], journal_head: 0, chain_now_ms }, { fight_id: FIGHT }),
    },
    local_at(chain_now_ms, skew)
  )
  store.getState().input({ type: 'tick' }, local_at(CHAIN_HANDOVER, skew))
  expect(store.getState().turn_playable).toBe(true)
  return store
}

beforeEach(() => fight_store.getState().input({ type: 'init', fight_id: null }))

describe('#2118 — the tick hands the verdict the offset it already holds', () => {
  test('a client running AHEAD of the chain does not declare a landable turn lost', () => {
    const skew = 8_000
    const store = drafted_turn_in_flight(skew)
    expect(store.getState().chain_offset_ms).toBe(-8_000)
    // one drafted action + an in-flight commit: the exact shape `turn_lost` is written for
    store.getState().input({ type: 'stage', intent: { kind: 0, target: 101 } }, local_at(CHAIN_HANDOVER, skew) + 1)
    store.getState().input({ type: 'busy', value: true }, local_at(CHAIN_HANDOVER, skew) + 2)
    // This client's own clock has passed the deadline number (`expired` is true) while the CHAIN is still 7
    // seconds short of the submit window closing. Uncorrected, that is where the turn was declared lost — with
    // the commit still in flight and the chain still willing to take it.
    store.getState().input({ type: 'tick' }, CHAIN_DEADLINE + 1_000)
    expect(store.getState().turn_lost, 'the chain still holds this turn — it is not missed').toBe(null)
    // Once the CHAIN deadline is genuinely reached, the loss is declared honestly.
    store.getState().input({ type: 'tick' }, local_at(CHAIN_DEADLINE, skew))
    expect(store.getState().turn_lost?.reason).toBe('missed')
  })
})

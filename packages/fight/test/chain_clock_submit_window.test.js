// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2113 — THE SUBMIT WINDOW READS ONE CLOCK.
//
// #2099 moved the turn HANDOVER into chain time. The submit window still mixed frames: `min_turn_ready_at`
// `Math.max`'d a LOCAL instant (`turn_started_at`) against a CHAIN one (`chain_min_turn_at`), and
// `submit_wait_ms`'s deadline escape hatch compared the CHAIN `turn_deadline_ms` to a local `Date.now()`. Under
// skew the max picked the wrong arm and the hatch opened at the wrong moment — on the END TURN path, where the
// cost is real: an early submit EXECUTES and aborts ETurnTooFast (gas burned, digest exists, never retried per
// the burn law), a late one loses the turn to the timer.
//
// THE TWO DERIVATIONS ERR IN OPPOSITE DIRECTIONS, and that asymmetry is the whole point of this change:
//   · the FLOOR may open late      — worst case a wasted pre-sign wait, which costs nothing;
//   · the HATCH may NOT open late  — that is a FORFEITED turn, which this module already ranks as strictly
//                                    worse than an ETurnTooFast refusal.
// The estimator converges from BELOW (`offset_hat ≤ offset`), so the plain correction is late-biased: right for
// the floor, wrong for the hatch. The hatch therefore takes the MORE URGENT frame (`max(0, offset)`) instead.

import { beforeEach, describe, expect, test } from 'bun:test'

import { fight_store } from '../src/store.js'
import { min_turn_ready_at, submit_wait_ms, PLAYER_TURN_FLOOR_MS } from '../src/store_state.js'
import { normalize_journal_page } from '../src/journal_normalize.js'

const ME = '0xme'
const FIGHT = '0xf1'
const TURN_MS = 45_000
const MOB_RESOLVE_MS = 3_000 // turns.move MOB_TURN_EXTRA_MS
const MOBS = 4

const CHAIN_T0 = 1_700_000_000_000
const CHAIN_HANDOVER = CHAIN_T0 + MOBS * MOB_RESOLVE_MS
const CHAIN_DEADLINE = CHAIN_T0 + TURN_MS + MOBS * MOB_RESOLVE_MS

/** The client's wall clock at chain instant `chain`, for a client skewed by `skew` (+ = ahead of the chain). */
const local_at = (chain, skew) => chain + skew

const fight_object = (deadline_ms, turn_ms = TURN_MS) => ({
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
  turn_ms,
  turn_deadline_ms: deadline_ms,
  turn_entropy: 0,
  turn_ordinal: 0,
  placement_deadline_ms: 0,
  start_cells_a: [],
  start_cells_b: [],
  invisibility_statuses: [],
})

/**
 * Drive a live, handed-over turn of mine on a client skewed by `skew`. `observe` false leaves the fight with no
 * chain-clock observation at all — the pre-#2099 world, which is the byte-for-byte control.
 * `turn_ms` shortens the per-turn dial: the hatch below only bites when the handover lands within the floor of
 * the deadline, which on the default 45s dial never happens (the floor elapses 42s early).
 */
const live_turn = ({ skew, observe = true, turn_ms = TURN_MS }) => {
  const store = fight_store
  const deadline = CHAIN_T0 + turn_ms + MOBS * MOB_RESOLVE_MS
  store.getState().input({ type: 'init', fight_id: null })
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: ME, beat_ctx: { grid_width: 20 } },
  })
  store
    .getState()
    .input({ type: 'snapshot', version: 1, fight: fight_object(deadline, turn_ms) }, local_at(CHAIN_T0, skew))
  if (observe) {
    const chain_now_ms = CHAIN_T0 + MOB_RESOLVE_MS
    store.getState().input(
      {
        type: 'journal',
        fight_id: FIGHT,
        batch: normalize_journal_page({ fight: FIGHT, events: [], journal_head: 0, chain_now_ms }, { fight_id: FIGHT }),
      },
      local_at(chain_now_ms, skew)
    )
  }
  // The handover, at its chain-true moment on this client's clock — this stamps `turn_started_at` (LOCAL frame).
  // Unobserved, the uncorrected fold still fires on the raw chain number: that IS #2099, pinned in its own suite.
  store.getState().input({ type: 'tick' }, observe ? local_at(CHAIN_HANDOVER, skew) : CHAIN_HANDOVER)
  expect(store.getState().turn_playable).toBe(true)
  return store
}

beforeEach(() => fight_store.getState().input({ type: 'init', fight_id: null }))

describe('#2113 — the min-turn floor lands in the client’s own frame', () => {
  // The chain arm only outranks the local one when the deadline widened after the handover was stamped (the
  // "belt against a fold that has not re-run" case the derivation is written for) — so widen it, which is
  // exactly when a mixed-frame max does damage.
  const WIDENED = CHAIN_DEADLINE + 2 * MOB_RESOLVE_MS
  const CHAIN_FLOOR = WIDENED - TURN_MS + PLAYER_TURN_FLOOR_MS // chain_min_turn_at of the widened deadline

  const widen = (store, skew) =>
    store
      .getState()
      .input({ type: 'snapshot', version: 2, fight: fight_object(WIDENED) }, local_at(CHAIN_HANDOVER, skew) + 10_000)

  for (const [name, skew] of [
    ['+8s — the client clock runs AHEAD of the chain', 8_000],
    ['−8s — the client clock runs BEHIND the chain', -8_000],
    ['zero skew — the control: nothing moves', 0],
  ]) {
    test(name, () => {
      const store = live_turn({ skew })
      widen(store, skew)
      // The chain's floor is a CHAIN instant; on this client's clock it falls `skew` away from its own number.
      expect(min_turn_ready_at(store.getState())).toBe(local_at(CHAIN_FLOOR, skew))
    })
  }

  test('a floor the client cannot locate is never fabricated into one', () => {
    // A starved read (no per-turn dial) refuses to name a chain floor — 0, not an offset-shifted instant.
    const store = live_turn({ skew: -8_000 })
    store
      .getState()
      .input(
        { type: 'snapshot', version: 2, fight: { ...fight_object(WIDENED), turn_ms: 0 } },
        local_at(CHAIN_HANDOVER, -8_000) + 10_000
      )
    expect(min_turn_ready_at(store.getState())).toBe(store.getState().turn_started_at + PLAYER_TURN_FLOOR_MS)
  })
})

describe('#2113 — the deadline escape hatch errs EARLY, never late', () => {
  // A SHORT admin dial: the turn is handed over 4s before it expires, so the 3s min-turn floor is still pending
  // inside the hatch's own window — the only shape where the two actually contend.
  const SHORT_TURN_MS = 4_000
  const SHORT_DEADLINE = CHAIN_T0 + SHORT_TURN_MS + MOBS * MOB_RESOLVE_MS
  const short = (opts) => live_turn({ turn_ms: SHORT_TURN_MS, ...opts })
  // Where the hatch sits with NO correction: `deadline − now <= floor`, read on the raw client clock.
  const UNCORRECTED_HATCH = SHORT_DEADLINE - PLAYER_TURN_FLOOR_MS

  test('chain AHEAD of the client ⇒ the hatch opens EARLIER by exactly the offset', () => {
    const skew = -8_000 // client behind ⇒ offset = +8000: less turn left than this clock believes
    const store = short({ skew })
    expect(store.getState().chain_offset_ms).toBe(8_000)

    const opens_at = UNCORRECTED_HATCH - 8_000
    expect(submit_wait_ms(store.getState(), opens_at - 1), 'still inside the floor — hold the submit').toBeGreaterThan(
      0
    )
    expect(submit_wait_ms(store.getState(), opens_at), 'the chain is 8s further into this turn — go NOW').toBe(0)
    // Uncorrected the hatch waits 8 more seconds, and by then the chain deadline has passed: the turn is
    // forfeitable while the client is still politely waiting out a floor. That gap is the bug.
    expect(local_at(SHORT_DEADLINE, skew) - UNCORRECTED_HATCH).toBeLessThan(0)
  })

  test('client AHEAD of the chain ⇒ the hatch does NOT move — a lower bound never grants extra time', () => {
    const skew = 8_000 // offset = −8000; correcting symmetrically would DELAY the hatch, the one forbidden move
    const store = short({ skew })
    expect(store.getState().chain_offset_ms).toBe(-8_000)
    expect(submit_wait_ms(store.getState(), UNCORRECTED_HATCH - 1)).toBeGreaterThan(0)
    expect(submit_wait_ms(store.getState(), UNCORRECTED_HATCH), 'exactly where it sits today — deliberately').toBe(0)
  })

  test('zero skew — the control: the hatch sits exactly where it always did', () => {
    const store = short({ skew: 0 })
    expect(store.getState().chain_offset_ms).toBe(0)
    expect(submit_wait_ms(store.getState(), UNCORRECTED_HATCH - 1)).toBeGreaterThan(0)
    expect(submit_wait_ms(store.getState(), UNCORRECTED_HATCH)).toBe(0)
  })

  test('an unobserved clock changes nothing at all — the pre-#2099 world, byte for byte', () => {
    const store = short({ skew: -8_000, observe: false })
    expect(store.getState().chain_offset_ms).toBe(null)
    expect(submit_wait_ms(store.getState(), UNCORRECTED_HATCH - 1)).toBeGreaterThan(0)
    expect(submit_wait_ms(store.getState(), UNCORRECTED_HATCH)).toBe(0)
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1808 — THE TURN IS HANDED OVER ONCE, WHEN IT IS GENUINELY PLAYABLE.
//
// Player report (mobile testnet): the turn UI appeared, then a line said "minimum turn time 49s — mobs still
// resolving on chain" and play was blocked. "If it's my turn to play then it's my turn — don't let me play if
// it's not."
//
// The chain's `resolve_from` stamps `deadline = start + turn_ms + 3s × replayed mobs`: the tail of that window
// is the chain still spending the mobs' resolution budget. The client's own paced replay of those same mobs can
// drain FASTER (mobile, skipped animations), so `presenting` cleared while the chain was still resolving — and
// the client handed the turn over early, then explained the gap with a countdown nobody can act on.
//
// `deadline − turn_ms` IS that instant. This pins the fold's `turn_playable` on it: chain-active seat, nothing
// replaying locally, AND the chain's own mob budget spent. Slow mob resolution ⇒ no playable turn yet.

import { beforeEach, describe, expect, test } from 'bun:test'

import { fight_store } from '../src/store.js'
import { turn_playable } from '../src/project.js'
import { turn_handover_at } from '../src/draft_budget.js'

const ME = '0xme'
const TURN_MS = 45_000
const MOB_RESOLVE_MS = 3_000 // actions.move: `deadline = start + turn_ms + 3s × resolved mobs`

/** Seed a live turn of mine whose chain window the mobs' resolution budget widened by `mobs_replayed`. */
const seed_turn = ({ mobs_replayed, now, turn_ms = TURN_MS }) => {
  const store = fight_store
  store.getState().input({ type: 'init', fight_id: null })
  store.getState().input({
    type: 'init',
    fight_id: '0xf1',
    my_key: 'p0',
    ctx: { my_entity_id: ME, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input(
    {
      type: 'snapshot',
      version: 1,
      fight: {
        id: '0xf1',
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
        mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3, level: 1 }],
        queue: [
          { is_mob: false, idx: 0 },
          { is_mob: true, idx: 0 },
        ],
        turn_ptr: 0,
        turn_ms,
        turn_deadline_ms: now + TURN_MS + mobs_replayed * MOB_RESOLVE_MS,
        turn_entropy: 0,
        turn_ordinal: 0,
        placement_deadline_ms: 0,
        start_cells_a: [],
        start_cells_b: [],
        invisibility_statuses: [],
      },
    },
    now
  )
  return store
}

beforeEach(() => fight_store.getState().input({ type: 'init', fight_id: null }))

describe('#1808 — the turn-handover instant is the chain’s own, never the local replay’s', () => {
  test('`deadline − turn_ms` names the instant the chain finished spending the mob budget', () => {
    expect(turn_handover_at(1_000_000 + TURN_MS + 4 * MOB_RESOLVE_MS, TURN_MS)).toBe(1_000_000 + 4 * MOB_RESOLVE_MS)
    // No dial ⇒ no fabricated instant (a starved/dial-less read must never lock the player out).
    expect(turn_handover_at(1_000_000, 0)).toBe(0)
    expect(turn_handover_at(0, TURN_MS)).toBe(0)
  })

  test('mobs still resolving on chain ⇒ the turn is NOT playable, however fast the local replay drained', () => {
    const now = 1_000_000
    const store = seed_turn({ mobs_replayed: 4, now })
    expect(store.getState().turn_playable, 'chain-active seat, but the mob budget is unspent').toBe(false)
    expect(turn_playable(store.getState())).toBe(false)
  })

  test('the same turn becomes playable on the store’s own clock — one tick, one handover', () => {
    const now = 1_000_000
    const store = seed_turn({ mobs_replayed: 4, now })
    store.getState().input({ type: 'tick' }, now + 4 * MOB_RESOLVE_MS - 1)
    expect(store.getState().turn_playable, 'one ms early is still not my turn').toBe(false)
    store.getState().input({ type: 'tick' }, now + 4 * MOB_RESOLVE_MS)
    expect(store.getState().turn_playable, 'the chain’s budget is spent — hand it over').toBe(true)
    // The handover stamps the turn anchor ONCE, at the honest instant: the min-turn floor the button greys for
    // then runs the ordinary 3s from here, so there is no widened floor left to explain.
    expect(store.getState().turn_started_at).toBe(now + 4 * MOB_RESOLVE_MS)
  })

  test('an ordinary turn with nothing replayed is playable immediately — no new waiting anywhere', () => {
    const now = 1_000_000
    const store = seed_turn({ mobs_replayed: 0, now })
    expect(store.getState().turn_playable).toBe(true)
    expect(store.getState().turn_started_at).toBe(now)
  })

  test('a dial-less (starved) read never withholds the turn — the gate fails OPEN', () => {
    const now = 1_000_000
    // A read that carries a deadline but no per-turn dial cannot locate the handover; refusing to fabricate one
    // is the only safe direction — the alternative locks a player out of a turn the chain already gave them.
    const store = seed_turn({ mobs_replayed: 4, now, turn_ms: 0 })
    expect(store.getState().turn_playable).toBe(true)
  })
})

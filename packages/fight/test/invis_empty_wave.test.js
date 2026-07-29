// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #599 leg (b) — the PRESENTATION guard against an EMPTY mob wave: a pass receipt that is a bare
// [TurnEnded(player), TurnStarted(player)] with no mob gameplay event between them. The client must not wait
// forever on it — `presenting` stays false (no non-local turn to drain) and the player regains a PLAYABLE turn.
//
// #1061 lineage: this used to be introduced as "the all-invisible case", which no longer produces an empty wave
// (a blinded mob now emits MobMoved for its search walk — turns.move::search_anchor). The receipt shape this
// guards is still reachable and still the client's worst case: a mob that is walled in, or already standing at
// its goal, resolves its turn emitting nothing. The chain-side cause moved; the presentation invariant did not.
import { describe, test, expect } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { presenting, input_armed } from '../src/project.js'

const FIGHT = '0xf1647'
const WORLD = '0xworld'
const ME = '0xchar_a'
const OWNER = '0xa11ce'
const T0 = 1_000_000
const D1 = T0 + 30_000
const D2 = T0 + 90_000

const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

const fight_object = () => ({
  id: FIGHT,
  world: WORLD,
  status: 0,
  width: 20,
  height: 19,
  participants: [
    {
      owner: OWNER,
      character: ME,
      class: 'warrior',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 0,
      mp: 0,
      base_ap: 12,
      base_mp: 3,
      cell: 0,
      ready: false,
      casts_this_turn: 0,
      weapon: null,
    },
  ],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3 }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: 0,
  turn_entropy: 0,
  turn_ordinal: 1,
  placement_deadline_ms: T0 + 60_000,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

/** init → placement snapshot → placed+ready → my playable turn (deadline D1). */
const active_store = () => {
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT,
      ctx: { world_id: WORLD, my_entity_id: ME, address: OWNER, beat_ctx: { grid_width: 20 } },
    },
    T0
  )
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 }, T0 + 100)
  store.getState().input(
    {
      type: 'receipt',
      receipt: { events: [ev('Placed', { character: ME, cell: 21 }), ev('Ready', { character: ME })] },
      version: 2,
    },
    T0 + 500
  )
  store.getState().input(
    {
      type: 'receipt',
      receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: D1 })] },
      version: 3,
    },
    T0 + 1_000
  )
  return store
}

describe('#599 — an EMPTY mob wave (all targets invisible) must not stall the client', () => {
  test('bare TurnEnded→TurnStarted pass receipt leaves the player playable (no phantom presenting)', () => {
    const store = active_store()

    // The mob's only target is invisible → it passes emitting NOTHING. The player's pass receipt therefore holds
    // ONLY the two turn markers, no mob gameplay events between them.
    store.getState().input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: D2 }),
          ],
        },
        version: 4,
      },
      T0 + 6_000
    )

    const s = store.getState()
    expect(s.wave.filter((t) => !t.is_local)).toEqual([]) // no non-local turn was manufactured from zero mob events
    expect(presenting(s)).toBe(false) // …so presentation is NOT draining — nothing to wait for
    expect(s.active).toBe('p0') // the chain handed the turn back to me
    expect(s.turn_deadline_ms).toBe(D2)
    expect(input_armed(s, { busy: false })).toBe(true) // the fight is PLAYABLE again — it did not freeze
  })
})

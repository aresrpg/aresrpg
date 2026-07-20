// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LEG D — MP-ZONE LATCH AFTER SELF-CAST — after casting invisibility, the mp range didn't update: hovering
// showed nothing since the light-green zone never re-rendered. The
// light-green move zone (move_wash.reach) is suppressed WHILE my own cast VFX presents (cast_presenting) — a
// misclick guard — but must RE-RENDER the instant that local cast wave drains, sized to the CURRENT (post-buff)
// MP. This pins: a self-target cast's wave clears cast_presenting on drain, and the zone returns.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { move_wash, cast_presenting } from '../src/project.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(10, 9)

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: W,
  height: 19,
  world_seed: 999,
  spawn_id: 3,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 9,
      mp: 3,
      base_ap: 9,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: ME,
      stats: { agility: 10 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: enc(1, 1), ap: 4, mp: 3, level: 1, stats: { agility: 5 } }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

// A SELF-TARGET cast (invisibility + a +1 MP grant on myself) — its local wave carries a 'cast' beat.
const self_cast = (store) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'vanish1',
      actions: [
        { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: ME, ap_cost: 3 },
        { kind: 'Granted', target_is_mob: false, target_idx: 0, point_kind: 1, granted: 1 },
        { kind: 'StanceChanged', fighter_is_mob: false, fighter_idx: 0, stance: 27, active: true },
      ],
      beats: [{ kind: 'cast', at: 0, duration: 400, payload: {} }],
    },
    1_100
  )

describe('LEG D — the MP move zone returns after a self-cast VFX drains', () => {
  test('baseline: the zone is live before any cast', () => {
    const store = boot()
    const wash = move_wash(store.getState(), {})
    expect(wash.reach.length, 'the MP zone paints before a cast').toBeGreaterThan(0)
  })

  test('during the self-cast VFX the zone is suppressed (the misclick guard)', () => {
    const store = boot()
    self_cast(store)
    expect(cast_presenting(store.getState()), 'my own cast VFX is presenting').toBe(true)
    expect(move_wash(store.getState(), {}).reach.length, 'the zone is hidden mid-cast (guard)').toBe(0)
  })

  test('once the self-cast wave drains, the zone RE-RENDERS sized to the post-buff MP', () => {
    const store = boot()
    const base_reach = move_wash(store.getState(), {}).reach.length
    self_cast(store)
    for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, 1_500)
    expect(cast_presenting(store.getState()), 'the cast VFX cleared on drain').toBe(false)
    const wash = move_wash(store.getState(), {})
    expect(wash.reach.length, 'the light-green zone returns (never latched off)').toBeGreaterThan(0)
    expect(wash.reach.length, 'the zone grew with the +1 MP buff (post-buff MP)').toBeGreaterThan(base_reach)
  })
})

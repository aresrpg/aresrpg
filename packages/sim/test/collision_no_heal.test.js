// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  get_direction,
  handle_displacement,
} from '../src/fight_displacement.js'
import { find_entity } from '../src/fight_state.js'
import { create_fight_state } from '../src/reduce.js'

// THE KNOCKBACK THAT HEALS — a push/pull COLLISION is RAW environmental impact, never an "incoming hit". It must
// NOT route through the wave-12 reaction pipeline (DAMAGE_TO_HEAL / redirect / reflect), matching the Move twin:
// cast.move `displace_target` applies collision via `hit_mob`/`hit_player` (raw `apply_damage`), never the reaction
// twins `hit_*_from`. So a mob carrying DAMAGE_TO_HEAL that is shoved into a wall takes DAMAGE — it is NEVER healed.

const fighter = (overrides = {}) => ({
  id: 'm0',
  name: 'm0',
  cell: { x: 5, y: 8 },
  health: 20,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 5,
  mp_max: 5,
  ap_used: 0,
  mp_used: 0,
  is_player: false,
  template_id: 't',
  level: 1,
  stats: {},
  effects: [],
  deck: [],
  hand: [],
  discard: [],
  spell_levels: {},
  ap_reserve: 0,
  ...overrides,
})

const state_with = effects =>
  create_fight_state({
    fight_id: 'f',
    arena_seed: 1,
    arena_radius: 0,
    arena: {
      width: 20,
      height: 19,
      radius: 0,
      center: { x: 0, y: 0 },
      cells: new Uint8Array(20 * 19),
      spawns_a: [],
      spawns_b: [],
    },
    team0: [fighter({ id: 'p0', is_player: true, cell: { x: 4, y: 8 } })],
    team1: [fighter({ effects })],
  })

// A wall directly in the push path: the first step onto (6,8) is denied, so all 3 requested cells are blocked and
// collision damage (per_cell 1 × 3) lands on m0.
const wall = cell => !(cell.x === 6 && cell.y === 8)
const push = state =>
  handle_displacement(
    state,
    'm0',
    get_direction({ x: 4, y: 8 }, { x: 5, y: 8 }),
    3,
    1,
    wall,
    undefined,
  )

const INVERSION = {
  type: 'DAMAGE_TO_HEAL',
  source_id: 'x',
  value: 1,
  heal_multiplier: 1,
  chance: 100,
  turns_remaining: 5,
}

describe('collision damage is raw (Move parity) — a knockback never heals', () => {
  test('a DAMAGE_TO_HEAL mob shoved into a wall LOSES hp, emits a damage effect and ZERO heal', () => {
    const result = push(state_with([INVERSION]))
    // FOLD (state): the mob was DAMAGED 20 → 17, never healed to 23.
    expect(find_entity(result.state, 'm0').health).toBe(17)
    // BEAT (effects): a damage effect, no heal effect.
    expect(result.effects.some(effect => effect.heal !== undefined)).toBe(false)
    expect(
      result.effects.find(effect => effect.damage !== undefined),
    ).toMatchObject({
      target_id: 'm0',
      damage: 3,
      new_health: 17,
      killed: false,
    })
  })

  test('regression — a plain mob (no inversion) is unchanged: same raw collision damage', () => {
    const result = push(state_with([]))
    expect(find_entity(result.state, 'm0').health).toBe(17)
    expect(result.effects.some(effect => effect.heal !== undefined)).toBe(false)
    expect(
      result.effects.find(effect => effect.damage !== undefined),
    ).toMatchObject({
      target_id: 'm0',
      damage: 3,
    })
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_setup.test.js — the fight-start fold (spec §5): L1's builder output → the sim entity rows the
// authority is created from. These are the SHAPE assertions; the behavioural proof (the folded teams driven
// through the real chain to a decided winner) lives in fight_e2e.test.js.

import { describe, expect, test } from 'bun:test'

import { build_seat } from './content.js'
import { build_teams, mob_entity, seat_entity } from './fight_setup.js'

const character = {
  id: 'sim_c1',
  name: 'KAELIS',
  class_id: 'senshi',
  level: 20,
  stat_alloc: { vitality: 50, wisdom: 0, strength: 45, intelligence: 0, chance: 0, agility: 0 },
  spell_levels: { fire_strike: 3 },
  loadout: {},
}

/** A mob block in `build_mob`'s output shape — the fold reads it, never recomputes it. */
const mob_block = {
  template_id: '0xmob_aetherwing',
  name: 'Aetherwing',
  element: 3,
  role: 'striker',
  level: 12,
  min_level: 8,
  max_level: 16,
  hp: 60,
  max_hp: 60,
  ap: 6,
  mp: 3,
  stats: { strength: 20 },
  combat_block_published: true,
}

describe('a roster character becomes a player seat', () => {
  const seat = build_seat(character, [])
  const entity = seat_entity({ character, seat, spell_ids: ['fire_strike', 'ember_wall'], cell: { x: 4, y: 5 } })

  test('every number comes from L1’s builder, never recomputed here', () => {
    expect(entity.health).toBe(seat.hp)
    expect(entity.health_max).toBe(seat.max_hp)
    expect(entity.ap_max).toBe(seat.ap_max)
    expect(entity.mp_max).toBe(seat.mp_max)
    expect(entity.stats).toBe(seat.stats)
    expect(entity.level).toBe(seat.level)
  })

  test('the seat is a player, keyed by its roster id and class', () => {
    expect(entity.is_player).toBe(true)
    expect(entity.id).toBe('sim_c1')
    expect(entity.template_id).toBe('senshi')
    expect(entity.name).toBe('KAELIS')
  })

  test('allocated spell levels ride; unallocated spells still enter at the free baseline 1', () => {
    expect(entity.spell_levels).toEqual({ fire_strike: 3, ember_wall: 1 })
    expect(Object.keys(entity.spell_levels)).toEqual(['fire_strike', 'ember_wall'])
  })

  test('a seat opens at full health with a fresh pool', () => {
    expect(entity.health).toBe(entity.health_max)
    expect(entity.ap_used).toBe(0)
    expect(entity.mp_used).toBe(0)
    expect(entity.effects).toEqual([])
  })
})

describe('a picked mob becomes a mob seat with its authored kit', () => {
  const { entity, templates } = mob_entity({
    mob: mob_block,
    index: 0,
    cell: { x: 6, y: 5 },
    spells: [{ ap_cost: 3, min_range: 1, max_range: 1, effects: [] }],
  })

  test('identity and combat numbers come straight off the mob block', () => {
    expect(entity.is_player).toBe(false)
    expect(entity.id).toBe('mob_0')
    expect(entity.template_id).toBe(mob_block.template_id)
    expect(entity.health).toBe(60)
    expect(entity.ap_max).toBe(6)
    expect(entity.level).toBe(12)
  })

  test('its authored spell is in the spell book AND in the template map — never one without the other', () => {
    const [spell_id, ...rest] = Object.keys(entity.spell_levels)
    expect(rest).toEqual([])
    expect(templates.has(spell_id)).toBe(true)
    expect(entity.spell_levels[spell_id]).toBe(1)
  })
})

describe('build_teams merges every template into ONE map the authority carries', () => {
  test('class templates and every mob kit end up in one ctx map', () => {
    const class_templates = new Map([['fire_strike', { id: 'fire_strike', levels: [] }]])
    const { team0, team1, spell_templates } = build_teams({
      placements: [{ cell: { x: 4, y: 5 }, character, seat: build_seat(character, []), spell_ids: ['fire_strike'] }],
      picks: [
        { cell: { x: 6, y: 5 }, mob: mob_block, spells: [{ ap_cost: 3, min_range: 1, max_range: 1, effects: [] }] },
      ],
      class_templates,
    })
    expect(team0).toHaveLength(1)
    expect(team1).toHaveLength(1)
    expect(spell_templates.has('fire_strike')).toBe(true)
    expect(spell_templates.has(Object.keys(team1[0].spell_levels)[0])).toBe(true)
  })

  test('mob ids are index-keyed in pick order — the turn weave depends on that order being stable', () => {
    const { team1 } = build_teams({
      placements: [],
      picks: [
        { cell: { x: 6, y: 4 }, mob: mob_block },
        { cell: { x: 6, y: 6 }, mob: mob_block },
      ],
      class_templates: new Map(),
    })
    expect(team1.map(({ id }) => id)).toEqual(['mob_0', 'mob_1'])
  })
})

// The folded teams are driven through the REAL authority end to end in fight_e2e.test.js — that file is
// where a wrong field surfaces as a fight that cannot start, so it is not re-staged here.

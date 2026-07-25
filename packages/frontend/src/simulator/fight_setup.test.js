// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_setup.test.js — the fight-start fold (spec §5): L1's builder output → sim entities that the
// REAL authority accepts. The proof is not the shape but the fight: the folded teams are dropped into
// `create_session` and actually fought, so a wrong field surfaces as a fight that cannot start rather than as
// a green shape assertion.

import { describe, expect, test } from 'bun:test'
import { normalize_spell_templates, MOB_ATTACK_ID } from '@aresrpg/sim/spell_templates'

import { build_seat } from './content.js'
import { build_teams, mob_entity, seat_entity } from './fight_setup.js'
import { active_seat, commit_batch, create_session, drive_mob_turns, is_over } from './fight_driver.js'

const fake_encode_step = (pre, post, events) => events.map((event) => ({ type: event.type, parsedJson: event }))

const arena = (width = 11) => ({
  width,
  height: width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [{ x: 4, y: 5 }],
  spawns_b: [{ x: 6, y: 5 }],
})

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
    expect(entity.deck).toEqual(['fire_strike', 'ember_wall'])
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

  test('its authored spell is in the deck AND in the template map — never one without the other', () => {
    expect(entity.deck).toHaveLength(1)
    expect(templates.has(entity.deck[0])).toBe(true)
    expect(entity.spell_levels[entity.deck[0]]).toBe(1)
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
    expect(spell_templates.has(team1[0].deck[0])).toBe(true)
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

describe('the folded teams actually FIGHT (the shape proof that matters)', () => {
  test('a folded roster seat and a folded mob run a real turn through the authority', () => {
    const board = arena()
    // the built-in strike stands in for the published corpus here — the fold is what is under test, not balance
    const { team0, team1 } = build_teams({
      placements: [{ cell: { x: 4, y: 5 }, character, seat: build_seat(character, []), spell_ids: [MOB_ATTACK_ID] }],
      picks: [{ cell: { x: 6, y: 5 }, mob: { ...mob_block, hp: 20, max_hp: 20 } }],
      class_templates: normalize_spell_templates([]),
    })
    const ctx = { spell_templates: normalize_spell_templates([]), arena: board }
    const session = create_session({ fight_id: 'sim:1:1', seed: 42, arena: board, team0, team1 })
    const ready = commit_batch(session, [{ type: 'ready', entity_id: 'sim_c1' }], ctx, fake_encode_step)
    expect(ready.ok).toBe(true)
    expect(active_seat(ready.session)).toEqual({ id: 'sim_c1', is_player: true })

    const turn = commit_batch(
      ready.session,
      [
        { type: 'move', entity_id: 'sim_c1', path: [{ x: 5, y: 5 }] },
        { type: 'cast', entity_id: 'sim_c1', spell_id: MOB_ATTACK_ID, target: { x: 6, y: 5 } },
        { type: 'end_turn', entity_id: 'sim_c1' },
      ],
      ctx,
      fake_encode_step
    )
    expect(turn.ok).toBe(true)
    expect(turn.session.sim_state.team1[0].health).toBeLessThan(20)

    // and the mob answers on its own turn — a folded mob is a real actor, not a dummy
    const driven = drive_mob_turns(turn.session, ctx, fake_encode_step)
    expect(driven.turns).toBe(1)
    expect(driven.stalled_on).toBeNull()
    expect(is_over(driven.session)).toBe(false)
  })
})

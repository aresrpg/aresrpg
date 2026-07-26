// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { find_entity, get_current_turn_entity } from '../src/fight_state.js'

// c156 regression guards (from a live fight):
//   1. A trap PLACES on the ground and never damages the CASTER (it killed him before — its wide AoE covers
//      the caster's own cell + the path to engage, and a trap used to fire on whoever stepped on it).
//   2. A DEAD fighter cannot act (cast/move are no-ops) — it used to linger as the turn's actor and keep casting.
//   3. A fight whose whole side is dead ENDS (winner set + a single `fight_ended` event).
//   4. A fighter that dies mid-turn has its turn ended immediately (no lingering dead-actor turn / timer).

const flat_arena = (width = 21) => ({
  width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [
    { x: 5, y: 5 },
    { x: 5, y: 6 },
  ],
  spawns_b: [{ x: 7, y: 5 }],
})

// the REAL yajin 'trap' spell (packages/sdk/src/spells.json), normalized through the sim boundary: a
// damage trap with a wide `area: 1 square` placed at `target: 'trap'` cells.
const templates = normalize_spell_templates({
  yajin: {
    trap: {
      name: 'Trap',
      description: 'a hidden trap',
      levels: [
        {
          cost: 4,
          range: [1, 4],
          critical_chance: 100,
          area: 1,
          area_type: 'square',
          casts_per_turn: 255,
          casts_per_target: 255,
          cooldown_turns: 0,
          modifiable_range: true,
          line_of_sight: false,
          linear: false,
          free_cell: true,
          base_effects: [
            {
              type: 'damage',
              min: 5,
              max: 9,
              target: 'trap',
              element: 'earth',
              chance: 100,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
})

const make_entity = (id, cell, is_player, overrides = {}) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 5,
  mp_max: 5,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'yajin',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0, strength: 0 },
  effects: [],
  spell_levels: { trap: 1 },
  ap_reserve: 0,
  ...overrides,
})

/** Build a started fight. `team0`/`team1` are entity arrays. */
const started = (team0, team1) => {
  const arena = flat_arena()
  const ctx = { spell_templates: templates, arena }
  const state = create_fight_state({
    fight_id: 'f',
    arena_seed: 1,
    arena_radius: arena.radius,
    arena,
    team0,
    team1,
  })
  return { state: reduce(state, { type: 'start' }, ctx).state, ctx }
}

describe('trap owner-blind on_enter', () => {
  test('casting a trap places it and deals NO damage to the caster', () => {
    const { state, ctx } = started(
      [make_entity('p0', { x: 5, y: 5 }, true)],
      [make_entity('m0', { x: 7, y: 5 }, false)],
    )
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap',
        target: { x: 6, y: 5 },
      },
      ctx,
    )
    expect(cast.events.some(e => e.type === 'fight_cast')).toBe(true)
    expect(cast.state.traps.length).toBeGreaterThan(0) // placed on the ground
    expect(find_entity(cast.state, 'p0').health).toBe(100) // caster unharmed on cast
  })

  test('the caster walking onto its own trap can die', () => {
    // p0 has only 6 HP, so a trap's owner-agnostic on_enter payload is lethal.
    const { state, ctx } = started(
      [make_entity('p0', { x: 5, y: 5 }, true, { health: 6 })],
      [make_entity('m0', { x: 7, y: 5 }, false)],
    )
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap',
        target: { x: 6, y: 5 },
      },
      ctx,
    )
    // step onto (6,5) — a cell its own trap covers (the path to engage the enemy)
    const move = reduce(
      cast.state,
      { type: 'move', entity_id: 'p0', path: [{ x: 6, y: 5 }] },
      ctx,
    )
    expect(find_entity(move.state, 'p0').health).toBe(0)
    expect(move.state.winner).toBe(1)
    expect(move.events.some(e => e.type === 'fight_trap_triggered')).toBe(true)
    expect(move.events.some(e => e.type === 'fight_ended')).toBe(true)
  })
})

describe('c156: death + fight-end', () => {
  test('a DEAD fighter cannot cast (the command is a no-op)', () => {
    // a 2v1 so the fight stays open (winner -1) while p0 is dead — the lingering-dead-actor case
    const { state, ctx } = started(
      [
        make_entity('p0', { x: 5, y: 5 }, true),
        make_entity('p1', { x: 5, y: 6 }, true),
      ],
      [make_entity('m0', { x: 7, y: 5 }, false)],
    )
    expect(get_current_turn_entity(state).id).toBe('p0')
    // simulate p0 having just died (health 0) while still the turn's actor
    const dead = {
      ...state,
      team0: state.team0.map(e => (e.id === 'p0' ? { ...e, health: 0 } : e)),
    }
    const cast = reduce(
      dead,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap',
        target: { x: 6, y: 5 },
      },
      ctx,
    )
    expect(cast.events.length).toBe(0) // no-op: a dead actor cannot act
    expect(cast.state.traps.length).toBe(0)
  })

  test('a fight whose whole side is dead ENDS (winner + one fight_ended)', () => {
    // m0 with 1 HP dies to p0's trap when it steps on -> team1 wiped -> fight ends
    const { state, ctx } = started(
      [make_entity('p0', { x: 5, y: 5 }, true)],
      [make_entity('m0', { x: 7, y: 5 }, false, { health: 1, mp: 5 })],
    )
    const cast = reduce(
      state,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'trap',
        target: { x: 6, y: 5 },
      },
      ctx,
    )
    const ended = reduce(cast.state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    expect(get_current_turn_entity(ended.state).id).toBe('m0')
    const move = reduce(
      ended.state,
      { type: 'move', entity_id: 'm0', path: [{ x: 6, y: 5 }] },
      ctx,
    )
    expect(find_entity(move.state, 'm0').health).toBe(0)
    expect(move.state.winner).toBe(0) // the player team won
    expect(move.events.filter(e => e.type === 'fight_ended').length).toBe(1)
  })

  test('a fighter that dies mid-turn (enemy trap) has its turn ended immediately', () => {
    // 1v2: m0 places a trap, ends turn; p0 (surviving teammate p1) walks onto m0's trap and dies. The fight
    // continues (p1 alive), so p0's dead turn must auto-advance to the next actor (no lingering dead-actor turn).
    const { state, ctx } = started(
      [
        make_entity('p0', { x: 5, y: 5 }, true, { health: 6 }),
        make_entity('p1', { x: 5, y: 6 }, true),
      ],
      [make_entity('m0', { x: 7, y: 5 }, false)],
    )
    // turn order interleaves p0, m0, p1 — let p0 end its turn so m0 (the mob) can place a trap
    const t1 = reduce(state, { type: 'end_turn', entity_id: 'p0' }, ctx)
    expect(get_current_turn_entity(t1.state).id).toBe('m0')
    const trap = reduce(
      t1.state,
      {
        type: 'cast',
        entity_id: 'm0',
        spell_id: 'trap',
        target: { x: 6, y: 5 },
      },
      ctx,
    )
    const t2 = reduce(trap.state, { type: 'end_turn', entity_id: 'm0' }, ctx)
    expect(get_current_turn_entity(t2.state).id).toBe('p1')
    const t3 = reduce(t2.state, { type: 'end_turn', entity_id: 'p1' }, ctx)
    // back to p0; it walks onto m0's ENEMY trap on (6,5) and dies
    expect(get_current_turn_entity(t3.state).id).toBe('p0')
    const move = reduce(
      t3.state,
      { type: 'move', entity_id: 'p0', path: [{ x: 6, y: 5 }] },
      ctx,
    )
    expect(find_entity(move.state, 'p0').health).toBe(0) // p0 died on the enemy trap
    expect(move.state.winner).toBe(-1) // p1 still alive -> fight continues
    // p0's turn ended immediately -> the active actor is no longer the dead p0
    expect(move.events.some(e => e.type === 'fight_turn_end')).toBe(true)
    expect(get_current_turn_entity(move.state).id).not.toBe('p0')
  })
})

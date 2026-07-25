// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/turn_mapping.test.js — the staged-draft → sim-command mapping (spec §4.5 step 1).
//
// The rows under test are the PRODUCTION staged shape (`turn_commit.js stage_to_batch`'s input), so a drift in
// what the HUD stages breaks here rather than silently committing a different turn than the player drafted.

import { describe, expect, test } from 'bun:test'

import { encode } from '@aresrpg/fight/los'
import { normalize_spell_templates, MOB_ATTACK_ID } from '@aresrpg/sim/spell_templates'
import { create_fight_state, reduce } from '@aresrpg/sim/reduce'

import { stage_to_commands } from './turn_mapping.js'

const arena = (width = 11, blocked = []) => {
  const cells = new Uint8Array(width * width)
  for (const { x, y } of blocked) cells[y * width + x] = 1
  return {
    width,
    height: width,
    radius: (width - 1) / 2,
    center: { x: (width - 1) / 2, y: (width - 1) / 2 },
    cells,
    spawns_a: [{ x: 2, y: 5 }],
    spawns_b: [{ x: 8, y: 5 }],
  }
}

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 12,
  ap_max: 12,
  mp: 6,
  mp_max: 6,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : 'mob',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  deck: Array.from({ length: 8 }, () => MOB_ATTACK_ID),
  hand: [MOB_ATTACK_ID],
  discard: [],
  spell_levels: { [MOB_ATTACK_ID]: 1 },
  ap_reserve: 0,
})

const state_of = (board) =>
  create_fight_state({
    fight_id: 'sim:1:1',
    arena_seed: 1,
    arena_radius: board.radius,
    arena: board,
    team0: [fighter('sim_c1', { x: 2, y: 5 }, true)],
    team1: [fighter('mob_0', { x: 5, y: 5 }, false)],
  })

describe('staged moves become real sim paths', () => {
  test('one waypoint becomes the step-by-step path, start cell excluded', () => {
    const board = arena()
    const { commands, rejected } = stage_to_commands([{ kind: 0, target: encode(4, 5) }], {
      sim_state: state_of(board),
      arena: board,
      entity_id: 'sim_c1',
    })
    expect(rejected).toEqual([])
    expect(commands).toHaveLength(2) // the move + the implicit end_turn
    expect(commands[0].type).toBe('move')
    expect(commands[0].path).toEqual([
      { x: 3, y: 5 },
      { x: 4, y: 5 },
    ])
    expect(commands[1]).toEqual({ type: 'end_turn', entity_id: 'sim_c1' })
  })

  test('multiple waypoints chain from the RUNNING cell — a bent path, not two paths from the start', () => {
    const board = arena()
    const { commands } = stage_to_commands(
      [
        { kind: 0, target: encode(2, 7) },
        { kind: 0, target: encode(4, 7) },
      ],
      { sim_state: state_of(board), arena: board, entity_id: 'sim_c1', end_turn: false }
    )
    expect(commands).toHaveLength(2)
    expect(commands[0].path[commands[0].path.length - 1]).toEqual({ x: 2, y: 7 })
    // the second segment STARTS where the first ended (2,7) — not back at the spawn (2,5)
    expect(commands[1].path[0]).toEqual({ x: 3, y: 7 })
    expect(commands[1].path[commands[1].path.length - 1]).toEqual({ x: 4, y: 7 })
  })

  test('the mapped path routes AROUND an obstacle the board painted (no straight lines)', () => {
    const board = arena(11, [{ x: 3, y: 5 }])
    const { commands } = stage_to_commands([{ kind: 0, target: encode(4, 5) }], {
      sim_state: state_of(board),
      arena: board,
      entity_id: 'sim_c1',
      end_turn: false,
    })
    expect(commands[0].path.some((cell) => cell.x === 3 && cell.y === 5)).toBe(false)
    expect(commands[0].path[commands[0].path.length - 1]).toEqual({ x: 4, y: 5 })
  })

  test('a path THROUGH a living body is refused, never quietly re-routed into the body', () => {
    const board = arena()
    const { commands, rejected } = stage_to_commands([{ kind: 0, target: encode(5, 5) }], {
      sim_state: state_of(board), // the mob stands on (5,5)
      arena: board,
      entity_id: 'sim_c1',
      end_turn: false,
    })
    expect(commands).toEqual([])
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBe('unreachable')
  })
})

describe('staged casts and weapon strikes', () => {
  test('a cast carries its template id and the decoded target cell', () => {
    const board = arena()
    const { commands, rejected } = stage_to_commands(
      [{ kind: 1, target: encode(5, 5), spell_template_id: MOB_ATTACK_ID }],
      { sim_state: state_of(board), arena: board, entity_id: 'sim_c1', end_turn: false }
    )
    expect(rejected).toEqual([])
    expect(commands).toEqual([{ type: 'cast', entity_id: 'sim_c1', spell_id: MOB_ATTACK_ID, target: { x: 5, y: 5 } }])
  })

  test('a weapon strike (kind 2) maps to the seat’s weapon spell', () => {
    const board = arena()
    const { commands } = stage_to_commands([{ kind: 2, target: encode(5, 5) }], {
      sim_state: state_of(board),
      arena: board,
      entity_id: 'sim_c1',
      weapon_spell_id: MOB_ATTACK_ID,
      end_turn: false,
    })
    expect(commands[0].spell_id).toBe(MOB_ATTACK_ID)
  })

  test('an unmappable row is REJECTED with a reason, never silently dropped', () => {
    const board = arena()
    const { commands, rejected } = stage_to_commands(
      [{ kind: 1, target: encode(5, 5) }, { kind: 2, target: encode(5, 5) }],
      { sim_state: state_of(board), arena: board, entity_id: 'sim_c1', end_turn: false }
    )
    expect(commands).toEqual([])
    expect(rejected.map((row) => row.reason)).toEqual(['no_spell_template', 'no_weapon_spell'])
  })
})

describe('the mapping produces commands the REAL sim accepts', () => {
  test('a mapped move+cast turn folds through reduce and damages the target', () => {
    const board = arena()
    const ctx = { spell_templates: normalize_spell_templates([]), arena: board }
    const ready = reduce(state_of(board), { type: 'ready', entity_id: 'sim_c1' }, ctx).state
    const { commands, rejected } = stage_to_commands(
      [
        { kind: 0, target: encode(4, 5) },
        { kind: 1, target: encode(5, 5), spell_template_id: MOB_ATTACK_ID },
      ],
      { sim_state: ready, arena: board, entity_id: 'sim_c1' }
    )
    expect(rejected).toEqual([])
    const folded = commands.reduce(
      (acc, command) => {
        const { state, events } = reduce(acc.state, command, ctx)
        return { state, events: [...acc.events, ...events] }
      },
      { state: ready, events: [] }
    )
    expect(folded.events.some((event) => event.type === 'fight_moved')).toBe(true)
    expect(folded.events.some((event) => event.type === 'fight_cast')).toBe(true)
    expect(folded.state.team1[0].health).toBeLessThan(100)
  })
})

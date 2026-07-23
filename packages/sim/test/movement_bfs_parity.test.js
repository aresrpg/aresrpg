// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { find_path_4dir } from '../src/pathfind.js'
import { create_fight_state, reduce } from '../src/reduce.js'

import {
  chain_walk_path,
  scenario_occupied,
  scenario_terrain_walkable,
  scenario_walkable,
  walk_parity_scenarios,
} from './fixtures/movement_bfs_parity.js'

const entity_of = ({ id, is_player, cell }) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 8,
  mp_max: 8,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'parity',
  level: 1,
  stats: {},
  effects: [],
  deck: [],
  hand: [],
  discard: [],
  spell_levels: {},
  ap_reserve: 0,
})

const arena_of = scenario => {
  const cells = new Uint8Array(scenario.board.width * scenario.board.height)
  for (const cell of scenario.board.obstacles)
    cells[cell.y * scenario.board.width + cell.x] = 1
  return {
    width: scenario.board.width,
    height: scenario.board.height,
    radius: 0,
    center: { x: 0, y: 0 },
    cells,
    spawns_a: [],
    spawns_b: [],
  }
}

const state_of = (scenario, arena) => {
  const mover = entity_of({ ...scenario.mover, cell: scenario.mover.start })
  const entities = [
    mover,
    entity_of(scenario.opponent),
    ...scenario.bodies.map(entity_of),
  ]
  const state = create_fight_state({
    fight_id: scenario.meta.id,
    arena_seed: 474,
    arena_radius: 0,
    arena,
    team0: entities.filter(entity => entity.is_player),
    team1: entities.filter(entity => !entity.is_player),
  })
  return {
    ...state,
    started: true,
    turn_order: [mover.id],
    traps: [
      {
        id: 1,
        source_id: scenario.trap.source_id,
        anchor: scenario.trap.cell,
        cells: [scenario.trap.cell],
        element: 'EARTH',
        min: 7,
        max: 7,
      },
    ],
  }
}

describe('Move/sim canonical walk parity (#474 interim)', () => {
  for (const scenario of walk_parity_scenarios) {
    test(scenario.meta.id, () => {
      const is_walkable = scenario_walkable(scenario)
      const terrain_walkable = scenario_terrain_walkable(scenario)
      const is_occupied = scenario_occupied(scenario)
      const chain_path = chain_walk_path(
        scenario.mover.start,
        scenario.destination,
        scenario.budget,
        is_walkable,
      )
      expect(chain_path).toEqual(scenario.expected_path)

      const sim_path = find_path_4dir(
        scenario.mover.start,
        scenario.destination,
        scenario.budget,
        terrain_walkable,
        is_occupied,
      )
      expect(sim_path, scenario.meta.symptom).toEqual(chain_path)

      const arena = arena_of(scenario)
      const result = reduce(
        state_of(scenario, arena),
        { type: 'move', entity_id: scenario.mover.id, path: sim_path.slice(1) },
        { arena, spell_templates: new Map() },
      )
      const moved = result.events.find(event => event.type === 'fight_moved')
      const walked_cells = chain_path.slice(1)
      expect(moved?.path).toEqual(walked_cells)

      const crossed_trap = walked_cells.some(
        cell =>
          cell.x === scenario.trap.cell.x && cell.y === scenario.trap.cell.y,
      )
      const trap_events = result.events.filter(
        event => event.type === 'fight_trap_triggered',
      )
      expect(crossed_trap).toBe(scenario.expected_trigger)
      expect(trap_events.map(event => event.cell)).toEqual(
        crossed_trap ? [scenario.trap.cell] : [],
      )
      expect(result.state.traps).toHaveLength(crossed_trap ? 0 : 1)
      expect(find_entity(result.state, scenario.mover.id)?.health).toBe(
        crossed_trap ? 93 : 100,
      )
    })

    if (scenario.alternate_path) {
      test(`${scenario.meta.id} canonicalizes caller intermediates`, () => {
        const arena = arena_of(scenario)
        const result = reduce(
          state_of(scenario, arena),
          {
            type: 'move',
            entity_id: scenario.mover.id,
            path: scenario.alternate_path,
          },
          { arena, spell_templates: new Map() },
        )
        const moved = result.events.find(event => event.type === 'fight_moved')
        expect(moved?.path, scenario.meta.symptom).toEqual(
          scenario.expected_path.slice(1),
        )
      })
    }
  }
})

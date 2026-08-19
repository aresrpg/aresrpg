// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The walk law under mid-walk displacement (twin of fight_walk_tests.move): bodies are walls,
// and a body a trap payload pulls onto a declared-but-not-yet-entered cell stops the remaining
// route — the walker never shares a cell with a living fighter.

import { describe, expect, test } from 'bun:test'

import { GRID_CELLS, mask_get } from '../src/combat_grid.ts'
import { create_fight } from '../src/fight.ts'
import { create_character_source, create_fight_state } from '../src/create.ts'
import { CONTRACT_CONSTANTS } from '../src/move_contract.gen.ts'
import type { BoardZone } from '../src/types.ts'

const GRID_W = BigInt(CONTRACT_CONSTANTS.grid_w)

// A circle-2 pull trap — the ZONE is the payload's area (one authored fact): the walker
// entering the anchor triggers it and the pull drags every occupant of the circle toward the
// anchor; the walker standing on it is spared by the pull's own ≤1-distance floor.
const pull_trap = (anchor: bigint): BoardZone => ({
  owner_fighter: 1n,
  trap: true,
  shape: 1n,
  size: 2n,
  anchor,
  turns_left: 0n,
  effects: [
    {
      kind: 9n,
      element: '',
      value: 1n,
      value_max: 1n,
      area_shape: 0n,
      area_size: 0n,
      target_filter: 0n,
      chance_bp: 10_000n,
      turns: 0n,
      stat: 0n,
    },
  ],
})

const damage_trap = (anchor: bigint): BoardZone => ({
  owner_fighter: 1n,
  trap: true,
  shape: 0n,
  size: 0n,
  anchor,
  turns_left: 0n,
  effects: [
    {
      kind: 0n,
      element: 'earth',
      value: 5n,
      value_max: 5n,
      area_shape: 0n,
      area_size: 0n,
      target_filter: 0n,
      chance_bp: 10_000n,
      turns: 0n,
      stat: 0n,
    },
  ],
})

const walk_scenario = () => {
  const checkpoint = create_fight_state({
    fight_id: '0xf1',
    world: 'incarnam',
    x: 250_000n,
    z: 250_000n,
    board_seed: 1n,
    players: [
      {
        character: '0xc1',
        owner: '0xa1',
        team: 0n,
        ready: true,
        hp: 100n,
        // agility 1000 ⇒ the tackle contest is a guaranteed escape — the guard under test is
        // the only thing that can stop this walk
        source: create_character_source({ classe: 'senshi', level: 10n, agility: 1_000n }),
      },
    ],
    mobs: [
      {
        team: 1n,
        scalar: 100n,
        template: {
          mob_type: 'wabbit',
          level_min: 10n,
          level_max: 10n,
          hp: 100n,
          ap: 6n,
          mp: 3n,
          agility: 0n,
          wisdom: 0n,
          earth_res: 32_768n,
          fire_res: 32_768n,
          water_res: 32_768n,
          air_res: 32_768n,
          spells: [],
          xp: 50n,
          loot: [],
        },
      },
    ],
    spells: {},
  })
  // four consecutive open cells on one row: start → step_1 (trap) → step_2 ← bystander
  const run = (() => {
    for (let cell = 0n; cell < GRID_CELLS; cell += 1n) {
      if (cell % GRID_W > GRID_W - 4n) continue
      const candidate = [cell, cell + 1n, cell + 2n, cell + 3n] as const
      if (candidate.every((c) => !mask_get(checkpoint.contract.closed, c))) return candidate
    }
    throw new Error('fixture board has no open 4-cell row run')
  })()
  const [start, step_1, step_2, bystander_cell] = run
  checkpoint.contract.fighters[0]!.cell = start
  checkpoint.contract.fighters[1]!.cell = bystander_cell
  checkpoint.contract.zones = [pull_trap(step_1)]
  return { checkpoint, step_1, step_2 }
}

describe('the walk under mid-walk displacement', () => {
  test('a body pulled onto the declared route stops the walk', () => {
    const { checkpoint, step_1, step_2 } = walk_scenario()
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })

    const result = fight.apply({ type: 'move_to', fighter: 0n, path: [step_1, step_2] })

    expect(result.error).toBeNull()
    // the trap's pull landed the bystander on the walker's second declared cell…
    expect(result.state.contract.fighters[1]!.cell).toBe(step_2)
    // …so the walk stops on the first step instead of entering an occupied cell
    expect(result.state.contract.fighters[0]!.cell).toBe(step_1)
  })

  test('multiple traps remain interleaved with the exact accepted walk steps', () => {
    const { checkpoint, step_1, step_2 } = walk_scenario()
    checkpoint.contract.zones = [damage_trap(step_1), damage_trap(step_2)]
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })

    const result = fight.apply({ type: 'move_to', fighter: 0n, path: [step_1, step_2] })
    const visible = result.events.filter(({ type }) =>
      ['fighter_moved', 'trap_triggered', 'zone_removed', 'damage_number'].includes(type)
    )

    expect(visible.map(({ type }) => type)).toEqual([
      'fighter_moved',
      'trap_triggered',
      'zone_removed',
      'damage_number',
      'fighter_moved',
      'trap_triggered',
      'zone_removed',
      'damage_number',
    ])
    expect(result.state.contract.zones).toEqual([])
  })

  test('stepping off the edge of a trap area does not fire it', () => {
    const { checkpoint } = walk_scenario()
    // five consecutive open cells on one row: exit ← start(edge) ← trap center → …
    const run = (() => {
      for (let cell = 0n; cell < GRID_CELLS; cell += 1n) {
        if (cell % GRID_W > GRID_W - 5n) continue
        const candidate = [cell, cell + 1n, cell + 2n, cell + 3n, cell + 4n] as const
        if (candidate.every((c) => !mask_get(checkpoint.contract.closed, c))) return candidate
      }
      throw new Error('fixture board has no open 5-cell row run')
    })()
    const [exit, start, trap_center, , far_cell] = run
    checkpoint.contract.fighters[0]!.cell = start
    checkpoint.contract.fighters[1]!.cell = far_cell
    // a circle trap of size 1: start sits ON its edge; exit sits outside it
    checkpoint.contract.zones = [{ ...damage_trap(trap_center), shape: 1n, size: 1n }]
    const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
    fight.apply({ type: 'start', observed_ms: 60_000n })

    const result = fight.apply({ type: 'move_to', fighter: 0n, path: [exit] })

    expect(result.error).toBeNull()
    expect(result.state.contract.fighters[0]!.cell).toBe(exit)
    expect(result.events.some(({ type }) => type === 'trap_triggered')).toBeFalse()
    // the untouched trap stays armed
    expect(result.state.contract.zones).toHaveLength(1)
  })
})

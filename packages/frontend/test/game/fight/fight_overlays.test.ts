// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_character_source, create_fight, fight_path_to, reachable_fight_cells } from '@aresrpg/fight'
import { AREA_SHAPES } from '@aresrpg/fight/move_contract'
import { expect, test } from 'bun:test'

import {
  fight_visual_checkpoint,
  fight_zone_visual_checkpoint,
  project_fight_overlays,
} from '../../../src/game/fight/fight_overlays.ts'

const checkpoint = () => {
  const source = create_character_source({ classe: 'senshi', level: 1n })
  const fight = create_fight({
    mode: 'local',
    seed: 17n,
    setup: {
      board_seed: 17n,
      players: [
        { character: 'mine', owner: 'local', team: 0n, ready: true, hp: 55n, source },
        { character: 'other', owner: 'other', team: 1n, ready: true, hp: 55n, source },
      ],
      mobs: [],
    },
  })
  return fight.apply({ type: 'start', observed_ms: 1_000n }).state
}

const movement_checkpoint = () => {
  const source = create_character_source({
    classe: 'senshi',
    level: 1n,
    folded_stats: { movement: 32_769n },
  })
  const fight = create_fight({
    mode: 'local',
    seed: 17n,
    setup: {
      board_seed: 17n,
      players: [
        { character: 'mine', owner: 'local', team: 0n, ready: true, hp: 55n, source },
        {
          character: 'other',
          owner: 'other',
          team: 1n,
          ready: true,
          hp: 55n,
          source: create_character_source({ classe: 'senshi', level: 1n }),
        },
      ],
      mobs: [],
    },
  })
  return fight.apply({ type: 'start', observed_ms: 1_000n }).state
}

test('occupied targets keep the blue cast range and receive the red area preview', () => {
  const state = checkpoint()
  const target = state.contract.fighters[1]!.cell
  const overlays = project_fight_overlays({
    checkpoint: state,
    presentation_active: false,
    hovered_cell: target,
    owned_active_seat: 0n,
    selected_spell: 'snare',
    movement_cells: Object.freeze([]),
    range_seat: 0n,
    spell_cells: Object.freeze({ range: Object.freeze([target]), targetable: Object.freeze([target]) }),
    spell_hover_area: Object.freeze([target]),
    hovered_spell_targetable: true,
  })

  expect(overlays.map(({ id }) => id)).toEqual(['spell-range', 'spell-targetable', 'spell-hover'])
  expect(overlays.at(-1)?.blob.cells).toEqual([Number(target)])
})

test('a valid active-fighter path is not suppressed by unrelated fighter hover state', () => {
  const state = checkpoint()
  const movement_cells = reachable_fight_cells(state, 0n)
  const target = movement_cells.find((cell) => fight_path_to(state, 0n, cell)?.length === 3)
  if (target === undefined) throw new Error('fixture has no three-cell movement path')
  const path = fight_path_to(state, 0n, target)
  if (!path) throw new Error('fixture target lost its path')
  const overlays = project_fight_overlays({
    checkpoint: state,
    presentation_active: false,
    hovered_cell: target,
    owned_active_seat: 0n,
    selected_spell: null,
    movement_cells,
    range_seat: 0n,
    spell_cells: null,
    spell_hover_area: Object.freeze([]),
    hovered_spell_targetable: false,
  })

  expect(overlays.find(({ id }) => id === 'movement-path')?.blob.cells).toEqual(path.map(Number))
  expect(overlays.find(({ id }) => id === 'movement-range')?.blob.cells).not.toContainAnyValues(path.map(Number))
})

test('a pointer hover immediately paints the complete equipment-extended movement path', () => {
  const state = movement_checkpoint()
  const movement_cells = reachable_fight_cells(state, 0n)
  const target = movement_cells.find((cell) => fight_path_to(state, 0n, cell)?.length === 4)
  if (target === undefined) throw new Error('fixture has no four-cell movement path')
  const overlays = project_fight_overlays({
    checkpoint: state,
    presentation_active: false,
    hovered_cell: target,
    owned_active_seat: 0n,
    selected_spell: null,
    movement_cells,
    range_seat: 0n,
    spell_cells: null,
    spell_hover_area: Object.freeze([]),
    hovered_spell_targetable: false,
  })

  expect(state.contract.fighters[0]?.mp).toBe(4n)
  expect(overlays.find(({ id }) => id === 'movement-path')?.blob.cells).toHaveLength(4)
  expect(overlays.find(({ id }) => id === 'movement-range')?.blob).toMatchObject({
    animate: false,
    animate_updates: false,
  })
})

test('persistent board truth exposes owned traps and public glyphs through engine-owned presets', () => {
  const state = structuredClone(checkpoint())
  const [ally, enemy] = state.contract.fighters
  if (!ally || !enemy) throw new Error('fixture has no opposing fighters')
  state.contract.zones = [
    {
      owner_fighter: 0n,
      trap: true,
      shape: AREA_SHAPES.point,
      size: 0n,
      anchor: ally.cell + 1n,
      turns_left: 0n,
      effects: [],
    },
    {
      owner_fighter: 1n,
      trap: true,
      shape: AREA_SHAPES.point,
      size: 0n,
      anchor: enemy.cell - 1n,
      turns_left: 0n,
      effects: [],
    },
    {
      owner_fighter: 1n,
      trap: false,
      shape: AREA_SHAPES.point,
      size: 0n,
      anchor: enemy.cell,
      turns_left: 2n,
      effects: [],
    },
  ]

  const overlays = project_fight_overlays({
    checkpoint: state,
    presentation_active: true,
    hovered_cell: null,
    owned_active_seat: null,
    selected_spell: null,
    movement_cells: [],
    range_seat: null,
    spell_cells: null,
    spell_hover_area: [],
    hovered_spell_targetable: false,
    viewer_owner: 'local',
  })

  expect(overlays.find(({ id }) => id === 'zones-trap')?.blob).toMatchObject({
    cells: [Number(ally.cell + 1n)],
    decoration: 'trap',
  })
  expect(overlays.find(({ id }) => id === 'zones-glyph')?.blob.cells).toEqual([Number(enemy.cell)])
})

test('unpresented events retain the previous visual checkpoint until their cue batch settles', () => {
  const before = checkpoint()
  const after = structuredClone(before)
  after.contract.fighters[0]!.cell += 3n

  expect(fight_visual_checkpoint(before, after, true)).toBe(before)
  expect(fight_visual_checkpoint(before, after, false)).toBe(after)
})

test('a trap placement advances persistent zones when its presentation beat completes', () => {
  const before = checkpoint()
  const after = structuredClone(before)
  const owner = after.contract.fighters[0]!
  after.contract.zones.push({
    owner_fighter: 0n,
    trap: true,
    shape: AREA_SHAPES.point,
    size: 0n,
    anchor: owner.cell + 1n,
    turns_left: 0n,
    effects: [],
  })
  const cue = {
    id: '0xf1:1:1',
    type: 'zone_placed' as const,
    action: 'trap_placed' as const,
    zone_id: 'zone:0',
    owner_id: 'fight_character_0',
    cell: Number(owner.cell + 1n),
  }

  expect(fight_zone_visual_checkpoint(before, after, cue, 'start')).toBe(before)
  expect(fight_zone_visual_checkpoint(before, after, cue, 'complete')).toBe(after)
})

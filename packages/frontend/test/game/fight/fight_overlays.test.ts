// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { create_character_source, create_fight, fight_path_to, reachable_fight_cells } from '@aresrpg/fight'
import { AREA_SHAPES, EFFECT_KINDS } from '@aresrpg/fight/move_contract'
import { expect, test } from 'bun:test'

import {
  fight_visual_checkpoint,
  fight_visual_checkpoint_after_cue,
  fight_range_seat,
  fight_viewer_team,
  fight_zone_visual_state,
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

test('hovered fighters temporarily own the displayed MP range', () => {
  expect(fight_range_seat(0n, 1n)).toBe(1n)
  expect(fight_range_seat(0n, null)).toBe(0n)
  expect(fight_range_seat(null, 1n)).toBe(1n)
})

test('a local fight viewer derives its team without a selected character filter', () => {
  const state = checkpoint()

  expect(fight_viewer_team(state, 'local', null)).toBe(0n)
  expect(fight_viewer_team(state, 'local', 'mine')).toBe(0n)
  expect(fight_viewer_team(state, 'local', 'other')).toBeNull()
  expect(fight_viewer_team(state, null, null)).toBeNull()
})

test('an ordered visibility cue reveals the fighter before the following action', () => {
  const state = checkpoint()
  state.contract.fighters[0]!.effects = [
    { kind: EFFECT_KINDS.invis, element: '', value: 0n, turns_left: 0n, source: 0n, stat: 0n },
  ]
  const revealed = fight_visual_checkpoint_after_cue(
    state,
    { id: 'reveal', type: 'visibility', entity_id: 'fight_character_0', invisible: false },
    'start'
  )

  expect(revealed.contract.fighters[0]?.effects).toEqual([])
  expect(state.contract.fighters[0]?.effects).toHaveLength(1)
})

test('an ordered status cue updates the card only when that cue starts', () => {
  const state = checkpoint()
  const effect = { kind: 4n, element: 'fire', value: 3n, turns_left: 2n, source: 1n, stat: 0n }
  const cue = { id: 'status', type: 'status', entity_id: 'fight_character_0', effects: [effect] } as const

  expect(fight_visual_checkpoint_after_cue(state, cue, 'complete')).toBe(state)
  const presented = fight_visual_checkpoint_after_cue(state, cue, 'start')
  expect(presented.contract.fighters[0]?.effects).toEqual([effect])
  expect(state.contract.fighters[0]?.effects).toEqual([])
})

test('another fighter range does not mix with the active fighter path', () => {
  const state = checkpoint()
  const hovered_range = reachable_fight_cells(state, 1n, 3n)
  const [active_target] = reachable_fight_cells(state, 0n)
  if (active_target === undefined) throw new Error('fixture active fighter has no movement target')

  const overlays = project_fight_overlays({
    checkpoint: state,
    presentation_active: false,
    hovered_cell: active_target,
    owned_active_seat: 0n,
    attack_selected: false,
    movement_cells: hovered_range,
    range_seat: 1n,
    spell_cells: null,
    spell_hover_area: [],
    hovered_spell_targetable: false,
  })

  expect(overlays.find(({ id }) => id === 'movement-range')?.blob.cells).toEqual(hovered_range.map(Number))
  expect(overlays.some(({ id }) => id === 'movement-path')).toBeFalse()
})

test('occupied targets keep the blue cast range and receive the red area preview', () => {
  const state = checkpoint()
  const target = state.contract.fighters[1]!.cell
  const overlays = project_fight_overlays({
    checkpoint: state,
    presentation_active: false,
    hovered_cell: target,
    owned_active_seat: 0n,
    attack_selected: true,
    movement_cells: Object.freeze([]),
    range_seat: 0n,
    spell_cells: Object.freeze({ range: Object.freeze([target]), targetable: Object.freeze([target]) }),
    spell_hover_area: Object.freeze([target]),
    hovered_spell_targetable: true,
  })

  // team rings ride under every living fighter, before the spell paint
  expect(overlays.map(({ id }) => id)).toEqual(['team:0', 'team:1', 'spell-range', 'spell-targetable', 'spell-hover'])
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
    attack_selected: false,
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
    attack_selected: false,
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
    attack_selected: false,
    movement_cells: [],
    range_seat: null,
    spell_cells: null,
    spell_hover_area: [],
    hovered_spell_targetable: false,
    viewer_team: fight_viewer_team(state, 'local', null),
    zone_ids: ['zone:ally', 'zone:enemy', 'zone:glyph'],
  })

  expect(overlays.find(({ id }) => id === 'zone:zone:ally')?.blob).toMatchObject({
    cells: [Number(ally.cell + 1n)],
    origin_cell: Number(ally.cell + 1n),
    shape: 'single',
    decoration: 'trap',
  })
  expect(overlays.find(({ id }) => id === 'zone:zone:glyph')?.blob.cells).toEqual([Number(enemy.cell)])
  expect(overlays.find(({ id }) => id === 'zone:zone:enemy')).toBeUndefined()
})

test('the active team ring follows the turn being presented, including mobs and opponents', () => {
  const state = checkpoint()
  const overlays = project_fight_overlays({
    checkpoint: state,
    presentation_active: true,
    presented_turn_seat: 1n,
    hovered_cell: null,
    owned_active_seat: null,
    attack_selected: false,
    movement_cells: [],
    range_seat: null,
    spell_cells: null,
    spell_hover_area: [],
    hovered_spell_targetable: false,
  })

  expect(overlays.find(({ id }) => id === 'team:0')?.blob).toMatchObject({ opacity: 0.42 })
  expect(overlays.find(({ id }) => id === 'team:1')?.blob).toMatchObject({ opacity: 0.95, pulse: true })
})

test('an invisible fighter exposes no team ring cell', () => {
  const state = checkpoint()
  state.contract.fighters[1]!.effects = [
    { kind: EFFECT_KINDS.invis, element: '', value: 1n, turns_left: 2n, source: 1n, stat: 0n },
  ]
  const overlays = project_fight_overlays({
    checkpoint: state,
    presentation_active: true,
    presented_turn_seat: 1n,
    hovered_cell: null,
    owned_active_seat: null,
    attack_selected: false,
    movement_cells: [],
    range_seat: null,
    spell_cells: null,
    spell_hover_area: [],
    hovered_spell_targetable: false,
  })

  expect(overlays.find(({ id }) => id === 'team:0')).toBeDefined()
  expect(overlays.find(({ id }) => id === 'team:1')).toBeUndefined()
})

test('the visual checkpoint marks damage, movement, and death only when each cue completes', () => {
  const before = checkpoint()
  const target = before.contract.fighters[1]!
  const damage = {
    id: 'damage',
    type: 'damage',
    source_id: 'fight_character_0',
    target_id: 'fight_character_1',
    amount: Number(target.hp),
    hp_before: Number(target.hp),
    hp_after: 0,
    element: 'earth',
    cause: 'spell',
    critical: false,
  } as const
  const moved_cell = target.cell + 1n
  const movement = {
    id: 'movement',
    type: 'movement',
    entity_id: 'fight_character_1',
    cells: [Number(moved_cell)],
    mode: 'walk',
    source_id: 'fight_character_1',
    mp_spent: 1,
    gait: 'walk',
  } as const
  const death = {
    id: 'death',
    type: 'death',
    entity_id: 'fight_character_1',
    source_id: 'fight_character_0',
    cell: Number(moved_cell),
    cause: 'spell',
  } as const

  expect(fight_visual_checkpoint_after_cue(before, death, 'start')).toBe(before)
  const damaged = fight_visual_checkpoint_after_cue(before, damage, 'complete')
  const moved = fight_visual_checkpoint_after_cue(damaged, movement, 'complete')
  const dead = fight_visual_checkpoint_after_cue(moved, death, 'complete')

  expect(dead.contract.fighters[1]).toMatchObject({ hp: 0n, cell: moved_cell, dead: true })
})

test('unpresented events retain the previous visual checkpoint until their cue batch settles', () => {
  const before = checkpoint()
  const after = structuredClone(before)
  after.contract.fighters[0]!.cell += 3n

  expect(fight_visual_checkpoint(before, after, true)).toBe(before)
  expect(fight_visual_checkpoint(before, after, false)).toBe(after)
  const layer = readFileSync(new URL('../../../src/game/fight/FightLayer.tsx', import.meta.url), 'utf8')
  expect(layer).toContain('fight_visual_checkpoint(presented_checkpoint, checkpoint, presentation_queued)')
  expect(layer).toContain('fight.presentations.length > 0 || fight.awaiting_turn_witness')
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

  const before_state = Object.freeze({ checkpoint: before, zone_ids: Object.freeze([]) })
  const after_state = Object.freeze({ checkpoint: after, zone_ids: Object.freeze(['zone:0']) })
  expect(fight_zone_visual_state(before_state, after_state, cue, 'start')).toBe(before_state)
  expect(fight_zone_visual_state(before_state, after_state, cue, 'complete')?.zone_ids).toEqual(['zone:0'])
})

test('a trigger removes only its own trap zone, and never a persistent glyph', () => {
  const before = structuredClone(checkpoint())
  const owner = before.contract.fighters[0]!
  const trap = (anchor: bigint) => ({
    owner_fighter: 0n,
    trap: true,
    shape: AREA_SHAPES.point,
    size: 0n,
    anchor,
    turns_left: 0n,
    effects: [],
  })
  before.contract.zones = [trap(owner.cell + 1n), trap(owner.cell + 2n)]
  const after = structuredClone(before)
  after.contract.zones = []
  const cue = {
    id: '0xf1:1:4',
    type: 'zone' as const,
    action: 'trap_triggered' as const,
    zone_id: 'zone:first',
    owner_id: 'fight_character_0',
    target_id: 'fight_mob_1',
    cell: Number(owner.cell + 1n),
    element: 'earth',
  }

  const before_state = Object.freeze({
    checkpoint: before,
    zone_ids: Object.freeze(['zone:first', 'zone:second']),
  })
  const after_state = Object.freeze({ checkpoint: after, zone_ids: Object.freeze([]) })
  expect(fight_zone_visual_state(before_state, after_state, cue, 'start')?.zone_ids).toEqual(['zone:second'])

  // A glyph trigger keeps its persistent zone visible.
  const state = checkpoint()
  const visual = Object.freeze({ checkpoint: state, zone_ids: Object.freeze(['zone:glyph']) })
  const glyph_cue = {
    id: '0xf1:1:4',
    type: 'zone' as const,
    action: 'glyph_triggered' as const,
    zone_id: 'zone:glyph',
    owner_id: 'fight_character_0',
    target_id: 'fight_mob_1',
    cell: Number(state.contract.fighters[1]!.cell),
    element: 'earth',
  }

  expect(fight_zone_visual_state(visual, visual, glyph_cue, 'start')).toBe(visual)
})

test('an ordered zone-removal cue drops an expired or ownerless glyph when the cue starts', () => {
  const state = structuredClone(checkpoint())
  state.contract.zones = [
    {
      owner_fighter: 0n,
      trap: false,
      shape: AREA_SHAPES.point,
      size: 0n,
      anchor: state.contract.fighters[0]!.cell,
      turns_left: 1n,
      effects: [],
    },
  ]
  const visual = Object.freeze({ checkpoint: state, zone_ids: Object.freeze(['zone:glyph']) })
  const cue = { id: 'remove', type: 'zone_removed' as const, zone_id: 'zone:glyph' }

  expect(fight_zone_visual_state(visual, visual, cue, 'complete')).toBe(visual)
  expect(fight_zone_visual_state(visual, visual, cue, 'start')?.zone_ids).toEqual([])
})

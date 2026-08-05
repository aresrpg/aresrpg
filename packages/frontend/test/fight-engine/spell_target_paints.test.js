// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2165 — the light wash is informational range; the dark wash is the sim's cast-validity verdict.

import { describe, expect, test } from 'bun:test'
import { encode } from '@aresrpg/fight/los'
import { weapon_spell_template } from '@aresrpg/fight/predict_cast'

import {
  cast_range_set_dungeon,
  resolve_cell_paints,
  spell_target_paints,
} from '../../src/fight-engine/overlay_intents.js'

const cell = (x, y) => ({ x, y })
const grid = { width: 10, height: 10 }
const clear = { terrain_cells: [], occupant_cells: [] }
const as_set = (paints, key) => new Set(paints[key])

const level = (overrides = {}) => ({
  range: [1, 6],
  modifiable_range: false,
  linear: false,
  line_of_sight: true,
  free_cell: false,
  base_effects: [],
  ...overrides,
})

describe('#2165 — spell targeting paints range light blue and sim-valid cells dark blue', () => {
  test('a bow keeps its point-blank floor light while its valid ring is dark', () => {
    const [bow] = weapon_spell_template({ category: 'bow', reach: 6, ap_cost: 3, lines: [] }).levels
    const paints = spell_target_paints(bow, { cell: cell(5, 5) }, grid, clear)
    const light = as_set(paints, 'los_blocked')
    const dark = as_set(paints, 'in_range')

    expect(bow.range).toEqual([2, 6])
    expect(light.has(encode(6, 5))).toBe(true) // distance 1: shown, but below the bow's sim-owned floor
    expect(dark.has(encode(6, 5))).toBe(false)
    expect(dark.has(encode(7, 5))).toBe(true) // distance 2: the first actually castable ring
    expect(light.has(encode(7, 5))).toBe(false) // dark replaces light; the sets never stack
  })

  test('an LoS-blocked cell stays light and never becomes dark', () => {
    const blocked = encode(3, 5)
    const target = encode(5, 5)
    const paints = spell_target_paints(level(), { cell: cell(1, 5) }, grid, {
      terrain_cells: [blocked],
      occupant_cells: [],
    })

    expect(as_set(paints, 'los_blocked').has(target)).toBe(true)
    expect(as_set(paints, 'in_range').has(target)).toBe(false)
  })

  test('a valid empty cell is dark for a zone spell', () => {
    const empty = encode(7, 5)
    const zone = level({
      base_effects: [{ type: 'PLACE_GLYPH', area_type: 'CIRCLE', area_size: 2 }],
    })
    const paints = spell_target_paints(zone, { cell: cell(5, 5) }, grid, clear)

    expect(as_set(paints, 'in_range').has(empty)).toBe(true)
    expect(as_set(paints, 'los_blocked').has(empty)).toBe(false)
  })

  test('a linear spell paints diagonal reach light and orthogonal targets dark', () => {
    const paints = spell_target_paints(level({ linear: true, line_of_sight: false }), { cell: cell(5, 5) }, grid, clear)
    const diagonal = encode(6, 6)
    const orthogonal = encode(8, 5)

    expect(as_set(paints, 'los_blocked').has(diagonal)).toBe(true)
    expect(as_set(paints, 'in_range').has(diagonal)).toBe(false)
    expect(as_set(paints, 'in_range').has(orthogonal)).toBe(true)
    expect(as_set(paints, 'los_blocked').has(orthogonal)).toBe(false)
  })

  test('hover target red still replaces either blue with one resolved paint', () => {
    const target = encode(7, 5)
    const paints = spell_target_paints(level(), { cell: cell(5, 5) }, grid, clear)

    expect(resolve_cell_paints({ ...paints, target: [target] }).filter((row) => row.cell === target)).toEqual([
      { cell: target, paint: 'target' },
    ])
  })
})

describe('#2246 — dark paint and click consume one cast-legality verdict', () => {
  const caster = { cell: cell(5, 5) }
  const target = encode(6, 6)
  const clear_target = encode(5, 7)

  const agreement = ({ spell, paint_context = {}, click_flags = {}, expected }) => {
    const paints = spell_target_paints(spell, caster, grid, {
      ...clear,
      ...paint_context,
    })
    const dark = as_set(paints, 'in_range')
    const click = cast_range_set_dungeon(spell.range, caster, grid, [], {
      los: spell.line_of_sight,
      linear: spell.linear,
      free_cell: spell.free_cell,
      modifiable_range: spell.modifiable_range,
      ...click_flags,
    })

    expect(dark.has(target)).toBe(expected)
    expect(click.has(target)).toBe(expected)
    expect(click).toEqual(dark)
    expect(dark.has(clear_target)).toBe(true)
    expect(click.has(clear_target)).toBe(true)
  }

  test('own live trap: the trapped anchor is light/refused and another free cell is dark/accepted', () => {
    agreement({
      spell: level({
        line_of_sight: false,
        free_cell: true,
        base_effects: [{ type: 'PLACE_TRAP' }],
      }),
      paint_context: { trap_cells: [target] },
      click_flags: { trap_cells: [target] },
      expected: false,
    })
  })

  test('empty non-free target: the chain-legal whiff is dark and click-accepted', () => {
    agreement({
      spell: level({ base_effects: [{ type: 'DAMAGE', area_type: 'CIRCLE', area_size: 0 }] }),
      click_flags: { occupant_cells: [clear_target] },
      expected: true,
    })
  })

  test('per-target cap: the saturated cell is light/refused and another cell is dark/accepted', () => {
    const target_cap_reached = (encoded) => encoded === target
    agreement({
      spell: level({ casts_per_target: 1 }),
      paint_context: { target_cap_reached },
      click_flags: { target_cap_reached },
      expected: false,
    })
  })

  test('line-launch: a diagonal cell is light/refused and an orthogonal cell is dark/accepted', () => {
    agreement({
      spell: level({ linear: true }),
      expected: false,
    })
  })

  test('property: paint and click sets are equal over the whole board under all composed rules', () => {
    const spell = level({
      linear: true,
      free_cell: true,
      base_effects: [{ type: 'PLACE_TRAP' }],
    })
    const trap_cells = [encode(5, 7)]
    const target_cap_reached = (encoded) => encoded === encode(5, 8)
    const paints = spell_target_paints(spell, caster, grid, {
      ...clear,
      trap_cells,
      target_cap_reached,
    })
    const click = cast_range_set_dungeon(spell.range, caster, grid, [], {
      los: true,
      linear: true,
      free_cell: true,
      trap_cells,
      target_cap_reached,
    })

    expect(click).toEqual(as_set(paints, 'in_range'))
  })
})

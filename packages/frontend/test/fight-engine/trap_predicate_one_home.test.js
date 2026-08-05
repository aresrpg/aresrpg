// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1368 — one answer to "does this spell place a trap?", exported by the sim targeting home.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'
import { encode } from '@aresrpg/fight/los'
import { places_trap } from '@aresrpg/sim/spell_targeting'

import { cast_range_set_dungeon } from '../../src/fight-engine/overlay_intents.js'

const ROOT = join(import.meta.dir, '../../../..')
const source = (path) => readFileSync(join(ROOT, path), 'utf8')
const level = (effects) => ({
  range: [1, 4],
  modifiable_range: false,
  linear: false,
  line_of_sight: false,
  free_cell: true,
  effects,
})

describe('#1368 trap predicate — one home', () => {
  test('the overlay passes the real projected spell to the same predicate the sim uses', () => {
    const trap = level([{ kind: 'PLACE_TRAP' }])
    const damage = level([{ kind: 'DAMAGE' }])
    const caster = { cell: { x: 5, y: 5 } }
    const grid = { width: 10, height: 10 }
    const occupied = encode(6, 5)

    expect(places_trap(trap)).toBe(true)
    expect(places_trap(damage)).toBe(false)
    expect(cast_range_set_dungeon(trap, caster, grid, [], { trap_cells: [occupied] }).has(occupied)).toBe(false)
    expect(cast_range_set_dungeon(damage, caster, grid, [], { trap_cells: [occupied] }).has(occupied)).toBe(true)
  })

  test('the overlay has no fabricated trap payload', () => {
    const overlay = source('packages/frontend/src/fight-engine/overlay_intents.js')
    expect(overlay).not.toContain("base_effects: trap_cells == null ? [] : [{ type: 'PLACE_TRAP' }]")
  })
})

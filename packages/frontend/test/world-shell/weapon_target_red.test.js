// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2280 RED-FIRST — arming a weapon painted the blue range but never the red target cell. The blue wash
// resolves its level from the SEAT'S ESCROW weapon (`weapon_cast_level`); the hover re-derived a bare band off
// `active.weapon`, a field the projected fighter row never carries, so it fell back to the pre-read melee line
// and every reaching weapon's hovered cell came back un-castable — no footprint, no red. These tests pin the
// two halves that were disagreeing: the level itself, and the paint the hovered cell resolves to.

import { describe, expect, test } from 'bun:test'
import { encode } from '@aresrpg/fight/los'

import {
  cast_range_set_dungeon,
  resolve_cell_paints,
  spell_target_paints,
} from '../../src/fight-engine/overlay_intents.js'
import { spell_footprint, weapon_cast_level } from '../../src/world-shell/voxel_fight_folds.js'

const WEAPON_ATTACK_ID = '__weapon_attack' // the sentinel (fight/weapon.js) — literal keeps this test dep-free

// A REACHING weapon: a bow-class escrow line the chain strikes 4 cells away with. The whole point of the bug is
// that its band is NOT the melee [1,1] fallback the hover used to paint.
const bow = {
  element: 3,
  damage: 9,
  damage_max: 14,
  crit_damage: 15,
  crit_rate: 20,
  ap_cost: 4,
  reach: 4,
  category: 'bow',
  lines: [],
}

const grid = { width: 10, height: 10 }
const caster = { id: '0xme', cell: { x: 2, y: 2 } }
const target = { x: 5, y: 2 } // 3 cells away — inside the bow's reach, outside a melee ring

describe('#2280 — an armed weapon paints its target cell red', () => {
  test('the weapon level is the seat escrow weapon`s, not the pre-read melee line', () => {
    const level = weapon_cast_level(bow)
    expect(level).toBeTruthy()
    expect(level.range[1]).toBe(4)
    // the pre-read fallback stays honest, and stays SHORTER — the exact divergence the bug rode on
    expect(weapon_cast_level(null).range[1]).toBe(1)
  })

  test('the hovered target cell is castable, so the red footprint has cells to paint', () => {
    const castable = cast_range_set_dungeon(weapon_cast_level(bow), caster, grid, [], {})
    expect(castable.has(encode(target.x, target.y))).toBe(true)

    const foot = spell_footprint(WEAPON_ATTACK_ID, target, caster.cell, { ...caster, weapon: bow })
    expect(foot.length).toBeGreaterThan(0)
    expect(foot).toContainEqual(target)
  })

  test('target-red wins over range-blue on that cell (the board`s one-blob-per-cell law)', () => {
    const level = weapon_cast_level(bow)
    const blue = spell_target_paints(level, caster, grid, {})
    const red = spell_footprint(WEAPON_ATTACK_ID, target, caster.cell, { ...caster, weapon: bow }).map((c) =>
      encode(c.x, c.y)
    )
    const painted = resolve_cell_paints({ in_range: blue.in_range, los_blocked: blue.los_blocked, target: red })
    const hovered = painted.find((row) => row.cell === encode(target.x, target.y))
    expect(hovered).toEqual({ cell: encode(target.x, target.y), paint: 'target' })
  })

  test('a weaponless projected fighter is exactly what starved the red (the regression`s shape)', () => {
    // The fight-view fighter row carries the composed build but no `weapon` — resolving the level off IT
    // yields the melee line, and the hovered cell 3 away is not castable.
    const projected_fighter = { ...caster, spell_levels: {}, base_stats: {} }
    const starved = cast_range_set_dungeon(weapon_cast_level(projected_fighter.weapon), caster, grid, [], {})
    expect(starved.has(encode(target.x, target.y))).toBe(false)
  })
})

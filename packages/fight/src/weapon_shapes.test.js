// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { get_aoe_cells } from '@aresrpg/sim/spell_targeting'
import { SHAPE_CROSS, SHAPE_NO_OVERRIDE, SHAPE_POINT } from '@aresrpg/sim/spell_effect'

import { weapon_spell_template } from './predict_cast.js'
import { WEAPON_SHAPE_DEFAULT, WEAPON_SHAPES, weapon_shape_of, weapon_shape_resolved } from './weapon.js'

// §387 — the ONE-HOME shape TABLE + the preview wiring. `weapon_spell_template` stamps the category's cell-set shape
// onto the synthetic weapon spell, so the SAME `get_aoe_cells` the board paints for spell AoEs paints the weapon's
// shape. RED-FIRST: before §387 the weapon template carried no `area_shape`, so every category previewed one cell.

describe('§387 weapon shape table (weapon_shape_of)', () => {
  test('the total ruling maps every named category to its shape class', () => {
    // area_shape codes: POINT 0 · LINE 3 · TBAR 4 · PODIUM 8
    expect(weapon_shape_of('sword')).toEqual(WEAPON_SHAPE_DEFAULT) // 1-cell default
    expect(weapon_shape_of('daggers').area_shape).toBe(0) // 1-cell
    expect(weapon_shape_of('axe').area_shape).toBe(0) // 1-cell
    expect(weapon_shape_of('club').area_shape).toBe(3) // 2-inline
    expect(weapon_shape_of('longsword').area_shape).toBe(3) // 2-inline
    expect(weapon_shape_of('scythe').area_shape).toBe(4) // 3-front-arc
    expect(weapon_shape_of('staff').area_shape).toBe(4)
    expect(weapon_shape_of('spear').area_shape).toBe(4)
    expect(weapon_shape_of('battleaxe').area_shape).toBe(8) // podium-4
    expect(weapon_shape_of('mace').area_shape).toBe(8)
    expect(weapon_shape_of('hammer').area_shape).toBe(8)
  })

  test('ranged classes carry their range attributes', () => {
    expect(weapon_shape_of('bow')).toMatchObject({ area_shape: 0, range_modifiable: true, line_only: false })
    expect(weapon_shape_of('wand')).toMatchObject({ area_shape: 0, range_modifiable: false, line_only: false })
    expect(weapon_shape_of('spellbook')).toMatchObject({ area_shape: 0, range_modifiable: false, line_only: true })
  })

  test('tools / bare hands / unknown fall through to the 1-cell default (pre-§387 behaviour preserved)', () => {
    expect(weapon_shape_of(undefined)).toBe(WEAPON_SHAPE_DEFAULT)
    expect(weapon_shape_of(null)).toBe(WEAPON_SHAPE_DEFAULT)
    expect(weapon_shape_of('tool_miner')).toBe(WEAPON_SHAPE_DEFAULT)
    expect(weapon_shape_of('shovel')).toBe(WEAPON_SHAPE_DEFAULT)
    expect(weapon_shape_of('unknown_thing')).toBe(WEAPON_SHAPE_DEFAULT)
  })

  test('every table entry is a legal area_shape code (≤ PODIUM 8)', () => {
    for (const s of Object.values(WEAPON_SHAPES)) {
      expect(s.area_shape).toBeGreaterThanOrEqual(0)
      expect(s.area_shape).toBeLessThanOrEqual(8)
    }
  })
})

describe('§387 preview wiring — weapon_spell_template paints the shape through get_aoe_cells', () => {
  const caster = { x: 5, y: 5 }
  const target = { x: 6, y: 5 } // strike east
  const aoe = (weapon) => {
    const tmpl = weapon_spell_template(weapon)
    return get_aoe_cells(tmpl.levels[0].base_effects[0], target, caster)
      .map((c) => `${c.x},${c.y}`)
      .sort()
  }

  test('a sword (default) previews the single aimed cell', () => {
    expect(aoe({ category: 'sword', damage: 10, reach: 1 })).toEqual(['6,5'])
    // and the effect really carries POINT
    expect(weapon_spell_template({ category: 'sword' }).levels[0].base_effects[0].area_shape).toBe(SHAPE_POINT)
  })
  test('a spear (front-arc) previews the 3 arc cells', () => {
    expect(aoe({ category: 'spear', damage: 14, reach: 2 })).toEqual(['6,4', '6,5', '6,6'].sort())
  })
  test('a battleaxe (podium) previews the 4 podium cells', () => {
    expect(aoe({ category: 'battleaxe', damage: 22, reach: 1 })).toEqual(['6,4', '6,5', '6,6', '7,5'].sort())
  })
  test('a club (2-inline) previews the aimed cell + one beyond', () => {
    expect(aoe({ category: 'club', damage: 16, reach: 1 })).toEqual(['6,5', '7,5'].sort())
  })
  test('spellbook carries the line-only aim constraint onto the level', () => {
    expect(weapon_spell_template({ category: 'spellbook' }).levels[0].linear).toBe(true)
    expect(weapon_spell_template({ category: 'sword' }).levels[0].linear).toBe(false)
  })
})

// ── wave-D — the authored per-line SHAPE OVERRIDE (owner's 8-tier weapon-shape table; tonight the slot + a live
//    path). Twin of participant.move::weapon_shape_resolved + weapon_shape_tests.move.
describe('wave-D — weapon_shape_resolved (an authored override wins; the 255 sentinel falls through)', () => {
  test('an authored override (CROSS/2) wins over the category table', () => {
    expect(weapon_shape_resolved({ area_shape: SHAPE_CROSS, area_size: 2 }, null)).toMatchObject({
      area_shape: SHAPE_CROSS,
      area_size: 2,
      range_modifiable: false,
      line_only: false,
    })
    // range_modifiable / line_only still come from the CATEGORY even under an override (bow stays modifiable).
    expect(weapon_shape_resolved({ area_shape: SHAPE_CROSS, area_size: 2 }, 'bow')).toMatchObject({
      area_shape: SHAPE_CROSS,
      area_size: 2,
      range_modifiable: true,
    })
  })

  test('the 255 sentinel / a missing override field falls through to weapon_shape_of BYTE-IDENTICALLY', () => {
    expect(weapon_shape_resolved({ area_shape: SHAPE_NO_OVERRIDE }, 'battleaxe')).toEqual(weapon_shape_of('battleaxe'))
    expect(weapon_shape_resolved({}, 'battleaxe')).toEqual(weapon_shape_of('battleaxe'))
    expect(weapon_shape_resolved(undefined, 'spear')).toEqual(weapon_shape_of('spear'))
  })

  test('the resolved override drives the SAME 9-cell CROSS/2 set the chain resolves (shared vector; cell 105 = (5,5))', () => {
    const { area_shape, area_size } = weapon_shape_resolved({ area_shape: SHAPE_CROSS, area_size: 2 }, null)
    const cells = get_aoe_cells({ area_shape, area_size }, { x: 5, y: 5 }, { x: 0, y: 5 })
      .map((c) => c.y * 20 + c.x)
      .sort((a, b) => a - b)
    // Twin of zone_cells(SHAPE_CROSS, 2, 105, ·) in weapon_shape_tests.move — the exact same 9 cells.
    expect(cells).toEqual([65, 85, 103, 104, 105, 106, 107, 125, 145])
  })

  test('the override flows through the LIVE preview path (weapon_spell_template honors area_shape)', () => {
    const tmpl = weapon_spell_template({
      category: 'sword', // sword's category shape is POINT — the override must beat it
      area_shape: SHAPE_CROSS,
      area_size: 2,
      damage: 10,
      reach: 1,
    })
    expect(tmpl.levels[0].base_effects[0].area_shape).toBe(SHAPE_CROSS)
    expect(tmpl.levels[0].base_effects[0].area_size).toBe(2)
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { get_aoe_cells } from '@aresrpg/sim/spell_targeting'
import { SHAPE_POINT } from '@aresrpg/sim/spell_effect'

import { weapon_spell_template } from './predict_cast.js'
import {
  WEAPON_SHAPE_DEFAULT,
  WEAPON_SHAPES,
  weapon_shape_of,
} from './weapon.js'

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
  const aoe = weapon => {
    const tmpl = weapon_spell_template(weapon)
    return get_aoe_cells(tmpl.levels[0].base_effects[0], target, caster)
      .map(c => `${c.x},${c.y}`)
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

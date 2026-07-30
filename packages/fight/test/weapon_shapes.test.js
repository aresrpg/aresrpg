// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #387 — WEAPON ATTACK SHAPES per FINE category, the JS twin's half of the parity fixture.
//
// THE REPORTED DIMENSION: a weapon strike resolved ONE cell whatever the equipped weapon was — a staff swing
// and a dagger poke touched the same single cell. These tests VARY THE CATEGORY over the real preview path
// (`weapon_spell_template` → the sim's own `get_aoe_cells`, the exact seam DungeonBoard paints from), so a
// category whose zone is wider than a point FAILS while the strike is point-only. They are not "the module
// exists" tests: nothing here imports the shape table to compare it against itself — the expected cell sets
// come from `packages/sim/test/fixtures/weapon_shapes.json`, the same file the Move twin's
// `weapon_shape_tests.move` asserts, and the actual sets come out of the production template path.
import { describe, expect, test } from 'bun:test'
import { GRID_W } from '@aresrpg/sim/combat_grid'
import { get_aoe_cells } from '@aresrpg/sim/spell_targeting'

import fixture from '../../sim/test/fixtures/weapon_shapes.json' with { type: 'json' }
import { weapon_spell_template } from '../src/predict_cast.js'

const decode = (cell) => ({ x: cell % GRID_W, y: Math.floor(cell / GRID_W) })
const encode = ({ x, y }) => y * GRID_W + x
const sorted = (cells) => [...cells].sort((a, b) => a - b)

const CASTER = decode(fixture.caster)
const ANCHOR = decode(fixture.anchor)
const zone_of = (name) => fixture.zones.find((row) => row.zone === name)

/** A normalized escrow weapon of `category` — the zone is the ONLY thing under test, so the damage line is
 *  a constant fixed row for every row of the matrix. */
const weapon_of = (category, extra = {}) => ({
  category,
  element: 2,
  damage: 10,
  damage_max: 10,
  crit_damage: 15,
  crit_damage_max: 15,
  crit_rate: 0,
  ap_cost: 3,
  reach: 6,
  lines: [],
  ...extra,
})

/** The cell set the PRODUCTION preview path resolves for this weapon aiming at the fixture's anchor. */
const strike_cells = (weapon) => {
  const [effect] = weapon_spell_template(weapon).levels[0].base_effects
  return sorted(get_aoe_cells(effect, ANCHOR, CASTER).map(encode))
}

describe('#387 zone kinds — engine truth, one geometry engine', () => {
  for (const row of fixture.zones)
    test(`${row.zone} resolves ${row.cells.length} cell(s) through the spell zone engine`, () => {
      const cells = get_aoe_cells({ area_shape: row.area_shape, area_size: row.area_size }, ANCHOR, CASTER)
      expect(sorted(cells.map(encode))).toEqual(sorted(row.cells))
    })

  test('the five zone kinds are genuinely distinct cell counts', () => {
    expect(sorted(fixture.zones.map((row) => row.cells.length))).toEqual([1, 2, 3, 4, 5])
  })
})

describe('#387 weapon strike shapes — the ruled zone per FINE category', () => {
  for (const row of fixture.categories)
    test(`${row.category} strikes its ${row.zone} zone`, () => {
      expect(strike_cells(weapon_of(row.category))).toEqual(sorted(zone_of(row.zone).cells))
    })

  test('an unknown / un-authored category never resolves wider than the pre-#387 single cell', () => {
    expect(strike_cells(weapon_of('tool_miner'))).toEqual([fixture.anchor])
    expect(strike_cells(weapon_of(null))).toEqual([fixture.anchor])
    expect(strike_cells(weapon_of(undefined))).toEqual([fixture.anchor])
  })

  test('the ranged BAND rides the category — min/max and modifiability, not a zone change', () => {
    const level_of = (category) => weapon_spell_template(weapon_of(category)).levels[0]
    const bow = fixture.categories.find((row) => row.category === 'bow')
    // The band CEILING is the weapon's own reach (6 on every row of this matrix) — the category contributes the
    // floor and the flags, never a second home for a number the chain already carries.
    expect(level_of('bow').range).toEqual([bow.range_min, 6])
    expect(level_of('bow').modifiable_range).toBe(true)
    expect(level_of('wand').modifiable_range).toBe(false)
    // A melee category keeps the weapon's own reach — the band is a ranged-category fact only.
    expect(level_of('sword').range).toEqual([1, 6])
  })

  test('a spellbook strike is LINE-only; a sword strike is not', () => {
    expect(weapon_spell_template(weapon_of('spellbook')).levels[0].linear).toBe(true)
    expect(weapon_spell_template(weapon_of('sword')).levels[0].linear).toBe(false)
  })

  test('an AUTHORED per-line zone OVERRIDES the category default (the published-data door)', () => {
    // A dagger (defaulted to `single`) whose authored line carries the cross_1 zone strikes the cross.
    const cross = zone_of('cross_1')
    const authored = weapon_of('daggers', {
      lines: [
        {
          element: 2,
          damage: 10,
          damage_max: 10,
          crit_damage: 15,
          crit_damage_max: 15,
          area_shape: cross.area_shape,
          area_size: cross.area_size,
        },
      ],
    })
    expect(strike_cells(authored)).toEqual(sorted(cross.cells))
  })

  test('the crit branch strikes the SAME cells as the normal branch', () => {
    const [level] = weapon_spell_template(weapon_of('staff')).levels
    const of = ([effect]) => sorted(get_aoe_cells(effect, ANCHOR, CASTER).map(encode))
    expect(of(level.crit_effects)).toEqual(of(level.base_effects))
  })
})

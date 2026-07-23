// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { get_aoe_cells } from '../src/spell_targeting.js'
import {
  SHAPE_LINE,
  SHAPE_PODIUM,
  SHAPE_POINT,
  SHAPE_TBAR,
} from '../src/spell_effect.js'

// §387 THE WEAPON SHAPE SYSTEM — sim half of the twin. Weapon strikes resolve a CATEGORY-SHAPED CELL SET oriented
// by the attacker→target axis. The geometry IS the existing spell-AoE `get_aoe_cells`, so these assert the exact
// cell sets the chain's `combat_grid::zone_cells` twin must also produce. RED-FIRST: before §387 a weapon resolved
// one cell (POINT) always, and SHAPE_PODIUM did not exist (get_aoe_cells fell through to `[target]`).

/** cell set as a sorted "x,y" list — order-independent comparison of the touched cells. */
const cells = (shape, size, target, caster) =>
  get_aoe_cells({ area_shape: shape, area_size: size }, target, caster)
    .map(c => `${c.x},${c.y}`)
    .sort()

const set_of = (...xy) => xy.sort()

describe('§387 weapon shape cell-set derivation (sim twin)', () => {
  test('1-CELL (POINT) hits only the aimed cell', () => {
    expect(cells(SHAPE_POINT, 0, { x: 6, y: 5 }, { x: 5, y: 5 })).toEqual([
      '6,5',
    ])
  })

  describe('2-INLINE (LINE size 1) — aimed cell + the next cell along the strike direction', () => {
    test('strike EAST', () => {
      // attacker (5,5) → target (6,5): beyond = (7,5)
      expect(cells(SHAPE_LINE, 1, { x: 6, y: 5 }, { x: 5, y: 5 })).toEqual(
        set_of('6,5', '7,5'),
      )
    })
    test('strike WEST', () => {
      expect(cells(SHAPE_LINE, 1, { x: 6, y: 5 }, { x: 7, y: 5 })).toEqual(
        set_of('6,5', '5,5'),
      )
    })
    test('strike SOUTH (+y)', () => {
      expect(cells(SHAPE_LINE, 1, { x: 5, y: 6 }, { x: 5, y: 5 })).toEqual(
        set_of('5,6', '5,7'),
      )
    })
    test('strike NORTH (-y)', () => {
      expect(cells(SHAPE_LINE, 1, { x: 5, y: 6 }, { x: 5, y: 7 })).toEqual(
        set_of('5,6', '5,5'),
      )
    })
  })

  describe('3-FRONT-ARC (TBAR size 1) — aimed cell + its two PERPENDICULAR neighbours', () => {
    test('horizontal strike → vertical bar', () => {
      // attacker (5,5) → target (6,5) [east]: perpendicular = north/south of target
      expect(cells(SHAPE_TBAR, 1, { x: 6, y: 5 }, { x: 5, y: 5 })).toEqual(
        set_of('6,5', '6,4', '6,6'),
      )
    })
    test('vertical strike → horizontal bar', () => {
      // attacker (5,5) → target (5,6) [south]: perpendicular = east/west of target
      expect(cells(SHAPE_TBAR, 1, { x: 5, y: 6 }, { x: 5, y: 5 })).toEqual(
        set_of('5,6', '4,6', '6,6'),
      )
    })
  })

  describe('PODIUM-4 (PODIUM size 1) — the front arc + one cell beyond the aimed cell along the axis', () => {
    test('strike EAST', () => {
      // target (6,5): arc = (6,4),(6,6); beyond = (7,5)
      expect(cells(SHAPE_PODIUM, 1, { x: 6, y: 5 }, { x: 5, y: 5 })).toEqual(
        set_of('6,5', '6,4', '6,6', '7,5'),
      )
    })
    test('strike NORTH', () => {
      // attacker (5,7) → target (5,6): arc = (4,6),(6,6); beyond = (5,5)
      expect(cells(SHAPE_PODIUM, 1, { x: 5, y: 6 }, { x: 5, y: 7 })).toEqual(
        set_of('5,6', '4,6', '6,6', '5,5'),
      )
    })
  })

  describe('orientation edge cases', () => {
    test('diagonal target — the dominant axis wins ties (x), matching push/displacement', () => {
      // attacker (5,5) → target (6,6): |dx|==|dy| ⇒ x-axis strike (east) ⇒ vertical arc
      expect(cells(SHAPE_TBAR, 1, { x: 6, y: 6 }, { x: 5, y: 5 })).toEqual(
        set_of('6,6', '6,5', '6,7'),
      )
    })
    test('board EDGE drops the off-grid cells of the shape', () => {
      // target on the top row (y=0), strike north: the "beyond"/arc cells above the board fall away
      // attacker (3,1) → target (3,0) [north]: podium arc = (2,0),(4,0); beyond = (3,-1) OFF-GRID (dropped)
      expect(cells(SHAPE_PODIUM, 1, { x: 3, y: 0 }, { x: 3, y: 1 })).toEqual(
        set_of('3,0', '2,0', '4,0'),
      )
    })
  })
})

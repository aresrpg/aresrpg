// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { encode, in_zone } from '../src/combat_grid.js'
import {
  shape_point,
  shape_circle,
  shape_cross,
  shape_ring,
} from '../src/spell_effect.js'

// PARITY FIXTURES — the in_zone containment asserts copied VERBATIM from combat_grid.move's zone-geometry tests
// (t_zone_cross_is_arms_only / t_zone_ring_is_perimeter_only / t_zone_point_and_circle). Only the in_zone surface
// is mirrored here (zone_cells for line/tbar/cone is out of scope for the S-16 board + effect-board mirrors).

describe('combat grid in_zone — parity with combat_grid.move', () => {
  const a = encode(5, 5)

  test('t_zone_point_and_circle: point is the anchor; circle r1 includes orthogonal neighbours', () => {
    expect(in_zone(shape_point(), 0, a, a)).toBe(true)
    expect(in_zone(shape_point(), 0, a, encode(0, 0))).toBe(false)
    // circle radius 1 = anchor + 4 orthogonal neighbours (all interior → in grid)
    const circle1 = [a, encode(4, 5), encode(6, 5), encode(5, 4), encode(5, 6)]
    for (const c of circle1) expect(in_zone(shape_circle(), 1, a, c)).toBe(true)
    expect(in_zone(shape_circle(), 1, a, encode(6, 6))).toBe(false) // diagonal is manhattan 2 → outside r1
  })

  test('t_zone_cross_is_arms_only: cross excludes diagonals, circle includes them', () => {
    // a diagonal cell (6,6) is NOT in a cross but IS in a circle
    expect(in_zone(shape_cross(), 2, a, encode(6, 6))).toBe(false)
    expect(in_zone(shape_circle(), 2, a, encode(6, 6))).toBe(true)
    expect(in_zone(shape_cross(), 2, a, encode(7, 5))).toBe(true) // straight arm cell
  })

  test('t_zone_ring_is_perimeter_only', () => {
    expect(in_zone(shape_ring(), 2, a, encode(7, 5))).toBe(true) // manhattan 2 → on the ring
    expect(in_zone(shape_ring(), 2, a, encode(6, 5))).toBe(false) // manhattan 1 → inside, not on ring
    expect(in_zone(shape_ring(), 2, a, a)).toBe(false) // centre not on ring
  })
})

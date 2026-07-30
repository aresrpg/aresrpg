// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { revive_arena } from '../src/timeline.js'

const even_width_arena = {
  width: 10,
  height: 8,
  cells: Array.from({ length: 80 }, () => 0),
  spawns_a: [{ x: 2, y: 4 }],
  spawns_b: [{ x: 7, y: 4 }],
}

describe('timeline capsule arena revival', () => {
  test('an even-width board revives with integer-exact geometry (#756)', () => {
    const capsule_arena = JSON.parse(JSON.stringify(even_width_arena))
    const revived = revive_arena(capsule_arena)

    expect(revived.radius).toBe(5)
    expect(revived.center).toEqual({ x: 5, y: 4 })
    expect(Number.isInteger(revived.radius)).toBe(true)
    expect(Number.isInteger(revived.center.x)).toBe(true)
    expect(Number.isInteger(revived.center.y)).toBe(true)
    expect(Array.from(revived.cells)).toEqual(capsule_arena.cells)
  })
})

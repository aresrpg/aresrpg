// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { read_spawn_column_gate } from './spawn_column_gate.js'

const open_column = (surface_y) => (_x, y) => (y <= surface_y ? 3 : 0)

describe('world-join spawn-column gate', () => {
  test('resident low ground unlocks despite air at the provisional seed voxel', () => {
    const sample_block = open_column(124)
    expect(sample_block(0, 137, 0)).toBe(0) // the old exact-y gate wedged here forever
    expect(
      read_spawn_column_gate({
        spawn: [0.5, 138, 0.5],
        is_column_resident: () => true,
        sample_block,
      })
    ).toEqual({ ready: true, ground_y: 124 })
  })

  test('analytic-looking ground cannot unlock before the real column is resident', () => {
    expect(
      read_spawn_column_gate({
        spawn: [0.5, 138, 0.5],
        is_column_resident: () => false,
        sample_block: open_column(137),
      })
    ).toEqual({ ready: false, ground_y: null })
  })

  test('a warm resident boot resolves the same standing height', () => {
    expect(
      read_spawn_column_gate({
        spawn: [3.5, 138, 4.5],
        is_column_resident: () => true,
        sample_block: open_column(137),
      })
    ).toEqual({ ready: true, ground_y: 137 })
  })
})

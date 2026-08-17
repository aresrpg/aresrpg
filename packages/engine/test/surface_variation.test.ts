// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { material_tint_tables } from '../src/terrain_tint_data.ts'
import { compile_materials } from '../src/world_materials.ts'

describe('macro ground tint (legacy NG-TINT port)', () => {
  test('material classes come from structural recipe roles, never authored names', () => {
    const first = compile_materials(
      {
        stone: { color: '#787878', preset: 'stone' },
        grass: { color: '#5c8c3c', preset: 'grass' },
        water: { color: '#2e609e', preset: 'water' },
      },
      [
        { name: 'stone', role: 'filler' },
        { name: 'grass', role: 'surface', paired_material: 'stone' },
        { name: 'water', role: 'liquid' },
      ]
    )
    const renamed = compile_materials(
      {
        foundation: { color: '#787878', preset: 'stone' },
        meadow: { color: '#5c8c3c', preset: 'grass' },
        sea: { color: '#2e609e', preset: 'water' },
      },
      [
        { name: 'foundation', role: 'filler' },
        { name: 'meadow', role: 'surface', paired_material: 'foundation' },
        { name: 'sea', role: 'liquid' },
      ]
    )

    expect(material_tint_tables(first).classes).toEqual(material_tint_tables(renamed).classes)
    expect(material_tint_tables(first).classes).toEqual([0, 1, 3, 0])
  })
})

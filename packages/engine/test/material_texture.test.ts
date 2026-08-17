// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { MATERIAL_TEXTURE_VARIANTS } from '../src/material_presets.ts'
import { create_material_texture_data } from '../src/material_texture.ts'
import { compile_materials } from '../src/world_materials.ts'

describe('procedural material texture', () => {
  test('bakes compact deterministic variants from the authored color and preset', () => {
    const materials = compile_materials({ ground: { color: '#718348', preset: 'grass' } })
    const first = create_material_texture_data(materials, 8)
    const second = create_material_texture_data(materials, 8)
    const material_bytes = first.slice(8 * 8 * 4 * MATERIAL_TEXTURE_VARIANTS)

    expect(first).toEqual(second)
    expect(first).toHaveLength(2 * MATERIAL_TEXTURE_VARIANTS * 8 * 8 * 4)
    expect(new Set(material_bytes).size).toBeGreaterThan(8)
  })
})

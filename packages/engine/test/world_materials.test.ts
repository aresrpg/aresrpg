// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { compile_materials, validate_materials } from '../src/world_materials.ts'

describe('world materials', () => {
  test('compiles arbitrary names without assigning engine semantics', () => {
    const materials = compile_materials({ basalt: '#102030', amber: '#ffbf00' })

    expect(materials.id_for('basalt')).toBe(1)
    expect(materials.colors[0]).toEqual([0, 0, 0])
    expect(materials.colors[1]?.[0]).toBeCloseTo(0.0051815)
    expect(materials.colors[1]?.[1]).toBeCloseTo(0.0144438)
    expect(materials.colors[1]?.[2]).toBeCloseTo(0.0295568)
    expect(materials.colors[2]?.[0]).toBe(1)
    expect(materials.colors[2]?.[1]).toBeCloseTo(0.5209956)
    expect(materials.colors[2]?.[2]).toBe(0)
    expect(materials.id_for('amber')).toBe(2)
  })

  test('keeps exactly one palette entry per authored color', () => {
    const materials = compile_materials({ moss: '#5c8c3c' })

    expect(materials.colors).toHaveLength(2)
    expect(materials.id_for('moss')).toBe(1)
    expect(() => materials.id_for('missing')).toThrow('unknown world material "missing"')
  })

  test('rejects wrappers and malformed colors at the recipe boundary', () => {
    expect(
      validate_materials({
        mist: '#abc',
        empty: {},
        moss: {
          color: {
            cold_dry: '#000000',
            cold_wet: '#0000ff',
            hot_dry: '#ff0000',
            hot_wet: '#ffffff',
          },
        },
      })
    ).toEqual(['materials.mist must be #rrggbb', 'materials.empty must be #rrggbb', 'materials.moss must be #rrggbb'])
  })
})

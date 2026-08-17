// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { compile_materials, validate_materials } from '../src/world_materials.ts'

describe('world materials', () => {
  test('compiles arbitrary names without assigning engine semantics', () => {
    const materials = compile_materials({
      basalt: { color: '#102030', preset: 'stone' },
      amber: { color: '#ffbf00', preset: 'sand' },
    })

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
    const materials = compile_materials({ moss: { color: '#5c8c3c', preset: 'grass' } })

    expect(materials.colors).toHaveLength(2)
    expect(materials.id_for('moss')).toBe(1)
    expect(() => materials.id_for('missing')).toThrow('unknown world material "missing"')
  })

  test('requires one base color and one engine-owned appearance preset', () => {
    expect(
      validate_materials({
        mist: { color: '#abc', preset: 'water' },
        empty: {},
        moss: { color: '#5c8c3c', preset: 'velvet' },
        legacy: '#ffffff',
      })
    ).toEqual([
      'materials.mist.color must be #rrggbb',
      'materials.empty.color must be #rrggbb',
      'materials.empty.preset must be one of stone, earth, grass, sand, snow, ice, water',
      'materials.moss.preset must be one of stone, earth, grass, sand, snow, ice, water',
      'materials.legacy must contain color and preset',
    ])
  })

  test('refuses recipes that cannot fit the guaranteed WebGPU texture-array floor', () => {
    const materials = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`material_${index}`, { color: '#808080', preset: 'stone' as const }])
    )

    expect(() => compile_materials(materials)).toThrow('compiled world materials exceed 63 appearance uses')
  })
})

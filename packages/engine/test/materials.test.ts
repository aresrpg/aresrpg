// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { liquid_palette } from '../src/liquid_palette.ts'
import { MATERIAL_PRESET_DEFINITIONS, MATERIAL_PRESETS, material_pattern } from '../src/material_presets.ts'
import { create_material_texture_data } from '../src/material_texture.ts'
import { material_tint_tables } from '../src/terrain_tint_data.ts'
import { compile_materials, material_color, validate_materials } from '../src/world_materials.ts'

const pattern_field = (preset: keyof typeof MATERIAL_PRESET_DEFINITIONS, size: number) =>
  Array.from({ length: size * size }, (_, index) =>
    material_pattern(preset, index % size, Math.floor(index / size), size)
  )

const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length

describe('material appearance', () => {
  test('material detail is deterministic, preset-distinct, and directional where the surface is', () => {
    const samples = (preset: keyof typeof MATERIAL_PRESET_DEFINITIONS) => pattern_field(preset, 8)

    expect(samples('grass')).toEqual(samples('grass'))
    expect(samples('grass')).not.toEqual(samples('stone'))
    expect(samples('wood')).not.toEqual(samples('foliage'))
    expect(samples('snow')).not.toEqual(samples('sand'))
    expect(samples('ice')).not.toEqual(samples('water'))
    expect(Math.max(...samples('sand')) - Math.min(...samples('sand'))).toBeLessThan(
      Math.max(...samples('grass')) - Math.min(...samples('grass'))
    )

    // Stone reads as broad plates and fissures; grass reads as directional tufts.
    const size = 32
    const edge_energy = (values: readonly number[], axis: 'horizontal' | 'vertical') => {
      const differences = values.flatMap((value, index) => {
        const x = index % size
        const y = Math.floor(index / size)
        const neighbour = axis === 'horizontal' ? (x + 1 < size ? index + 1 : null) : y + 1 < size ? index + size : null
        return neighbour === null ? [] : [Math.abs(value - values[neighbour]!)]
      })
      return average(differences)
    }
    const stone = pattern_field('stone', size)
    const grass = pattern_field('grass', size)
    const stone_horizontal = edge_energy(stone, 'horizontal')
    const grass_horizontal = edge_energy(grass, 'horizontal')
    const grass_vertical = edge_energy(grass, 'vertical')

    expect(stone.filter((value) => value < -0.16).length).toBeGreaterThan(8)
    expect(grass_horizontal).toBeGreaterThan(stone_horizontal * 1.1)
    expect(grass_horizontal).toBeGreaterThan(grass_vertical * 1.5)
  })

  test('every preset wraps without a dark frame or an exceptional seam, and bakes a physically bounded layer', () => {
    const size = 32
    Object.keys(MATERIAL_PRESET_DEFINITIONS).forEach((preset) => {
      const samples = pattern_field(preset as keyof typeof MATERIAL_PRESET_DEFINITIONS, size)
      const edges = samples.filter((_, index) => {
        const x = index % size
        const y = Math.floor(index / size)
        return x === 0 || y === 0 || x === size - 1 || y === size - 1
      })
      const center = samples.filter((_, index) => {
        const x = index % size
        const y = Math.floor(index / size)
        return x > 1 && y > 1 && x < size - 2 && y < size - 2
      })
      const seam = Array.from({ length: size }, (_, index) => [
        Math.abs(samples[index * size]! - samples[index * size + size - 1]!),
        Math.abs(samples[index]! - samples[(size - 1) * size + index]!),
      ]).flat()
      const internal = samples.flatMap((value, index) => {
        const x = index % size
        const y = Math.floor(index / size)
        return [
          ...(x + 1 < size ? [Math.abs(value - samples[index + 1]!)] : []),
          ...(y + 1 < size ? [Math.abs(value - samples[index + size]!)] : []),
        ]
      })

      expect(Math.abs(average(edges) - average(center))).toBeLessThan(0.025)
      const sorted_internal = [...internal].sort((left, right) => left - right)
      const internal_p95 = sorted_internal[Math.floor(sorted_internal.length * 0.95)]!
      expect(average(seam)).toBeLessThan(internal_p95 * 1.25 + 0.002)
    })

    // Every dielectric response stays in a physically useful range — as authored…
    Object.values(MATERIAL_PRESET_DEFINITIONS).forEach(({ roughness }) => {
      expect(roughness).toBeGreaterThanOrEqual(0.1)
      expect(roughness).toBeLessThanOrEqual(0.95)
    })

    // …and in the compact deterministic layer baked per authored material.
    const materials = compile_materials({ ground: { color: '#718348', preset: 'grass' } })
    const first = create_material_texture_data(materials, 8)
    const second = create_material_texture_data(materials, 8)
    const material_bytes = first.slice(8 * 8 * 4)
    const roughness = material_bytes.filter((_, index) => index % 4 === 3)

    expect(first).toEqual(second)
    expect(first).toHaveLength(2 * 8 * 8 * 4)
    expect(new Set(material_bytes).size).toBeGreaterThan(8)
    expect(new Set(roughness).size).toBeGreaterThan(4)
    expect(Math.min(...roughness)).toBeGreaterThan(64)
    expect(Math.max(...roughness)).toBeLessThan(192)
  })
})

describe('world materials', () => {
  test('compiles arbitrary names into exactly one palette entry each, without engine semantics', () => {
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

    const single = compile_materials({ moss: { color: '#5c8c3c', preset: 'grass' } })

    expect(single.colors).toHaveLength(2)
    expect(single.id_for('moss')).toBe(1)
    expect(() => single.id_for('missing')).toThrow('unknown world material "missing"')
  })

  test('refuses recipes that are malformed or cannot fit the guaranteed WebGPU texture-array floor', () => {
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
      `materials.empty.preset must be one of ${MATERIAL_PRESETS.join(', ')}`,
      `materials.moss.preset must be one of ${MATERIAL_PRESETS.join(', ')}`,
      'materials.legacy must contain color and preset',
    ])

    const oversized = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`material_${index}`, { color: '#808080', preset: 'stone' as const }])
    )

    expect(() => compile_materials(oversized)).toThrow('compiled world materials exceed 63 appearance uses')
  })

  test('one authored liquid color drives surface and underwater appearance', () => {
    const blue = liquid_palette(material_color('#2e609e'))
    const red = liquid_palette(material_color('#9e2e2e'))

    expect(blue.body).not.toEqual(red.body)
    expect(blue.shallow).not.toEqual(red.shallow)
    expect(blue.up).not.toEqual(red.up)
    expect(blue.down).not.toEqual(red.down)
    expect(blue.body[2]).toBeGreaterThan(blue.body[0])
    expect(red.body[0]).toBeGreaterThan(red.body[2])
  })

  test('material tint classes come from structural recipe roles, never authored names', () => {
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

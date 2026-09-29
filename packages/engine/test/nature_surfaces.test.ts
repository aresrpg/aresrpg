// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { mulberry } from '../src/nature/sprite_kit.ts'
import { ore_vein } from '../src/nature/ore_vein.ts'
import { herb_fern } from '../src/nature/herb_fern.ts'
import { herb_tall_grass } from '../src/nature/herb_tall_grass.ts'
import { herb_bush } from '../src/nature/herb_bush.ts'
import { flower_bloom } from '../src/nature/flower_bloom.ts'
import { nature_surface, nature_uv } from '../src/nature/surface_texture.ts'

test('botanical and mineral variants remain deterministic, opaque geometry with bounded triangle budgets', () => {
  for (const builder of [ore_vein, herb_fern, herb_tall_grass, herb_bush, flower_bloom]) {
    const vertices = builder(mulberry(42))
    expect(vertices).toEqual(builder(mulberry(42)))
    expect(vertices.length / 3).toBeLessThanOrEqual(96)
    expect(vertices.every((v) => v.length === 7 && v.every(Number.isFinite))).toBe(true)
    expect(vertices.every((v) => v[5]! >= 0 && v[5]! <= 1 && v[6]! >= 0 && v[6]! <= 1)).toBe(true)
  }
  const crystals = ore_vein(mulberry(42))
  expect(crystals.every((v) => v[4] === 0)).toBe(true)
  expect(new Set(crystals.map((v) => v[0])).size).toBeGreaterThan(30)
})
test('neutral textures contain fine surface variation and UVs stay inside their padded atlas tile', () => {
  for (const kind of ['plant', 'mineral', 'mushroom'] as const) {
    const samples = Array.from({ length: 64 }, (_, i) => nature_surface(kind, i / 64, 0.65))
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.08)
    const lo = nature_uv(kind, [0, 0, 0, 0, 0, 0, 0]),
      hi = nature_uv(kind, [0, 0, 0, 0, 0, 1, 1])
    expect(Math.floor(lo[1] * 4)).toBe(Math.floor(hi[1] * 4))
  }
  expect(nature_surface('plain', 0.3, 0.7)).toBe(1)
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  BIOME_SLOTS,
  compile_world_recipe,
  far_shell_y,
  sample_world_column,
  type WorldRecipe,
} from '../src/world_recipe.ts'

const world = compile_world_recipe({
  seed: 'far-parity',
  sea_level: 10,
  materials: {
    rock: { color: '#787878', preset: 'stone' },
    soil: { color: '#6e4f38', preset: 'earth' },
    meadow: { color: '#5c8c3c', preset: 'grass' },
  },
  biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'ground'])) as WorldRecipe['biome_slots'],
  biomes: [
    {
      name: 'ground',
      landscape: [
        { x: 0, y: 0, land: { surface: 'meadow', subsurface: 'soil', filler: 'rock' } },
        { x: 0.5, y: 12 },
        { x: 1, y: 24 },
      ],
    },
  ],
})

describe('far terrain parity', () => {
  test('the overlapping shell stays half a block below the exact voxel surface', () => {
    for (let z = -256; z <= 256; z += 8) {
      for (let x = -256; x <= 256; x += 8) {
        const surface = sample_world_column(world, x, z).surface_y
        expect(far_shell_y(world, x, z)).toBe(surface - 0.5)
      }
    }
  })
})

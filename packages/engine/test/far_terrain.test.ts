// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { compile_world_recipe, far_shell_y, sample_world_column, type WorldRecipe } from '../src/world_recipe.ts'

const world = compile_world_recipe({
  seed: 'far-parity',
  sea_level: 10,
  vertical_chunks: [0],
  materials: {
    rock: '#787878',
    soil: '#6e4f38',
    meadow: '#5c8c3c',
  },
  noise: Object.fromEntries(
    ['temperature', 'humidity', 'continentalness', 'erosion', 'weirdness'].map((name) => [
      name,
      { period: 256, octaves: 2 },
    ])
  ) as WorldRecipe['noise'],
  splines: {
    continentalness_to_base: [
      [0, 0],
      [0.5, 12],
      [1, 24],
    ],
    erosion_to_amplitude: [
      [0, 10],
      [1, 1],
    ],
    pv_to_relief: [
      [0, -0.2],
      [1, 1],
    ],
  },
  biome_selection: {
    axis_weights: { temperature: 1, humidity: 1, continentalness: 0.6, erosion: 0.5, pv: 0.4 },
    blend_k: 1,
    transition_softness: 0.6,
  },
  biomes: [
    {
      name: 'ground',
      climate: { temperature: 0.5, humidity: 0.5, continentalness: 0.5, erosion: 0.5, pv: 0.5 },
      weight: 1,
      land: { surface: 'meadow', subsurface: 'soil', filler: 'rock' },
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

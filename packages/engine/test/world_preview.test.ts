// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { far_cell_visible, preview_pan_delta, preview_sample_plan } from '../src/world_preview.ts'
import { BIOME_SLOTS, compile_world_recipe, sample_world_column, type WorldRecipe } from '../src/world_recipe.ts'

const recipe = {
  seed: 'preview-world',
  sea_level: 16,
  materials: {
    rock: { color: '#5f6468', preset: 'stone' },
    soil: { color: '#624831', preset: 'earth' },
    grass: { color: '#668047', preset: 'grass' },
    water: { color: '#2e609e', preset: 'water' },
  },
  liquid: 'water',
  biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'meadow'])) as WorldRecipe['biome_slots'],
  biomes: [
    {
      name: 'meadow',
      landscape: [
        { x: 0, y: 4, land: { surface: 'grass', subsurface: 'soil', filler: 'rock' } },
        { x: 1, y: 28 },
      ],
    },
  ],
} as const satisfies WorldRecipe

test('the editor preview samples exact near blocks and a coarse far extent from one compiled world', () => {
  const plan = preview_sample_plan(recipe, {
    focus_x: 13,
    focus_z: -7,
    near_radius: 2,
    far_radius: 8,
    far_step: 4,
  })
  const exact = sample_world_column(compile_world_recipe(recipe), 13, -7)
  const center = plan.near.at(12)
  if (!center) throw new Error('preview center missing')

  expect(plan.near).toHaveLength(25)
  expect(plan.far).toHaveLength(25)
  expect(center).toMatchObject({ local_x: 0, local_z: 0, surface_y: exact.surface_y })
  expect(center.colors).toEqual({ surface: '#668047', subsurface: '#624831', filler: '#5f6468' })
  expect(plan.far[0]).toMatchObject({ local_x: -8, local_z: -8 })
  expect(plan.far.at(-1)).toMatchObject({ local_x: 8, local_z: 8 })
  expect(plan.liquid_color).toBe('#2e609e')
})

test('the editor preview default exposes a substantial exact block field', () => {
  const plan = preview_sample_plan(recipe, { focus_x: 0, focus_z: 0 })

  expect(plan.near_side).toBe(385)
  expect(plan.options.far_radius).toBe(2048)
})

test('the editor preview accepts an operator-selected exact voxel radius', () => {
  const plan = preview_sample_plan(recipe, { focus_x: 0, focus_z: 0, near_radius: 320 })

  expect(plan.near_side).toBe(641)
  expect(plan.near).toHaveLength(641 * 641)
})

test('the coarse far shell leaves the exact voxel field uncovered', () => {
  expect(far_cell_visible(384, 0, 0, 32)).toBeFalse()
  expect(far_cell_visible(384, 352, 0, 32)).toBeFalse()
  expect(far_cell_visible(384, 384, 0, 32)).toBeTrue()
  expect(far_cell_visible(384, -416, 0, 32)).toBeTrue()
})

test('right-drag pans in camera space at the current zoom', () => {
  expect(preview_pan_delta(0, 500, 1000, 100, 0)).toEqual([-44.5229, 0])
  expect(preview_pan_delta(0, 500, 1000, 0, 100)).toEqual([0, -44.5229])
  expect(preview_pan_delta(Math.PI / 2, 500, 1000, 100, 0)).toEqual([0, 44.5229])
})

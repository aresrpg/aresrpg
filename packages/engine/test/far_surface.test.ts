// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { sample_far_height, FAR_SURFACE_OFFSET } from '../src/far_surface.ts'
import { get_quality_profile, QUALITY_OPTIONS } from '../src/quality.ts'
import { compile_runtime_world_recipe, parse_world_recipe, sample_world_column } from '../src/world_recipe.ts'
import { world_terrain } from '../src/world_catalog.ts'

test('far surface sampling matches horizon vertices and both triangle interiors', () => {
  const world = compile_runtime_world_recipe(world_terrain('nauvis'), { structures: false })
  for (const quality of QUALITY_OPTIONS) {
    const { horizon_step: step, horizon_radius: radius } = get_quality_profile(quality).chunks
    const x = -radius + step * 100,
      z = -radius + step * 101
    const y = (dx: number, dz: number) =>
      sample_world_column(world, x + dx * step, z + dz * step).surface_y - FAR_SURFACE_OFFSET
    expect(sample_far_height(world, quality, x, z)).toBe(y(0, 0))
    expect(sample_far_height(world, quality, x + step * 0.25, z + step * 0.25)).toBeCloseTo(
      y(0, 0) * 0.5 + y(1, 0) * 0.25 + y(0, 1) * 0.25,
      10
    )
    expect(sample_far_height(world, quality, x + step * 0.75, z + step * 0.75)).toBeCloseTo(
      y(1, 1) * 0.5 + y(1, 0) * 0.25 + y(0, 1) * 0.25,
      10
    )
  }
})

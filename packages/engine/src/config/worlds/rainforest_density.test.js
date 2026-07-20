// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_gen_context, anchor_surface } from '../../gen/column_gen.js'
import { resolve_placement_at } from '../../gen/surface_decorator.js'
import { SPECIES } from '../../gen/trees/species.js'

import { RAINFOREST_WORLD } from './rainforest.js'

const patch_x = 128
const patch_z = 128
const patch_width = 256
const patch_depth = 256
const trunk_halo = Math.max(...Object.values(SPECIES).map((species) => species.trunk_r ?? 0))
const forest_biome_ids = new Set(
  RAINFOREST_WORLD.biomes
    .filter((biome) => biome.name === 'tropical' || biome.name === 'cloud_forest')
    .map((biome) => biome.id)
)

function path_crosses(blocked, axis) {
  const visited = new Uint8Array(blocked.length)
  const queue = new Int32Array(blocked.length)
  let head = 0
  let tail = 0
  const seeds = axis === 'west_east' ? patch_depth : patch_width
  for (let offset = 0; offset < seeds; offset += 1) {
    const index = axis === 'west_east' ? offset * patch_width : offset
    if (blocked[index]) continue
    visited[index] = 1
    queue[tail++] = index
  }

  while (head < tail) {
    const index = queue[head++]
    const x = index % patch_width
    const z = Math.floor(index / patch_width)
    if ((axis === 'west_east' && x === patch_width - 1) || (axis === 'north_south' && z === patch_depth - 1))
      return true
    for (const neighbour of [index - 1, index + 1, index - patch_width, index + patch_width]) {
      if (neighbour < 0 || neighbour >= blocked.length || visited[neighbour] || blocked[neighbour]) continue
      const neighbour_x = neighbour % patch_width
      if (Math.abs(neighbour_x - x) > 1) continue
      visited[neighbour] = 1
      queue[tail++] = neighbour
    }
  }
  return false
}

function measure_verdant_walkability() {
  const ctx = create_gen_context(RAINFOREST_WORLD)
  const seed = ctx.seeds.decorators
  const blocked = new Uint8Array(patch_width * patch_depth)
  let forest_columns = 0
  let forest_tree_anchors = 0

  for (let world_x = patch_x - trunk_halo; world_x < patch_x + patch_width + trunk_halo; world_x += 1)
    for (let world_z = patch_z - trunk_halo; world_z < patch_z + patch_depth + trunk_halo; world_z += 1) {
      const placement = resolve_placement_at(ctx, world_x, world_z, seed)
      const tree_name = placement?.schematic?.name
      const is_tree = tree_name?.includes(':') === true
      const inside =
        world_x >= patch_x && world_x < patch_x + patch_width && world_z >= patch_z && world_z < patch_z + patch_depth
      if (inside && forest_biome_ids.has(anchor_surface(ctx, world_x, world_z).biome_id)) {
        forest_columns += 1
        if (is_tree) forest_tree_anchors += 1
      }
      if (!is_tree) continue

      const species = SPECIES[tree_name.split(':')[0]]
      const trunk_radius = species?.trunk_r ?? 2
      for (let dx = -trunk_radius; dx <= trunk_radius; dx += 1)
        for (let dz = -trunk_radius; dz <= trunk_radius; dz += 1) {
          if (dx * dx + dz * dz > trunk_radius * trunk_radius) continue
          const x = world_x + dx - patch_x
          const z = world_z + dz - patch_z
          if (x >= 0 && x < patch_width && z >= 0 && z < patch_depth) blocked[z * patch_width + x] = 1
        }
    }

  let blocked_columns = 0
  for (const value of blocked) blocked_columns += value
  return {
    forest_columns,
    forest_tree_anchors,
    forest_tree_anchor_fraction: forest_tree_anchors / forest_columns,
    blocked_fraction: blocked_columns / blocked.length,
    west_east_path: path_crosses(blocked, 'west_east'),
    north_south_path: path_crosses(blocked, 'north_south'),
  }
}

let measured
const metrics = () => (measured ??= measure_verdant_walkability())

test('Verdant Hollow forest anchor density stays at or below the established 8% walkability cap', () => {
  expect(metrics().forest_tree_anchors).toBeGreaterThan(0)
  expect(metrics().forest_tree_anchor_fraction).toBeLessThanOrEqual(0.08)
})

test('Verdant Hollow tree trunks occupy less than 40% of a representative generated patch', () => {
  expect(metrics().blocked_fraction).toBeLessThan(0.4)
})

test('Verdant Hollow keeps four-neighbour walking routes across both axes of the generated patch', () => {
  expect({ west_east: metrics().west_east_path, north_south: metrics().north_south_path }).toEqual({
    west_east: true,
    north_south: true,
  })
})

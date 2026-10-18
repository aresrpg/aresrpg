// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { nature_uv, type NatureSurface } from './nature/surface.ts'
import { flower_bloom } from './nature/flower_bloom.ts'
import { thebes_dry_reed } from './cities/thebes/nature/dry_reed.ts'
import { thebes_field_crop } from './cities/thebes/nature/field_crop.ts'
import { ruins_cobweb } from './cities/the_ruins/nature/cobweb.ts'
import { herb_bush } from './nature/herb_bush.ts'
import { herb_fern } from './nature/herb_fern.ts'
import { herb_sedge } from './nature/herb_sedge.ts'
import { herb_tall_grass } from './nature/herb_tall_grass.ts'
import { ice_spike } from './nature/ice_spike.ts'
import { mushroom_toadstool } from './nature/mushroom_toadstool.ts'
import { rock_pebbles } from './nature/rock_pebbles.ts'
import { twig_branch } from './nature/twig_branch.ts'
import { mulberry, rotate_y, type RecipeVertex, type SpriteBuilder } from './nature/sprite_kit.ts'
import { RECIPE_VARIANTS, type ScatterInstance, type ScatterKind } from './scatter.ts'
import type { Vec3 } from './types.ts'

export type ScatterMeshData = Readonly<{
  attributes: Readonly<Record<string, Readonly<{ values: Float32Array<ArrayBuffer>; size: number }>>>
  bounds: Readonly<{ center: Vec3; radius: number }>
}>

const scatter_bounds = (positions: Float32Array): ScatterMeshData['bounds'] => {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < positions.length; index += 1) {
    const axis = index % 3
    min[axis] = Math.min(min[axis]!, positions[index]!)
    max[axis] = Math.max(max[axis]!, positions[index]!)
  }
  const center: Vec3 = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2]
  let squared_radius = 0
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]! - center[0],
      y = positions[index + 1]! - center[1],
      z = positions[index + 2]! - center[2]
    squared_radius = Math.max(squared_radius, x * x + y * y + z * z)
  }
  return { center, radius: Math.sqrt(squared_radius) + CULL_MARGIN }
}

/** A kind's variant pool cycles through its sprite species — placement only picks an index. */
const variant_pool = (kind_seed: number, species: readonly SpriteBuilder[], surface: NatureSurface) => ({
  surface,
  variants: Array.from({ length: RECIPE_VARIANTS }, (_, variant) =>
    species[variant % species.length]!(mulberry(kind_seed * 977 + variant * 131 + 7))
  ),
})
const RECIPES: Readonly<Record<ScatterKind, ReturnType<typeof variant_pool>>> = Object.freeze({
  tuft: variant_pool(1, [herb_tall_grass, herb_fern, herb_tall_grass, herb_sedge], 'plant'),
  bush: variant_pool(7, [herb_bush], 'plant'),
  flower: variant_pool(2, [flower_bloom], 'plant'),
  mushroom: variant_pool(3, [mushroom_toadstool], 'mushroom'),
  twig: variant_pool(4, [twig_branch], 'plain'),
  pebble: variant_pool(5, [rock_pebbles], 'mineral'),
  spike: variant_pool(6, [ice_spike], 'plain'),
  cobweb: variant_pool(11, [ruins_cobweb], 'plain'),
  dry_reed: variant_pool(8, [thebes_dry_reed], 'plant'),
  city_shrub: variant_pool(9, [herb_bush], 'plant'),
  field_crop: variant_pool(10, [thebes_field_crop], 'plant'),
})

/** Sway keeps a vertex within ~0.2 blocks; +3 covers it and the tallest scaled recipe. */
const CULL_MARGIN = 3

const recipe_for = ({ kind, variant }: ScatterInstance): readonly RecipeVertex[] =>
  RECIPES[kind].variants[variant % RECIPE_VARIANTS]!

export const build_scatter_mesh = (origin: Vec3, instances: readonly ScatterInstance[]): ScatterMeshData | null => {
  if (instances.length === 0) return null
  const vertex_count = instances.reduce((total, instance) => total + recipe_for(instance).length, 0)
  const uvs = new Float32Array(vertex_count * 2)
  const positions = new Float32Array(vertex_count * 3)
  const normals = new Float32Array(vertex_count * 3)
  const colors = new Float32Array(vertex_count * 3)
  const sways = new Float32Array(vertex_count)
  const tints = new Float32Array(vertex_count)
  const phases = new Float32Array(vertex_count)
  let cursor = 0
  instances.forEach((instance) => {
    const recipe = recipe_for(instance)
    for (let start = 0; start < recipe.length; start += 3) {
      const base = (cursor + start) * 3
      for (let corner = 0; corner < 3; corner += 1) {
        const [x, y, z, blend, sway] = rotate_y(recipe[start + corner]!, instance.yaw)
        uvs.set(nature_uv(RECIPES[instance.kind].surface, recipe[start + corner]!), (cursor + start + corner) * 2)
        const offset = base + corner * 3
        positions[offset] = instance.x - origin[0] + x * instance.scale
        positions[offset + 1] = instance.y - origin[1] + y * instance.scale
        positions[offset + 2] = instance.z - origin[2] + z * instance.scale
        colors[offset] = instance.color[0] + (instance.accent[0] - instance.color[0]) * blend
        colors[offset + 1] = instance.color[1] + (instance.accent[1] - instance.color[1]) * blend
        colors[offset + 2] = instance.color[2] + (instance.accent[2] - instance.color[2]) * blend
        sways[cursor + start + corner] = sway * instance.scale
        tints[cursor + start + corner] = instance.climate_tint
        // World-position phase, per plant — no chunk-period repetition, no border step.
        phases[cursor + start + corner] = (instance.x + instance.z) * 0.8
      }
      const edge_ab = [
        positions[base + 3]! - positions[base]!,
        positions[base + 4]! - positions[base + 1]!,
        positions[base + 5]! - positions[base + 2]!,
      ]
      const edge_ac = [
        positions[base + 6]! - positions[base]!,
        positions[base + 7]! - positions[base + 1]!,
        positions[base + 8]! - positions[base + 2]!,
      ]
      const cross = [
        edge_ab[1]! * edge_ac[2]! - edge_ab[2]! * edge_ac[1]!,
        edge_ab[2]! * edge_ac[0]! - edge_ab[0]! * edge_ac[2]!,
        edge_ab[0]! * edge_ac[1]! - edge_ab[1]! * edge_ac[0]!,
      ]
      const length = Math.hypot(cross[0]!, cross[1]!, cross[2]!) || 1
      for (let corner = 0; corner < 3; corner += 1) {
        const offset = base + corner * 3
        normals[offset] = cross[0]! / length
        normals[offset + 1] = cross[1]! / length
        normals[offset + 2] = cross[2]! / length
      }
    }
    cursor += recipe.length
  })
  return {
    attributes: {
      uv: { values: uvs, size: 2 },
      position: { values: positions, size: 3 },
      normal: { values: normals, size: 3 },
      color: { values: colors, size: 3 },
      sway: { values: sways, size: 1 },
      tint: { values: tints, size: 1 },
      phase: { values: phases, size: 1 },
    },
    bounds: scatter_bounds(positions),
  }
}

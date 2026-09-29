// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Ground-scatter rendering — turns a chunk's ScatterInstances (scatter.ts) into ONE merged
// palette-tinted, atlas-textured mesh per chunk. Sprites live in src/nature/ (one file per sprite, shared
// machinery in nature/sprite_kit.ts); this layer assembles each placement KIND's variant pool
// from those sprites, bakes instances, and follows the chunk lifecycle exactly: add on near
// upload, shed when a chunk re-renders coarser, removed with the chunk, hidden while a fight
// hides world dressing. The only GPU-side motion is a small wind sway on flagged vertices.

import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, type Scene } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { Fn, attribute, float, positionWorld, texture } from 'three/tsl'

import { create_nature_texture, nature_uv, type NatureSurface } from './nature/surface_texture.ts'
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
import { plant_wind_position } from './nature/plant_wind.ts'
import { RECIPE_VARIANTS, type ScatterInstance, type ScatterKind } from './scatter.ts'
import { macro_surface_tint_nodes } from './terrain_tint.ts'
import { occlusion_dither_discard, type BoardOcclusion } from './board_occlusion.ts'
import type { RenderedChunk } from './types.ts'

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

const build_geometry = (chunk: RenderedChunk, instances: readonly ScatterInstance[]): BufferGeometry | null => {
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
        positions[offset] = instance.x - chunk.origin[0] + x * instance.scale
        positions[offset + 1] = instance.y - chunk.origin[1] + y * instance.scale
        positions[offset + 2] = instance.z - chunk.origin[2] + z * instance.scale
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
  const geometry = new BufferGeometry()
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setAttribute('sway', new BufferAttribute(sways, 1))
  geometry.setAttribute('tint', new BufferAttribute(tints, 1))
  geometry.setAttribute('phase', new BufferAttribute(phases, 1))
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius += CULL_MARGIN
  return geometry
}

export type ScatterLayer = Readonly<{
  set_visible: (visible: boolean) => void
  add: (chunk: RenderedChunk, instances: readonly ScatterInstance[]) => void
  remove: (key: string) => void
  dispose: () => void
}>

export const create_scatter_layer = ({
  scene,
  board_occlusion,
}: Readonly<{ scene: Scene; board_occlusion: BoardOcclusion }>): ScatterLayer => {
  const group = new Group()
  scene.add(group)
  const meshes = new Map<string, Mesh<BufferGeometry, MeshStandardNodeMaterial>>()
  const material = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.9, metalness: 0 })
  // The clutter's color follows the SAME macro climate field the ground uses — living kinds
  // (tint attribute 1) shift with dry/lush regions exactly like the surface they grow from.
  const surface = create_nature_texture()
  const authored = attribute('color', 'vec3' as const)
  const tint = macro_surface_tint_nodes({
    paired_color: authored,
    roughness: float(0.9),
    climate_tint: attribute('tint', 'float' as const),
    position_world: { x: positionWorld.x, z: positionWorld.z },
    patch_scale: 0,
  })
  // CLUTTER MELTS FOR A BOARD. Grass grows through a slab that was laid on top of it, and it
  // stands between the camera and the arena — both are the peephole's job. Unlike terrain this
  // is one thin sprite layer, never the depth workhorse, so it carries the discard directly
  // rather than paying for a second material; the uniform folds it away when nothing is mounted.
  material.colorNode = Fn(() => {
    occlusion_dither_discard(board_occlusion)
    return tint.tint_albedo(authored.mul(texture(surface).rgb))
  })() as ReturnType<typeof tint.tint_albedo>
  material.roughnessNode = tint.roughness_node
  material.positionNode = plant_wind_position()
  const remove = (key: string): void => {
    const mesh = meshes.get(key)
    if (!mesh) return
    meshes.delete(key)
    group.remove(mesh)
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
  return Object.freeze({
    set_visible: (next: boolean) => {
      group.visible = next
    },
    add: (chunk: RenderedChunk, instances: readonly ScatterInstance[]) => {
      // A chunk re-rendered at a coarser lod sheds its clutter (walking away demotes near→mid).
      if (chunk.lod !== 'near') {
        remove(chunk.key)
        return
      }
      if (meshes.has(chunk.key)) return
      const geometry = build_geometry(chunk, instances)
      if (!geometry) return
      // Chunk-owned material lifetime releases Three's per-object render bindings on eviction.
      // The cloned node material still shares its shader graph and world uniforms.
      const mesh = new Mesh(geometry, material.clone())
      mesh.position.set(chunk.origin[0], chunk.origin[1], chunk.origin[2])
      mesh.castShadow = false
      mesh.receiveShadow = true
      meshes.set(chunk.key, mesh)
      group.add(mesh)
    },
    remove,
    dispose: () => {
      meshes.forEach((_, key) => remove(key))
      material.dispose()
      surface.dispose()
      scene.remove(group)
    },
  })
}

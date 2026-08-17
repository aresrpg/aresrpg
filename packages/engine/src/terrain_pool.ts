// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  BufferAttribute,
  FrontSide,
  InstancedBufferGeometry,
  Mesh,
  type DataArrayTexture,
  type Material,
  type Scene,
} from 'three'
import {
  IndirectStorageBufferAttribute,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
  type NodeBuilder,
  StorageBufferAttribute,
} from 'three/webgpu'
import {
  Fn,
  attribute,
  cos,
  float,
  floor,
  fract,
  fwidth,
  int,
  instanceIndex,
  length,
  min,
  mix,
  sin,
  smoothstep,
  storage,
  transformNormalToView,
  uint,
  varying,
  texture,
  vec2,
  vec3,
} from 'three/tsl'

import type { Clouds } from './clouds.ts'
import type { FlattenUniform } from './flatten.ts'
import { create_flat_nodes } from './flat_nodes.ts'
import { FACE_WINDING_FLIP_BITS, type GreedyMeshData } from './greedy_mesher.ts'
import { get_quality_profile } from './quality.ts'
import { MATERIAL_TEXTURE_VARIANTS } from './material_presets.ts'
import { create_material_texture } from './material_texture.ts'
import type { create_sky_node } from './sky/sky_node.ts'
import { SURFACE_HASH_WRAP, surface_phase } from './surface_variation.ts'
import { macro_tint_nodes, material_color_node } from './terrain_tint.ts'
import { AO_FLOOR, AO_LEVELS, FACE_BRIGHTNESS, LIT_FACE_BRIGHTNESS } from './terrain_lighting.ts'
import type { EngineQuality, RenderedChunk } from './types.ts'
import { derive_sub_seed } from './world_noise.ts'
import { compile_world_recipe, type WorldRecipe } from './world_recipe.ts'
import type { CompiledMaterials } from './world_materials.ts'

export const TERRAIN_POOL_LAYOUT = Object.freeze({ slot_quads: 1024, max_slots: 2048 })
const SLOT_QUADS = TERRAIN_POOL_LAYOUT.slot_quads
const MAX_SLOTS = TERRAIN_POOL_LAYOUT.max_slots
const SLOT_SHIFT = Math.log2(SLOT_QUADS)
const INDIRECT_WORDS = 4

export type TerrainPool = Readonly<{
  upload: (chunk: RenderedChunk, data: GreedyMeshData) => 'uploaded' | 'full' | 'too_large'
  remove: (key: string) => void
  set_quality: (quality: EngineQuality) => void
  set_flatten_active: (active: boolean) => void
  count: () => number
  dispose: () => void
}>

const create_geometry = (capacity: number): InstancedBufferGeometry => {
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('corner', new BufferAttribute(new Float32Array([0, 1, 2, 2, 1, 3]), 1))
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(18), 3))
  geometry.instanceCount = capacity
  return geometry
}

const build_material = (
  quality: EngineQuality,
  pool_attr: StorageBufferAttribute,
  meta_attr: StorageBufferAttribute,
  flatten: FlattenUniform,
  variation_phase: number,
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction'],
  clouds: Clouds,
  color_for: (material_id: Node<'uint'>) => Node<'vec3'>,
  materials: CompiledMaterials,
  material_texture: DataArrayTexture,
  flatten_variant: boolean
): Material => {
  const terrain_kind = get_quality_profile(quality).terrain
  const material =
    terrain_kind === 'flat'
      ? new MeshBasicNodeMaterial({ side: FrontSide })
      : new MeshStandardNodeMaterial({ side: FrontSide, roughness: 0.88, metalness: 0 })
  const words = storage(pool_attr, 'uvec2', pool_attr.count).toReadOnly().element(instanceIndex)
  const meta = storage(meta_attr, 'vec4', meta_attr.count)
    .toReadOnly()
    .element(instanceIndex.shiftRight(uint(SLOT_SHIFT)))
  const word_a = uint(words.x)
  const word_b = uint(words.y)
  const material_id = word_b.bitAnd(uint(0xfff))
  const x = float(word_a.bitAnd(uint(0x3f)))
  const y = float(word_a.shiftRight(uint(6)).bitAnd(uint(0x3f)))
  const z = float(word_a.shiftRight(uint(12)).bitAnd(uint(0x3f)))
  const width = float(word_a.shiftRight(uint(18)).bitAnd(uint(0x1f)).add(uint(1)))
  const height = float(word_a.shiftRight(uint(23)).bitAnd(uint(0x1f)).add(uint(1)))
  const face = word_a.shiftRight(uint(28)).bitAnd(uint(0x7))
  const corner = attribute('corner', 'float' as const)
  const corner_u = corner
    .equal(float(1))
    .or(corner.equal(float(3)))
    .select(float(1), float(0))
  const corner_v = corner
    .equal(float(2))
    .or(corner.equal(float(3)))
    .select(float(1), float(0))
  const winding_flip = uint(FACE_WINDING_FLIP_BITS).shiftRight(face).bitAnd(uint(1)).equal(uint(1))
  const rendered_corner_u = winding_flip.select(float(1).sub(corner_u), corner_u)
  const axis_x = face.lessThan(uint(2))
  const axis_y = face.greaterThanEqual(uint(2)).and(face.lessThan(uint(4)))
  const positive = face.bitAnd(uint(1)).equal(uint(0))
  const u_axis = axis_x.select(vec3(0, 1, 0), vec3(1, 0, 0))
  const v_axis = axis_x.select(vec3(0, 0, 1), axis_y.select(vec3(0, 0, 1), vec3(0, 1, 0)))
  // BRANCHLESS normal from the face bits — nested select chains evaluated fine as albedo but
  // produced garbage in the lighting (normalNode) context on WebGPU (2026-08-15 probe chain);
  // pure arithmetic is stage-proof: axis flags × sign.
  const axis_x_f = axis_x.select(float(1), float(0))
  const axis_y_f = axis_y.select(float(1), float(0))
  const axis_z_f = float(1).sub(axis_x_f).sub(axis_y_f)
  const face_sign = float(1).sub(float(face.bitAnd(uint(1))).mul(2))
  const normal = vec3(axis_x_f.mul(face_sign), axis_y_f.mul(face_sign), axis_z_f.mul(face_sign))
  const push = positive.select(normal, vec3(0))
  const local = vec3(x, y, z)
    .add(u_axis.mul(rendered_corner_u.mul(width)))
    .add(v_axis.mul(corner_v.mul(height)))
    .add(push)
    .add(meta.xyz)
  // EXPLICIT interpolation: color math must see the per-FRAGMENT position. Left implicit,
  // the reconstruction collapsed to per-quad values in the fragment stage — every pixel/tint
  // layer flattened to one flat shade per greedy quad (the owner's "I see quads" bug).
  const local_frag = varying(local)
  const top = face.equal(uint(2))
  const face_levels = terrain_kind === 'flat' ? FACE_BRIGHTNESS : LIT_FACE_BRIGHTNESS
  const face_brightness = axis_x.select(
    float(face_levels[0]),
    axis_y.select(positive.select(float(face_levels[2]), float(face_levels[3])), float(face_levels[4]))
  )
  // The four corner AO levels are PER BLOCK. A merged quad spans many blocks, so the corner
  // gradient must repeat per block cell, not stretch across the whole quad — evaluated in the
  // fragment from the cell-local position (the legacy voxel AO look).
  const ao_fraction_of = (slot: number): Node<'float'> => {
    const level = float(word_b.shiftRight(uint(20 + slot * 2)).bitAnd(uint(3)))
    return level
      .equal(float(0))
      .select(
        float(AO_LEVELS[0]),
        level
          .equal(float(1))
          .select(float(AO_LEVELS[1]), level.equal(float(2)).select(float(AO_LEVELS[2]), float(AO_LEVELS[3])))
      )
  }
  const u_cells = varying(rendered_corner_u.mul(width))
  const v_cells = varying(corner_v.mul(height))
  const cell_u = fract(min(u_cells, varying(width).sub(0.001)))
  const cell_v = fract(min(v_cells, varying(height).sub(0.001)))
  const ao_fraction = mix(
    mix(ao_fraction_of(0), ao_fraction_of(1), cell_u),
    mix(ao_fraction_of(2), ao_fraction_of(3), cell_u),
    cell_v
  )
  const ao_floor = top.select(float(AO_FLOOR.top), float(AO_FLOOR.side))
  const ao = mix(ao_floor, float(1), ao_fraction)
  const material_color = color_for(material_id)
  const distance_from_extreme = min(length(material_color), length(material_color.sub(1)))
  const noise_modulation = mix(float(0.2), float(1), smoothstep(float(0), float(0.5), distance_from_extreme))
  // THE PIXEL SHADER (the aresrpg-engine block look): every block face is an 8×8 grid of
  // stable hashed PIXELS, posterized to 5 discrete shades — reads as authored pixel-art
  // from one color. A per-BLOCK jitter underneath varies whole tiles.
  const hash_position = local_frag.sub(floor(local_frag.div(float(SURFACE_HASH_WRAP))).mul(float(SURFACE_HASH_WRAP)))
  const block_cell = floor(hash_position.sub(normal.mul(0.5)))
  const block_noise = fract(
    sin(block_cell.x.mul(17.171).add(block_cell.y.mul(43.759)).add(block_cell.z.mul(91.133)).add(variation_phase)).mul(
      37_213.577
    )
  ).sub(0.5)
  const material_layer = float(material_id)
    .mul(float(MATERIAL_TEXTURE_VARIANTS))
    .add(floor(block_noise.add(0.5).mul(float(MATERIAL_TEXTURE_VARIANTS))))
  const texture_color = texture(material_texture, vec2(u_cells, float(1).sub(v_cells))).depth(int(material_layer)).rgb
  const pixel_cell = floor(hash_position.mul(8).sub(normal.mul(0.5)))
  const pixel_hash = fract(
    sin(pixel_cell.x.mul(12.9898).add(pixel_cell.y.mul(37.719)).add(pixel_cell.z.mul(78.233)).add(variation_phase)).mul(
      43_758.5453
    )
  )
  const material_noise = floor(pixel_hash.mul(5)).div(4).sub(0.5) // 5 posterized shades — the pixel-art read
  // BAND-LIMITING (2026-08-15): the grain is an analytic function with no mip chain, so once a
  // screen pixel covers more than its cell the fragment samples far below Nyquist and shimmers.
  // `fwidth` gives the world size of a pixel, and each layer fades out as its cell drops below
  // that — the close-up look is untouched, the distance stops crawling.
  const world_per_pixel = fwidth(local_frag).length()
  const cell_fade = (cell_size: number) =>
    float(1).sub(smoothstep(float(cell_size * 0.5), float(cell_size), world_per_pixel))
  const pixel_fade = cell_fade(0.125) // the 8×8 grid: one cell per eighth of a block
  const block_fade = cell_fade(1) // the per-block jitter under it
  const grain_strength = quality === 'low' ? 0.07 : 0.11
  const environment_light =
    quality === 'low' ? mix(float(0.32), float(1), smoothstep(-0.14, 0.18, sun_direction.y)) : float(1)
  // The legacy NG-TINT macro field (moisture, climate, underlayer patches, and macro gradient)
  // layers OVER the grain — world-space continuous, so the greedy quads dissolve.
  const tint = macro_tint_nodes({
    material_id,
    position_world: { x: local_frag.x, z: local_frag.z },
    materials,
  })
  const grained =
    quality === 'low'
      ? material_color.add(
          block_noise
            .mul(grain_strength)
            .mul(0.7)
            .mul(block_fade)
            .add(material_noise.mul(grain_strength).mul(pixel_fade))
            .mul(noise_modulation)
        )
      : texture_color.add(block_noise.mul(0.035).mul(block_fade).mul(noise_modulation))
  const base_color = tint.tint_albedo(grained).mul(face_brightness).mul(ao).mul(environment_light)
  // The scan front is presentation only. Geometry uses the one global projection amount so
  // the renderer, character collision, boards, and markers all agree on exact height.
  const flat = create_flat_nodes(local_frag.x, local_frag.z, flatten.amount, base_color)
  const flattened_position = vec3(local.x, mix(local.y, float(0), flatten.amount), local.z)
  const flattened_normal = mix(normal, vec3(0, 1, 0), flatten.amount).normalize()
  const solid_opacity = top.select(float(1), float(1).sub(flatten.amount))

  material.positionNode = flattened_position
  material.normalNode = transformNormalToView(flattened_normal)
  material.colorNode = flat.color
  if (terrain_kind !== 'flat')
    material.receivedShadowNode = Fn((args: readonly [Node<'float'>], _builder: NodeBuilder) =>
      args[0].mul(clouds.shadow_at(local_frag.xz, local_frag.y))
    ) as unknown as () => Node
  // The side-face fade exists ONLY for the flat-world projection; on the normal path the
  // material stays fully opaque with NO alphaTest — a discard in the opaque terrain shader
  // kills early-Z on every GPU (perf audit) for a feature that is off in normal play.
  if (flatten_variant) {
    material.opacityNode = solid_opacity
    material.alphaTest = 0.5
  }
  // Quality changes workload, not the material's meaning. Every lit tier keeps the same
  // role-derived dielectric response; low remains the explicit unlit fallback.
  if (terrain_kind !== 'flat') (material as MeshStandardNodeMaterial).roughnessNode = tint.roughness_node
  return material
}

export const create_terrain_pool = ({
  scene,
  quality,
  flatten,
  world,
  sun_direction,
  clouds,
}: Readonly<{
  scene: Scene
  quality: EngineQuality
  flatten: FlattenUniform
  world: WorldRecipe
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction']
  clouds: Clouds
}>): TerrainPool => {
  const capacity = MAX_SLOTS * SLOT_QUADS
  const compiled_materials = compile_world_recipe(world).materials
  const material_texture = create_material_texture(compiled_materials)
  const color_for = (material_id: Node<'uint'>): Node<'vec3'> => material_color_node(compiled_materials, material_id)
  const variation_phase = surface_phase(derive_sub_seed(world.seed, 'surface-variation'))
  const pool_array = new Uint32Array(capacity * 2)
  const meta_array = new Float32Array(MAX_SLOTS * 4)
  const indirect_array = new Uint32Array(MAX_SLOTS * INDIRECT_WORDS)
  const pool_attr = new StorageBufferAttribute(pool_array, 2)
  const meta_attr = new StorageBufferAttribute(meta_array, 4)
  const indirect_attr = new IndirectStorageBufferAttribute(indirect_array, INDIRECT_WORDS)
  const geometry = create_geometry(capacity)
  const free_slots = Array.from({ length: MAX_SLOTS }, (_, index) => MAX_SLOTS - index - 1)
  const chunk_slots = new Map<string, Readonly<{ origin: RenderedChunk['origin']; slots: readonly number[] }>>()
  const build = (tier: EngineQuality, flatten_variant: boolean) =>
    build_material(
      tier,
      pool_attr,
      meta_attr,
      flatten,
      variation_phase,
      sun_direction,
      clouds,
      color_for,
      compiled_materials,
      material_texture,
      flatten_variant
    )
  const materials = Object.freeze({
    low: build('low', false),
    medium: build('medium', false),
    high: build('high', false),
  })
  const flatten_materials = Object.freeze({
    low: build('low', true),
    medium: build('medium', true),
    high: build('high', true),
  })
  let flatten_active = false
  let current_quality = quality
  const mesh = new Mesh(geometry, materials[quality])
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.castShadow = quality !== 'low'
  mesh.receiveShadow = quality !== 'low'
  scene.add(mesh)

  for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
    const offset = slot * INDIRECT_WORDS
    indirect_array[offset] = 6
    indirect_array[offset + 1] = 0
    indirect_array[offset + 2] = 0
    indirect_array[offset + 3] = slot * SLOT_QUADS
  }

  const rebuild_draws = (): void => {
    geometry.setIndirect(
      indirect_attr,
      [...chunk_slots.values()].flatMap(({ slots }) =>
        slots.map((slot) => slot * INDIRECT_WORDS * Uint32Array.BYTES_PER_ELEMENT)
      )
    )
  }
  rebuild_draws()

  const release_chunk = (key: string): boolean => {
    const allocation = chunk_slots.get(key)
    if (!allocation) return false
    allocation.slots.forEach((slot) => {
      const word_start = slot * SLOT_QUADS * 2
      pool_array.fill(0, word_start, word_start + SLOT_QUADS * 2)
      pool_attr.addUpdateRange(word_start, SLOT_QUADS * 2)
      meta_array.fill(0, slot * 4, slot * 4 + 4)
      indirect_array[slot * INDIRECT_WORDS + 1] = 0
      free_slots.push(slot)
    })
    chunk_slots.delete(key)
    return true
  }

  const update_buffers = (): void => {
    pool_attr.needsUpdate = true
    meta_attr.needsUpdate = true
    indirect_attr.needsUpdate = true
  }

  const remove = (key: string): void => {
    if (!release_chunk(key)) return
    update_buffers()
    rebuild_draws()
  }

  return Object.freeze({
    upload: (chunk: RenderedChunk, data: GreedyMeshData) => {
      const required = Math.ceil(data.quad_count / SLOT_QUADS)
      const reusable = chunk_slots.get(chunk.key)?.slots.length ?? 0
      if (required > MAX_SLOTS) return 'too_large'
      if (required > free_slots.length + reusable) return 'full'
      release_chunk(chunk.key)
      if (required === 0) return 'uploaded'
      const slots = Array.from({ length: required }, (_, index) => {
        const slot = free_slots.pop()!
        const quad_start = index * SLOT_QUADS
        const quad_count = Math.min(SLOT_QUADS, data.quad_count - quad_start)
        const word_start = slot * SLOT_QUADS * 2
        pool_array.set(data.quads.subarray(quad_start * 2, (quad_start + quad_count) * 2), word_start)
        pool_attr.addUpdateRange(word_start, quad_count * 2)
        meta_array.set([chunk.origin[0], chunk.origin[1], chunk.origin[2], quad_count], slot * 4)
        indirect_array[slot * INDIRECT_WORDS + 1] = quad_count
        return slot
      })
      chunk_slots.set(chunk.key, Object.freeze({ origin: chunk.origin, slots: Object.freeze(slots) }))
      update_buffers()
      rebuild_draws()
      return 'uploaded'
    },
    remove,
    set_quality: (next: EngineQuality) => {
      current_quality = next
      mesh.material = (flatten_active ? flatten_materials : materials)[next]
      mesh.castShadow = next !== 'low'
      mesh.receiveShadow = next !== 'low'
    },
    /// The transparent side-fade variant rides ONLY while the flat projection is live.
    set_flatten_active: (active: boolean) => {
      if (active === flatten_active) return
      flatten_active = active
      mesh.material = (active ? flatten_materials : materials)[current_quality]
    },
    count: () => chunk_slots.size,
    dispose: () => {
      scene.remove(mesh)
      geometry.dispose()
      Object.values(materials).forEach((material) => material.dispose())
      Object.values(flatten_materials).forEach((material) => material.dispose())
      material_texture.dispose()
      chunk_slots.clear()
      free_slots.length = 0
    },
  })
}

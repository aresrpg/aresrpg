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
  float,
  fract,
  int,
  instanceIndex,
  min,
  mix,
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
import { create_material_texture } from './material_texture.ts'
import type { create_sky_node } from './sky/sky_node.ts'
import { macro_tint_nodes } from './terrain_tint.ts'
import { AO_FLOOR, AO_LEVELS, FACE_BRIGHTNESS, LIT_FACE_BRIGHTNESS } from './terrain_lighting.ts'
import type { EngineQuality, RenderedChunk } from './types.ts'
import { compile_world_recipe, type WorldRecipe } from './world_recipe.ts'
import type { CompiledMaterials } from './world_materials.ts'

export const TERRAIN_POOL_LAYOUT = Object.freeze({ slot_quads: 1024, max_slots: 3072 })
const SLOT_QUADS = TERRAIN_POOL_LAYOUT.slot_quads
const MAX_SLOTS = TERRAIN_POOL_LAYOUT.max_slots
const SLOT_SHIFT = Math.log2(SLOT_QUADS)
const INDIRECT_WORDS = 4
const MATERIAL_TEXTURE_BLOCK_SPAN = 4

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
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction'],
  clouds: Clouds,
  materials: CompiledMaterials,
  material_texture: DataArrayTexture,
  flatten_variant: boolean
): Material => {
  const terrain_kind = get_quality_profile(quality).terrain.kind
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
  const width_frag = varying(width)
  const height_frag = varying(height)
  const cell_u = fract(min(u_cells, width_frag.sub(0.001)))
  const cell_v = fract(min(v_cells, height_frag.sub(0.001)))
  const ao_fraction = mix(
    mix(ao_fraction_of(0), ao_fraction_of(1), cell_u),
    mix(ao_fraction_of(2), ao_fraction_of(3), cell_u),
    cell_v
  )
  const ao_floor = top.select(float(AO_FLOOR.top), float(AO_FLOOR.side))
  const ao = mix(ao_floor, float(1), ao_fraction)
  // One world-space field spans several blocks. A material never switches texture layers at a
  // voxel boundary, so greedy-quad and block identity cannot draw a straight texture seam.
  const texture_uv = vec2(local_frag.dot(u_axis), local_frag.dot(v_axis).negate()).div(
    float(MATERIAL_TEXTURE_BLOCK_SPAN)
  )
  const texture_sample = texture(material_texture, texture_uv).depth(int(material_id))
  const texture_color = texture_sample.rgb
  const micro_roughness = texture_sample.a.sub(0.5)
  const environment_light =
    quality === 'low' ? mix(float(0.32), float(1), smoothstep(-0.14, 0.18, sun_direction.y)) : float(1)
  // The legacy NG-TINT macro field (moisture, climate, underlayer patches, and macro gradient)
  // layers OVER the grain — world-space continuous, so the greedy quads dissolve.
  const tint = macro_tint_nodes({
    material_id,
    position_world: { x: local_frag.x, z: local_frag.z },
    materials,
  })
  const base_color = tint.tint_albedo(texture_color).mul(face_brightness).mul(ao).mul(environment_light)
  // Rounded corners (port of the legacy engine's uSmoothEdgeRadius): near a CONVEX quad edge
  // the fragment normal bends as if the surface curved away — lighting reads the edge as a
  // bevel, geometry never changes. Edge flags come from the mesher (word B bits 28-31); the
  // whole computation stays branchless arithmetic — select chains in the normalNode context
  // compile to garbage on WebGPU (2026-08-15 probe chain).
  // SUBTLE is the whole point (owner 2026-08-19: 0.3 read as fat white chalk lips): a thin
  // 0.1-block margin, and the bend capped below 45° so a lit top edge brightens instead of
  // turning into a specular stripe.
  const round_radius = float(0.1)
  const round_strength = float(0.7)
  const edge_flags = word_b.shiftRight(uint(28))
  const round_u_low = float(edge_flags.bitAnd(uint(1)))
  const round_u_high = float(edge_flags.shiftRight(uint(1)).bitAnd(uint(1)))
  const round_v_low = float(edge_flags.shiftRight(uint(2)).bitAnd(uint(1)))
  const round_v_high = float(edge_flags.shiftRight(uint(3)).bitAnd(uint(1)))
  const overrun_u = round_u_high
    .mul(u_cells.sub(width_frag.sub(round_radius)).max(0))
    .sub(round_u_low.mul(round_radius.sub(u_cells).max(0)))
  const overrun_v = round_v_high
    .mul(v_cells.sub(height_frag.sub(round_radius)).max(0))
    .sub(round_v_low.mul(round_radius.sub(v_cells).max(0)))
  const bent_local = vec3(overrun_u.mul(round_strength), overrun_v.mul(round_strength), round_radius).normalize()
  const rounded_normal = u_axis.mul(bent_local.x).add(v_axis.mul(bent_local.y)).add(normal.mul(bent_local.z))
  // The scan front is presentation only. Geometry uses the one global projection amount so
  // the renderer, character collision, boards, and markers all agree on exact height.
  const flat = create_flat_nodes(local_frag.x, local_frag.z, flatten.amount, base_color)
  const flattened_position = vec3(local.x, mix(local.y, float(0), flatten.amount), local.z)
  const flattened_normal = mix(rounded_normal, vec3(0, 1, 0), flatten.amount).normalize()
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
  if (terrain_kind !== 'flat')
    (material as MeshStandardNodeMaterial).roughnessNode = tint.roughness_node.add(micro_roughness).clamp(0.1, 1)
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
  const pool_array = new Uint32Array(capacity * 2)
  const meta_array = new Float32Array(MAX_SLOTS * 4)
  const indirect_array = new Uint32Array(MAX_SLOTS * INDIRECT_WORDS)
  const pool_attr = new StorageBufferAttribute(pool_array, 2)
  const meta_attr = new StorageBufferAttribute(meta_array, 4)
  const indirect_attr = new IndirectStorageBufferAttribute(indirect_array, INDIRECT_WORDS)
  const geometry = create_geometry(capacity)
  const free_slots = Array.from({ length: MAX_SLOTS }, (_, index) => MAX_SLOTS - index - 1)
  const chunk_slots = new Map<string, Readonly<{ origin: RenderedChunk['origin']; slots: readonly number[] }>>()
  const build = (tier: EngineQuality, material_texture: DataArrayTexture, flatten_variant: boolean) =>
    build_material(
      tier,
      pool_attr,
      meta_attr,
      flatten,
      sun_direction,
      clouds,
      compiled_materials,
      material_texture,
      flatten_variant
    )
  const create_quality_resources = (tier: EngineQuality, retained_texture?: DataArrayTexture) => {
    const { texture_size } = get_quality_profile(tier).terrain
    const material_texture = retained_texture ?? create_material_texture(compiled_materials, texture_size)
    return Object.freeze({
      texture_size,
      material_texture,
      material: build(tier, material_texture, false),
      flatten_material: build(tier, material_texture, true),
    })
  }
  const dispose_quality_resources = (
    resources: ReturnType<typeof create_quality_resources>,
    dispose_texture = true
  ): void => {
    resources.material.dispose()
    resources.flatten_material.dispose()
    if (dispose_texture) resources.material_texture.dispose()
  }
  let flatten_active = false
  let current_quality = quality
  let quality_resources = create_quality_resources(quality)
  const mesh = new Mesh(geometry, quality_resources.material)
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
      if (next === current_quality) return
      const previous_resources = quality_resources
      const { texture_size: next_texture_size } = get_quality_profile(next).terrain
      const reuse_texture = next_texture_size === previous_resources.texture_size
      quality_resources = create_quality_resources(
        next,
        reuse_texture ? previous_resources.material_texture : undefined
      )
      current_quality = next
      mesh.material = flatten_active ? quality_resources.flatten_material : quality_resources.material
      mesh.castShadow = next !== 'low'
      mesh.receiveShadow = next !== 'low'
      dispose_quality_resources(previous_resources, !reuse_texture)
    },
    /// The transparent side-fade variant rides ONLY while the flat projection is live.
    set_flatten_active: (active: boolean) => {
      if (active === flatten_active) return
      flatten_active = active
      mesh.material = active ? quality_resources.flatten_material : quality_resources.material
    },
    count: () => chunk_slots.size,
    dispose: () => {
      scene.remove(mesh)
      geometry.dispose()
      dispose_quality_resources(quality_resources)
      chunk_slots.clear()
      free_slots.length = 0
    },
  })
}

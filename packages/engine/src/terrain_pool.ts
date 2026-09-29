// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  BufferAttribute,
  type Camera,
  Frustum,
  FrontSide,
  InstancedBufferGeometry,
  Matrix4,
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

import type { UploadQueue } from './upload_queue.ts'
import { create_detail_layer } from './detail_layer.ts'
import type { Clouds } from './clouds.ts'
import { CANOPY_BOUNDS_MARGIN } from './opaque_canopy.ts'
import { CanopyLightingModel } from './canopy_lighting.ts'
import { opaque_leaf_nodes, opaque_voxel_nodes } from './opaque_canopy_nodes.ts'
import { chunk_in_frustum } from './chunk_visibility.ts'
import { FACE_WINDING_FLIP_BITS, type GreedyMeshData } from './greedy_mesher.ts'
import { get_quality_profile } from './quality.ts'
import { create_material_texture, MATERIAL_TEXTURE_BLOCK_SPAN } from './material_texture.ts'
import type { create_sky_node } from './sky/sky_node.ts'
import { material_emission_node, macro_tint_nodes } from './terrain_tint.ts'
import { AO_FLOOR, AO_LEVELS, FACE_BRIGHTNESS, LIT_FACE_BRIGHTNESS } from './terrain_lighting.ts'
import { occlusion_dither_discard, type BoardOcclusion } from './board_occlusion.ts'
import type { EngineQuality, RenderedChunk } from './types.ts'
import type { CompiledWorld } from './world_recipe.ts'
import type { CompiledMaterials } from './world_materials.ts'
import { CHUNK_EDGE } from './voxel_data.ts'

export const TERRAIN_POOL_LAYOUT = Object.freeze({ slot_quads: 1024, max_slots: 3072 })
const SLOT_QUADS = TERRAIN_POOL_LAYOUT.slot_quads
const MAX_SLOTS = TERRAIN_POOL_LAYOUT.max_slots
const SLOT_SHIFT = Math.log2(SLOT_QUADS)
const INDIRECT_WORDS = 5

export type TerrainPool = Readonly<{
  set_visible: (visible: boolean) => void
  set_details_visible: (visible: boolean) => void
  upload: (chunk: RenderedChunk, data: GreedyMeshData) => 'uploaded' | 'full' | 'too_large'
  remove: (key: string) => boolean
  set_quality: (quality: EngineQuality) => void
  /** swap the see-through variant in while a fight board is mounted */
  set_occlusion_active: (active: boolean) => void
  set_view: (camera: Camera, shadow_camera: Camera | null) => void
  count: () => number
  dispose: () => void
}>

const create_geometry = (capacity: number): InstancedBufferGeometry => {
  const geometry = new InstancedBufferGeometry()
  geometry.setAttribute('corner', new BufferAttribute(new Float32Array([0, 1, 2, 3]), 1))
  geometry.setIndex([0, 1, 2, 2, 1, 3])
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(12), 3))
  geometry.instanceCount = capacity
  return geometry
}

const build_material = (
  quality: EngineQuality,
  pool_attr: StorageBufferAttribute,
  meta_attr: StorageBufferAttribute,
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction'],
  clouds: Clouds,
  materials: CompiledMaterials,
  material_texture: DataArrayTexture,
  occlusion: BoardOcclusion | null,
  surface_nodes: typeof opaque_leaf_nodes
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
  const voxel_local = vec3(x, y, z)
    .add(u_axis.mul(rendered_corner_u.mul(width)))
    .add(v_axis.mul(corner_v.mul(height)))
    .add(push)
    .add(meta.xyz)
  const surface = surface_nodes(word_a, word_b, corner_u, corner_v, meta.xyz)
  const local = surface.position(voxel_local)
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
  const texture_uv = surface.uv(
    vec2(local_frag.dot(u_axis), local_frag.dot(v_axis).negate()).div(float(MATERIAL_TEXTURE_BLOCK_SPAN))
  )
  const texture_sample = texture(material_texture, texture_uv).depth(int(material_id))
  const texture_color = texture_sample.rgb
  const micro_roughness = texture_sample.a.sub(0.5)
  // The texture's micro-relief bends lighting normals, not the silhouette or collision.
  // World-space UVs preserve continuity across greedy quads and chunk boundaries.
  const relief_step = 1 / material_texture.image.width
  const relief_u = texture(material_texture, texture_uv.add(vec2(relief_step, 0)))
    .depth(int(material_id))
    .a.sub(texture_sample.a)
  const relief_v = texture(material_texture, texture_uv.add(vec2(0, relief_step)))
    .depth(int(material_id))
    .a.sub(texture_sample.a)
  const environment_light =
    terrain_kind === 'flat' ? mix(float(0.32), float(1), smoothstep(-0.14, 0.18, sun_direction.y)) : float(1)
  // The legacy NG-TINT macro field (moisture, climate, underlayer patches, and macro gradient)
  // layers OVER the grain — world-space continuous, so the greedy quads dissolve.
  const tint = macro_tint_nodes({
    material_id,
    position_world: { x: local_frag.x, z: local_frag.z },
    materials,
  })
  const base_color = tint.tint_albedo(texture_color).mul(face_brightness).mul(ao).mul(environment_light)
  // Square voxel faces meet authored stairs/slabs without an invented rounded highlight.
  const detailed_normal = normal
    .sub(u_axis.mul(relief_u.mul(2.5)))
    .add(v_axis.mul(relief_v.mul(2.5)))
    .normalize()
  const surface_normal = surface.normal(detailed_normal)
  // NodeMaterial consumes emissiveNode for Basic too; Three types declare it on Standard only.
  ;(material as MeshStandardNodeMaterial).emissiveNode = material_emission_node(materials, material_id)
  material.positionNode = local
  material.normalNode = transformNormalToView(surface_normal)
  // The peephole's screen-door discard MUST ride the colour output graph: a nested Fn's Discard
  // never reaches the outer stack, and a bare build-scope discard is compiled away entirely
  // (three's node builder only emits what an output slot reaches). This variant is the only
  // terrain material that can discard, and it renders only while a board is mounted.
  material.colorNode = occlusion
    ? (Fn(() => {
        occlusion_dither_discard(occlusion)
        return base_color
      })() as typeof base_color)
    : base_color
  if (terrain_kind !== 'flat')
    material.receivedShadowNode = Fn((args: readonly [Node<'float'>], _builder: NodeBuilder) =>
      surface.shadow(args[0]).mul(clouds.shadow_at(local_frag.xz, local_frag.y))
    ) as unknown as () => Node
  // Quality changes workload, not the material's meaning. Every lit tier keeps the same
  // role-derived dielectric response; low remains the explicit unlit fallback.
  if (terrain_kind !== 'flat') {
    const lit = material as MeshStandardNodeMaterial
    lit.roughnessNode = tint.roughness_node.add(micro_roughness).clamp(0.1, 1)
    lit.setupLightingModel = () => new CanopyLightingModel(surface.specular(float(1)))
  }
  return material
}

export const create_terrain_pool = ({
  scene,
  quality,
  world: compiled_world,
  uploads,
  sun_direction,
  clouds,
  board_occlusion,
}: Readonly<{
  scene: Scene
  quality: EngineQuality
  world: CompiledWorld
  uploads: UploadQueue
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction']
  clouds: Clouds
  /** the shared peephole uniforms — the see-through variant is built against them */
  board_occlusion: BoardOcclusion
}>): TerrainPool => {
  const capacity = MAX_SLOTS * SLOT_QUADS
  const world = compiled_world.recipe
  const compiled_materials = compiled_world.materials
  const pool_array = new Uint32Array(capacity * 2)
  const meta_array = new Float32Array(MAX_SLOTS * 4)
  const indirect_array = new Uint32Array(MAX_SLOTS * INDIRECT_WORDS)
  const pool_attr = new StorageBufferAttribute(pool_array, 2)
  const meta_attr = new StorageBufferAttribute(meta_array, 4)
  const indirect_attr = new IndirectStorageBufferAttribute(indirect_array, INDIRECT_WORDS)
  const geometry = create_geometry(capacity)
  const shadow_geometry = create_geometry(capacity)
  const free_slots = Array.from({ length: MAX_SLOTS }, (_, index) => MAX_SLOTS - index - 1)
  const bounds_margin = world.canopy === 'clusters' ? CANOPY_BOUNDS_MARGIN : 0
  const bounds_edge = CHUNK_EDGE + bounds_margin * 2
  const chunk_slots = new Map<string, Readonly<{ bounds_origin: RenderedChunk['origin']; slots: readonly number[] }>>()
  const build = (tier: EngineQuality, material_texture: DataArrayTexture, occlusion: BoardOcclusion | null = null) =>
    build_material(
      tier,
      pool_attr,
      meta_attr,
      sun_direction,
      clouds,
      compiled_materials,
      material_texture,
      occlusion,
      world.canopy === 'clusters' ? opaque_leaf_nodes : opaque_voxel_nodes
    )
  const create_quality_resources = (tier: EngineQuality, retained_texture?: DataArrayTexture) => {
    const { kind, texture_size } = get_quality_profile(tier).terrain
    const material_texture =
      retained_texture ?? create_material_texture(compiled_materials, texture_size, world.canopy === 'clusters')
    return Object.freeze({
      kind,
      texture_size,
      material_texture,
      material: build(tier, material_texture),
      // THE PEEPHOLE VARIANT. Its screen-door discard costs early-Z on every GPU, so it exists
      // beside the fast material and is swapped in only while a board is mounted — normal play
      // never renders a shader that can discard.
      occlusion_material: build(tier, material_texture, board_occlusion),
    })
  }
  const dispose_quality_resources = (
    resources: ReturnType<typeof create_quality_resources>,
    dispose_texture = true
  ): void => {
    resources.material.dispose()
    resources.occlusion_material.dispose()
    if (dispose_texture) resources.material_texture.dispose()
  }
  let occlusion_active = false
  const pick_material = () => {
    return occlusion_active ? quality_resources.occlusion_material : quality_resources.material
  }
  let quality_resources = create_quality_resources(quality)
  const details = create_detail_layer({
    scene,
    cells: world.details ?? [],
    uploads,
    clouds,
    materials: compiled_materials,
    atlas: quality_resources.material_texture,
    quality,
    sun_direction,
  })
  const mesh = new Mesh(geometry, quality_resources.material)
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.castShadow = false
  mesh.receiveShadow = quality_resources.kind !== 'flat'
  const shadow_mesh = new Mesh(shadow_geometry, quality_resources.material)
  shadow_mesh.frustumCulled = false
  shadow_mesh.matrixAutoUpdate = false
  shadow_mesh.castShadow = quality_resources.kind !== 'flat'
  shadow_mesh.receiveShadow = false
  shadow_mesh.layers.set(1)
  scene.add(mesh, shadow_mesh)

  for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
    const offset = slot * INDIRECT_WORDS
    indirect_array[offset] = 6
    indirect_array[offset + 1] = 0
    indirect_array[offset + 2] = 0
    indirect_array[offset + 3] = 0 // baseVertex
    indirect_array[offset + 4] = slot * SLOT_QUADS
  }

  const view_projection = new Matrix4()
  const shadow_view_projection = new Matrix4()
  const view_frustum = new Frustum()
  const shadow_frustum = new Frustum()
  let view_active = false
  let shadow_view_active = false
  let visible_draw_slots: readonly number[] | null = null
  let shadow_draw_slots: readonly number[] | null = null
  const visible_scratch: number[] = []
  const shadow_scratch: number[] = []
  const same_slots = (left: readonly number[], right: readonly number[]): boolean =>
    left.length === right.length && left.every((slot, index) => slot === right[index])
  const write_draws = (
    target: InstancedBufferGeometry,
    next: readonly number[],
    current: readonly number[] | null
  ): readonly number[] => {
    if (current && same_slots(next, current)) return current
    const slots = Object.freeze([...next])
    target.setIndirect(
      indirect_attr,
      slots.map((slot) => slot * INDIRECT_WORDS * Uint32Array.BYTES_PER_ELEMENT)
    )
    return slots
  }
  const rebuild_draws = (): void => {
    visible_scratch.length = 0
    shadow_scratch.length = 0
    chunk_slots.forEach(({ bounds_origin, slots }) => {
      if (!view_active || chunk_in_frustum(bounds_origin, bounds_edge, view_frustum.planes))
        visible_scratch.push(...slots)
      if (shadow_view_active && chunk_in_frustum(bounds_origin, bounds_edge, shadow_frustum.planes))
        shadow_scratch.push(...slots)
    })
    visible_draw_slots = write_draws(geometry, visible_scratch, visible_draw_slots)
    shadow_draw_slots = write_draws(shadow_geometry, shadow_scratch, shadow_draw_slots)
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

  const remove = (key: string): boolean => {
    details.remove(key)
    if (!release_chunk(key)) return false
    update_buffers()
    rebuild_draws()
    return true
  }

  return Object.freeze({
    set_details_visible: details.set_visible,
    set_visible: (visible: boolean) => {
      mesh.visible = visible
      shadow_mesh.visible = visible
    },
    upload: (chunk: RenderedChunk, data: GreedyMeshData) => {
      const required = Math.ceil(data.quad_count / SLOT_QUADS)
      const reusable = chunk_slots.get(chunk.key)?.slots.length ?? 0
      if (required > MAX_SLOTS) return 'too_large'
      if (required > free_slots.length + reusable) return 'full'
      release_chunk(chunk.key)
      details.retain(chunk.key, chunk.origin, chunk.details)
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
      const bounds_origin = [
        chunk.origin[0] - bounds_margin,
        chunk.origin[1] - bounds_margin,
        chunk.origin[2] - bounds_margin,
      ] as const
      chunk_slots.set(chunk.key, Object.freeze({ bounds_origin, slots: Object.freeze(slots) }))
      update_buffers()
      rebuild_draws()
      return 'uploaded'
    },
    remove,
    set_quality: (next: EngineQuality) => {
      const { kind, texture_size: next_texture_size } = get_quality_profile(next).terrain
      const previous_resources = quality_resources
      // Tier changes do not replace identical terrain materials.
      if (kind === previous_resources.kind && next_texture_size === previous_resources.texture_size) return
      const reuse_texture = next_texture_size === previous_resources.texture_size
      quality_resources = create_quality_resources(
        next,
        reuse_texture ? previous_resources.material_texture : undefined
      )
      details.set_quality(next, quality_resources.material_texture)
      mesh.material = pick_material()
      shadow_mesh.material = pick_material()
      shadow_mesh.castShadow = kind !== 'flat'
      mesh.receiveShadow = kind !== 'flat'
      rebuild_draws()
      dispose_quality_resources(previous_resources, !reuse_texture)
    },
    set_occlusion_active: (active: boolean) => {
      if (active === occlusion_active) return
      occlusion_active = active
      mesh.material = pick_material()
      shadow_mesh.material = pick_material()
    },
    set_view: (camera, shadow_camera) => {
      camera.updateMatrixWorld()
      view_projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      view_frustum.setFromProjectionMatrix(view_projection, camera.coordinateSystem, camera.reversedDepth)
      view_active = true
      shadow_view_active = shadow_camera !== null
      if (shadow_camera) {
        shadow_camera.updateMatrixWorld()
        shadow_view_projection.multiplyMatrices(shadow_camera.projectionMatrix, shadow_camera.matrixWorldInverse)
        shadow_frustum.setFromProjectionMatrix(
          shadow_view_projection,
          shadow_camera.coordinateSystem,
          shadow_camera.reversedDepth
        )
      }
      rebuild_draws()
    },
    count: () => chunk_slots.size,
    dispose: () => {
      scene.remove(mesh, shadow_mesh)
      geometry.dispose()
      shadow_geometry.dispose()
      details.dispose()
      dispose_quality_resources(quality_resources)
      chunk_slots.clear()
      free_slots.length = 0
    },
  })
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, Vector2, type Material, type Scene } from 'three'
import {
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type UniformNode,
  type Node,
  type NodeBuilder,
} from 'three/webgpu'
import {
  Fn,
  abs,
  attribute,
  float,
  max,
  mix,
  positionWorld,
  smoothstep,
  transformNormalToView,
  uniform,
  vec3,
} from 'three/tsl'

import type { Clouds } from './clouds.ts'
import type { FlattenUniform } from './flatten.ts'
import { create_flat_nodes } from './flat_nodes.ts'
import { effective_render_distance, get_quality_profile } from './quality.ts'
import type { create_sky_node } from './sky/sky_node.ts'
import { macro_surface_tint_nodes } from './terrain_tint.ts'
import type { EngineQuality } from './types.ts'
import { CHUNK_EDGE } from './voxel_data.ts'
import type { WorldRecipe } from './world_recipe.ts'

type FarSample = Readonly<{
  id: number
  quality: EngineQuality
  center: readonly [number, number]
  heights: Float32Array
  base_colors: Float32Array
  paired_colors: Float32Array
  roughness: Float32Array
  climate_tint: Float32Array
}>

export type FarTerrain = Readonly<{
  set_focus: (x: number, z: number) => void
  set_quality: (quality: EngineQuality, render_distance: number | null) => void
  ready: () => boolean
  dispose: () => void
}>

/** The shell opens where direct voxel terrain ends — the EFFECTIVE chunk radius, not the tier's. */
export const seam_radius = (far_radius: number): number => far_radius * CHUNK_EDGE - CHUNK_EDGE

/** The hole is carried by the INDEX buffer alone — vertices and attributes never move, so a
 *  render-distance change swaps indices without touching the worker-sampled heights. */
export const ring_indices = (quality: EngineQuality, far_radius: number): number[] => {
  const { horizon_radius, horizon_step } = get_quality_profile(quality).chunks
  const side = Math.floor((horizon_radius * 2) / horizon_step) + 1
  const direct_radius = seam_radius(far_radius)
  const indices: number[] = []
  for (let z = 0; z < side - 1; z += 1) {
    for (let x = 0; x < side - 1; x += 1) {
      const center_x = -horizon_radius + (x + 0.5) * horizon_step
      const center_z = -horizon_radius + (z + 0.5) * horizon_step
      if (Math.max(Math.abs(center_x), Math.abs(center_z)) < direct_radius) continue
      const top_left = z * side + x
      const bottom_left = top_left + side
      indices.push(top_left, top_left + 1, bottom_left, bottom_left, top_left + 1, bottom_left + 1)
    }
  }
  return indices
}

const create_ring_geometry = (quality: EngineQuality, far_radius: number): BufferGeometry => {
  const { horizon_radius, horizon_step } = get_quality_profile(quality).chunks
  const side = Math.floor((horizon_radius * 2) / horizon_step) + 1
  const positions = new Float32Array(side * side * 3)
  for (let z = 0; z < side; z += 1) {
    for (let x = 0; x < side; x += 1) {
      const vertex = (z * side + x) * 3
      positions[vertex] = -horizon_radius + x * horizon_step
      positions[vertex + 2] = -horizon_radius + z * horizon_step
    }
  }
  const indices = ring_indices(quality, far_radius)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('base_color', new BufferAttribute(new Float32Array(positions.length), 3))
  geometry.setAttribute('paired_color', new BufferAttribute(new Float32Array(positions.length), 3))
  geometry.setAttribute('roughness', new BufferAttribute(new Float32Array(side * side), 1))
  geometry.setAttribute('climate_tint', new BufferAttribute(new Float32Array(side * side), 1))
  geometry.setIndex(indices)
  return geometry
}

const build_material = (
  quality: EngineQuality,
  flatten: FlattenUniform,
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction'],
  clouds: Clouds,
  center: UniformNode<'vec2', Vector2>,
  seam: UniformNode<'float', number>
): Material => {
  const material =
    quality === 'low'
      ? new MeshBasicNodeMaterial({ side: DoubleSide })
      : new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.94, metalness: 0 })
  const local = attribute('position', 'vec3' as const)
  const environment_light =
    quality === 'low' ? mix(float(0.32), float(1), smoothstep(-0.14, 0.18, sun_direction.y)) : float(1)
  const base_color = attribute('base_color', 'vec3' as const)
  const paired_color = attribute('paired_color', 'vec3' as const)
  const roughness = attribute('roughness', 'float' as const)
  const climate_tint = attribute('climate_tint', 'float' as const)
  const position_world = { x: local.x.add(center.x), z: local.z.add(center.y) }
  const tint = macro_surface_tint_nodes({ paired_color, roughness, climate_tint, position_world })
  const color = tint.tint_albedo(base_color).mul(environment_light)
  const flat = create_flat_nodes(position_world.x, position_world.z, flatten.amount, color)
  // The shell remains half a block below direct terrain throughout flattening. Sharing y=0
  // made the overlap band z-fight precisely when flat mode needed the clearest grid read.
  const { horizon_step } = get_quality_profile(quality).chunks
  const seam_band = smoothstep(seam, seam.add(float(horizon_step * 2)), max(abs(local.x), abs(local.z)))
  const terrain_y = local.y.sub(float(1).sub(seam_band).mul(8))
  material.positionNode = vec3(local.x, mix(terrain_y, float(-0.5), flatten.amount), local.z)
  const face_normal = positionWorld.dFdx().cross(positionWorld.dFdy()).normalize()
  const upward_normal = face_normal.mul(face_normal.y.greaterThanEqual(0).select(float(1), float(-1)))
  material.normalNode = transformNormalToView(mix(upward_normal, vec3(0, 1, 0), flatten.amount).normalize())
  material.colorNode = flat.color
  if (quality !== 'low')
    material.receivedShadowNode = Fn((args: readonly [Node<'float'>], _builder: NodeBuilder) =>
      args[0].mul(clouds.shadow_at(vec3(position_world.x, 0, position_world.z).xz, local.y))
    ) as unknown as () => Node
  if (quality !== 'low') (material as MeshStandardNodeMaterial).roughnessNode = tint.roughness_node
  return material
}

export const create_far_terrain = ({
  scene,
  quality,
  flatten,
  world,
  sun_direction,
  clouds,
  initial_focus = [0, 0],
}: Readonly<{
  scene: Scene
  quality: EngineQuality
  flatten: FlattenUniform
  world: WorldRecipe
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction']
  clouds: Clouds
  initial_focus?: readonly [number, number]
}>): FarTerrain => {
  const worker = new Worker(new URL('./far_worker.ts', import.meta.url), { type: 'module' })
  const centers = Object.freeze({
    low: uniform(new Vector2()),
    medium: uniform(new Vector2()),
    high: uniform(new Vector2()),
  })
  const tier_radius = (tier: EngineQuality): number =>
    effective_render_distance(get_quality_profile(tier).chunks.far_radius, render_distance)
  let render_distance: number | null = null
  const applied_radii = new Map<EngineQuality, number>()
  const seams = Object.freeze({
    low: uniform(seam_radius(tier_radius('low'))),
    medium: uniform(seam_radius(tier_radius('medium'))),
    high: uniform(seam_radius(tier_radius('high'))),
  })
  const meshes = Object.freeze(
    Object.fromEntries(
      (['low', 'medium', 'high'] as const).map((tier) => {
        applied_radii.set(tier, tier_radius(tier))
        const mesh = new Mesh(
          create_ring_geometry(tier, tier_radius(tier)),
          build_material(tier, flatten, sun_direction, clouds, centers[tier], seams[tier])
        )
        mesh.frustumCulled = false
        mesh.matrixAutoUpdate = false
        mesh.receiveShadow = tier === 'high'
        mesh.visible = false
        scene.add(mesh)
        return [tier, mesh]
      })
    ) as Record<EngineQuality, Mesh>
  )
  /** the hole tracks the effective radius: swap indices + seam uniform, never the vertices */
  const apply_render_distance = (): void => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const radius = tier_radius(tier)
      if (applied_radii.get(tier) === radius) continue
      applied_radii.set(tier, radius)
      meshes[tier].geometry.setIndex(ring_indices(tier, radius))
      seams[tier].value = seam_radius(radius)
    }
  }
  let active_quality = quality
  const initial_step = get_quality_profile(active_quality).chunks.horizon_step
  let desired_center: readonly [number, number] = [
    Math.round(initial_focus[0] / initial_step) * initial_step,
    Math.round(initial_focus[1] / initial_step) * initial_step,
  ]
  let request_id = 0
  let applied_id = 0
  let in_flight_id: number | null = null
  let disposed = false

  const dispatch_latest = (): void => {
    if (in_flight_id !== null) return
    in_flight_id = request_id
    worker.postMessage({ type: 'sample', id: request_id, quality: active_quality, center: desired_center })
  }

  const request = (): void => {
    request_id += 1
    dispatch_latest()
  }

  worker.addEventListener('message', ({ data }: MessageEvent<FarSample>) => {
    if (data.id === in_flight_id) in_flight_id = null
    if (!disposed && data.id === request_id && data.quality === active_quality) {
      applied_id = data.id
      const mesh = meshes[data.quality]
      const positions = mesh.geometry.getAttribute('position') as BufferAttribute
      const position_array = positions.array as Float32Array
      for (let index = 0; index < data.heights.length; index += 1) position_array[index * 3 + 1] = data.heights[index]
      positions.needsUpdate = true
      const base_colors = mesh.geometry.getAttribute('base_color') as BufferAttribute
      ;(base_colors.array as Float32Array).set(data.base_colors)
      base_colors.needsUpdate = true
      const paired_colors = mesh.geometry.getAttribute('paired_color') as BufferAttribute
      ;(paired_colors.array as Float32Array).set(data.paired_colors)
      paired_colors.needsUpdate = true
      const roughness = mesh.geometry.getAttribute('roughness') as BufferAttribute
      ;(roughness.array as Float32Array).set(data.roughness)
      roughness.needsUpdate = true
      const climate_tint = mesh.geometry.getAttribute('climate_tint') as BufferAttribute
      ;(climate_tint.array as Float32Array).set(data.climate_tint)
      climate_tint.needsUpdate = true
      centers[data.quality].value.set(data.center[0], data.center[1])
      mesh.position.set(data.center[0], 0, data.center[1])
      mesh.updateMatrix()
      Object.entries(meshes).forEach(([tier, candidate]) => {
        candidate.visible = tier === active_quality
      })
    }
    if (!disposed && request_id > data.id) dispatch_latest()
  })
  // A failed job never answers, so the in-flight slot would stay taken forever and
  // `dispatch_latest` would refuse every later focus — one exception freezing the far shell
  // for the whole session. Free the slot so the next focus recovers. Deliberately NO retry
  // here: a worker that throws on every message would answer each error with a fresh post.
  worker.addEventListener('error', (event) => {
    console.error('[engine] far-terrain worker failed.', event.error)
    in_flight_id = null
  })
  worker.postMessage({ type: 'initialize', world })
  request()

  return Object.freeze({
    set_focus: (x: number, z: number) => {
      const step = get_quality_profile(active_quality).chunks.horizon_step
      const next = [Math.round(x / step) * step, Math.round(z / step) * step] as const
      if (next[0] === desired_center[0] && next[1] === desired_center[1]) return
      desired_center = next
      request()
    },
    set_quality: (next: EngineQuality, next_render_distance: number | null) => {
      if (next === active_quality && next_render_distance === render_distance) return
      render_distance = next_render_distance
      apply_render_distance()
      if (next === active_quality) return
      active_quality = next
      const step = get_quality_profile(next).chunks.horizon_step
      desired_center = [Math.round(desired_center[0] / step) * step, Math.round(desired_center[1] / step) * step]
      request()
    },
    ready: () => applied_id === request_id && in_flight_id === null,
    dispose: () => {
      disposed = true
      worker.terminate()
      Object.values(meshes).forEach((mesh) => {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as Material).dispose()
      })
    },
  })
}

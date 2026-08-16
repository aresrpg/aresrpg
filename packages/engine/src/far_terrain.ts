// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, Vector2, type Material, type Scene } from 'three'
import {
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshStandardNodeMaterial,
  type UniformNode,
  type Node,
  type NodeBuilder,
} from 'three/webgpu'
import { Fn, attribute, float, mix, smoothstep, transformNormalToView, uniform, uint, vec3 } from 'three/tsl'

import type { Clouds } from './clouds.ts'
import type { FlattenUniform } from './flatten.ts'
import { create_flat_nodes } from './flat_nodes.ts'
import { get_quality_profile } from './quality.ts'
import type { create_sky_node } from './sky/sky_node.ts'
import { macro_tint_nodes, material_color_node } from './terrain_tint.ts'
import type { EngineQuality } from './types.ts'
import { CHUNK_EDGE } from './voxel_data.ts'
import { compile_world_recipe, type WorldRecipe } from './world_recipe.ts'
import type { CompiledMaterials } from './world_materials.ts'

type FarSample = Readonly<{
  id: number
  quality: EngineQuality
  center: readonly [number, number]
  heights: Float32Array
  normals: Float32Array
  material_ids: Float32Array
}>

export type FarTerrain = Readonly<{
  set_focus: (x: number, z: number) => void
  set_quality: (quality: EngineQuality) => void
  ready: () => boolean
  dispose: () => void
}>

const create_ring_geometry = (quality: EngineQuality): BufferGeometry => {
  const { horizon_radius, horizon_step, far_radius } = get_quality_profile(quality).chunks
  const side = Math.floor((horizon_radius * 2) / horizon_step) + 1
  const positions = new Float32Array(side * side * 3)
  const indices: number[] = []
  for (let z = 0; z < side; z += 1) {
    for (let x = 0; x < side; x += 1) {
      const vertex = (z * side + x) * 3
      positions[vertex] = -horizon_radius + x * horizon_step
      positions[vertex + 2] = -horizon_radius + z * horizon_step
    }
  }
  const direct_radius = far_radius * CHUNK_EDGE - CHUNK_EDGE
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
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(positions.length), 3))
  geometry.setAttribute('material_id', new BufferAttribute(new Float32Array(side * side), 1))
  geometry.setIndex(indices)
  return geometry
}

const build_material = (
  quality: EngineQuality,
  flatten: FlattenUniform,
  sun_direction: ReturnType<typeof create_sky_node>['sun_direction'],
  clouds: Clouds,
  center: UniformNode<'vec2', Vector2>,
  materials: CompiledMaterials
): Material => {
  const material =
    quality === 'low'
      ? new MeshBasicNodeMaterial({ side: DoubleSide })
      : quality === 'medium'
        ? new MeshLambertNodeMaterial({ side: DoubleSide })
        : new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.94, metalness: 0 })
  const local = attribute('position', 'vec3' as const)
  const normal = attribute('normal', 'vec3' as const)
  const environment_light =
    quality === 'low' ? mix(float(0.32), float(1), smoothstep(-0.14, 0.18, sun_direction.y)) : float(1)
  const material_id = uint(attribute('material_id', 'float' as const))
  const position_world = { x: local.x.add(center.x), z: local.z.add(center.y) }
  const tint = macro_tint_nodes({ material_id, position_world, materials })
  const color = tint.tint_albedo(material_color_node(materials, material_id)).mul(environment_light)
  const flat = create_flat_nodes(position_world.x, position_world.z, flatten.amount, color)
  // The shell remains half a block below direct terrain throughout flattening. Sharing y=0
  // made the overlap band z-fight precisely when flat mode needed the clearest grid read.
  material.positionNode = vec3(local.x, mix(local.y, float(-0.5), flatten.amount), local.z)
  material.normalNode = transformNormalToView(mix(normal, vec3(0, 1, 0), flatten.amount).normalize())
  material.colorNode = flat.color
  if (quality !== 'low')
    material.receivedShadowNode = Fn((args: readonly [Node<'float'>], _builder: NodeBuilder) =>
      args[0].mul(clouds.shadow_at(vec3(position_world.x, 0, position_world.z).xz, local.y))
    ) as unknown as () => Node
  if (quality === 'high') (material as MeshStandardNodeMaterial).roughnessNode = tint.roughness_node
  return material
}

export const create_far_terrain = ({
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
}>): FarTerrain => {
  const worker = new Worker(new URL('./far_worker.ts', import.meta.url), { type: 'module' })
  const { materials } = compile_world_recipe(world)
  const centers = Object.freeze({
    low: uniform(new Vector2()),
    medium: uniform(new Vector2()),
    high: uniform(new Vector2()),
  })
  const meshes = Object.freeze(
    Object.fromEntries(
      (['low', 'medium', 'high'] as const).map((tier) => {
        const mesh = new Mesh(
          create_ring_geometry(tier),
          build_material(tier, flatten, sun_direction, clouds, centers[tier], materials)
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
  let active_quality = quality
  let desired_center: readonly [number, number] = [0, 0]
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
      const normals = mesh.geometry.getAttribute('normal') as BufferAttribute
      ;(normals.array as Float32Array).set(data.normals)
      normals.needsUpdate = true
      const material_ids = mesh.geometry.getAttribute('material_id') as BufferAttribute
      ;(material_ids.array as Float32Array).set(data.material_ids)
      material_ids.needsUpdate = true
      centers[data.quality].value.set(data.center[0], data.center[1])
      mesh.position.set(data.center[0], 0, data.center[1])
      mesh.updateMatrix()
      Object.entries(meshes).forEach(([tier, candidate]) => {
        candidate.visible = tier === active_quality
      })
    }
    if (!disposed && request_id > data.id) dispatch_latest()
  })
  worker.addEventListener('error', (event) => console.error('[engine] far-terrain worker failed.', event.error))
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
    set_quality: (next: EngineQuality) => {
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

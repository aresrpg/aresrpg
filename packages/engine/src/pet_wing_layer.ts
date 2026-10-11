// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  Vector3,
  type Camera,
  type Object3D,
  type Scene,
} from 'three'

import { create_pet_wing_material } from './pet_wing_material.ts'
import { WING_SHAPES, WING_TRAILS, type PetWingsRender } from './pet_wing_style.ts'
import type { EngineQuality, EntityRender, MobEntityRender } from './types.ts'

const CAPACITY = 128
const QUALITY = {
  low: { range: 24, trails: [1, 4], ghost: 0 },
  medium: { range: 40, trails: [0, 2, 4], ghost: 1 },
  high: { range: 64, trails: [0, 1, 2, 3, 4], ghost: 1 },
} as const

export const advance_wing_deployment = (current: number, deployed: boolean, dt: number): number =>
  Math.max(0, Math.min(1, current + dt * (deployed ? 1 / 0.25 : -1 / 0.2)))

type WingEntity = MobEntityRender & Readonly<{ wings: PetWingsRender }>
const eligible = (spec: EntityRender): spec is WingEntity =>
  spec.kind === 'mob' && spec.wings !== undefined && spec.visible !== false && !spec.visual_effect

type WingPose = Readonly<{ center: Vector3; right: Vector3; up: Vector3; forward: Vector3 }>
const create_batch = (ribbon: boolean) => {
  const capacity = CAPACITY * (ribbon ? 10 : 2)
  const plane = new PlaneGeometry(1, 1, ribbon ? 16 : 1, 1)
  const geometry = new InstancedBufferGeometry()
  geometry.index = plane.index
  geometry.attributes = plane.attributes
  geometry.instanceCount = 0
  const names = ['center', 'right', 'up', 'forward', 'primary', 'secondary', 'shade'] as const
  // One interleaved instance row stays below WebGPU's eight-buffer baseline on every adapter.
  const buffer = new InstancedInterleavedBuffer(new Float32Array(capacity * 29), 29)
  const vectors = Object.fromEntries(
    names.map((name, index) => [name, new InterleavedBufferAttribute(buffer, 3, index * 3)])
  ) as Record<(typeof names)[number], InterleavedBufferAttribute>
  const motion = new InterleavedBufferAttribute(buffer, 4, 21)
  const profile = new InterleavedBufferAttribute(buffer, 4, 25)
  for (const name of names) geometry.setAttribute(`wing_${name}`, vectors[name])
  geometry.setAttribute('wing_motion', motion)
  geometry.setAttribute('wing_profile', profile)
  const material = create_pet_wing_material(ribbon)
  const mesh = new Mesh(geometry, material)
  mesh.name = ribbon ? 'pet-wings:trails' : 'pet-wings:surfaces'
  mesh.visible = false
  mesh.frustumCulled = false
  mesh.renderOrder = ribbon ? 1 : 2
  plane.dispose()
  return {
    mesh,
    write: (
      index: number,
      pose: WingPose,
      style: PetWingsRender,
      progress: number,
      side: number,
      tip: number,
      ghost: number
    ) => {
      for (const name of ['center', 'right', 'up', 'forward'] as const) {
        const point = pose[name]
        vectors[name].setXYZ(index, point.x, point.y, point.z)
      }
      for (const name of ['primary', 'secondary', 'shade'] as const) vectors[name].setXYZ(index, ...style[name])
      motion.setXYZW(index, progress, side, style.scale, tip)
      profile.setXYZW(index, WING_SHAPES.indexOf(style.shape), WING_TRAILS.indexOf(style.trail), style.variant, ghost)
    },
    flush: (count: number) => {
      geometry.instanceCount = count
      mesh.visible = count > 0
      buffer.clearUpdateRanges()
      if (count) buffer.addUpdateRange(0, count * buffer.stride)
      buffer.needsUpdate = true
    },
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}

/** Two bounded batches follow the pet's authored carrying frame, after its animation advances. */
export const create_pet_wing_layer = (
  scene: Scene,
  camera: Camera,
  mount_anchor: (id: string) => Object3D | null,
  initial_quality: EngineQuality
) => {
  const wings = create_batch(false)
  const trails = create_batch(true)
  scene.add(wings.mesh, trails.mesh)
  const deployment = new Map<string, number>()
  const pose = { center: new Vector3(), right: new Vector3(), up: new Vector3(), forward: new Vector3() }
  let specs: readonly WingEntity[] = []
  let quality = initial_quality
  let previous_ms = performance.now()
  return {
    set: (next: readonly EntityRender[]) => {
      specs = next.filter(eligible)
      const retained = new Set(specs.map(({ id }) => id))
      for (const id of deployment.keys()) if (!retained.has(id)) deployment.delete(id)
      if (!specs.length) {
        wings.flush(0)
        trails.flush(0)
      }
    },
    set_quality: (next: EngineQuality) => {
      quality = next
    },
    tick: (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - previous_ms) / 1000))
      previous_ms = now
      const settings = QUALITY[quality]
      let count = 0
      let trail_count = 0
      // Dark membranes use alpha blending: retain the nearest gliders, then draw back to front.
      const visible = specs
        .flatMap((spec) => {
          const progress = advance_wing_deployment(deployment.get(spec.id) ?? 0, spec.wings.deployed, dt)
          if (progress <= 0) return []
          const anchor = mount_anchor(spec.id)
          if (!anchor) return []
          anchor.updateWorldMatrix(true, false)
          const distance = pose.center.setFromMatrixPosition(anchor.matrixWorld).distanceTo(camera.position)
          return distance <= settings.range ? [{ spec, anchor, progress, distance }] : []
        })
        .sort((left, right) => right.distance - left.distance)
        .slice(-CAPACITY)
      const retained = new Set(visible.map(({ spec }) => spec.id))
      for (const id of deployment.keys()) if (!retained.has(id)) deployment.delete(id)
      for (const { spec, anchor, progress } of visible) {
        deployment.set(spec.id, progress)
        pose.center.setFromMatrixPosition(anchor.matrixWorld)
        pose.right.setFromMatrixColumn(anchor.matrixWorld, 0).normalize()
        pose.up.setFromMatrixColumn(anchor.matrixWorld, 1).normalize()
        pose.forward.setFromMatrixColumn(anchor.matrixWorld, 2).normalize()
        wings.write(count++, pose, spec.wings, progress, -1, 0, settings.ghost)
        wings.write(count++, pose, spec.wings, progress, 1, 0, settings.ghost)
        for (const tip of settings.trails) {
          trails.write(trail_count++, pose, spec.wings, progress, -1, tip, settings.ghost)
          trails.write(trail_count++, pose, spec.wings, progress, 1, tip, settings.ghost)
        }
      }
      wings.flush(count)
      trails.flush(trail_count)
    },
    dispose: () => {
      scene.remove(wings.mesh, trails.mesh)
      deployment.clear()
      wings.dispose()
      trails.dispose()
    },
  }
}

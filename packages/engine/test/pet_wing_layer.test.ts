// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Object3D, PerspectiveCamera, Scene, type InstancedBufferGeometry, type Mesh } from 'three'

import { advance_wing_deployment, create_pet_wing_layer } from '../src/pet_wing_layer.ts'
import type { MobEntityRender } from '../src/types.ts'

const glider: MobEntityRender = {
  id: 'pet',
  kind: 'mob',
  model_url: 'pet.glb',
  anchor: { kind: 'world', position: [0, 0, 0] },
  facing: { kind: 'yaw', yaw: 0 },
  wings: {
    deployed: true,
    shape: 'shadow',
    trail: 'smoke',
    primary: [0.72, 0.36, 1],
    secondary: [0.9, 0.7, 1],
    shade: [0.05, 0.01, 0.09],
    scale: 1.55,
    variant: 0.75,
  },
}

test('deployment is fast, frame-rate independent, and cannot overshoot', () => {
  expect(advance_wing_deployment(0, true, 0.25)).toBe(1)
  expect(advance_wing_deployment(1, false, 0.2)).toBe(0)
  expect(advance_wing_deployment(0, true, 10)).toBe(1)
  const step = Array.from({ length: 30 }).reduce<number>(
    (progress) => advance_wing_deployment(progress, true, 1 / 120),
    0
  )
  expect(step).toBeCloseTo(1)
})

test('missing sockets, folding, invisibility and disposal retire bounded batches', () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  camera.position.z = 5
  const anchor = new Object3D()
  let available = false
  const layer = create_pet_wing_layer(scene, camera, () => (available ? anchor : null), 'high')
  const geometry = (name: string) => (scene.getObjectByName(name) as Mesh).geometry as InstancedBufferGeometry
  const wings = geometry('pet-wings:surfaces')
  const trails = geometry('pet-wings:trails')
  let now = performance.now()
  layer.set([glider])
  layer.tick((now += 100))
  expect(wings.instanceCount).toBe(0)
  available = true
  layer.tick((now += 100))
  layer.tick((now += 100))
  expect(wings.instanceCount).toBe(2)
  expect(trails.instanceCount).toBe(10)
  layer.set_quality('low')
  layer.tick((now += 100))
  expect(trails.instanceCount).toBe(4)
  layer.set([{ ...glider, wings: { ...glider.wings!, deployed: false } }])
  layer.tick((now += 50))
  expect(wings.instanceCount).toBe(2)
  layer.tick((now += 100))
  layer.tick((now += 100))
  expect(wings.instanceCount).toBe(0)
  layer.set([{ ...glider, visible: false }])
  layer.tick((now += 100))
  expect(wings.instanceCount).toBe(0)
  layer.set([glider])
  layer.tick(now + 100)
  layer.set([])
  expect(wings.instanceCount).toBe(0)
  layer.dispose()
  expect(scene.children).toHaveLength(0)
})

test('overlapping gliders draw back to front regardless of presence arrival order', () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  const near = new Object3D()
  const far = new Object3D()
  near.position.z = 5
  far.position.z = 10
  const layer = create_pet_wing_layer(scene, camera, (id) => (id === 'near' ? near : far), 'high')
  layer.set([
    { ...glider, id: 'near' },
    { ...glider, id: 'far' },
  ])
  layer.tick(performance.now() + 100)
  const mesh = scene.getObjectByName('pet-wings:surfaces') as Mesh
  const centers = mesh.geometry.getAttribute('wing_center')
  expect(centers.getZ(0)).toBe(10)
  expect(centers.getZ(2)).toBe(5)
  layer.dispose()
})

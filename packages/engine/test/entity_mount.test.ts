// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { AnimationClip, Group, Scene, Vector3, VectorKeyframeTrack } from 'three'

import { create_entity_layer } from '../src/entities.ts'
import type { EntityRender } from '../src/types.ts'

const appearance = {
  body_url: '/rider.glb',
  hair_url: null,
  colors: ['#fff', '#fff', '#fff'] as const,
  worn: { head: null, back: null },
}
const rider: EntityRender = {
  id: 'rider',
  kind: 'character',
  appearance,
  anchor: { kind: 'mount', entity_id: 'pet' },
  facing: { kind: 'yaw', yaw: 0 },
  animation: { name: 'SIT', time_scale: 1 },
}
const pet: EntityRender = {
  id: 'pet',
  kind: 'mob',
  model_url: '/pet.glb',
  anchor: { kind: 'world', position: [7, 3, 11] },
  facing: { kind: 'yaw', yaw: Math.PI / 2 },
  animation: { name: 'RUN', time_scale: 1 },
}

test('a rider follows the animated seat, including yaw and scale, instead of the pet bounds', async () => {
  const scene = new Scene()
  const rider_root = new Group()
  const rider_socket = new Group()
  rider_socket.name = 'Rider'
  rider_socket.position.set(0.1, 0.8, -0.15)
  rider_root.add(rider_socket)
  const pet_root = new Group()
  pet_root.scale.setScalar(2)
  const seat = new Group()
  seat.name = 'Mount'
  seat.position.set(0, 0.5, -0.25)
  seat.rotation.x = 0.4
  pet_root.add(seat)
  const run = new AnimationClip('RUN', 1, [
    new VectorKeyframeTrack('Mount.position', [0, 0.5, 1], [0, 0.5, -0.25, 0, 0.7, -0.25, 0, 0.5, -0.25]),
  ])
  const layer = create_entity_layer({
    scene,
    load_model: async (spec) => ({
      root: spec.id === 'pet' ? pet_root : rider_root,
      clips: spec.id === 'pet' ? [run] : [],
      min_y: spec.id === 'pet' ? -0.2 : -0.1,
      dispose: () => {},
    }),
  })
  layer.set([rider, pet])
  await Promise.resolve()
  await Promise.resolve()
  for (let frame = 0; frame < 15; frame++) {
    layer.tick(performance.now() + frame * 30)
    const actual = rider_socket.getWorldPosition(new Vector3())
    const expected = seat.getWorldPosition(new Vector3())
    expect(actual.distanceTo(expected)).toBeLessThan(1e-6)
    expect(scene.getObjectByName('entity:rider')!.scale.toArray()).toEqual([1, 1, 1])
  }
  layer.set([{ ...rider, visible: false }, pet])
  layer.tick(performance.now() + 460)
  expect(scene.getObjectByName('entity:rider')!.visible).toBeFalse()
  expect(layer.entity_position('rider')).toEqual(scene.getObjectByName('entity:rider')!.position.toArray())
  const eye = scene.getObjectByName('entity:rider')!.localToWorld(new Vector3(0, 1.8, 0))
  expect(new Vector3(...layer.entity_position('rider', 1.8)!).distanceTo(eye)).toBeLessThan(1e-6)
  expect(layer.entity_position('not-loaded')).toBeNull()
  layer.set([{ ...rider, anchor: { kind: 'world', position: [1, 2, 3] } }, pet])
  layer.tick(performance.now() + 500)
  expect(scene.getObjectByName('entity:rider')!.position.toArray()).toEqual([1, 2, 3])
  layer.set([rider])
  layer.tick(performance.now() + 600)
  expect(scene.getObjectByName('entity:rider')!.visible).toBeFalse()
  layer.dispose()
})

test('a missing seat never invents a floating rider position', async () => {
  const scene = new Scene()
  const layer = create_entity_layer({
    scene,
    load_model: async () => ({ root: new Group(), clips: [], min_y: 0, dispose: () => {} }),
  })
  layer.set([pet, rider])
  await Promise.resolve()
  await Promise.resolve()
  layer.tick(performance.now())
  expect(scene.getObjectByName('entity:rider')!.visible).toBeFalse()
  layer.dispose()
})

test('a hidden first-person rider has no camera position until its pet finishes loading', async () => {
  const root = new Group()
  const contact = new Group()
  contact.name = 'Rider'
  contact.position.y = 0.8
  root.add(contact)
  const pet_root = new Group()
  const seat = new Group()
  seat.name = 'Mount'
  seat.position.y = 0.5
  pet_root.add(seat)
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const layer = create_entity_layer({
    scene: new Scene(),
    load_model: async (spec) => {
      if (spec.id === 'pet') await pending
      return { root: spec.id === 'pet' ? pet_root : root, clips: [], min_y: 0, dispose: () => {} }
    },
  })
  layer.set([{ ...rider, visible: false }, pet])
  await Promise.resolve()
  await Promise.resolve()
  expect(layer.entity_position('rider')).toBeNull()
  release()
  await pending
  await Promise.resolve()
  layer.tick(performance.now())
  expect(layer.entity_position('rider')?.[1]).toBeCloseTo(2.7)
  layer.set([{ ...rider, visible: false }])
  expect(layer.entity_position('rider')).toBeNull()
  layer.dispose()
})

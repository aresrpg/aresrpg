// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { AnimationClip, BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene, VectorKeyframeTrack } from 'three'

import { create_entity_layer, resolve_entity_animation_clip } from '../src/entities.ts'

test('a terminal death pose cannot shadow the actual death animation', () => {
  const pose = new AnimationClip('DEATH_POSE', 0.125)
  const death = new AnimationClip('DEATH', 1)
  expect(resolve_entity_animation_clip([pose, death], 'DEATH')).toBe(death)
})

test('weapons and tails cannot move captions sideways from the entity placement anchor', async () => {
  const root = new Group()
  const body = new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial())
  body.position.y = 1
  const weapon = new Mesh(new BoxGeometry(2, 0.1, 0.1), new MeshBasicMaterial())
  weapon.position.set(-2, 0.8, 0)
  root.add(body, weapon)
  const layer = create_entity_layer({
    scene: new Scene(),
    load_model: () => Promise.resolve({ root, clips: [], min_y: 0, dispose: () => {} }),
  })
  layer.set([
    {
      id: 'armed_skeleton',
      kind: 'mob',
      model_url: '/moka.glb',
      anchor: { kind: 'world', position: [7, 3, 11] },
      facing: { kind: 'yaw', yaw: Math.PI / 2 },
    },
  ])
  await Promise.resolve()
  await Promise.resolve()
  expect(layer.world_anchor('armed_skeleton')?.toArray()).toEqual([7, 5, 11])
  expect(layer.live_crown('armed_skeleton')?.toArray()).toEqual([7, 5, 11])
  body.position.y = 2
  expect(layer.live_crown('armed_skeleton')?.toArray()).toEqual([7, 6, 11])
  layer.dispose()
})

test('an explicitly looped action repeats without restarting on repeated entity specs', async () => {
  const root = new Group()
  const motion = new Group()
  motion.name = 'motion'
  root.add(motion)
  const clip = new AnimationClip('DEATH', 0.2, [
    new VectorKeyframeTrack('motion.position', [0, 0.2], [0, 0, 0, 2, 0, 0]),
  ])
  const layer = create_entity_layer({
    scene: new Scene(),
    load_model: async () => ({ root, clips: [clip], min_y: 0, dispose: () => {} }),
  })
  const spec = {
    id: 'preview',
    kind: 'mob' as const,
    model_url: '/preview.glb',
    anchor: { kind: 'world' as const, position: [0, 0, 0] as const },
    facing: { kind: 'yaw' as const, yaw: 0 },
    animation: { name: 'DEATH' as const, time_scale: 1, loop: true },
  }
  layer.set([spec])
  await Promise.resolve()
  await Promise.resolve()
  layer.tick(1_000_000)
  layer.tick(1_000_100)
  expect(motion.position.x).toBeCloseTo(0, 5)
  layer.tick(1_000_150)
  layer.set([spec])
  layer.tick(1_000_200)
  expect(motion.position.x).toBeCloseTo(1, 5)
  layer.set([{ ...spec, animation: { ...spec.animation, loop: false } }])
  layer.tick(1_000_300)
  layer.tick(1_000_400)
  layer.tick(1_000_500)
  expect(motion.position.x).toBeCloseTo(2, 5)
  layer.set([{ ...spec, animation: { ...spec.animation, loop: false } }])
  layer.tick(1_000_550)
  expect(motion.position.x).toBeCloseTo(2, 5)
  const replay = layer.beat('preview', 'death')
  layer.tick(1_000_600)
  expect(motion.position.x).toBeCloseTo(0.5, 5)
  layer.dispose()
  expect(await replay).toBeFalse()
})

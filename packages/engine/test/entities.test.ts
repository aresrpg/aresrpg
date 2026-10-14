// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { AnimationClip, BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene, VectorKeyframeTrack } from 'three'

import { create_entity_layer, resolve_entity_animation_clip } from '../src/entities.ts'

test('Prime Machin resolves its authored run instead of idle or jump-run', () => {
  const bytes = readFileSync(new URL('../../../seed/models/pets/primemachin.glb', import.meta.url))
  const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
    animations: readonly { name: string }[]
  }
  const clips = model.animations.map(({ name }) => new AnimationClip(name, 1))
  for (const action of ['RUN', 'WALK', 'JUMP_RUN', 'JUMP', 'FALL', 'ATTACK', 'DEATH', 'SIT', 'DANCE'] as const)
    expect(resolve_entity_animation_clip(clips, action)?.name, action).toBe(action)
})

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

test('spell windup reaches the model release marker before normal-speed recovery', async () => {
  const root = new Group(),
    motion = new Group()
  motion.name = 'draw'
  root.add(motion)
  const attack = new AnimationClip('ATTACK', 1, [new VectorKeyframeTrack('draw.position', [0, 1], [0, 0, 0, 1, 0, 0])])
  Reflect.set(attack, 'userData', { release_seconds: 0.4 })
  const idle = new AnimationClip('IDLE', 1, [new VectorKeyframeTrack('draw.position', [0, 1], [0, 0, 0, 0, 0, 0])])
  const layer = create_entity_layer({
    scene: new Scene(),
    load_model: async () => ({ root, clips: [idle, attack], min_y: 0, dispose: () => {} }),
  })
  layer.set([
    {
      id: 'caster',
      kind: 'mob',
      model_url: '/body.glb',
      anchor: { kind: 'world', position: [0, 0, 0] },
      facing: { kind: 'yaw', yaw: 0 },
    },
  ])
  await layer.prepare_attack('caster')
  layer.tick(10000)
  const finished = layer.beat('caster', 'attack', undefined, false, 1.2)
  for (let time = 10050; time <= 11200; time += 50) layer.tick(time)
  expect(motion.position.x).toBeCloseTo(0.4)
  layer.tick(11300)
  expect(motion.position.x).toBeCloseTo(0.5)
  for (let time = 11350; time <= 12000; time += 50) layer.tick(time)
  expect(await finished).toBeTrue()
  expect(motion.position.x).toBeCloseTo(0)
  layer.dispose()
})

test('death finishes before its render resources are removed', async () => {
  const scene = new Scene(),
    root = new Group()
  let releases = 0
  const layer = create_entity_layer({
    scene,
    load_model: async () => ({
      root,
      clips: [new AnimationClip('DEATH', 1)],
      min_y: 0,
      dispose: () => {
        releases += 1
      },
    }),
  })
  layer.set([
    {
      id: 'dying',
      kind: 'mob',
      model_url: '/body.glb',
      anchor: { kind: 'world', position: [0, 0, 0] },
      facing: { kind: 'yaw', yaw: 0 },
    },
  ])
  await layer.prepare_attack('dying')
  layer.tick(10000)
  const death = layer.beat('dying', 'death')
  expect(releases).toBe(0)
  expect(root.parent).not.toBeNull()
  layer.tick(11100)
  expect(await death).toBeTrue()
  layer.set([])
  expect(releases).toBe(1)
  layer.dispose()
  expect(releases).toBe(1)
})

test('an interrupted displacement never teleports to its unfinished destination', async () => {
  const root = new Group()
  const layer = create_entity_layer({
    scene: new Scene(),
    load_model: async () => ({ root, clips: [], min_y: 0, dispose: () => {} }),
  })
  layer.set_board({
    width: 3,
    height: 1,
    cell_size: 1,
    origin: { x: 0, y: 0, z: 0 },
    cells: [0, 1, 2].map((cell) => ({ cell, x: cell, y: 0, kind: 'floor' })),
  })
  const spec = {
    id: 'caster',
    kind: 'mob',
    model_url: '/body.glb',
    anchor: { kind: 'fight_cell', cell: 0 },
    facing: { kind: 'yaw', yaw: 0 },
  } as const
  layer.set([spec])
  await layer.prepare_attack('caster')
  layer.tick(10000)
  const moved = layer.animate({ id: 'caster', cells: [1, 2], gait: 'slide' })
  layer.tick(10050)
  layer.set([{ ...spec, anchor: { kind: 'fight_cell', cell: 2 } }])
  const [before] = layer.entity_position('caster')!
  const cast = layer.beat('caster', 'attack')
  expect(layer.entity_position('caster')?.[0]).toBeCloseTo(before)
  expect(before).toBeLessThan(2.5)
  expect(await moved).toBeFalse()
  layer.dispose()
  expect(await cast).toBeFalse()
})

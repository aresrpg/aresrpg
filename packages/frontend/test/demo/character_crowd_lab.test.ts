// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { crowd_benchmark_entity, crowd_benchmark_result } from '../../src/demo/CharacterCrowdLab.tsx'

const actor = Object.freeze({
  id: 'crowd_0',
  appearance: Object.freeze({
    body_url: '/body.glb',
    hair_url: '/hair.glb',
    colors: Object.freeze(['#fff', '#888', '#111'] as const),
    worn: Object.freeze({ head: null, back: null }),
  }),
  x: 2,
  y: 3,
  z: 4,
  offset: 0,
})
const world_position = (entity: ReturnType<typeof crowd_benchmark_entity>) =>
  entity.anchor.kind === 'world' ? entity.anchor.position : null

test('crowd benchmark drives real moving, jumping, and dance entity specs', () => {
  const running = crowd_benchmark_entity(actor, 'run', 1_000)
  const jumping = crowd_benchmark_entity(actor, 'jump', 1_000)
  const dancing = crowd_benchmark_entity(actor, 'dance', 1_000)

  expect(running.animation?.name).toBe('RUN')
  expect(world_position(running)).not.toEqual([2, 3, 4])
  expect(jumping.animation?.name).toBe('JUMP')
  expect(world_position(jumping)?.[1]).toBeGreaterThan(3)
  expect(dancing.animation?.name).toBe('DANCE')
  expect(world_position(dancing)).toEqual([2, 3, 4])
})

test('crowd benchmark reports average FPS and the slow-frame tail', () => {
  expect(crowd_benchmark_result('run', [16, 16, 16, 32])).toEqual({
    phase: 'run',
    fps: 50,
    p95_ms: 16,
    max_ms: 32,
    switch_ms: 0,
  })
})

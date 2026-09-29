// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { walking_edge } from '../../src/game/core/walkable.ts'
import { walkable_spawn_height } from '../../src/game/core/collision.ts'

test('wandering mobs stay outside a raised wall instead of teleporting through its columns', async () => {
  const original = globalThis.requestAnimationFrame
  const frames: FrameRequestCallback[] = []
  globalThis.requestAnimationFrame = (callback) => frames.push(callback)
  const { create_spawn_renderer } = await import('../../src/game/spawn_entities.ts')
  const positions: number[] = []
  const solid_at = (x: number, y: number) => y < 0 || (x >= 2 && y < 4)
  publish_pose({ character_id: 'observer', x: 0, y: 0, z: 0, yaw: 0, riding: false, time_of_day: 0.5 })
  const renderer = create_spawn_renderer({
    submit: (entities) => {
      for (const entity of entities) {
        if (entity.anchor.kind === 'world') positions.push(entity.anchor.position[0])
      }
    },
    ground_height: () => 0.001,
    entity_height: () => 2,
    label: () => undefined,
    model_for: () => ({ model_url: 'goblin.glb', variant: null }),
    walk_step: (from, x, z) =>
      walking_edge({ solid_at, liquid_at: () => false, ready: () => true, ground_height: () => 0 }, from, x, z),
  })
  try {
    renderer.update([{ id: 'pack', x: 0.5, z: 0.5, members: [{ mob_type: 'goblin', level_scalar: 0 }] }])
    let now = performance.now()
    for (let step = 0; step < 1000; step += 1) {
      now += 250
      frames.shift()?.(now)
    }
    expect(positions.length).toBeGreaterThan(100)
    expect(Math.max(...positions)).toBeLessThan(2)
    expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(0.5)
    expect(walkable_spawn_height(solid_at, 2, 0, 0)).toBe(4)
  } finally {
    renderer.dispose()
    publish_pose(null)
    globalThis.requestAnimationFrame = original
  }
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_controller_state } from '@aresrpg/engine/locomotion/controller'
import { walkable_spawn_height } from '@aresrpg/engine/locomotion/collision'
import type { WalkWorld } from '@aresrpg/engine/locomotion/walkable'

import { begin_idle, step_idle } from '../src/idle.ts'

const flat_world = (): WalkWorld => {
  const solid_at = (_x: number, y: number) => y < 0
  return {
    solid_at,
    liquid_at: () => false,
    ready: () => true,
    ground_height: (x, z, anchor_y = 0) => walkable_spawn_height(solid_at, x, anchor_y, z),
  }
}

test('open-ground idle starts immediately and varies gait and heading without scheduled rests', () => {
  let seed = 42
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const world = flat_world()
  let body = create_controller_state([0, 0, 0])
  let state = begin_idle(body.position, 0, random)
  const speeds: number[] = []
  let stationary_ms = 0
  let longest_rest = 0
  let curved_steps = 0
  for (let now = 100; now <= 90000; now += 100) {
    const step = step_idle(world, body, body.position, state, now, 100, random, false)
    const distance = Math.hypot(step.position[0] - body.position[0], step.position[2] - body.position[2])
    if (now === 100) expect(distance).toBeGreaterThan(0)
    stationary_ms = distance < 0.001 ? stationary_ms + 100 : 0
    longest_rest = Math.max(longest_rest, stationary_ms)
    if (step.motion.body.on_ground) speeds.push(step.motion.body.speed)
    if (step.state.change_at === state.change_at && Math.abs(step.state.yaw - state.yaw) > 0.01) curved_steps += 1
    expect(Math.hypot(step.position[0], step.position[2])).toBeLessThanOrEqual(50)
    ;({ body } = step.motion)
    ;({ state } = step)
  }
  expect(longest_rest).toBeLessThan(300)
  expect(speeds.some((speed) => Math.abs(speed - 4.8) < 0.1)).toBe(true)
  expect(speeds.some((speed) => Math.abs(speed - 10.5) < 0.1)).toBe(true)
  expect(curved_steps).toBeGreaterThan(10)
})

for (const hazard of ['wall', 'water', 'cliff', 'radius']) {
  test(`airborne idle keeps gravity and turns away from ${hazard}`, () => {
    const flat = flat_world()
    const world: WalkWorld = {
      ...flat,
      solid_at: (x, y, z) => (flat.solid_at(x, y, z) && (hazard !== 'cliff' || x < 1)) || (hazard === 'wall' && x >= 1),
      liquid_at: (x) => hazard === 'water' && x >= 1,
    }
    let body = {
      ...create_controller_state([hazard === 'radius' ? 49.9 : 0.5, 4, 0]),
      velocity: [8, -1, 0] as [number, number, number],
    }
    let state = { ...begin_idle([0, 0, 0], 0, () => 0.25), yaw: -Math.PI / 2, change_at: 10000, jump_at: Infinity }
    const first = step_idle(world, body, body.position, state, 100, 100, () => 0.25, true)
    expect(first.position[0]).toBe(body.position[0])
    expect(first.position[1]).toBeLessThan(body.position[1])
    expect(first.gliding).toBe(false)
    expect(first.motion).not.toBeNull()
    ;({ body } = first.motion)
    ;({ state } = first)
    for (let now = 200; now <= 3000; now += 100) {
      const step = step_idle(world, body, body.position, state, now, 100, () => 0.25, true)
      expect(Math.hypot(step.position[0], step.position[2])).toBeLessThanOrEqual(50)
      if (hazard !== 'radius') expect(step.position[0]).toBeLessThan(1)
      ;({ body } = step.motion)
      ;({ state } = step)
    }
    expect(body.position[1]).toBeCloseTo(0)
    expect(Math.hypot(body.position[0] - first.position[0], body.position[2] - first.position[2])).toBeGreaterThan(1)
  })
}

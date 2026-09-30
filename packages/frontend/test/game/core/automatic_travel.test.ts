// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { MOUNT_SPEED_SCALE } from '../../../src/game/core/controller.ts'
import { create_character_controller } from '../../../src/game/core/character.ts'
import { begin_walking, step_walking } from '../../../src/game/core/walking.ts'
import { step_walking_follower } from '../../../src/game/core/walking_follower.ts'

const world = {
  solid_at: (x: number, y: number) => y < 0 || (x >= 2 && x <= 5 && y < 6),
  liquid_at: () => false,
  ready: () => true,
  ground_height: () => 0,
}
const start = [0.5, 0.001, 0.5] as const
const target = { x: 10.5, z: 0.5 }

test('run-to crosses an impassable wall at bounded speed and returns to collision walking', () => {
  const character = create_character_controller({ ...world, position: start })
  let walking = begin_walking(start, target)
  let clipped = false
  let resumed = false
  let arrived = false
  for (let frame = 0; frame < 600; frame++) {
    const before = character.get_transform().position
    const step = step_walking(world, walking, before, target, 1 / 60)
    walking = step.state
    clipped ||= step.phase_target != null
    resumed ||= clipped && step.status === 'walking' && step.phase_target === null
    character.set_input({ yaw: step.yaw, forward: step.forward, phase_target: step.phase_target })
    character.tick(1 / 60)
    const after = character.get_transform().position
    expect(Math.hypot(...after.map((value, index) => value - before[index]!))).toBeLessThanOrEqual(10.5 / 60 + 0.001)
    if (step.status === 'arrived') {
      arrived = true
      break
    }
  }
  expect(clipped).toBe(true)
  expect(resumed).toBe(true)
  expect(arrived).toBe(true)
  character.dispose()
})

test('a follower retargets while clipping and reaches its moving leader', () => {
  let position: readonly [number, number, number] = start
  let motion: Parameters<typeof step_walking_follower>[1] = null
  for (let frame = 0; frame < 600; frame++) {
    const next = step_walking_follower(world, motion, position, { x: 10.5, z: frame < 40 ? 0.5 : 4.5 }, 1000 / 60)
    ;({ position, motion } = next)
  }
  expect(Math.hypot(position[0] - 10.5, position[2] - 4.5)).toBeLessThan(0.2)
})

test('cancelling clipping leaves the current position and a new target escapes the wall', () => {
  const character = create_character_controller({ ...world, position: start })
  character.teleport([3.5, 0.001, 0.5], { eject: false })
  character.set_input({ phase_target: null, forward: 0 })
  expect(character.get_transform().position).toEqual([3.5, 0.001, 0.5])
  let walking = begin_walking(character.get_transform().position, target)
  for (let frame = 0; frame < 600; frame++) {
    const step = step_walking(world, walking, character.get_transform().position, target, 1 / 60)
    walking = step.state
    character.set_input({ yaw: step.yaw, forward: step.forward, phase_target: step.phase_target })
    character.tick(1 / 60)
    if (step.status === 'arrived') break
  }
  expect(character.get_transform().position[0]).toBeGreaterThan(10.3)
  character.dispose()
})

test('clipping respects movement boundaries without snapping the player elsewhere', () => {
  const character = create_character_controller({ ...world, position: start })
  character.set_movement_area((x) => x < 2)
  character.set_input({ forward: 1, yaw: -Math.PI / 2, phase_target: [10, 0, 0.5] })
  for (let frame = 0; frame < 120; frame++) character.tick(1 / 60)
  expect(character.get_transform().position[0]).toBeLessThan(2)
  expect(character.get_transform().position[0]).toBeGreaterThan(1.5)
  character.dispose()
})

test('a direct segment samples its height once and waits when its collision data becomes unavailable', () => {
  let height_reads = 0
  const sampled_world = {
    ...world,
    ground_height: () => {
      height_reads++
      return 0
    },
  }
  let position: readonly [number, number, number] = [3, 0, 0.5]
  let motion: Parameters<typeof step_walking_follower>[1] = null
  for (let frame = 0; frame < 5; frame++) {
    const step = step_walking_follower(sampled_world, motion, position, target, 1000 / 60)
    ;({ position, motion } = step)
  }
  expect(height_reads).toBe(1)
  expect(position[0]).toBeGreaterThan(3)
  const paused = step_walking_follower({ ...sampled_world, ready: () => false }, motion, position, target, 100)
  expect(paused.position).toEqual(position)
})

test.each([30, 60, 120])('obstacle detours keep running between waypoints at %i FPS', (fps) => {
  const detour_world = {
    ...world,
    solid_at: (x: number, y: number, z: number) => y < 0 || (x === 4 && y < 4 && z >= -1 && z <= 1),
  }
  const goal = { x: 20.5, z: 0.5 }
  // Twenty blocks and this short detour fit in three simulated seconds; waypoint circling does not.
  for (const speed_scale of [1, MOUNT_SPEED_SCALE]) {
    const character = create_character_controller({ ...detour_world, position: start })
    let walking = begin_walking(start, goal)
    let arrived = false
    for (let frame = 0; frame < fps * 3; frame++) {
      const { position } = character.get_transform()
      const step = step_walking(detour_world, walking, position, goal, 1 / fps)
      walking = step.state
      if (step.status === 'arrived') {
        arrived = true
        break
      }
      if (step.status === 'walking' && Math.hypot(goal.x - position[0], goal.z - position[2]) > 2)
        expect(step.forward).toBe(1)
      character.set_input({ yaw: step.yaw, forward: step.forward, phase_target: step.phase_target, speed_scale })
      character.tick(1 / fps)
    }
    expect(arrived).toBe(true)
    character.dispose()
  }
})

test.each([30, 60, 120])('leader follow keeps running through the same detour at %i FPS', (fps) => {
  const detour_world = {
    ...world,
    solid_at: (x: number, y: number, z: number) => y < 0 || (x === 4 && y < 4 && z >= -1 && z <= 1),
  }
  const goal = { x: 20.5, z: 0.5 }
  let position: readonly [number, number, number] = start
  let motion: Parameters<typeof step_walking_follower>[1] = null
  for (let frame = 0; frame < fps * 3; frame++) {
    const next = step_walking_follower(detour_world, motion, position, goal, 1000 / fps)
    ;({ position, motion } = next)
  }
  expect(Math.hypot(position[0] - goal.x, position[2] - goal.z)).toBeLessThan(0.2)
})

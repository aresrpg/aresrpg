// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { step_walking_follower } from '../../../src/game/core/walking_follower.ts'
import type { WalkPoint, WalkWorld } from '../../../src/game/core/walkable.ts'

const floor: WalkWorld = {
  solid_at: (_x, y) => y < 0,
  liquid_at: () => false,
  ready: () => true,
  ground_height: () => 0,
}
const start: WalkPoint = [0.5, 0.001, 0.5]

test('open-ground following only probes local clearance, independent of leader distance', () => {
  let reads = 0
  const columns = new Set<number>()
  const world: WalkWorld = {
    ...floor,
    solid_at: (x, y) => {
      reads++
      columns.add(Math.floor(x))
      return y < 0
    },
  }
  const result = step_walking_follower(world, null, start, { x: 100.5, z: 0.5 }, 1000 / 60)
  // Local clearance plus one physics step, independent of leader distance.
  expect(reads).toBeLessThan(1000)
  expect(Math.max(...columns)).toBeLessThanOrEqual(2)
  expect(result.position[0]).toBeGreaterThan(start[0])
})

test('followers cross an impassable wall and only claim arrival after crossing', () => {
  const world: WalkWorld = { ...floor, solid_at: (x, y) => y < 0 || (x === 3 && y < 4) }
  let motion: Parameters<typeof step_walking_follower>[1] = null
  let position = start
  let distance = 0
  for (let tick = 0; tick < 120; tick++) {
    const result = step_walking_follower(world, motion, position, { x: 4.5, z: 0.5 }, 1000 / 60)
    ;({ motion, position, distance } = result)
  }
  expect(position[0]).toBeGreaterThan(4.3)
  expect(distance).toBeLessThan(0.2)
})

test('unknown terrain suspends followers without physics probes or movement', () => {
  let reads = 0
  const world: WalkWorld = {
    ...floor,
    ready: () => false,
    solid_at: () => {
      reads++
      return false
    },
  }
  const result = step_walking_follower(world, null, start, { x: 100, z: 0.5 }, 100)
  expect(result.position).toEqual(start)
  expect(result.distance).toBe(Infinity)
  expect(reads).toBe(0)
})

test.each(['water', 'cliff'] as const)('direct following crosses %s when no easy walking route exists', (hazard) => {
  const world: WalkWorld = {
    ...floor,
    solid_at: (x, y) => y < (hazard === 'cliff' && x >= 3 ? -8 : 0),
    liquid_at: (x) => hazard === 'water' && x >= 3,
    ground_height: (x) => (hazard === 'cliff' && x >= 3 ? -8 : 0),
  }
  let motion: Parameters<typeof step_walking_follower>[1] = null
  let position = start
  for (let tick = 0; tick < 240; tick++) {
    const result = step_walking_follower(world, motion, position, { x: 10, z: 0.5 }, 1000 / 60)
    ;({ motion, position } = result)
  }
  expect(position[0]).toBeGreaterThan(9.8)
  expect(position[1]).toBeCloseTo(hazard === 'cliff' ? -8 : 0, 1)
})

test('a zero-time follower update does not move or search', () => {
  expect(step_walking_follower(floor, null, start, { x: 100, z: 100 }, 0).position).toEqual(start)
})

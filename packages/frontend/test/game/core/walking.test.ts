// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { advance_walking_search, begin_walking_search } from '../../../src/game/core/walking_route.ts'
import { walking_edge, type WalkWorld, type WalkPoint } from '../../../src/game/core/walkable.ts'
import { begin_walking, step_walking } from '../../../src/game/core/walking.ts'
import { create_controller_state, move_direction, step_controller } from '../../../src/game/core/controller.ts'

const floor: WalkWorld = {
  solid_at: (_x, y) => y < 0,
  liquid_at: () => false,
  ready: () => true,
  ground_height: () => 0,
}
const start: WalkPoint = [0.5, 0.001, 0.5]
const target = { x: 8.5, z: 0.5 }
const wall: WalkWorld = { ...floor, solid_at: (x, y, z) => y < 0 || (x === 4 && y < 4 && z >= -3 && z <= 3) }
const solve = (world: WalkWorld, origin = start, goal = target) => {
  let search = begin_walking_search(origin, goal)
  for (let frame = 0; frame < 1000; frame += 1) {
    const result = advance_walking_search(world, search)
    if (result.type !== 'searching') return result
    ;({ search } = result)
  }
  throw new Error('Search did not terminate within its frame budget')
}

test('walks around a wall using edges accepted by the real collision solver', () => {
  const result = solve(wall)
  expect(result.type).toBe('route')
  if (result.type !== 'route') return
  expect(result.path.some((point) => Math.abs(point[2]) > 3)).toBe(true)
  result.path
    .slice(1)
    .forEach((point, index) => expect(walking_edge(wall, result.path[index]!, point[0], point[2])).toEqual(point))
})

test('unknown collision never becomes an open route', () => {
  expect(solve({ ...floor, ready: () => false }).type).toBe('waiting')
})

test('steps climb one block, but walking refuses walls, water and cliffs', () => {
  expect(walking_edge({ ...floor, solid_at: (x, y) => y < (x > 0 ? 1 : 0) }, start, 1.5, 0.5)?.[1]).toBeCloseTo(1, 2)
  expect(walking_edge({ ...floor, solid_at: (x, y) => y < (x > 0 ? 2 : 0) }, start, 1.5, 0.5)).toBeNull()
  expect(walking_edge({ ...floor, solid_at: (x, y) => y < (x > 0 ? -8 : 0) }, start, 1.5, 0.5)).toBeNull()
  expect(walking_edge({ ...floor, liquid_at: () => true }, start, 1.5, 0.5)).toBeNull()
})

test('bridge and tunnel routes retain the starting vertical layer', () => {
  const bridge: WalkWorld = { ...floor, solid_at: (_x, y) => y < 0 || y === 4 }
  const lower = solve(bridge)
  const upper = solve(bridge, [0.5, 5.001, 0.5])
  expect(lower.type).toBe('route')
  expect(upper.type).toBe('route')
  if (lower.type === 'route') expect(lower.path.every((point) => point[1] < 1)).toBe(true)
  if (upper.type === 'route') expect(upper.path.every((point) => point[1] > 4.99)).toBe(true)
})

test('enclosed start stops without a fabricated arrival', () => {
  const room: WalkWorld = {
    ...floor,
    solid_at: (x, y, z) => y < 0 || (y < 4 && (Math.abs(x) === 2 || Math.abs(z) === 2)),
  }
  expect(solve(room).type).toBe('blocked')
})

for (const speed_scale of [1, 1.5])
  test(`the real controller follows the detour at speed scale ${speed_scale}`, () => {
    const body = create_controller_state([...start])
    let route = begin_walking(start, target)
    let status = ''
    for (let frame = 0; frame < 3600; frame += 1) {
      const step = step_walking(wall, route, body.position, target, 1 / 60)
      ;({ state: route, status } = step)
      if (status === 'arrived') break
      expect(step.phase_target).toBeNull()
      step_controller(
        body,
        {
          yaw: step.yaw,
          forward: step.forward,
          strafe: 0,
          jump: false,
          glide: false,
          walk: false,
          speed_scale,
          phase_target: step.phase_target,
        },
        wall,
        1 / 60
      )
    }
    expect(status).toBe('arrived')
    expect(Math.hypot(body.position[0] - target.x, body.position[2] - target.z)).toBeLessThan(0.2)
  })

test('analog movement preserves braking input while diagonal keyboard input stays bounded', () => {
  expect(move_direction(0.1, 0, 0)).toEqual([0, -0.1])
  expect(Math.hypot(...move_direction(1, 1, 0))).toBeCloseTo(1)
})

test('a blocked route cannot claim arrival just because the target is close through a wall', () => {
  const enclosed: WalkWorld = {
    ...floor,
    solid_at: (x, y, z) => y < 0 || (y < 4 && (x === 1 || x === -1 || z === 1 || z === -1)),
  }
  expect(solve(enclosed, start, { x: 2, z: 0.5 }).type).toBe('blocked')
})

test('a newly blocked segment switches to direct travel when no easy detour exists', () => {
  let state = begin_walking(start, target)
  for (let frame = 0; frame < 100 && state.search; frame += 1) {
    ;({ state } = step_walking(floor, state, start, target, 1 / 60))
  }
  const blocked: WalkWorld = {
    ...floor,
    solid_at: (x, y, z) => y < 0 || (y < 4 && (x === 1 || x === -1 || z === 1 || z === -1)),
  }
  let result = step_walking(blocked, state, start, target, 1 / 60)
  for (let frame = 0; frame < 100 && result.phase_target === null; frame += 1)
    result = step_walking(blocked, result.state, start, target, 1 / 60)
  expect(result.status).toBe('walking')
  expect(result.phase_target).not.toBeNull()
})

test.each([90, 144])('walking across a one-block dip uses physics positions at %s FPS', async (fps) => {
  const { create_character_controller } = await import('../../../src/game/core/character.ts')
  const world = { ...floor, solid_at: (x: number, y: number) => y < (x >= 4 ? -1 : 0) }
  const character = create_character_controller({ ...world, position: start })
  const target = { x: 10.5, z: 0.5 }
  let route = begin_walking(character.get_transform().position, target)
  let status: string = 'planning'
  for (let frame = 0; frame < fps * 20; frame += 1) {
    const step = step_walking(world, route, character.get_transform().position, target, 1 / fps)
    ;({ state: route, status } = step)
    character.set_input({ forward: step.forward, yaw: step.yaw, phase_target: step.phase_target })
    character.tick(1 / fps)
    if (status === 'arrived') break
  }
  character.dispose()
  expect(status).toBe('arrived')
})

test('a distant destination only requires collision inside the next local leg', () => {
  const local: WalkWorld = {
    ...floor,
    ready: ({ min_x, max_x, min_z, max_z }) => min_x >= -34 && max_x <= 34 && min_z >= -34 && max_z <= 34,
  }
  const result = solve(local, start, { x: 10_000, z: 10_000 })
  expect(result.type).toBe('route')
  if (result.type !== 'route') return
  const end = result.path.at(-1)!
  expect(Math.max(Math.abs(end[0] - start[0]), Math.abs(end[2] - start[2]))).toBeLessThanOrEqual(8)
  expect(end[0] + end[2]).toBeGreaterThan(start[0] + start[2])
})

test('a nearby zone boundary ends the leg before planning through the next zone', () => {
  // Client x=176 is chain x=50176, a canonical 512-block zone boundary.
  const result = solve(floor, [175.5, 0.001, 0.5], { x: 1000, z: 0.5 })
  expect(result.type).toBe('route')
  if (result.type !== 'route') return
  expect(result.path.at(-1)![0]).toBe(176.5)
})

test('a blocked preferred exit can use another walkable point on that edge', () => {
  const local: WalkWorld = {
    ...floor,
    solid_at: (x, y, z) => y < 0 || (x === 8 && y < 4 && Math.abs(z) <= 2),
  }
  const result = solve(local, start, { x: 10_000, z: 0.5 })
  expect(result.type).toBe('route')
  if (result.type !== 'route') return
  expect(result.path.at(-1)![0]).toBe(8.5)
  expect(Math.abs(result.path.at(-1)![2])).toBeGreaterThan(2)
})

test('rolling local legs cross zones and only report arrival at the real destination', () => {
  const goal = { x: 300.5, z: 0.5 }
  const body = create_controller_state([...start])
  let state = begin_walking(start, goal)
  let status = ''
  let partial = false
  for (let tick = 0; tick < 60 * 60; tick++) {
    const result = step_walking(wall, state, body.position, goal, 1 / 60)
    ;({ state, status } = result)
    if (status === 'arrived') break
    if (status === 'walking' && result.remaining === null) partial = true
    step_controller(
      body,
      {
        yaw: result.yaw,
        forward: result.forward,
        strafe: 0,
        jump: false,
        glide: false,
        walk: false,
        speed_scale: 1,
      },
      wall,
      1 / 60
    )
  }
  expect(partial).toBe(true)
  expect(status).toBe('arrived')
  expect(Math.hypot(body.position[0] - goal.x, body.position[2] - goal.z)).toBeLessThan(0.2)
})

test('an unobstructed distant diagonal plans locally within two frame slices', () => {
  const origin: WalkPoint = [0.1234567, 0.001, -0.1234567]
  let search = begin_walking_search(origin, { x: 10_000, z: 10_000 })
  let result = advance_walking_search(floor, search)
  if (result.type === 'searching') {
    ;({ search } = result)
    result = advance_walking_search(floor, search)
  }
  expect(result.type).toBe('route')
  if (result.type !== 'route') return
  const end = result.path.at(-1)!
  expect(end[0] - origin[0]).toBeGreaterThan(7)
  expect(end[2] - origin[2]).toBeGreaterThan(7)
  expect(search.seen.size).toBeLessThan(256)
})

test('coordinate rounding at a zone edge cannot produce a zero-length leg', () => {
  const x = 175.99999999999997
  const result = solve(floor, [x, 0.001, 0.5], { x: -1000, z: 0.5 })
  expect(result.type).toBe('route')
  if (result.type !== 'route') return
  expect(result.path.at(-1)![0]).toBeLessThan(x - 0.5)
})

test('difficult local searches retain at most 128 cells before choosing direct travel', () => {
  const maze = { ...floor, solid_at: (x: number, y: number) => y < 0 || (x === 6 && y < 4) }
  let search = begin_walking_search(start, { x: 1000, z: 0.5 })
  let ended = false
  for (let frame = 0; frame < 20; frame++) {
    expect(search.seen.size).toBeLessThanOrEqual(128)
    const result = advance_walking_search(maze, search)
    if (result.type === 'blocked') {
      ended = true
      break
    }
    if (result.type !== 'searching') throw new Error(`Unexpected ${result.type}`)
    ;({ search } = result)
  }
  expect(ended).toBe(true)
})

test('direct steering reports the full remaining distance instead of an empty cached path', () => {
  const goal = { x: 50.5, z: 0.5 }
  const initial = step_walking(floor, begin_walking(start, goal), start, goal, 1 / 60)
  expect(initial.status).toBe('walking')
  expect(initial.remaining).toBeCloseTo(50, 4)
  const advanced = step_walking(floor, initial.state, [10.5, 0.001, 0.5], goal, 1 / 60)
  expect(advanced.remaining).toBeCloseTo(40, 4)
})

test('detour lookahead stays bounded and retains its route while collision loads', () => {
  let probes = 0
  const path = Array.from({ length: 8 }, (_, index) => [start[0] + index + 1, start[1], start[2]] as const)
  const goal = { x: 100.5, z: 0.5 }
  const state = { ...begin_walking(start, goal), path }
  const step = step_walking(
    {
      ...floor,
      ready: () => {
        probes++
        return true
      },
    },
    state,
    start,
    goal,
    1 / 60
  )
  expect(probes).toBeLessThanOrEqual(5)
  expect(step.forward).toBe(1)
  const waiting = step_walking({ ...floor, ready: () => false }, step.state, start, goal, 1 / 60)
  expect(waiting.status).toBe('planning')
  expect(waiting.forward).toBe(0)
  expect(waiting.state.path).toEqual(step.state.path)
})

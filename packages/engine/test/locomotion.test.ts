// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  BIOME_SLOTS,
  compile_runtime_world_recipe,
  compile_world_recipe,
  world_terrain,
  type WorldRecipe,
} from '../src/data.ts'
import {
  box_overlaps_solid,
  eject_from_solid,
  ground_height_below,
  resolve_movement,
  walkable_spawn_height,
  type SolidFn,
} from '../src/locomotion/collision.ts'
import {
  classify_anim,
  create_controller_state,
  move_direction,
  step_controller,
} from '../src/locomotion/controller.ts'
import { run_to_mount, run_to_remaining_seconds } from '../src/locomotion/run_to.ts'
import { walking_edge, type WalkPoint, type WalkWorld } from '../src/locomotion/walkable.ts'
import { begin_walking, step_walking } from '../src/locomotion/walking.ts'
import { step_walking_follower } from '../src/locomotion/walking_follower.ts'
import { advance_walking_search, begin_walking_search, WALKING_SEARCH_LIMIT } from '../src/locomotion/walking_route.ts'
import { city_collision_readiness, create_world_collision } from '../src/locomotion/world_collision.ts'

const floor: WalkWorld = {
  solid_at: (_x, y) => y < 0,
  liquid_at: () => false,
  ready: () => true,
  ground_height: () => 0,
}
const start: WalkPoint = [0.5, 0.001, 0.5]
const wall: WalkWorld = { ...floor, solid_at: (x, y, z) => y < 0 || (x === 4 && y < 4 && z >= -3 && z <= 3) }
const solve = (world: WalkWorld, origin: WalkPoint = start, goal = { x: 8.5, z: 0.5 }) => {
  let search = begin_walking_search(origin, goal)
  for (let frame = 0; frame < 1000; frame += 1) {
    const result = advance_walking_search(world, search)
    if (result.type !== 'searching') return result
    ;({ search } = result)
  }
  throw new Error('search did not terminate within its frame budget')
}
const idle = { strafe: 0, jump: false, glide: false, walk: false, speed_scale: 1 }
const route_of = (result: ReturnType<typeof solve>) => {
  if (result.type !== 'route') throw new Error(`expected a route, got ${result.type}`)
  return result.path
}
// A body thrown at a wall along one axis stops flush against it and keeps no velocity into it.
const stops_at_wall = (axis: 0 | 1 | 2, sign: number, offset: number): boolean => {
  const velocity: [number, number, number] = [0, 0, 0]
  velocity[axis] = sign * 20
  const blocked = sign > 0 ? offset + 3 : offset - 2
  const solid: SolidFn = (...point) => (sign > 0 ? point[axis] >= blocked : point[axis] < blocked)
  const result = resolve_movement(solid, [offset + 0.5, offset + 0.1, offset + 0.5], velocity, 0.5)
  const extent = [0.4, sign > 0 ? 1.9 : 0, 0.4][axis]!
  return (
    !box_overlaps_solid(solid, ...result.position, 0.4, 1.9) &&
    Math.abs(result.position[axis] - (blocked - sign * extent)) < 0.005 &&
    result.velocity[axis] === 0
  )
}
const walk_detour = (speed_scale: number, goal = { x: 300.5, z: 0.5 }) => {
  const body = create_controller_state([...start])
  let state = begin_walking(start, goal)
  let status = ''
  let partial = false
  for (let tick = 0; tick < 3600 && status !== 'arrived'; tick++) {
    const step = step_walking(wall, state, body.position, goal, 1 / 60)
    ;({ state, status } = step)
    partial ||= status === 'walking' && step.remaining === null
    const input = { ...idle, yaw: step.yaw, forward: step.forward, speed_scale, phase_target: step.phase_target }
    step_controller(body, input, wall, 1 / 60)
  }
  return { status, partial, distance: Math.hypot(body.position[0] - goal.x, body.position[2] - goal.z) }
}
const controller_trace = (world: WalkWorld, input: Partial<typeof idle>) => {
  const body = create_controller_state([0.5, 0.001, 0.5])
  return Array.from({ length: 90 }, () => {
    step_controller(body, { ...idle, yaw: 0, forward: 1, ...input }, world, 1 / 60)
    return body.position.map((value) => value.toFixed(4)).join(',') + classify_anim(body)
  })
}

test('movement never tunnels through solids and lands on the floor below', () => {
  for (const axis of [0, 1, 2] as const)
    expect([-1, 1].flatMap((sign) => [-20, 0, 20].map((offset) => stops_at_wall(axis, sign, offset)))).toEqual(
      Array(6).fill(true)
    )
  let reads = 0
  const landing = resolve_movement((_x, y) => (reads++, y < 0), [0.5, 0.1, 0.5], [0, -1, 0], 0.2)
  expect([landing.on_ground, reads <= 4]).toEqual([true, true])
  expect(landing.position[1]).toBeCloseTo(0, 2)
  const inside: SolidFn = (x) => x >= 0 && x < 4
  expect(resolve_movement(inside, [1.59, 0, 0.5], [2, 0, 0], 0.1).position).toEqual([1.59, 0, 0.5])
  const ledge: SolidFn = (_x, y) => y < 3 && y !== 1
  expect(ground_height_below(ledge, 0.5, 10, 0.5)).toBe(3)
  expect(ground_height_below(() => false, 0.5, 10, 0.5, 4)).toBeNull()
  expect(walkable_spawn_height(ledge, 0.5, 0, 0.5)).toBe(3)
  expect(eject_from_solid((_x, y) => y < 5, [0.5, 1, 0.5])[1]).toBeGreaterThanOrEqual(5)
})

test('the walking search finds bounded routes, refuses hazards and never fabricates an arrival', () => {
  const route = route_of(solve(wall))
  expect(route.some((point) => Math.abs(point[2]) > 3)).toBe(true)
  route.slice(1).forEach((point, index) => expect(walking_edge(wall, route[index]!, point[0], point[2])).toEqual(point))
  expect(solve({ ...floor, ready: () => false }).type).toBe('waiting')
  expect(walking_edge({ ...floor, solid_at: (x, y) => y < (x > 0 ? 1 : 0) }, start, 1.5, 0.5)?.[1]).toBeCloseTo(1, 2)
  for (const hazard of [
    { solid_at: (x: number, y: number) => y < (x > 0 ? 2 : 0) },
    { solid_at: (x: number, y: number) => y < (x > 0 ? -8 : 0) },
    { liquid_at: () => true },
  ])
    expect(walking_edge({ ...floor, ...hazard }, start, 1.5, 0.5)).toBeNull()
  const bridge: WalkWorld = { ...floor, solid_at: (_x, y) => y < 0 || y === 4 }
  const [lower, upper] = [solve(bridge), solve(bridge, [0.5, 5.001, 0.5])]
  expect(route_of(lower).every((point) => point[1] < 1)).toBe(true)
  expect(route_of(upper).every((point) => point[1] > 4.99)).toBe(true)
  const room: WalkWorld = {
    ...floor,
    solid_at: (x, y, z) => y < 0 || (y < 4 && (Math.abs(x) === 2 || Math.abs(z) === 2)),
  }
  expect(solve(room).type).toBe('blocked')
  const cell: WalkWorld = {
    ...floor,
    solid_at: (x, y, z) => y < 0 || (y < 4 && (Math.abs(x) === 1 || Math.abs(z) === 1)),
  }
  expect(solve(cell, start, { x: 2, z: 0.5 }).type).toBe('blocked')
  // Client x = 176 is chain x = 50176, a 512-block zone boundary: the leg ends there.
  const zone = solve(floor, [175.5, 0.001, 0.5], { x: 1000, z: 0.5 })
  expect(route_of(zone).at(-1)![0]).toBe(176.5)
  const rounded = solve(floor, [175.99999999999997, 0.001, 0.5], { x: -1000, z: 0.5 })
  expect(route_of(rounded).at(-1)![0]).toBeLessThan(175.5)
  const local = solve({ ...floor, ready: ({ min_x, max_x }) => min_x >= -34 && max_x <= 34 }, start, {
    x: 10_000,
    z: 10_000,
  })
  expect(Math.abs(route_of(local).at(-1)![0] - start[0])).toBeLessThanOrEqual(8)
  const maze = { ...floor, solid_at: (x: number, y: number) => y < 0 || (x === 6 && y < 4) }
  let search = begin_walking_search(start, { x: 1000, z: 0.5 })
  let outcome = advance_walking_search(maze, search)
  for (let frame = 0; frame < 20 && outcome.type === 'searching'; frame++) {
    expect(outcome.search.seen.size).toBeLessThanOrEqual(WALKING_SEARCH_LIMIT)
    ;({ search } = outcome)
    outcome = advance_walking_search(maze, search)
  }
  expect(outcome.type).toBe('blocked')
})

test('the controller walks a detour to its destination at every speed scale and steps deterministically', () => {
  for (const speed_scale of [1, 1.5]) {
    const walked = walk_detour(speed_scale)
    expect([walked.status, walked.partial]).toEqual(['arrived', true])
    expect(walked.distance).toBeLessThan(0.2)
  }
  const direct = step_walking(floor, begin_walking(start, { x: 50.5, z: 0.5 }), start, { x: 50.5, z: 0.5 }, 1 / 60)
  expect([direct.status, Math.round(direct.remaining!)]).toEqual(['walking', 50])
  expect(step_walking({ ...floor, ready: () => false }, direct.state, start, { x: 50.5, z: 0.5 }, 1 / 60).forward).toBe(
    0
  )
  expect(move_direction(0.1, 0, 0)).toEqual([0, -0.1])
  expect(Math.hypot(...move_direction(1, 1, 0))).toBeCloseTo(1)
  const lake: WalkWorld = { ...floor, liquid_at: (_x, y) => y < 3 }
  for (const [world, input] of [
    [floor, {}],
    [floor, { jump: true }],
    [lake, {}],
  ] as const) {
    const trace = controller_trace(world, input)
    expect(controller_trace(world, input)).toEqual(trace)
    expect(trace.at(-1)).not.toEqual(trace[0])
  }
  expect(controller_trace(floor, { jump: true }).some((frame) => frame.includes('JUMP'))).toBe(true)
  expect(controller_trace(lake, {}).some((frame) => frame.endsWith('SWIM'))).toBe(true)
  expect([run_to_remaining_seconds(100, false), run_to_remaining_seconds(100, true)]).toEqual([10, 7])
  expect(
    [false, true].map((nearby) => run_to_mount({ requested: true, available: true, riding: false, nearby }))
  ).toEqual(['wait', 'mount'])
})

test('followers approach their leader through local clearance without adopting a forbidden pose', () => {
  let reads = 0
  const columns = new Set<number>()
  const counted: WalkWorld = { ...floor, solid_at: (x, y) => (reads++, columns.add(Math.floor(x)), y < 0) }
  const near = step_walking_follower(counted, null, start, { x: 100.5, z: 0.5 }, 1000 / 60)
  expect([reads < 1000, Math.max(...columns) <= 2, near.position[0] > start[0]]).toEqual([true, true, true])
  const blocked: WalkWorld = { ...floor, solid_at: (x, y) => y < 0 || (x === 3 && y < 4) }
  let motion: Parameters<typeof step_walking_follower>[1] = null
  let position = start
  for (let tick = 0; tick < 120; tick++)
    ({ motion, position } = step_walking_follower(blocked, motion, position, { x: 4.5, z: 0.5 }, 1000 / 60))
  expect(position[0]).toBeGreaterThan(4.3)
  expect(Math.hypot(4.5 - position[0], 0.5 - position[2])).toBeLessThan(0.2)
  let probes = 0
  const unknown = { ...floor, ready: () => false, solid_at: () => (probes++, false) }
  expect([step_walking_follower(unknown, null, start, { x: 100, z: 0.5 }, 100).position, probes]).toEqual([start, 0])
  expect(step_walking_follower(floor, null, start, { x: 2.5, z: 0.5 }, 0).position).toEqual(start)
  const body = create_controller_state([0, 0, 0])
  body.velocity = [100, 0, 0]
  let checked = 0
  const fenced = step_walking_follower(
    floor,
    { body, walking: begin_walking(body.position, { x: -20, z: 0 }) },
    body.position,
    { x: -20, z: 0 },
    130,
    (_from, to) => (checked++, to[0] <= 0.01)
  )
  expect([checked > 0, fenced.blocked, fenced.position[0] <= 0.01]).toEqual([true, true, true])
})

test('world collision reports city readiness and authored solid blocks from the compiled world', async () => {
  const recipe: WorldRecipe = {
    seed: 'collision',
    sea_level: 4,
    portal: false,
    materials: { stone: { color: '#777777', preset: 'stone' } },
    biome_slots: Object.fromEntries(BIOME_SLOTS.map((slot) => [slot, 'rock'])) as WorldRecipe['biome_slots'],
    biomes: [
      {
        name: 'rock',
        landscape: [
          { x: 0, y: 1, land: { surface: 'stone', subsurface: 'stone', filler: 'stone' } },
          { x: 1, y: 1 },
        ],
      },
    ],
    fixed_structures: [
      {
        origin: [0, 2, 0],
        rotation: 0,
        scale: 1,
        source: { name: 'block', size: [1, 1, 1], anchor: [0, 0, 0], blocks: [[0, 0, 0, 'stone']] },
      },
    ],
  }
  const collision = create_world_collision(compile_runtime_world_recipe(recipe), (error) => {
    throw error
  })
  expect([collision.solid_at(0, 2, 0), collision.solid_at(0, 3, 0), collision.solid_at(5, 0, 5)]).toEqual([
    true,
    false,
    true,
  ])
  expect(collision.ground_height(0, 0)).toBe(3)
  expect([collision.liquid_at(5, 2, 5), collision.liquid_at(5, 0, 5)]).toEqual([true, false])
  for (let column = 0; column < 300; column++) collision.structure_material_at(column * 32, 2, 0)
  expect(collision.structure_material_at(0, 2, 0)).toBeGreaterThan(0)
  const world = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
  const city = world.structures.cities.find(({ id }) => id === 'thebes')!
  const x = Math.ceil(city.area.min_x / 32) * 32
  const z = Math.ceil(city.area.min_z / 32) * 32
  const area = { min_x: x, max_x: x + 31, min_z: z, max_z: z + 31 }
  const loads: (() => void)[] = []
  const ready = city_collision_readiness(world, () => new Promise<void>((resolve) => loads.push(resolve)))
  expect([ready(area), ready(area), loads.length]).toEqual([false, false, 1])
  loads[0]!()
  await Promise.resolve()
  expect([ready(area), ready({ ...area, min_x: x + 32, max_x: x + 63 }), loads.length]).toEqual([true, false, 2])
  expect(ready({ min_x: 40_000, max_x: 40_031, min_z: 40_000, max_z: 40_031 })).toBe(true)
})

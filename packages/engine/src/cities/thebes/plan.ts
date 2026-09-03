// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CompiledWorld } from '../../world_recipe.ts'
import { sample_world_column } from '../../world_recipe.ts'
import { hash_position } from '../../world_noise.ts'
import { solve_tiled_wfc, type WfcConstraint, type WfcTile } from '../tiled_wfc.ts'
import type { CompiledCity } from '../types.ts'

export const THEBES_CELL = 64
const WEST = 1
const EAST = 2
const NORTH = 4
const SOUTH = 8
const ROAD_DIRECTIONS = Object.freeze([
  Object.freeze({ dx: -1, dz: 0, socket: WEST, opposite: EAST }),
  Object.freeze({ dx: 1, dz: 0, socket: EAST, opposite: WEST }),
  Object.freeze({ dx: 0, dz: -1, socket: NORTH, opposite: SOUTH }),
  Object.freeze({ dx: 0, dz: 1, socket: SOUTH, opposite: NORTH }),
])

export type ThebesPlanKind = 'empty' | 'road' | 'lot'
export type ThebesPlanCell = Readonly<{
  x: number
  z: number
  kind: ThebesPlanKind
  openings: number
  entrance: number
}>
export type ThebesLandmark = Readonly<{
  style: 'castle' | 'temple' | 'market' | 'ruin' | 'town_hall'
  x: number
  z: number
  entrance: number
}>
export type ThebesGate = Readonly<{
  edge: 'north' | 'east' | 'south' | 'west'
  segment: number
  target: number
}>
export type ThebesPlan = Readonly<{
  width: number
  depth: number
  cells: readonly ThebesPlanCell[]
  landmarks: readonly ThebesLandmark[]
  gates: readonly ThebesGate[]
}>

const road_tile = (openings: number): WfcTile =>
  Object.freeze({
    id: `road_${openings}`,
    weight: openings === 15 ? 0.08 : openings === 3 || openings === 12 ? 0.5 : 0.25,
    sockets: [
      openings & WEST ? 1 : 0,
      openings & EAST ? 1 : 0,
      0,
      0,
      openings & NORTH ? 1 : 0,
      openings & SOUTH ? 1 : 0,
    ] as const,
  })

const lot_tile = (entrance: number): WfcTile =>
  Object.freeze({
    id: `lot_${entrance}`,
    weight: 3.5,
    sockets: [
      entrance & WEST ? 1 : 0,
      entrance & EAST ? 1 : 0,
      0,
      0,
      entrance & NORTH ? 1 : 0,
      entrance & SOUTH ? 1 : 0,
    ] as const,
  })

const PLAN_TILES = Object.freeze([
  Object.freeze({ id: 'empty', weight: 24, sockets: [0, 0, 0, 0, 0, 0] as const }),
  ...Array.from({ length: 15 }, (_, index) => road_tile(index + 1)),
  ...[WEST, EAST, NORTH, SOUTH].map(lot_tile),
])
const ROAD_TILE_IDS = Object.freeze(PLAN_TILES.filter(({ id }) => id.startsWith('road_')).map(({ id }) => id))
const LOT_TILE_IDS = Object.freeze(PLAN_TILES.filter(({ id }) => id.startsWith('lot_')).map(({ id }) => id))

const plan_index = (x: number, z: number, width: number): number => z * width + x
const plan_coordinates = (index: number, width: number): readonly [number, number] => [
  index % width,
  Math.floor(index / width),
]
const inside = (x: number, z: number, width: number, depth: number): boolean =>
  x >= 0 && x < width && z >= 0 && z < depth

const cell_samples = (world: CompiledWorld, city: CompiledCity, x: number, z: number) => {
  const min_x = city.area.min_x + x * THEBES_CELL
  const min_z = city.area.min_z + z * THEBES_CELL
  return [
    sample_world_column(world, min_x + 2, min_z + 2),
    sample_world_column(world, min_x + THEBES_CELL - 3, min_z + 2),
    sample_world_column(world, min_x + 2, min_z + THEBES_CELL - 3),
    sample_world_column(world, min_x + THEBES_CELL - 3, min_z + THEBES_CELL - 3),
    sample_world_column(world, min_x + THEBES_CELL / 2, min_z + THEBES_CELL / 2),
  ] as const
}

const land_cells = (world: CompiledWorld, city: CompiledCity, width: number, depth: number): readonly boolean[] =>
  Object.freeze(
    Array.from({ length: width * depth }, (_, index) => {
      const [x, z] = plan_coordinates(index, width)
      return cell_samples(world, city, x, z).every(({ biome }) => biome !== world.ocean?.biome)
    })
  )

const building_relief = (world: CompiledWorld, city: CompiledCity, x: number, z: number): number => {
  const center_x = city.area.min_x + x * THEBES_CELL + THEBES_CELL / 2
  const center_z = city.area.min_z + z * THEBES_CELL + THEBES_CELL / 2
  const offsets = [-28, -21, -14, -7, 0, 7, 14, 21, 28]
  const heights = offsets.flatMap((offset_x) =>
    offsets.map((offset_z) => sample_world_column(world, center_x + offset_x, center_z + offset_z).surface_y)
  )
  return Math.max(...heights) - Math.min(...heights)
}

const nearest_land = (
  land: readonly boolean[],
  width: number,
  depth: number,
  target_x: number,
  target_z: number
): number => {
  const first = land.findIndex(Boolean)
  if (first < 0) throw new TypeError('Thebes city area contains no land')
  return land.reduce((selected, available, index) => {
    if (!available) return selected
    const [x, z] = plan_coordinates(index, width)
    const distance = Math.abs(x - target_x) + Math.abs(z - target_z)
    const [selected_x, selected_z] = plan_coordinates(selected, width)
    const selected_distance = Math.abs(selected_x - target_x) + Math.abs(selected_z - target_z)
    return distance < selected_distance ? index : selected
  }, first)
}

const ordered_neighbours = (index: number, width: number, depth: number, seed: number): readonly number[] => {
  const [x, z] = plan_coordinates(index, width)
  return ROAD_DIRECTIONS.map(({ dx, dz }) => [x + dx, z + dz] as const)
    .filter(([next_x, next_z]) => inside(next_x, next_z, width, depth))
    .map(([next_x, next_z]) => plan_index(next_x, next_z, width))
    .sort(
      (left, right) =>
        hash_position(seed, 'thebes-route', left, index, 0x9e3779b9) -
        hash_position(seed, 'thebes-route', right, index, 0x9e3779b9)
    )
}

const shortest_path = (
  land: readonly boolean[],
  width: number,
  depth: number,
  start: number,
  target: number,
  seed: number
): readonly number[] => {
  const previous = new Int32Array(width * depth).fill(-1)
  const queue = [start]
  previous[start] = start
  for (let cursor = 0; cursor < queue.length && previous[target] < 0; cursor += 1)
    for (const neighbour of ordered_neighbours(queue[cursor]!, width, depth, seed))
      if (land[neighbour] && previous[neighbour] < 0) {
        previous[neighbour] = queue[cursor]!
        queue.push(neighbour)
      }
  if (previous[target] < 0) return []
  const reversed = [target]
  while (reversed.at(-1) !== start) reversed.push(previous[reversed.at(-1)!]!)
  return Object.freeze(reversed.reverse())
}

const path_openings = (path: readonly number[], width: number): ReadonlyMap<number, number> => {
  const openings = new Map<number, number>()
  path.slice(1).forEach((next, index) => {
    const current = path[index]!
    const [current_x, current_z] = plan_coordinates(current, width)
    const [next_x, next_z] = plan_coordinates(next, width)
    const direction = ROAD_DIRECTIONS.find(({ dx, dz }) => current_x + dx === next_x && current_z + dz === next_z)!
    openings.set(current, (openings.get(current) ?? 0) | direction.socket)
    openings.set(next, (openings.get(next) ?? 0) | direction.opposite)
  })
  return openings
}

const merge_openings = (paths: readonly (readonly number[])[], width: number): ReadonlyMap<number, number> => {
  const merged = new Map<number, number>()
  paths.forEach((path) =>
    path_openings(path, width).forEach((openings, index) => merged.set(index, (merged.get(index) ?? 0) | openings))
  )
  return merged
}

const tile_openings = (id: string): number => Number(id.split('_')[1] ?? 0)
const matching_roads = (required: number): readonly string[] =>
  ROAD_TILE_IDS.filter((id) => (tile_openings(id) & required) === required)

const plan_constraints = (
  world: CompiledWorld,
  city: CompiledCity,
  width: number,
  depth: number,
  land: readonly boolean[],
  routes: ReadonlyMap<number, number>,
  reserved: ReadonlySet<number>
): readonly WfcConstraint[] =>
  Object.freeze(
    land.map((available, index) => {
      const required = routes.get(index) ?? 0
      if (!available) return Object.freeze({ index, allowed: ['empty'] })
      if (required !== 0) return Object.freeze({ index, allowed: matching_roads(required) })
      if (reserved.has(index)) return Object.freeze({ index, allowed: ['empty'] })
      const [x, z] = plan_coordinates(index, width)
      const allowed =
        building_relief(world, city, x, z) <= 8 ? PLAN_TILES.map(({ id }) => id) : ['empty', ...ROAD_TILE_IDS]
      return Object.freeze({ index, allowed })
    })
  )

const landmark_targets = (city: CompiledCity, width: number, depth: number): readonly ThebesLandmark[] => {
  const center_x = Math.floor((city.area.anchor_x - city.area.min_x) / THEBES_CELL)
  const center_z = Math.floor((city.area.anchor_z - city.area.min_z) / THEBES_CELL)
  const spread_x = Math.max(5, Math.floor(width * 0.3))
  const spread_z = Math.max(5, Math.floor(depth * 0.3))
  return Object.freeze([
    Object.freeze({ style: 'castle', x: center_x + spread_x, z: center_z + spread_z, entrance: NORTH }),
    Object.freeze({ style: 'temple', x: center_x - spread_x, z: center_z + spread_z, entrance: NORTH }),
    Object.freeze({ style: 'market', x: center_x - spread_x, z: center_z - spread_z, entrance: SOUTH }),
    Object.freeze({ style: 'ruin', x: center_x + spread_x, z: center_z - spread_z, entrance: SOUTH }),
  ])
}

const neighbouring_cells = (x: number, z: number, radius: number, width: number, depth: number): readonly number[] =>
  Array.from({ length: (radius * 2 + 1) ** 2 }, (_, index) => {
    const side = radius * 2 + 1
    const cell_x = x - radius + (index % side)
    const cell_z = z - radius + Math.floor(index / side)
    return inside(cell_x, cell_z, width, depth) ? plan_index(cell_x, cell_z, width) : -1
  }).filter((index) => index >= 0)

const entrance_cell = (landmark: ThebesLandmark, width: number): number => {
  const direction = ROAD_DIRECTIONS.find(({ socket }) => socket === landmark.entrance)!
  return plan_index(landmark.x + direction.dx, landmark.z + direction.dz, width)
}

const place_landmark = (
  landmark: ThebesLandmark,
  land: readonly boolean[],
  width: number,
  depth: number
): ThebesLandmark => {
  const direction = ROAD_DIRECTIONS.find(({ socket }) => socket === landmark.entrance)!
  const candidates = land.flatMap((available, index) => {
    if (!available) return []
    const [x, z] = plan_coordinates(index, width)
    const entrance_x = x + direction.dx
    const entrance_z = z + direction.dz
    if (!inside(entrance_x, entrance_z, width, depth) || !land[plan_index(entrance_x, entrance_z, width)]) return []
    return [Object.freeze({ x, z, distance: Math.abs(x - landmark.x) + Math.abs(z - landmark.z) })]
  })
  if (candidates.length === 0) throw new TypeError(`Thebes ${landmark.style} has no land entrance`)
  const nearest = candidates.reduce((selected, candidate) =>
    candidate.distance < selected.distance ? candidate : selected
  )
  return Object.freeze({ ...landmark, x: nearest.x, z: nearest.z })
}

const gate_targets = (land: readonly boolean[], width: number, depth: number): readonly ThebesGate[] => {
  const center_x = Math.floor(width / 2)
  const center_z = Math.floor(depth / 2)
  const target = (x: number, z: number): number => nearest_land(land, width, depth, x, z)
  const north = target(center_x, 1)
  const east = target(width - 2, center_z)
  const south = target(center_x, depth - 2)
  const west = target(1, center_z)
  return Object.freeze([
    Object.freeze({ edge: 'north', segment: plan_coordinates(north, width)[0], target: north }),
    Object.freeze({ edge: 'east', segment: plan_coordinates(east, width)[1], target: east }),
    Object.freeze({ edge: 'south', segment: plan_coordinates(south, width)[0], target: south }),
    Object.freeze({ edge: 'west', segment: plan_coordinates(west, width)[1], target: west }),
  ])
}

const decoded_cell = (id: string, index: number, width: number): ThebesPlanCell => {
  const [x, z] = plan_coordinates(index, width)
  if (id.startsWith('road_')) return Object.freeze({ x, z, kind: 'road', openings: tile_openings(id), entrance: 0 })
  if (id.startsWith('lot_')) return Object.freeze({ x, z, kind: 'lot', openings: 0, entrance: tile_openings(id) })
  return Object.freeze({ x, z, kind: 'empty', openings: 0, entrance: 0 })
}

const build_thebes_plan = (world: CompiledWorld, city: CompiledCity): ThebesPlan => {
  const width = Math.floor((city.area.max_x - city.area.min_x + 1) / THEBES_CELL)
  const depth = Math.floor((city.area.max_z - city.area.min_z + 1) / THEBES_CELL)
  const land = land_cells(world, city, width, depth)
  const portal = nearest_land(
    land,
    width,
    depth,
    Math.floor((city.area.anchor_x - city.area.min_x) / THEBES_CELL),
    Math.floor((city.area.anchor_z - city.area.min_z) / THEBES_CELL)
  )
  const [portal_x, portal_z] = plan_coordinates(portal, width)
  const landmarks = landmark_targets(city, width, depth).map((landmark) => place_landmark(landmark, land, width, depth))
  const landmark_reserved = new Set(
    landmarks.flatMap(({ style, x, z }) => neighbouring_cells(x, z, style === 'castle' ? 1 : 0, width, depth))
  )
  const civic_reserved = neighbouring_cells(portal_x, portal_z, 1, width, depth)
  const reserved = new Set([...landmark_reserved, ...civic_reserved])
  const gates = gate_targets(land, width, depth)
  const route_targets = [
    ...landmarks.map((landmark) => entrance_cell(landmark, width)),
    ...gates.map(({ target }) => target),
  ]
  const route_target_set = new Set(route_targets)
  const route_land = land.map(
    (available, index) => available && (!landmark_reserved.has(index) || route_target_set.has(index))
  )
  const paths = route_targets.map((target, index) =>
    shortest_path(route_land, width, depth, portal, target, world.decoration_seed + index)
  )
  if (paths.some((path) => path.length === 0))
    throw new TypeError('Thebes landmark routes cannot share one land network')
  const routes = merge_openings(paths, width)
  const solved = solve_tiled_wfc({
    seed: world.decoration_seed,
    size: [width, 1, depth],
    tiles: PLAN_TILES,
    constraints: plan_constraints(world, city, width, depth, land, routes, reserved),
    attempts: 12,
  })
  if (!solved) throw new TypeError('Thebes tile constraints are unsatisfiable')
  return Object.freeze({
    width,
    depth,
    cells: Object.freeze(solved.map((id, index) => decoded_cell(id, index, width))),
    landmarks,
    gates,
  })
}

const plan_caches = new WeakMap<CompiledWorld, Map<string, ThebesPlan>>()
export const plan_thebes_tiles = (world: CompiledWorld, city: CompiledCity): ThebesPlan => {
  let plans = plan_caches.get(world)
  if (!plans) {
    plans = new Map()
    plan_caches.set(world, plans)
  }
  const cached = plans.get(city.id)
  if (cached) return cached
  const plan = build_thebes_plan(world, city)
  plans.set(city.id, plan)
  return plan
}

export const thebes_road_bits = Object.freeze({ WEST, EAST, NORTH, SOUTH })

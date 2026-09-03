// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  compile_positioned_city_structure,
  type CityBlock,
  type PositionedCityStructure,
} from '../../city_structure.ts'
import { solve_tiled_wfc, wfc_cell_index, type WfcConstraint, type WfcTile } from '../../tiled_wfc.ts'
import type { CompiledWorld } from '../../../world_recipe.ts'
import { sample_world_column } from '../../../world_recipe.ts'
import { hash_position } from '../../../world_noise.ts'
import { THEBES_CELL } from '../plan.ts'
import { THEBES_MATERIALS as M } from '../materials.ts'

import { decorate_thebes_building } from './building_architecture.ts'

const MODULE = 5
const WEST = 1
const EAST = 2
const NORTH = 4
const SOUTH = 8

export type ThebesBuildingStyle =
  | 'house'
  | 'courtyard'
  | 'tower'
  | 'wood'
  | 'villa'
  | 'barracks'
  | 'watchtower'
  | 'monument'
  | 'town_hall'
  | 'castle'
  | 'temple'
  | 'market'
  | 'ruin'
type BuildingProfile = Readonly<{
  width: number
  depth: number
  floors: number
  wall: string
  roof: string
}>

const PROFILES: Readonly<Record<ThebesBuildingStyle, BuildingProfile>> = Object.freeze({
  house: Object.freeze({ width: 3, depth: 3, floors: 1, wall: M.limestone, roof: 'temperate_wood' }),
  courtyard: Object.freeze({ width: 4, depth: 3, floors: 1, wall: M.limestone, roof: 'temperate_wood' }),
  tower: Object.freeze({ width: 3, depth: 3, floors: 3, wall: M.limestone, roof: 'temperate_wood' }),
  wood: Object.freeze({ width: 3, depth: 3, floors: 2, wall: M.limestone, roof: 'temperate_wood' }),
  villa: Object.freeze({ width: 4, depth: 4, floors: 2, wall: M.limestone, roof: 'temperate_wood' }),
  barracks: Object.freeze({ width: 5, depth: 3, floors: 2, wall: M.limestone, roof: 'temperate_wood' }),
  watchtower: Object.freeze({ width: 3, depth: 3, floors: 4, wall: M.limestone, roof: 'temperate_wood' }),
  monument: Object.freeze({ width: 2, depth: 2, floors: 1, wall: M.limestone, roof: 'temperate_wood' }),
  town_hall: Object.freeze({ width: 7, depth: 5, floors: 3, wall: M.limestone, roof: 'temperate_wood' }),
  castle: Object.freeze({ width: 9, depth: 9, floors: 4, wall: M.limestone, roof: 'temperate_wood' }),
  temple: Object.freeze({ width: 5, depth: 3, floors: 2, wall: M.limestone, roof: 'temperate_wood' }),
  market: Object.freeze({ width: 4, depth: 3, floors: 1, wall: M.limestone, roof: 'temperate_wood' }),
  ruin: Object.freeze({ width: 3, depth: 3, floors: 1, wall: M.limestone, roof: 'temperate_wood' }),
})

export const thebes_building_size = (style: ThebesBuildingStyle): readonly [number, number] => {
  const profile = PROFILES[style]
  return [profile.width * MODULE + 1, profile.depth * MODULE + 1]
}

const variable_profile = (style: ThebesBuildingStyle, seed: number): BuildingProfile => {
  const profile = PROFILES[style]
  const variable = style === 'house' || style === 'wood' || style === 'villa' || style === 'barracks'
  return variable && seed % 3 === 0 ? Object.freeze({ ...profile, floors: profile.floors + 1 }) : profile
}

const room_tile = (openings: number): WfcTile =>
  Object.freeze({
    id: `room_${openings}`,
    weight: openings === 15 ? 0.3 : openings === 3 || openings === 12 ? 1.4 : 1,
    sockets: [
      openings & WEST ? 1 : 0,
      openings & EAST ? 1 : 0,
      0,
      0,
      openings & NORTH ? 1 : 0,
      openings & SOUTH ? 1 : 0,
    ] as const,
  })

const ROOM_TILES = Object.freeze([
  ...Array.from({ length: 15 }, (_, index) => room_tile(index + 1)),
  Object.freeze({ id: 'stairs_up', weight: 1, sockets: [1, 1, 0, 1, 1, 1] as const }),
  Object.freeze({ id: 'stairs_down', weight: 1, sockets: [1, 1, 1, 0, 1, 1] as const }),
  Object.freeze({ id: 'stairs_both', weight: 1, sockets: [1, 1, 1, 1, 1, 1] as const }),
])
const ROOM_IDS = Object.freeze(ROOM_TILES.filter(({ id }) => id.startsWith('room_')).map(({ id }) => id))

const room_openings = (id: string): number => (id.startsWith('room_') ? Number(id.slice(5)) : 15)
const room_index = (x: number, y: number, z: number, profile: BuildingProfile): number =>
  wfc_cell_index(x, y, z, [profile.width, profile.floors, profile.depth])

const spanning_openings = (profile: BuildingProfile): readonly number[] => {
  const required = Array.from({ length: profile.width * profile.floors * profile.depth }, () => 0)
  for (let floor = 0; floor < profile.floors; floor += 1)
    for (let z = 0; z < profile.depth; z += 1) {
      const forward = z % 2 === 0
      const row = Array.from({ length: profile.width }, (_, index) => (forward ? index : profile.width - 1 - index))
      row.slice(1).forEach((x, index) => {
        const previous = row[index]!
        required[room_index(previous, floor, z, profile)]! |= forward ? EAST : WEST
        required[room_index(x, floor, z, profile)]! |= forward ? WEST : EAST
      })
      if (z + 1 < profile.depth) {
        const edge_x = forward ? profile.width - 1 : 0
        required[room_index(edge_x, floor, z, profile)]! |= SOUTH
        required[room_index(edge_x, floor, z + 1, profile)]! |= NORTH
      }
    }
  return required
}

const stair_id = (floor: number, floors: number): string => {
  if (floor === 0) return 'stairs_up'
  return floor === floors - 1 ? 'stairs_down' : 'stairs_both'
}

const room_constraints = (profile: BuildingProfile): readonly WfcConstraint[] => {
  const required = spanning_openings(profile)
  const stair_x = Math.floor(profile.width / 2)
  const stair_z = Math.floor(profile.depth / 2)
  return Object.freeze(
    required.map((openings, index) => {
      const floor = Math.floor(index / (profile.width * profile.depth))
      const within = index % (profile.width * profile.depth)
      const x = within % profile.width
      const z = Math.floor(within / profile.width)
      if (profile.floors > 1 && x === stair_x && z === stair_z)
        return Object.freeze({ index, allowed: [stair_id(floor, profile.floors)] })
      return Object.freeze({ index, allowed: ROOM_IDS.filter((id) => (room_openings(id) & openings) === openings) })
    })
  )
}

const solve_rooms = (seed: number, profile: BuildingProfile): readonly string[] => {
  const solved = solve_tiled_wfc({
    seed,
    size: [profile.width, profile.floors, profile.depth],
    tiles: ROOM_TILES,
    constraints: room_constraints(profile),
    attempts: 4,
  })
  if (!solved) throw new TypeError('Thebes building tile constraints are unsatisfiable')
  return solved
}

type BlockMap = Map<string, CityBlock>
const block_key = (x: number, y: number, z: number): string => `${x}:${y}:${z}`
const set_block = (blocks: BlockMap, x: number, y: number, z: number, material: string): void => {
  blocks.set(block_key(x, y, z), Object.freeze([x, y, z, material]))
}
const clear_block = (blocks: BlockMap, x: number, y: number, z: number): void => {
  blocks.delete(block_key(x, y, z))
}

const line_x = (
  blocks: BlockMap,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z: number,
  material: string
): void => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) set_block(blocks, x, y, z, material)
}
const line_z = (
  blocks: BlockMap,
  x: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  material: string
): void => {
  for (let y = y0; y <= y1; y += 1) for (let z = z0; z <= z1; z += 1) set_block(blocks, x, y, z, material)
}

const draw_internal_walls = (
  blocks: BlockMap,
  profile: BuildingProfile,
  openings: number,
  x: number,
  z: number,
  min_x: number,
  min_z: number,
  base_y: number
): void => {
  if (x === 0 || (openings & WEST) === 0)
    line_z(blocks, min_x, base_y + 1, base_y + 4, min_z, min_z + MODULE, profile.wall)
  if (z === 0 || (openings & NORTH) === 0)
    line_x(blocks, min_x, min_x + MODULE, base_y + 1, base_y + 4, min_z, profile.wall)
}

const draw_external_walls = (
  blocks: BlockMap,
  profile: BuildingProfile,
  x: number,
  z: number,
  min_x: number,
  min_z: number,
  base_y: number
): void => {
  if (x === profile.width - 1)
    line_z(blocks, min_x + MODULE, base_y + 1, base_y + 4, min_z, min_z + MODULE, profile.wall)
  if (z === profile.depth - 1)
    line_x(blocks, min_x, min_x + MODULE, base_y + 1, base_y + 4, min_z + MODULE, profile.wall)
}

const draw_room = (
  blocks: BlockMap,
  profile: BuildingProfile,
  openings: number,
  x: number,
  floor: number,
  z: number,
  origin_x: number,
  datum: number,
  origin_z: number
): void => {
  const min_x = origin_x + x * MODULE
  const min_z = origin_z + z * MODULE
  const base_y = datum + floor * MODULE
  for (let block_z = min_z; block_z <= min_z + MODULE; block_z += 1)
    for (let block_x = min_x; block_x <= min_x + MODULE; block_x += 1)
      set_block(blocks, block_x, base_y, block_z, M.sandstone)
  draw_internal_walls(blocks, profile, openings, x, z, min_x, min_z, base_y)
  draw_external_walls(blocks, profile, x, z, min_x, min_z, base_y)
}

const room_shell = (
  blocks: BlockMap,
  profile: BuildingProfile,
  rooms: readonly string[],
  origin_x: number,
  datum: number,
  origin_z: number
): void => {
  for (let floor = 0; floor < profile.floors; floor += 1)
    for (let z = 0; z < profile.depth; z += 1)
      for (let x = 0; x < profile.width; x += 1)
        draw_room(
          blocks,
          profile,
          room_openings(rooms[room_index(x, floor, z, profile)]!),
          x,
          floor,
          z,
          origin_x,
          datum,
          origin_z
        )
}

const entrance_position = (
  entrance: number,
  profile: BuildingProfile,
  origin_x: number,
  origin_z: number
): Readonly<{ x: number; z: number; along_x: boolean }> => {
  if (entrance === WEST) return { x: origin_x, z: origin_z + Math.floor((profile.depth * MODULE) / 2), along_x: false }
  if (entrance === EAST)
    return {
      x: origin_x + profile.width * MODULE,
      z: origin_z + Math.floor((profile.depth * MODULE) / 2),
      along_x: false,
    }
  if (entrance === NORTH) return { x: origin_x + Math.floor((profile.width * MODULE) / 2), z: origin_z, along_x: true }
  return { x: origin_x + Math.floor((profile.width * MODULE) / 2), z: origin_z + profile.depth * MODULE, along_x: true }
}

const open_entrance = (
  blocks: BlockMap,
  entrance: number,
  profile: BuildingProfile,
  origin_x: number,
  datum: number,
  origin_z: number
): void => {
  const door = entrance_position(entrance, profile, origin_x, origin_z)
  for (let y = datum + 1; y <= datum + 3; y += 1)
    for (let offset = -1; offset <= 1; offset += 1)
      clear_block(blocks, door.x + (door.along_x ? offset : 0), y, door.z + (door.along_x ? 0 : offset))
}

const add_stairs = (
  blocks: BlockMap,
  profile: BuildingProfile,
  origin_x: number,
  datum: number,
  origin_z: number
): void => {
  const stair_x = origin_x + Math.floor(profile.width / 2) * MODULE
  const stair_z = origin_z + Math.floor(profile.depth / 2) * MODULE + 1
  for (let floor = 0; floor < profile.floors - 1; floor += 1)
    add_stair_flight(blocks, stair_x, datum + floor * MODULE, stair_z)
}

const add_stair_flight = (blocks: BlockMap, stair_x: number, base_y: number, stair_z: number): void => {
  for (let step = 0; step < MODULE; step += 1)
    for (let width = 0; width < 2; width += 1) {
      set_block(blocks, stair_x + step, base_y + step + 1, stair_z + width, 'temperate_wood')
      for (let headroom = 1; headroom <= 3; headroom += 1)
        clear_block(blocks, stair_x + step, base_y + step + 1 + headroom, stair_z + width)
    }
  for (let x = stair_x + MODULE - 2; x <= stair_x + MODULE; x += 1)
    for (let z = stair_z; z < stair_z + 2; z += 1) clear_block(blocks, x, base_y + MODULE, z)
}

const add_foundation = (
  blocks: BlockMap,
  world: CompiledWorld,
  origin_x: number,
  origin_z: number,
  width: number,
  depth: number,
  datum: number
): void => {
  for (let z = origin_z; z <= origin_z + depth; z += 1)
    for (let x = origin_x; x <= origin_x + width; x += 1) {
      const ground = sample_world_column(world, x, z).surface_y - 1
      for (let y = ground; y <= datum; y += 1) set_block(blocks, x, y, z, M.sandstone)
    }
}

const add_roof = (
  blocks: BlockMap,
  profile: BuildingProfile,
  origin_x: number,
  datum: number,
  origin_z: number,
  style: ThebesBuildingStyle
): void => {
  const roof_y = datum + profile.floors * MODULE
  for (let z = origin_z - 1; z <= origin_z + profile.depth * MODULE + 1; z += 1)
    for (let x = origin_x - 1; x <= origin_x + profile.width * MODULE + 1; x += 1)
      set_block(blocks, x, roof_y, z, profile.roof)
  if (style === 'castle' || style === 'tower' || style === 'watchtower')
    for (let x = origin_x - 1; x <= origin_x + profile.width * MODULE + 1; x += 3) {
      set_block(blocks, x, roof_y + 1, origin_z - 1, profile.wall)
      set_block(blocks, x, roof_y + 1, origin_z + profile.depth * MODULE + 1, profile.wall)
    }
}

const add_castle_tower = (
  blocks: BlockMap,
  x0: number,
  z0: number,
  datum: number,
  roof_y: number,
  profile: BuildingProfile
): void => {
  for (let y = datum + 1; y <= roof_y + 7; y += 1)
    for (let offset = 0; offset <= 4; offset += 1) {
      set_block(blocks, x0 + offset, y, z0, profile.wall)
      set_block(blocks, x0 + offset, y, z0 + 4, profile.wall)
      set_block(blocks, x0, y, z0 + offset, profile.wall)
      set_block(blocks, x0 + 4, y, z0 + offset, profile.wall)
    }
  for (let z = z0 - 1; z <= z0 + 5; z += 1)
    for (let x = x0 - 1; x <= x0 + 5; x += 1) set_block(blocks, x, roof_y + 8, z, profile.roof)
}

const add_castle_details = (
  blocks: BlockMap,
  profile: BuildingProfile,
  origin_x: number,
  datum: number,
  origin_z: number
): void => {
  const max_x = origin_x + profile.width * MODULE
  const max_z = origin_z + profile.depth * MODULE
  const roof_y = datum + profile.floors * MODULE
  ;[
    [origin_x, origin_z],
    [max_x - 4, origin_z],
    [origin_x, max_z - 4],
    [max_x - 4, max_z - 4],
  ].forEach(([x, z]) => add_castle_tower(blocks, x!, z!, datum, roof_y, profile))
}

const add_courtyard_details = (
  blocks: BlockMap,
  profile: BuildingProfile,
  origin_x: number,
  datum: number,
  origin_z: number
): void => {
  const center_x = origin_x + Math.floor((profile.width * MODULE) / 2)
  const center_z = origin_z + Math.floor((profile.depth * MODULE) / 2)
  for (let y = datum + 1; y <= datum + profile.floors * MODULE; y += 1)
    for (let z = center_z - 3; z <= center_z + 3; z += 1)
      for (let x = center_x - 3; x <= center_x + 3; x += 1) clear_block(blocks, x, y, z)
}

const add_market_details = (
  blocks: BlockMap,
  profile: BuildingProfile,
  origin_x: number,
  datum: number,
  origin_z: number
): void => {
  const max_x = origin_x + profile.width * MODULE
  const max_z = origin_z + profile.depth * MODULE
  for (let y = datum + 1; y <= datum + 3; y += 1)
    for (let offset = 1; offset < profile.width * MODULE; offset += 1) {
      clear_block(blocks, origin_x + offset, y, origin_z)
      clear_block(blocks, origin_x + offset, y, max_z)
    }
  for (const x of [origin_x, max_x])
    for (const z of [origin_z, max_z])
      for (let y = datum + 1; y <= datum + 4; y += 1) set_block(blocks, x, y, z, 'temperate_wood')
}

const add_monument_details = (
  blocks: BlockMap,
  profile: BuildingProfile,
  origin_x: number,
  datum: number,
  origin_z: number
): void => {
  const center_x = origin_x + Math.floor((profile.width * MODULE) / 2)
  const center_z = origin_z + Math.floor((profile.depth * MODULE) / 2)
  const roof_y = datum + profile.floors * MODULE
  add_monument_pedestal(blocks, center_x, center_z, roof_y)
  add_monument_shaft(blocks, center_x, center_z, roof_y)
}

const add_monument_pedestal = (blocks: BlockMap, center_x: number, center_z: number, roof_y: number): void => {
  for (let y = roof_y + 1; y <= roof_y + 3; y += 1)
    for (let z = center_z - 2; z <= center_z + 2; z += 1)
      for (let x = center_x - 2; x <= center_x + 2; x += 1) set_block(blocks, x, y, z, M.sandstone)
}

const add_monument_shaft = (blocks: BlockMap, center_x: number, center_z: number, roof_y: number): void => {
  for (let y = roof_y + 4; y <= roof_y + 14; y += 1) {
    const radius = y < roof_y + 11 ? 1 : 0
    for (let z = center_z - radius; z <= center_z + radius; z += 1)
      for (let x = center_x - radius; x <= center_x + radius; x += 1) set_block(blocks, x, y, z, M.limestone)
  }
  set_block(blocks, center_x, roof_y + 15, center_z, M.copper)
}

type StyleDetail = (
  blocks: BlockMap,
  profile: BuildingProfile,
  origin_x: number,
  datum: number,
  origin_z: number
) => void
const STYLE_DETAILS: Partial<Readonly<Record<ThebesBuildingStyle, StyleDetail>>> = Object.freeze({
  castle: add_castle_details,
  courtyard: add_courtyard_details,
  villa: add_courtyard_details,
  market: add_market_details,
  monument: add_monument_details,
})

const building_ground = (
  world: CompiledWorld,
  origin_x: number,
  origin_z: number,
  width: number,
  depth: number
): readonly number[] | null => {
  const columns = Array.from({ length: (width + 1) * (depth + 1) }, (_, index) => {
    const x = origin_x + (index % (width + 1))
    const z = origin_z + Math.floor(index / (width + 1))
    return sample_world_column(world, x, z)
  })
  return columns.some(({ biome }) => biome === world.ocean?.biome)
    ? null
    : columns.map(({ surface_y }) => surface_y - 1)
}

export const build_thebes_building_at = (
  world: CompiledWorld,
  center_x: number,
  center_z: number,
  entrance: number,
  style: ThebesBuildingStyle,
  order: number
): PositionedCityStructure | null => {
  const seed = hash_position(world.decoration_seed, `thebes-building:${style}`, center_x, center_z, order)
  const profile = variable_profile(style, seed)
  const width = profile.width * MODULE
  const depth = profile.depth * MODULE
  const origin_x = center_x - Math.floor(width / 2)
  const origin_z = center_z - Math.floor(depth / 2)
  const ground = building_ground(world, origin_x, origin_z, width, depth)
  const maximum_relief = style === 'castle' || style === 'town_hall' ? 14 : 8
  if (!ground || Math.max(...ground) - Math.min(...ground) > maximum_relief) return null
  const datum = Math.max(...ground)
  const rooms = solve_rooms(seed, profile)
  const blocks: BlockMap = new Map()
  add_foundation(blocks, world, origin_x, origin_z, width, depth, datum)
  room_shell(blocks, profile, rooms, origin_x, datum, origin_z)
  add_stairs(blocks, profile, origin_x, datum, origin_z)
  open_entrance(blocks, entrance, profile, origin_x, datum, origin_z)
  add_roof(blocks, profile, origin_x, datum, origin_z, style)
  STYLE_DETAILS[style]?.(blocks, profile, origin_x, datum, origin_z)
  decorate_thebes_building(
    Object.freeze({
      set: (x, y, z, material) => set_block(blocks, x, y, z, material),
      clear: (x, y, z) => clear_block(blocks, x, y, z),
    }),
    Object.freeze({
      style,
      origin_x,
      origin_z,
      datum,
      width,
      depth,
      floors: profile.floors,
      wall: profile.wall,
      roof: profile.roof,
      entrance,
      seed,
    })
  )
  if (style === 'ruin') {
    ;[...blocks].forEach(([key, [x, y, z]]) => {
      if (y > datum + 2 && hash_position(seed, 'ruin', x, z, y) % 5 === 0) blocks.delete(key)
    })
  }
  return compile_positioned_city_structure(
    `thebes_${style}_${String(order).padStart(4, '0')}`,
    [...blocks.values()],
    world.materials
  )
}

export const build_thebes_building = (
  world: CompiledWorld,
  area: Readonly<{ min_x: number; min_z: number }>,
  cell_x: number,
  cell_z: number,
  entrance: number,
  style: ThebesBuildingStyle,
  order: number
): PositionedCityStructure | null =>
  build_thebes_building_at(
    world,
    area.min_x + cell_x * THEBES_CELL + THEBES_CELL / 2,
    area.min_z + cell_z * THEBES_CELL + THEBES_CELL / 2,
    entrance,
    style,
    order
  )

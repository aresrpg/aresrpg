// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import worlds from '../../../seed/content/worlds.json'

export const worlds_source = Object.freeze(worlds)

const ZONE_SIZE = 512
const WORLD_CENTER = 50_000
export const client_world_position = (x: number, z: number): readonly [number, number] =>
  Object.freeze([x - WORLD_CENTER, z - WORLD_CENTER])

export type WorldCityArea = Readonly<{
  id: string
  dungeon: string
  anchor_x: number
  anchor_z: number
  min_x: number
  max_x: number
  min_z: number
  max_z: number
  structure_packs: readonly string[]
}>

const EMPTY_CITY_AREAS: readonly WorldCityArea[] = Object.freeze([])
const CITY_AREAS: Readonly<Record<string, readonly WorldCityArea[]>> = Object.freeze(
  Object.fromEntries(
    worlds_source.map((world) => [
      world.world,
      Object.freeze(
        world.cities.map(({ city, dungeon, x, z, structure_packs }) => {
          const zone_x = Math.floor(x / ZONE_SIZE)
          const zone_z = Math.floor(z / ZONE_SIZE)
          const [anchor_x, anchor_z] = client_world_position(x, z)
          return Object.freeze({
            id: city,
            dungeon,
            min_x: (zone_x - 1) * ZONE_SIZE - WORLD_CENTER,
            max_x: (zone_x + 2) * ZONE_SIZE - 1 - WORLD_CENTER,
            min_z: (zone_z - 1) * ZONE_SIZE - WORLD_CENTER,
            max_z: (zone_z + 2) * ZONE_SIZE - 1 - WORLD_CENTER,
            anchor_x,
            anchor_z,
            structure_packs: Object.freeze([...structure_packs]),
          })
        })
      ),
    ])
  )
)

export const world_city_areas = (world_name: string | null): readonly WorldCityArea[] =>
  (world_name && CITY_AREAS[world_name]) || EMPTY_CITY_AREAS

export const city_at_position = (world_name: string | null, x: number, z: number): WorldCityArea | null =>
  world_city_areas(world_name).find(
    ({ min_x, max_x, min_z, max_z }) => x >= min_x && x <= max_x && z >= min_z && z <= max_z
  ) ?? null

/** Resolve authored terrain by world identity. The first authored recipe is only the guest/default
 * world; a named world never borrows another world's terrain. */
export const world_terrain = (world_name: string | null): unknown | null => {
  const world =
    world_name === null
      ? worlds_source.find(({ terrain }) => terrain !== undefined)
      : worlds_source.find(({ world: name }) => name === world_name)
  if (!world?.terrain) return null
  return Object.freeze({
    ...world.terrain,
    structure_areas: world_city_areas(world.world),
  })
}

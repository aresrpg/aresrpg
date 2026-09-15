// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SeedDungeon, SeedWorld, WorldResource } from '../content/catalog.ts'
import { titleize } from '../content/catalog.ts'
import { derive_mob_locations, type MobFilterSource } from '../content/mob_filters.ts'

export type WorldPlace = Readonly<{
  key: string
  id: string
  kind: 'biome' | 'city'
  mob_types: readonly string[]
  resources: readonly WorldResource[]
  dungeon: SeedDungeon | null
}>

/** Roaming encounters use the shared archimob inheritance rule. Protectors and dungeons stay explicit. */
export const world_places = (
  world: SeedWorld,
  mobs: readonly MobFilterSource[],
  dungeons: readonly SeedDungeon[]
): readonly WorldPlace[] => {
  const roaming = derive_mob_locations(mobs, [
    {
      world: world.world,
      biome_names: world.terrain?.biomes.map(({ name }) => name) ?? [],
      mobs: world.mobs,
      protectors: [],
      cities: [],
    },
  ])
  const place = (id: string, kind: WorldPlace['kind'], dungeon: SeedDungeon | null): WorldPlace => {
    const field = kind === 'biome' ? 'biomes' : 'cities'
    return {
      key: `${kind}:${id}`,
      id,
      kind,
      dungeon,
      mob_types: roaming.filter((row) => row[field].includes(id)).map(({ mob_type }) => mob_type),
      resources: world.resources.filter((row) => row[field].includes(id)),
    }
  }
  return [
    ...(world.terrain?.biomes ?? []).map(({ name }) => place(name, 'biome', null)),
    ...world.cities.map(({ city, dungeon }) =>
      place(city, 'city', dungeons.find((row) => row.dungeon === dungeon) ?? null)
    ),
  ]
}

export const dungeon_mobs = (dungeon: SeedDungeon): readonly string[] => [
  ...new Set(dungeon.rooms.flatMap((room) => room.map(({ mob_type }) => mob_type))),
]

/** Search finds places by their residents, ordinary/rare harvests, protectors, or dungeon. */
export const place_matches = (
  query: string,
  place: WorldPlace,
  mob_name: (id: string) => string,
  item_name: (id: string) => string
): boolean => {
  const mobs = [
    ...place.mob_types,
    ...place.resources.map(({ protector }) => protector),
    ...(place.dungeon ? dungeon_mobs(place.dungeon) : []),
  ]
  const items = place.resources.flatMap(({ item_type, rare_item_type }) => [item_type, rare_item_type])
  const names = [
    place.id,
    titleize(place.id),
    titleize(place.dungeon?.dungeon ?? ''),
    ...mobs.flatMap((id) => [id, mob_name(id)]),
    ...items.flatMap((id) => [id, item_name(id)]),
  ]
  return names.some((name) => name.toLowerCase().includes(query.trim().toLowerCase()))
}

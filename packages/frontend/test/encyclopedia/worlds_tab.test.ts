// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import { dungeon_mobs, place_matches, world_places } from '../../src/encyclopedia/world_locations.ts'

const world = encyclopedia_catalog.world('nauvis')!
const places = world_places(world, encyclopedia_catalog.mobs, encyclopedia_catalog.dungeons)

test('world places use explicit biome and city gatherable memberships', () => {
  expect(places.filter(({ kind }) => kind === 'biome')).toHaveLength(world.terrain!.biomes.length)
  expect(places.filter(({ kind }) => kind === 'city')).toHaveLength(world.cities.length)
  const plains = places.find(({ key }) => key === 'biome:plains')!
  const thebes = places.find(({ key }) => key === 'city:thebes')!
  expect(plains.resources.map(({ item_type }) => item_type)).toContain('wheat')
  expect(plains.resources.map(({ item_type }) => item_type)).not.toContain('quartz')
  expect(thebes.resources.map(({ item_type }) => item_type)).toEqual(['wheat', 'green_mushroom', 'quartz'])
  expect(thebes.dungeon?.dungeon).toBe('gilded_lorito')
  expect(places.find(({ key }) => key === 'biome:ocean')!.resources).toEqual([])
})

test('roaming archimobs inherit locations, while protectors and dungeon-only mobs remain separate', () => {
  const source = {
    ...world,
    mobs: [{ mob_type: 'roamer', weight_bp: 10000, biomes: ['plains'], cities: ['thebes'] }],
    resources: [{ ...world.resources[0]!, protector: 'protector' }],
  }
  const mobs = [
    { mob_type: 'roamer', family: 'family', element: 'earth', role: 'normal' },
    { mob_type: 'archi', family: 'family', element: 'earth', role: 'archi' },
    { mob_type: 'protector', family: 'other', element: 'earth', role: 'protector' },
    { mob_type: 'boss', family: 'other', element: 'earth', role: 'boss' },
  ]
  const dungeons = [{ dungeon: 'gilded_lorito', key: 'key', rooms: [[{ mob_type: 'boss' }], [{ mob_type: 'boss' }]] }]
  const result = world_places(source, mobs, dungeons)
  const city = result.find(({ key }) => key === 'city:thebes')!
  expect(city.mob_types).toEqual(['roamer', 'archi'])
  expect(city.resources[0]!.protector).toBe('protector')
  expect(dungeon_mobs(city.dungeon!)).toEqual(['boss'])
  expect(result.find(({ key }) => key === 'biome:forest')!.mob_types).toEqual([])
})

test('search finds locations through resource, rare harvest, protector, and dungeon names', () => {
  const mob_name = (id: string) => encyclopedia_catalog.mob(id)?.mob.name ?? id
  const item_name = (id: string) => encyclopedia_catalog.item(id)?.item.name ?? id
  const plains = places.find(({ key }) => key === 'biome:plains')!
  const city = places.find(({ key }) => key === 'city:thebes')!
  expect(place_matches(' WHEAT ', plains, mob_name, item_name)).toBeTrue()
  expect(place_matches(item_name(plains.resources[0]!.rare_item_type), plains, mob_name, item_name)).toBeTrue()
  expect(place_matches(mob_name(plains.resources[0]!.protector), plains, mob_name, item_name)).toBeTrue()
  expect(place_matches('Gilded Lorito', city, mob_name, item_name)).toBeTrue()
  expect(place_matches('nothing matches', city, mob_name, item_name)).toBeFalse()
})

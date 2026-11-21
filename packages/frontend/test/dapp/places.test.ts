// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { PET_SPEED_MULTIPLIER, SPEED_BUDGET_BLOCKS_PER_SECOND, travel_proof_ready } from '@aresrpg/protocol'

import dungeons from '../../../../seed/content/dungeons.json'
import mobs from '../../../../seed/content/mobs.json'
import worlds from '../../../../seed/content/worlds.json'
import { account_bag } from '../../src/dapp/account.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import {
  city_potion,
  difficulty_fits,
  dungeon_rooms,
  key_drops,
  key_sources,
  place_area,
  place_drops,
  place_levels,
  quest_places,
  quest_worlds,
  rarest_drop,
  travel_potion,
  walk_seconds,
} from '../../src/dapp/places.ts'

import { HERO, account_fixture, character_fixture, item_fixture } from './fixtures.ts'

const nauvis = worlds.find(({ world }) => world === 'nauvis')!
const [thebes, ruins] = nauvis.cities
const lorito = dungeons.find((row) => row.dungeon === thebes!.dungeon)!
const mob = (mob_type: string) => mobs.find((row) => row.mob_type === mob_type)!
const at = (x: number, z: number, row: Parameters<typeof character_fixture>[0] = {}) =>
  character_fixture({ world: 'nauvis', checkpoint_world: 'nauvis', x, z, ...row })
const in_thebes = at(thebes!.x, thebes!.z)
const in_ruins = at(ruins!.x, ruins!.z)

test('a quest goes to the worlds and places of the seed that hold monsters, and to none it invents', () => {
  // Yakutia has no monster yet: it is not offered. A world opens at its entry level.
  expect(quest_worlds([character_fixture({ level: 3 })])).toEqual([{ world: 'nauvis', entry_level: 1, open: true }])
  expect(quest_worlds([])).toEqual([{ world: 'nauvis', entry_level: 1, open: false }])
  const places = quest_places('nauvis')
  expect(places.filter(({ kind }) => kind === 'city').map(({ id }) => id)).toEqual(
    nauvis.cities.map(({ city }) => city)
  )
  expect(places.every(({ mob_types }) => mob_types.length > 0)).toBe(true)
  expect(places.some(({ kind }) => kind === 'biome')).toBe(true)
  expect(quest_places('yakutia')).toEqual([])
  expect(quest_places('no_such_world')).toEqual([])
  // A place is named to a Start the way the binder takes it.
  expect(place_area('nauvis', { kind: 'city', id: 'thebes' })).toEqual({ world: 'nauvis', city: 'thebes' })
  expect(place_area('nauvis', { kind: 'biome', id: 'forest' })).toEqual({ world: 'nauvis', biome: 'forest' })
})

test('a place says the level band of its monsters and what they drop, at the seed’s own rates', () => {
  const city = quest_places('nauvis').find(({ id }) => id === thebes!.city)!
  const residents = city.mob_types.map(mob)
  expect(place_levels(city.mob_types)).toEqual({
    min: Math.min(...residents.map(({ level_min }) => level_min)),
    max: Math.max(...residents.map(({ level_max }) => level_max)),
  })
  expect(place_levels([])).toBeNull()
  expect(place_levels(['no_such_monster'])).toBeNull()
  const drops = place_drops(city.mob_types)
  // Every loot row of every resident, once, most frequent first.
  expect(drops).toHaveLength(residents.reduce((total, { loot }) => total + loot.length, 0))
  expect(drops.map(({ chance_bp }) => chance_bp)).toEqual(
    drops.map(({ chance_bp }) => chance_bp).toSorted((a, b) => b - a)
  )
  expect(place_drops([...city.mob_types, ...city.mob_types])).toEqual(drops)
  const [first] = drops
  expect(mob(first!.mob_type).loot).toContainEqual(
    expect.objectContaining({ item_type: first!.item_type, chance_bp: first!.chance_bp })
  )
  // The keys that drop there are dungeon keys of the seed; the rarest drop is never a key and carries no price.
  const keys = dungeons.map(({ key }) => key)
  expect(key_drops(city.mob_types).every(({ item_type }) => keys.includes(item_type))).toBe(true)
  expect(key_drops(city.mob_types).length).toBeGreaterThan(0)
  const rarest = rarest_drop(city.mob_types)!
  expect(keys).not.toContain(rarest.item_type)
  expect(Object.keys(rarest).toSorted()).toEqual(['chance_bp', 'item_type', 'mob_type'])
  const lowest = Math.min(
    ...drops.filter(({ item_type }) => !keys.includes(item_type)).map(({ chance_bp }) => chance_bp)
  )
  expect(rarest.chance_bp).toBe(lowest)
  expect(rarest_drop([])).toBeNull()
})

test('a key says which monsters drop it and where they live, most frequent first', () => {
  const sources = key_sources(lorito.key)
  expect(sources.length).toBeGreaterThan(0)
  for (const { mob_type, chance_bp, locations } of sources) {
    expect(mob(mob_type).loot).toContainEqual(expect.objectContaining({ item_type: lorito.key, chance_bp }))
    expect(locations).toEqual(content_catalog.mob(mob_type)!.locations)
  }
  expect(sources.map(({ chance_bp }) => chance_bp)).toEqual(
    sources.map(({ chance_bp }) => chance_bp).toSorted((a, b) => b - a)
  )
  expect(key_sources('no_such_key')).toEqual([])
})

test('a dungeon is its rooms in order: their monsters, level bands and drops, the last one the boss room', () => {
  const rooms = dungeon_rooms(content_catalog.dungeon(lorito.dungeon)!)
  expect(rooms.map(({ room }) => room)).toEqual(lorito.rooms.map((_, index) => index + 1))
  expect(rooms.map(({ boss }) => boss)).toEqual(lorito.rooms.map((_, index) => index === lorito.rooms.length - 1))
  rooms.forEach(({ mob_types, levels, drops }, index) => {
    const authored = [...new Set(lorito.rooms[index]!.map(({ mob_type }) => mob_type))]
    expect(mob_types).toEqual(authored)
    expect(levels).toEqual(place_levels(authored))
    expect(drops).toEqual(place_drops(authored))
  })
  // The boss lives in the last room.
  expect(rooms.at(-1)!.mob_types.map((mob_type) => mob(mob_type).role)).toContain('boss')
})

test('the time on foot to a city is the chain’s own walking rule: a floor, shorter with a pet', () => {
  const to_ruins = { world: 'nauvis', city: ruins!.city }
  expect(walk_seconds(in_ruins, to_ruins)).toBe(0)
  const seconds = walk_seconds(in_thebes, to_ruins)!
  // It is the straight way to the nearest edge of the city: never longer than the way to the city's own point,
  // and the chain proves no arrival there any sooner.
  const leg = { from_x: thebes!.x, from_z: thebes!.z, from_ms: 0, to_x: ruins!.x, to_z: ruins!.z }
  const walking = { ...leg, pet_at_start: false, pet_now: false }
  const straight = Math.hypot(ruins!.x - thebes!.x, ruins!.z - thebes!.z) / SPEED_BUDGET_BLOCKS_PER_SECOND
  expect(seconds).toBeGreaterThan(0)
  expect(seconds).toBeLessThanOrEqual(Math.ceil(straight))
  expect(travel_proof_ready({ ...walking, now_ms: Math.ceil(straight) * 1_000 })).toBe(true)
  expect(travel_proof_ready({ ...walking, now_ms: (seconds - 1) * 1_000 })).toBe(false)
  const riding = walk_seconds({ ...in_thebes, pet: true }, to_ruins)!
  expect(riding).toBeLessThan(seconds)
  expect(riding).toBeGreaterThanOrEqual(Math.floor(seconds / PET_SPEED_MULTIPLIER))
  // No figure for a biome, a whole world, another world, or a checkpoint the page cannot trust.
  expect(walk_seconds(in_thebes, { world: 'nauvis', biome: 'forest' })).toBeNull()
  expect(walk_seconds(in_thebes, { world: 'nauvis' })).toBeNull()
  expect(walk_seconds(in_thebes, { world: 'yakutia', city: 'thebes' })).toBeNull()
  expect(walk_seconds(character_fixture({ checkpoint_world: 'yakutia' }), to_ruins)).toBeNull()
  expect(walk_seconds(at(Number.NaN, 0), to_ruins)).toBeNull()
})

test('a difficulty fits a city only at the distance that city stands at; a world or a biome spans them all', () => {
  const fits = (city: string) =>
    (['easy', 'medium', 'hard'] as const).filter((level) => difficulty_fits({ world: 'nauvis', city }, level))
  expect(fits('thebes')).toEqual(['easy'])
  expect(fits('the_ruins')).toEqual(['hard'])
  expect(fits('fuwage')).toEqual(['hard'])
  expect(fits('no_such_city')).toEqual([])
  for (const level of ['easy', 'medium', 'hard'] as const) {
    expect(difficulty_fits({ world: 'nauvis' }, level)).toBe(true)
    expect(difficulty_fits({ world: 'nauvis', biome: 'forest' }, level)).toBe(true)
  }
})

test('a city potion is offered only to a hero that holds one in its own kiosk and does not stand there yet', () => {
  const to_ruins = { world: 'nauvis', city: ruins!.city }
  expect(city_potion('the_ruins')).toBe('potion_of_the_ruins')
  expect(city_potion('no_such_city')).toBeNull()
  const potion = { ...item_fixture('potion_of_the_ruins', 2, 'p1'), category: 'consumable' }
  const bag = (more: Parameters<typeof account_fixture>[0] = {}) =>
    account_bag(account_fixture({ items: [potion], ...more }))!
  expect(travel_potion(bag(), in_thebes, to_ruins)).toMatchObject({ id: 'p1', item_type: 'potion_of_the_ruins' })
  // Already there: the potion would change nothing, so it is never offered.
  expect(travel_potion(bag(), in_ruins, to_ruins)).toBeNull()
  // No potion for a biome or a whole world; the potion of another city is not this city's.
  expect(travel_potion(bag(), in_thebes, { world: 'nauvis', biome: 'forest' })).toBeNull()
  expect(travel_potion(bag(), in_thebes, { world: 'nauvis' })).toBeNull()
  expect(travel_potion(bag(), in_ruins, { world: 'nauvis', city: thebes!.city })).toBeNull()
  // A potion in another kiosk, one a listing locks, and a hero of another world.
  expect(travel_potion(bag({ items: [{ ...potion, kiosk: '0xother' }] }), in_thebes, to_ruins)).toBeNull()
  expect(travel_potion(bag({ listings: [{ id: 'p1' }] }), in_thebes, to_ruins)).toBeNull()
  const far = character_fixture({ id: HERO, world: 'yakutia', checkpoint_world: 'yakutia' })
  expect(travel_potion(bag(), far, to_ruins)).toBeNull()
})

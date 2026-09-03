// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { compile_world_recipe, parse_world_recipe, world_terrain } from '@aresrpg/engine'

import { city_collision_readiness } from '../../src/game/core/world.ts'

test('collision requests each city artifact when residency reaches it', async () => {
  const terrain = world_terrain('nauvis')
  if (!terrain) throw new Error('Nauvis terrain is missing')
  const world = compile_world_recipe(parse_world_recipe(terrain), { city_terrain: false })
  const requested: string[] = []
  const resolvers = new Map<string, () => void>()
  let ready_count = 0
  const readiness = city_collision_readiness(
    world,
    () => {
      ready_count += 1
    },
    (cities) =>
      new Promise<void>((resolve) => {
        const [city] = cities
        if (!city) throw new Error('collision requested no city')
        requested.push(city.id)
        resolvers.set(city.id, resolve)
      })
  )
  const thebes = world.structures.cities.find(({ id }) => id === 'thebes')!
  const ruins = world.structures.cities.find(({ id }) => id === 'the_ruins')!
  const fuwage = world.structures.cities.find(({ id }) => id === 'fuwage')!

  expect(readiness(thebes.area)).toBeFalse()
  expect(requested).toEqual(['thebes'])
  resolvers.get('thebes')!()
  await Promise.resolve()
  expect(readiness(thebes.area)).toBeTrue()

  expect(readiness(ruins.area)).toBeFalse()
  expect(requested).toEqual(['thebes', 'the_ruins'])
  resolvers.get('the_ruins')!()
  await Promise.resolve()
  expect(readiness(ruins.area)).toBeTrue()

  expect(readiness(fuwage.area)).toBeFalse()
  expect(requested).toEqual(['thebes', 'the_ruins', 'fuwage'])
  resolvers.get('fuwage')!()
  await Promise.resolve()
  expect(readiness(fuwage.area)).toBeTrue()
  expect(ready_count).toBe(3)
})

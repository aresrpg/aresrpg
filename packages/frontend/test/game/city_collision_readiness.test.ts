// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { compile_world_recipe, parse_world_recipe, world_terrain } from '@aresrpg/engine'

import { city_collision_readiness } from '../../src/game/core/world_collision.ts'

test('loading one city chunk cannot mark an unrequested chunk ready', async () => {
  const world = compile_world_recipe(world_terrain('nauvis'), { city_terrain: false })
  const city = world.structures.cities.find(({ id }) => id === 'thebes')!
  const x = Math.ceil(city.area.min_x / 32) * 32
  const z = Math.ceil(city.area.min_z / 32) * 32
  const area = { min_x: x, max_x: x + 31, min_z: z, max_z: z + 31 }
  const resolvers: (() => void)[] = []
  let ready_count = 0
  const ready = city_collision_readiness(
    world,
    () => {
      ready_count += 1
    },
    () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve)
      })
  )
  expect(ready(area)).toBe(false)
  expect(ready(area)).toBe(false)
  expect(resolvers).toHaveLength(1)
  resolvers[0]!()
  await Promise.resolve()
  expect(ready(area)).toBe(true)
  expect(ready({ ...area, min_x: x + 32, max_x: x + 63 })).toBe(false)
  expect(resolvers).toHaveLength(2)
  expect(ready_count).toBe(1)
  resolvers[1]!()
  await Promise.resolve()
  expect(ready({ ...area, min_x: x + 32, max_x: x + 63 })).toBe(true)
})

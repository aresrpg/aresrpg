// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { compile_runtime_world_recipe } from '@aresrpg/engine'

import { LIFECYCLE_WORLD } from '../../../../engine/test/browser_lifecycle.ts'
import { create_world_collision } from '../../../src/game/core/world_collision.ts'

// Observe actual projection work without timing thresholds or production-sized city artifacts.
const fixture = () => {
  const compiled = compile_runtime_world_recipe({
    ...LIFECYCLE_WORLD,
    portal: false,
    fixed_structures: [
      {
        origin: [0, 2, 0],
        rotation: 0,
        scale: 1,
        source: { name: 'collision-test', size: [1, 1, 1], anchor: [0, 0, 0], blocks: [[0, 0, 0, 'stone']] },
      },
    ],
  })
  let projections = 0
  const packs = new Proxy(compiled.structures.packs, {
    get: (target, key, receiver) =>
      key === 'flatMap'
        ? new Proxy(target.flatMap, {
            apply: (method, receiver, args) => {
              projections++
              return Reflect.apply(method, receiver, args)
            },
          })
        : Reflect.get(target, key, receiver),
  })
  const world = { ...compiled, structures: { ...compiled.structures, packs } }
  return {
    collision: create_world_collision(world, (error) => {
      throw error
    }),
    projections: () => projections,
  }
}

test('collision reuses a completed immutable column for repeated block queries', () => {
  const { collision, projections } = fixture()
  expect(collision.solid_at(0, 2, 0)).toBe(true)
  expect(collision.solid_at(0, 3, 0)).toBe(false)
  for (let query = 0; query < 100; query++) collision.solid_at(0, 2, 0)
  expect(projections()).toBe(1)
})

test('one new collision column evicts the oldest projection, not every retained column', () => {
  const { collision, projections } = fixture()
  for (let column = 0; column < 256; column++) collision.structure_material_at(column * 32, 2, 0)
  expect(projections()).toBe(256)
  collision.structure_material_at(256 * 32, 2, 0)
  collision.structure_material_at(255 * 32, 2, 0)
  expect(projections()).toBe(257)
  collision.structure_material_at(0, 2, 0)
  expect(projections()).toBe(258)
})

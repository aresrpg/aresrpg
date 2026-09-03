// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { decorate_thebes_building } from '../../src/cities/thebes/structures/building_architecture.ts'

const key = (x: number, y: number, z: number): string => `${x}:${y}:${z}`

test('stone houses receive filled wooden roofs and shuttered windows without exterior holes', () => {
  const blocks = new Map<string, string>()
  decorate_thebes_building(
    {
      set: (x, y, z, material) => blocks.set(key(x, y, z), material),
      clear: (x, y, z) => blocks.delete(key(x, y, z)),
    },
    {
      style: 'house',
      origin_x: 0,
      origin_z: 0,
      datum: 0,
      width: 15,
      depth: 15,
      floors: 1,
      wall: 'thebes_limestone',
      roof: 'temperate_wood',
      entrance: 4,
      seed: 0,
    }
  )

  expect(blocks.get(key(3, 2, 0))).toBe('thebes_tile')
  for (let inset = 0; inset <= 9; inset += 1)
    for (let z = -2 + inset; z <= 17 - inset; z += 1)
      for (let x = -2; x <= 17; x += 1) expect(blocks.has(key(x, 5 + inset, z))).toBeTrue()
  expect([...blocks.values()].filter((material) => material === 'temperate_wood').length).toBeGreaterThan(1_000)
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { derive_mob_filter_rows, filter_mob_types } from '../../src/content/mob_filters.ts'

const mobs = Object.freeze([
  Object.freeze({ mob_type: 'ant', family: 'ant', element: 'fire', role: 'trash' }),
  Object.freeze({ mob_type: 'ant__samurai', family: 'ant', element: 'air', role: 'archi' }),
  Object.freeze({ mob_type: 'fuwa', family: 'fuwa', element: 'earth', role: 'trash' }),
  Object.freeze({ mob_type: 'city_boss', family: 'boss', element: 'water', role: 'boss' }),
])

const worlds = Object.freeze([
  Object.freeze({
    world: 'nauvis',
    biome_names: Object.freeze(['plains', 'forest']),
    mobs: Object.freeze([
      Object.freeze({ mob_type: 'ant', biomes: Object.freeze(['forest']), cities: Object.freeze(['thebes']) }),
      Object.freeze({ mob_type: 'fuwa', biomes: Object.freeze(['plains']) }),
    ]),
    protectors: Object.freeze([]),
    cities: Object.freeze([Object.freeze({ city: 'thebes' })]),
  }),
])

test('mob taxonomy derives archimob and city placement and composes place, family, and element filters', () => {
  const rows = derive_mob_filter_rows(mobs, worlds)

  expect(rows).toContainEqual({
    kind: 'biome',
    id: 'nauvis:forest',
    parent: 'nauvis',
    count: 2,
    mob_types: ['ant', 'ant__samurai'],
  })
  expect(rows).toContainEqual({
    kind: 'city',
    id: 'nauvis:thebes',
    parent: 'nauvis',
    count: 2,
    mob_types: ['ant', 'ant__samurai'],
  })
  expect(rows.find((row) => row.kind === 'world' && row.id === 'nauvis')?.mob_types).toEqual([
    'ant',
    'fuwa',
    'ant__samurai',
  ])
  expect(
    filter_mob_types(
      mobs.map(({ mob_type }) => mob_type),
      rows,
      [
        { kind: 'world', ids: ['nauvis'] },
        { kind: 'biome', ids: ['nauvis:forest'] },
        { kind: 'family', ids: ['ant'] },
        { kind: 'element', ids: ['air', 'fire'] },
      ]
    )
  ).toEqual(['ant', 'ant__samurai'])
})

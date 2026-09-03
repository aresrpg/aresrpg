// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { world_mob_groups } from '../../src/encyclopedia/WorldsTab.tsx'

test('world details group mob identities by explicit biome and city membership', () => {
  const groups = world_mob_groups({
    terrain: { biomes: [{ name: 'forest' }, { name: 'desert' }] },
    cities: [{ city: 'thebes' }, { city: 'the_ruins' }],
    mobs: [
      { mob_type: 'ant', biomes: ['forest'], cities: [] },
      { mob_type: 'spider', biomes: ['desert'], cities: ['the_ruins'] },
      { mob_type: 'lorito', biomes: ['forest'], cities: ['thebes'] },
    ],
  } as never)

  expect(groups).toEqual({
    biomes: [
      { id: 'forest', mob_types: ['ant', 'lorito'] },
      { id: 'desert', mob_types: ['spider'] },
    ],
    cities: [
      { id: 'thebes', mob_types: ['lorito'] },
      { id: 'the_ruins', mob_types: ['spider'] },
    ],
  })
})

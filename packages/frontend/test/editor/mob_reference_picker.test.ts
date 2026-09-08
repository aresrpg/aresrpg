// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { mob_picker_facets } from '../../src/editor/MobReferencePicker.tsx'
import type { MobFilterRow } from '../../src/content/mob_filters.ts'

test('the mob picker retains only facets containing its candidate mobs', () => {
  const filters: readonly MobFilterRow[] = [
    { kind: 'world', id: 'fixture_world', count: 2, mob_types: ['candidate', 'other'] },
    { kind: 'biome', id: 'fixture_world:grove', parent: 'fixture_world', count: 1, mob_types: ['candidate'] },
    { kind: 'city', id: 'fixture_world:town', parent: 'fixture_world', count: 1, mob_types: ['other'] },
    { kind: 'family', id: 'fixture_family', count: 1, mob_types: ['candidate'] },
    { kind: 'element', id: 'earth', count: 1, mob_types: ['candidate'] },
  ]
  const facets = mob_picker_facets(new Set(['candidate']), filters)
  expect(facets.map(({ id }) => id)).toEqual([
    'world:fixture_world',
    'biome:fixture_world:grove',
    'family:fixture_family',
    'element:earth',
  ])
  expect(facets.find(({ id }) => id === 'biome:fixture_world:grove')?.parent).toBe('fixture_world')
})

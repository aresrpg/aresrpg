// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { item_picker_facets } from '../../src/editor/ItemReferencePicker.tsx'
import type { ItemReferenceFilterRow } from '../../src/editor/content_list.ts'

test('the recipe item picker exposes category, world, and mob-family facets', () => {
  const rows: readonly ItemReferenceFilterRow[] = [
    { kind: 'category', id: 'resource', count: 2, item_types: ['wheat', 'fuwa_wool'] },
    { kind: 'world', id: 'nauvis', count: 2, item_types: ['wheat', 'fuwa_wool'] },
    { kind: 'family', id: 'fuwa', count: 1, item_types: ['fuwa_wool'] },
  ]

  expect(item_picker_facets(new Set(['wheat', 'fuwa_wool']), rows).map(({ id, section }) => ({ id, section }))).toEqual(
    [
      { id: 'category:resource', section: 'Categories' },
      { id: 'world:nauvis', section: 'Worlds' },
      { id: 'family:fuwa', section: 'Mob families' },
    ]
  )
})

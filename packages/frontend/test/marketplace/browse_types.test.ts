// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { content_catalog } from '../../src/content/catalog.ts'
import { browse_types } from '../../src/marketplace/browse_types.ts'

test('a listed resource remains discoverable without any row in the bounded listing window', () => {
  const [first, missing] = content_catalog.items.filter(({ category }) => category === 'resource')
  const types = [first!, missing!].map(({ item_type, name, level }) => ({
    item_type,
    category: 'resource' as const,
    name,
    level,
  }))
  const listings = Array.from({ length: 200 }, (_, index) => ({ ...first!, kind: 'item', id: String(index) }))
  const rows = browse_types(types, listings as never, 'resource', '')
  expect(rows.map(({ item_type }) => item_type)).toContain(missing!.item_type)
  expect(rows.find(({ item_type }) => item_type === missing!.item_type)?.rows).toEqual([])
  expect(browse_types(types, listings as never, 'resource', missing!.name).map(({ item_type }) => item_type)).toContain(
    missing!.item_type
  )
})

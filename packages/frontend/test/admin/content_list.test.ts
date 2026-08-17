// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { content_navigation_domains, item_category_rows, order_content_rows } from '../../src/admin/content_list.ts'
import type { SeedEntityRow } from '../../src/admin/seed_editor.ts'

const row = (id: string, name: string, category: string, level: number): SeedEntityRow =>
  Object.freeze({ id, label: name, path: Object.freeze([]), value: Object.freeze({ name, category, level }) })

test('recipes stay loaded data but are not a standalone content tab', () => {
  expect(content_navigation_domains.map(({ id }) => id)).not.toContain('recipes')
})

test('items order by level then name and project a separate category column', () => {
  const rows = [row('late', 'Zulu', 'staff', 80), row('alpha', 'Alpha', 'sword', 10), row('beta', 'Beta', 'sword', 10)]
  expect(order_content_rows('items', rows).map(({ id }) => id)).toEqual(['alpha', 'beta', 'late'])
  expect(item_category_rows(rows)).toEqual([
    { category: 'staff', count: 1 },
    { category: 'sword', count: 2 },
  ])
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import items from '../../../../seed/content/items.json'
import mobs from '../../../../seed/content/mobs.json'
import recipes from '../../../../seed/content/recipes.json'
import shop from '../../../../seed/content/shop.json'
import type { JsonValue, SeedDomain } from '../../src/admin/seed_editor.ts'

mock.module('../../src/content/assets.ts', () => ({
  item_icon: (id: string) => `/items/${id}.webp`,
  mob_icon: (id: string) => `/mobs/${id}.webp`,
  spell_icon: () => '/spell.webp',
}))

const { ContentEntityEditor } = await import('../../src/admin/ContentEntityEditor.tsx')

const render_editor = (domain: SeedDomain, value: JsonValue): string =>
  renderToStaticMarkup(
    <ContentEntityEditor domain={domain} is_readonly={() => false} on_change={() => undefined} value={value} />
  )

test('item editing is a semantic Dofus power sheet, not an appearance block form', () => {
  const html = render_editor('items', items[0] as unknown as JsonValue)
  expect(html).toContain('data-content-editor="item"')
  expect(html).toContain('Dofus item power')
  expect(html).toContain('Donor p10–p90')
  expect(html).toContain('data-item-stats=""')
  expect(html).toContain('data-item-damages=""')
  expect(html).not.toContain('>Appearance<')
})

test('mob editing keeps the combat sheet and editable shared spell cards together', () => {
  const html = render_editor('mobs', mobs[0] as JsonValue)
  expect(html).toContain('data-content-editor="mob"')
  expect(html).toContain('Level range')
  expect(html).toContain('data-mob-resistances=""')
  expect(html).toContain('data-spell-detail-card=""')
  expect(html).toContain('data-mob-loot=""')
})

test('recipes and shop use compact domain rows', () => {
  expect(render_editor('recipes', recipes[0] as JsonValue)).toContain('data-content-editor="recipe"')
  expect(render_editor('recipes', recipes[0] as JsonValue)).toContain('Craft XP')
  expect(render_editor('shop', shop.sales[0] as JsonValue)).toContain('data-content-editor="shop"')
})

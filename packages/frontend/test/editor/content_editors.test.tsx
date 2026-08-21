// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import items from '../../../../seed/content/items.json'
import mobs from '../../../../seed/content/mobs.json'
import recipes from '../../../../seed/content/recipes.json'
import shop from '../../../../seed/content/shop.json'
import type { ItemRecipeBinding } from '../../src/editor/ItemContentEditor.tsx'
import type { JsonValue, SeedDomain } from '../../src/editor/seed_editor.ts'

mock.module('../../src/content/assets.ts', () => ({
  item_icon: (id: string) => `/items/${id}.webp`,
  mob_icon: (id: string) => `/mobs/${id}.webp`,
  spell_icon: () => '/spell.webp',
}))

const { ContentEntityEditor } = await import('../../src/editor/ContentEntityEditor.tsx')

const render_editor = (domain: SeedDomain, value: JsonValue, item_recipe?: ItemRecipeBinding): string =>
  renderToStaticMarkup(
    <ContentEntityEditor
      domain={domain}
      is_readonly={() => false}
      item_recipe={item_recipe}
      on_change={() => undefined}
      value={value}
    />
  )

test('item editing is a semantic Dofus power sheet, not an appearance block form', () => {
  const html = render_editor('items', items[0] as unknown as JsonValue)
  expect(html).toContain('data-content-editor="item"')
  expect(html).toContain('Dofus item power')
  expect(html).toContain('Donor p10–p90')
  expect(html).toContain('data-item-detail-editable=""')
  expect(html).toContain('data-item-stats=""')
  expect(html).toContain('data-item-damages=""')
  expect(html).not.toContain('locked identity')
  expect(html.indexOf('data-active-item-stats')).toBeLessThan(html.indexOf('data-inactive-item-stats'))
  expect(html).not.toContain('>Appearance<')
})

test('mob editing keeps the combat sheet and editable shared spell cards together', () => {
  const html = render_editor('mobs', mobs[0] as JsonValue)
  expect(html).toContain('data-content-editor="mob"')
  expect(html).toContain('Level range')
  expect(html).toContain('data-mob-resistances=""')
  expect(html).toContain('data-spell-detail-card=""')
  expect(html).toContain('data-mob-loot=""')
  expect(html).toContain('data-item-reference-picker="loot item"')
  expect(html).toContain('Resource · Level 83')
  expect(html).not.toContain('aria-label="Loot item"')
  for (const stat of ['hp', 'ap', 'mp', 'agility', 'wisdom', 'xp'])
    expect(html).toContain(`data-mob-stat-icon="${stat}"`)
})

test('a domain row carries its own editor, and an item edits its authored recipe in place', () => {
  const recipe_binding: ItemRecipeBinding = {
    value: recipes[0] as JsonValue,
    change: () => undefined,
    category_changed: () => undefined,
    create: () => undefined,
    remove: () => undefined,
  }
  const item = items.find(({ item_type }) => item_type === recipes[0].output_type)!
  const html = render_editor('items', item as unknown as JsonValue, recipe_binding)
  expect(html).toContain('data-item-recipe=""')
  expect(html).toContain('Craft XP')
  expect(html).toContain('SWORD SMITH')
  expect(html).toContain('data-item-reference-picker="ingredient"')
  expect(html).not.toContain('aria-label="Profession"')
  expect(html).not.toContain('data-item-reference-picker="crafted item"')
  expect(html).not.toContain('aria-label="Ingredient"')

  // Non-weapons cannot add weapon damage, and a fallback profession stays authored.
  const helmet = items.find(({ category }) => category === 'helmet')!
  const helmet_recipe = recipes.find(({ output_type }) => output_type === helmet.item_type)!
  const helmet_binding: ItemRecipeBinding = { ...recipe_binding, value: helmet_recipe as JsonValue }
  expect(render_editor('items', helmet as unknown as JsonValue, helmet_binding)).not.toContain('+ Damage line')

  const fallback_recipe = recipes.find((recipe) => 'job' in recipe && recipe.job === 'ALCHEMIST')!
  const fallback_item = items.find(({ item_type }) => item_type === fallback_recipe.output_type)!
  expect(
    render_editor('items', fallback_item as unknown as JsonValue, {
      ...recipe_binding,
      value: fallback_recipe as JsonValue,
    })
  ).toContain('aria-label="Profession"')

  // Shop keeps its own compact domain row.
  expect(render_editor('shop', shop.sales[0] as JsonValue)).toContain('data-content-editor="shop"')
})

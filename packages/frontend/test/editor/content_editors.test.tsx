// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import items from '../../../../seed/content/items.json'
import mobs from '../../../../seed/content/mobs.json'
import recipes from '../../../../seed/content/recipes.json'
import type { ItemRecipeBinding } from '../../src/editor/ItemContentEditor.tsx'
import type { JsonValue, SeedDomain } from '../../src/editor/seed_editor.ts'

const { ContentEntityEditor } = await import('../../src/editor/ContentEntityEditor.tsx')
const { clone_mob_spell, same_family_spell_clones } = await import('../../src/editor/MobContentEditor.tsx')

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
  const tool = items.find(({ item_type }) => item_type === 'arcanite_hoe')!
  const html = render_editor('items', tool as unknown as JsonValue)
  expect(html).toContain('data-content-editor="item"')
  expect(html).toContain('Dofus item power')
  expect(html).toContain('Retro p10–p90')
  expect(html).not.toContain('UPU')
  expect(html).toContain('data-item-detail-editable=""')
  expect(html).toContain('data-item-stats=""')
  expect(html).not.toContain('data-item-damages=""')
  expect(html).not.toContain('locked identity')
  expect(html.indexOf('data-active-item-stats')).toBeLessThan(html.indexOf('data-inactive-item-stats'))
  expect(html).not.toContain('>Appearance<')

  const { level: _level, ...without_level } = tool
  const missing_level = render_editor('items', without_level as unknown as JsonValue)
  expect(missing_level).toContain('data-item-inline-edit="item level"')
  expect(missing_level).toContain('Lv. 0')
})

test('item power presents maximum-roll percentile instead of a median ratio', () => {
  const fuwa_hat = items.find(({ item_type }) => item_type === 'coiffe_fuwa__white')!
  const html = render_editor('items', fuwa_hat as unknown as JsonValue)

  expect(html).toContain('Authored max power')
  expect(html).toContain('Retro max-roll median')
  expect(html).toContain('Retro percentile')
  expect(html).toContain('P98')
  expect(html).toContain('left:98%')
  expect(html).toContain('1 exact level/power donor')
  expect(html).not.toContain('427%')
})

test('mob editing keeps the combat sheet and editable shared spell cards together', () => {
  const html = render_editor('mobs', mobs[0] as JsonValue)
  expect(html).toContain('data-content-editor="mob"')
  expect(html).toContain('data-mob-detail-header=""')
  expect(html).toContain('data-item-inline-edit="mob level"')
  expect(html).toContain(mobs[0].mob_type)
  expect(html).not.toContain('aria-label="Mob type"')
  expect(html).toContain('data-mob-resistances=""')
  expect(html).toContain('data-mob-power=""')
  expect(html).toContain('Dofus reference')
  expect(html).toContain('Average HP')
  expect(html).toContain('Average base XP')
  expect(html).toContain('before Dofus applies player level, party, wisdom, and star modifiers')
  expect(html).toContain('Average damage')
  expect(html).toContain('data-mob-stat-range="hp"')
  expect(html).toContain('data-mob-resistance-range="earth"')
  expect(html).toContain('data-mob-damage-range=""')
  expect(html.indexOf('data-mob-damage-range=""')).toBeLessThan(html.indexOf('>Spells<'))
  expect(html).not.toContain('Apply P50')
  expect(html).toContain('data-spell-detail-card=""')
  expect(html).toContain('data-mob-loot=""')
  expect(html).toContain('aria-label="Edit mob family"')
  expect(html).toContain('data-item-reference-picker="loot item"')
  expect(html).toContain('aria-label="Choose loot item"')
  expect(html).toContain('AP/MP dodge')
  expect(html).toContain('Tackle vs 200 AGI')
  expect(html).toContain('Single adjacent locker against a 200-Agility runner')
  expect(html).toContain('At full pool versus a 200-Wisdom attacker')
  for (const stat of ['hp', 'ap', 'mp', 'agility', 'tackle', 'dodge', 'wisdom', 'xp'])
    expect(html).toContain(`data-mob-stat-icon="${stat}"`)

  const loot_html = render_editor('mobs', {
    ...mobs[0],
    level_min: 10,
    level_max: 20,
    loot: [{ item_type: 'wheat', chance_bp: 5_000, min_qty: 1, max_qty: 2 }],
  } as JsonValue)
  expect(loot_html).toContain('data-mob-loot-chance-range=""')
  expect(loot_html).toContain('min 40% · max 60%')
  expect(loot_html).toContain('before team Chance')
})

test('mob spells can clone one complete spell from another mob in the live family draft', () => {
  const white = mobs.find(({ mob_type }) => mob_type === 'fuwa__white')!
  const black = mobs.find(({ mob_type }) => mob_type === 'fuwa__black')!
  const candidates = same_family_spell_clones(black as unknown as JsonValue, mobs as unknown as readonly JsonValue[])

  expect(candidates.map(({ name, source_type }) => ({ name, source_type }))).toEqual([
    { name: 'Fuwater', source_type: 'fuwa__fukuo' },
    { name: 'Takoya', source_type: 'fuwa__fukuo' },
  ])
  expect(
    same_family_spell_clones(white as unknown as JsonValue, mobs as unknown as readonly JsonValue[]).map(
      ({ name, source_type }) => ({ name, source_type })
    )
  ).toEqual([
    { name: 'Nifuwoost', source_type: 'fuwa__black' },
    { name: 'Fuwater', source_type: 'fuwa__fukuo' },
    { name: 'Takoya', source_type: 'fuwa__fukuo' },
  ])

  const clone = clone_mob_spell(candidates[0]!.spell)
  expect(clone).toEqual(candidates[0]!.spell)
  expect(clone).not.toBe(candidates[0]!.spell)

  const html = renderToStaticMarkup(
    <ContentEntityEditor
      domain="mobs"
      is_readonly={() => false}
      mob_templates={mobs as unknown as readonly JsonValue[]}
      on_change={() => undefined}
      value={black as unknown as JsonValue}
    />
  )
  expect(html).toContain(`aria-label="Clone ${candidates[0]!.name}"`)
  expect(html).toContain(`>Clone ${candidates[0]!.name}<`)
})

test('a domain row carries its own editor, and an item edits its authored recipe in place', () => {
  const recipe_binding: ItemRecipeBinding = {
    value: recipes[0] as unknown as JsonValue,
    change: () => undefined,
    category_changed: () => undefined,
    create: () => undefined,
    remove: () => undefined,
  }
  const item = items.find(({ item_type }) => item_type === recipes[0].output_type)!
  const html = render_editor('items', item as unknown as JsonValue, recipe_binding)
  expect(html).toContain('data-item-recipe=""')
  expect(html).toContain('Craft XP')
  expect(html).toContain('FARMER')
  expect(html).toContain('data-item-reference-picker="ingredient"')
  expect(html.match(/data-recipe-ingredient-row=""/g)).toHaveLength(Object.keys(recipes[0].inputs).length)
  expect(html).toContain('data-recipe-ingredient-placeholder=""')
  expect(html).toContain(`aria-label="${Object.keys(recipes[0].inputs)[0]} quantity"`)
  expect(html).toContain('min="1"')
  expect(html).toContain('step="1"')
  expect(html).toContain('aria-label="Remove ingredient"')
  expect(html).toContain('Next slot · job Lv. 10')
  expect(html).toContain('type="number"')
  expect(html).not.toContain('aria-label="Decrease ingredient quantity"')
  expect(html).not.toContain('aria-label="Increase ingredient quantity"')
  expect(html).not.toContain('>Remove<')
  expect(html).toContain('aria-label="Profession"')
  expect(html).not.toContain('data-item-reference-picker="crafted item"')
  expect(html).not.toContain('aria-label="Ingredient"')

  // Non-weapons cannot add weapon damage, and a fallback profession stays authored.
  const fallback_recipe = recipes.find((recipe) => 'job' in recipe && recipe.job === 'HERBALIST')!
  const fallback_item = items.find(({ item_type }) => item_type === fallback_recipe.output_type)!
  expect(
    render_editor('items', fallback_item as unknown as JsonValue, {
      ...recipe_binding,
      value: fallback_recipe as unknown as JsonValue,
    })
  ).toContain('aria-label="Profession"')
  expect(
    render_editor('items', fallback_item as unknown as JsonValue, {
      ...recipe_binding,
      value: fallback_recipe as unknown as JsonValue,
    })
  ).not.toContain('+ Damage line')

  const full_recipe = recipes.find((recipe) => Object.keys(recipe.inputs).length === 8)!
  const full_item = items.find(({ item_type }) => item_type === full_recipe.output_type)!
  const full_html = render_editor('items', full_item as unknown as JsonValue, {
    ...recipe_binding,
    value: full_recipe as unknown as JsonValue,
  })
  expect(full_html).toContain('8 / 8 ingredients')
  expect(full_html).not.toContain('data-recipe-ingredient-placeholder=""')

  // Shop keeps its own compact domain row.
  expect(render_editor('shop', { item_type: 'pet_box', price: 1, supply: null } as unknown as JsonValue)).toContain(
    'data-content-editor="shop"'
  )
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ItemDetailContext } from '../../src/components/ItemDetailContext.ts'
import { ItemDetailView } from '../../src/components/ItemDetailView.tsx'
import { ItemPetDiet } from '../../src/components/ItemPetDiet.tsx'
import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import { items } from '../../src/content/items.ts'
import { CatalogueItemDetails } from '../../src/encyclopedia/CatalogueItemDetails.tsx'
import { encyclopedia_text } from '../../src/encyclopedia/copy.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'

const pet = items.find((item) => item.category === 'pet' && (item.pet_foods?.length ?? 0) > 0)!
const detail = encyclopedia_catalog.item(pet.item_type)!
const text = encyclopedia_text(en as AppCopy)
const labels = { characteristics: 'Stats', damages: 'Damage', level_short: 'Level', range_to: 'to' }
const card = (item_type = pet.item_type, category = 'pet') => (
  <ItemDetailView {...pet} item_type={item_type} category={category} damages={[]} labels={labels} />
)

test('unknown pets and empty diets remain readable without invented foods', () => {
  const unknown = renderToStaticMarkup(card('unknown_pet'))
  const empty = renderToStaticMarkup(<ItemPetDiet item_type="unknown_pet" />)
  for (const html of [unknown, empty]) {
    expect(html).toContain('encyclopedia_page.no_diet')
    expect(html).not.toContain('data-encyclopedia-item-icon')
  }
  expect(renderToStaticMarkup(card(pet.item_type, 'resource'))).not.toContain('data-pet-diet')
})

test('full and summary pet cards list exactly the canonical diet with item artwork identities', async () => {
  const full = renderToStaticMarkup(card())
  const summary = renderToStaticMarkup(
    <ItemDetailContext.Provider value="summary">{card()}</ItemDetailContext.Provider>
  )
  expect(detail.pet_foods.map((food) => food.item_type)).toEqual([...pet.pet_foods!])
  for (const html of [full, summary]) {
    expect(html.match(/data-pet-diet=""/g)).toHaveLength(1)
    expect(html.match(/data-encyclopedia-item-icon=/g)).toHaveLength(detail.pet_foods.length)
    for (const food of detail.pet_foods) {
      expect(html).toContain(food.name)
      expect(html).toContain(`data-encyclopedia-item-icon="${food.item_type}"`)
      expect(await Bun.file(`seed/icons/items/${food.item_type}.png`).exists()).toBe(true)
    }
  }
  expect(summary).not.toContain('<button')
  expect(summary).not.toContain('full-fed')
  expect(full).toContain('<button')
})

test('catalogue cards retain their full-fed note and render the shared diet only once', () => {
  const html = renderToStaticMarkup(
    <CatalogueItemDetails
      item_type={pet.item_type}
      select_item={() => undefined}
      select_mob={() => undefined}
      select_world={() => undefined}
      text={text}
      stat_name={(stat) => stat}
    />
  )
  expect(html.match(/data-pet-diet=""/g)).toHaveLength(1)
  expect(html).toContain('These are the full-fed stats.')
})

test('diet copy exists in every supported locale', async () => {
  const paths = Array.from(new Bun.Glob('*.yaml').scanSync('packages/frontend/src/i18n/locales'))
  for (const path of paths) {
    const locale = Bun.YAML.parse(await Bun.file(`packages/frontend/src/i18n/locales/${path}`).text()) as AppCopy
    for (const key of ['pet_food', 'pet_diet_note', 'no_diet']) {
      expect(encyclopedia_text(locale)(key)).not.toBe(key)
    }
  }
})

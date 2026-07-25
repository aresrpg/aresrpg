// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Render proof for the two pet-food display surfaces (pet_food_section.tsx) — real EN i18n, real
// markup, the same static-render idiom as mob_spells_section.test.tsx. The pure join laws live in
// pet_foods.test.ts; here we pin that the components actually SHOW the food:
// tiles with icon+name+level in the encyclopedia section, count+icon strip in the hover row, and the
// honest nothing-minted gap (null, never an empty shell).
import { expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../i18n/locales/en.json'

import { PetFoodSection, PetFoodHoverRow } from './pet_food_section'

const EN_I18N = i18next.createInstance()
EN_I18N.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const ITEMS = [
  { id: '0xaaa', slug: 'barley_flour', name: 'Barley Flour', level: 1, category: 'RESOURCE' },
  { id: '0xbbb', slug: 'tokek_paw', name: 'Tokek Paw', level: 17, category: 'RESOURCE' },
  { id: '0xccc', slug: 'iron_sword', name: 'Iron Sword', level: 10, category: 'WEAPON' }, // not a food
]

test('PetFoodSection renders one navigable tile per living food with the FOOD title and the diet note', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={EN_I18N}>
      <PetFoodSection items={ITEMS} food_slugs={['barley_flour', 'tokek_paw']} on_select_item={() => {}} />
    </I18nextProvider>
  )
  expect(html).toContain('FOOD')
  expect(html).toContain('Eats one unit of any of these 2 foods, once per day.')
  expect(html).toContain('data-pet-food="barley_flour"')
  expect(html).toContain('data-pet-food="tokek_paw"')
  expect(html).toContain('Barley Flour')
  expect(html).toContain('Tokek Paw')
  // the non-food row never leaks in
  expect(html).not.toContain('Iron Sword')
})

test('PetFoodSection with no living food renders nothing (honest gap, never an empty shell)', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={EN_I18N}>
      <PetFoodSection items={ITEMS} food_slugs={['unminted_food']} on_select_item={() => {}} />
    </I18nextProvider>
  )
  expect(html).toBe('')
})

test('PetFoodHoverRow renders the count line plus a capped icon strip with the overflow badge', () => {
  const slugs = Array.from({ length: 11 }, (_, index) => `food_${index}`)
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={EN_I18N}>
      <PetFoodHoverRow food_slugs={slugs} />
    </I18nextProvider>
  )
  expect(html).toContain('data-pet-food-row')
  expect(html).toContain('FOOD')
  expect(html).toContain('Eats one unit of any of these 11 foods, once per day.')
  // 8 preview icons + the +3 overflow badge
  expect(html).toContain('food_0')
  expect(html).toContain('food_7')
  expect(html).not.toContain('food_8')
  expect(html).toContain('+3')
})

test('PetFoodHoverRow with nothing minted renders nothing', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={EN_I18N}>
      <PetFoodHoverRow food_slugs={[]} />
    </I18nextProvider>
  )
  expect(html).toBe('')
})

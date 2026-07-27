// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SIMULATOR'S ITEM HOVER CARD. Two properties, because a card that merely renders is not the ask:
//
//   1. it shows the MAX ROLL, labelled — the simulator equips ceilings, so an authored `+2 to +7` range would
//      describe a roll no build here ever gets, and an unlabelled `+7` would read as an ordinary roll;
//   2. it is the SAME arithmetic as the `(+X)` on the stat rows — card and stat row are one fact seen twice,
//      so they are pinned EQUAL here rather than trusted to stay in step.
//
// The chrome itself is deliberately not asserted beyond the label: it is the shared ItemDetailView the bag and
// the encyclopedia already render, and duplicating its markup expectations here would be a second home for
// what that component looks like.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../src/i18n/locales/en.json'
import type { CorpusItem } from '../../src/pages/encyclopedia/item_corpus'
import { equipment_aggregate } from '../../src/simulator/content.js'
import { MaxRollItemCard, picker_item_detail } from '../../src/simulator/LoadoutSection'

const test_i18n = i18next.createInstance()
void test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

// Ranges, a flat line, and a zero line — the three shapes an authored template carries.
const blade: CorpusItem = {
  id: 'hover-blade',
  name: 'Hover Blade',
  description: 'A blade for proving things.',
  category: 'longsword',
  item_type: 'hover_blade',
  level: 140,
  stats: {
    strength: [11, 87],
    vitality: [4, 316],
    agility: 23,
    chance: [0, 0],
  },
  damages: [],
}

test('the card projection is the MAX half of every authored range, zero lines dropped', () => {
  const detail = picker_item_detail(blade)

  expect(detail.stats).toEqual({ strength: 87, vitality: 316, agility: 23 })
  // A range's floor never reaches the card — it would describe a roll the simulator never equips.
  expect(Object.values(detail.stats)).not.toContain(11)
  expect(Object.values(detail.stats)).not.toContain(4)
})

test('the card renders flat max-roll lines under the MAX ROLL label, never a min-to-max range', () => {
  const markup = renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <MaxRollItemCard item={blade} />
    </I18nextProvider>
  )

  expect(markup).toContain(en.simulator.max_roll)
  expect(markup).toContain('+87')
  expect(markup).toContain('+316')
  expect(markup).toContain('+23')
  // `entity.range_to` is the word ItemDetailView puts between a range's halves. Its absence IS the proof
  // that the card collapsed to a single value rather than rendering the authored spread.
  expect(markup).not.toContain(`> ${en.entity.range_to} <`)
})

test('ONE HOME: the card shows exactly what the stat rows credit for the same item', () => {
  const credited = equipment_aggregate([blade])
  const shown = picker_item_detail(blade).stats

  for (const [stat, value] of Object.entries(shown)) expect(credited[stat]).toBe(value)
})

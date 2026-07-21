// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../../i18n/locales/en.json'

const item = (id: string, name: string, category: string) => ({
  id,
  kiosk_id: `kiosk-${id}`,
  template_id: `template-${id}`,
  slug: id,
  name,
  category,
  level: 1,
  quantity: 1,
  stackable: false,
})

const listable = [
  item('gear-equipped', 'Equipped Gear', 'HELMET'),
  item('gear-loose', 'Loose Gear', 'HELMET'),
  item('cosmetic-equipped', 'Equipped Cosmetic', 'CLOAK'),
  item('cosmetic-loose', 'Loose Cosmetic', 'CLOAK'),
  item('pet-equipped', 'Equipped Pet', 'PET'),
  item('pet-loose', 'Loose Pet', 'PET'),
]

// Mirrors boot_roster's shape: equipped GEAR under `equipment[]`, worn COSMETICS under `worn{}`, and the
// active PET under its OWN top-level `pet` field (never inside equipment[]) — the read-model home the sell
// filter must honour so a companion the player is actively using never shows up as sellable.
const characters = [
  {
    id: 'character-one',
    equipment: [{ item_id: 'gear-equipped', category: 'helmet' }],
    worn: {},
    pet: 'pet-equipped',
    pet_equipped: true,
  },
  {
    id: 'character-two',
    equipment: [],
    worn: { cloak: { item_id: 'cosmetic-equipped', category: 'cloak' } },
    pet: null,
    pet_equipped: false,
  },
]

const slugs = Object.fromEntries(listable.map((row) => [row.name, `asset-${row.id}`]))

mock.module('virtual:item_catalog', () => ({ catalog: {}, slugs }))
mock.module('../../stores/marketplace_chain', () => ({
  use_marketplace_chain: () => ({ listable, listable_loading: false, listable_characters: [] }),
}))
mock.module('../../game/store.js', () => ({
  use_game_state: (selector: (state: any) => any) => selector({ sui: { characters } }),
}))
mock.module('../item_send_modal', () => ({ ItemSendModal: () => null }))

const { InventoryPanel, aggregate_listable } = await import('./inventory_panel')

const test_i18n = i18next.createInstance()
test_i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

function render_inventory(): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <InventoryPanel
        selected_id={null}
        on_select={() => {}}
        selected_character_id={null}
        on_select_character={() => {}}
      />
    </I18nextProvider>
  )
}

describe('marketplace SELL inventory equipped filter', () => {
  test('excludes equipped gear, cosmetic, and pet across the wallet roster while keeping loose siblings', () => {
    const html = render_inventory()
    const equipped = ['gear-equipped', 'cosmetic-equipped', 'pet-equipped']
    const loose = ['gear-loose', 'cosmetic-loose', 'pet-loose']

    expect(equipped.filter((id) => html.includes(`asset-${id}`))).toEqual([])
    expect(loose.filter((id) => html.includes(`asset-${id}`))).toEqual(loose)
  })
})

// THE ONE GROUPING HOME (issue #10): aggregate_listable now delegates its stackable merge to the SAME
// group_by_stack_identity the HUD bag grid consumes (item_classification.ts) — pins the marketplace SELL
// grid's own canonical cases (previously uncovered) so the shared mechanism can't silently drift either side.
describe('aggregate_listable — the marketplace SELL grouping home', () => {
  const stack_item = (id: string, template_id: string, quantity: number, level = 1): any => ({
    id,
    kiosk_id: `kiosk-${id}`,
    template_id,
    slug: id,
    name: 'Wool',
    category: 'RESOURCE',
    level,
    quantity,
    stackable: true,
  })
  const single_item = (id: string, level = 1): any => ({
    id,
    kiosk_id: `kiosk-${id}`,
    template_id: `tpl-${id}`,
    slug: id,
    name: id,
    category: 'HELMET',
    level,
    quantity: 1,
    stackable: false,
  })

  test('sums same-template stackables into one synthetic stack: row and leaves non-stackables per-object', () => {
    const rows = [stack_item('0xa', '0xtpl-wool', 50), stack_item('0xb', '0xtpl-wool', 137), single_item('0xgear')]
    const out = aggregate_listable(rows)

    expect(out).toHaveLength(2)
    const wool = out.find((it: any) => it.template_id === '0xtpl-wool')
    expect(wool).toMatchObject({ id: 'stack:0xtpl-wool', quantity: 187 })
    expect(out.find((it: any) => it.id === '0xgear')).toMatchObject({ quantity: 1, stackable: false })
  })

  test('two different templates never merge, even at the same category', () => {
    const rows = [stack_item('0xa', '0xtpl-wool', 10), stack_item('0xb', '0xtpl-linen', 5)]
    const out = aggregate_listable(rows)

    expect(out.map((it: any) => it.quantity).sort((a: number, b: number) => a - b)).toEqual([5, 10])
  })

  test('grouped stacks sort before singles, both level-ascending', () => {
    const rows = [
      single_item('0xhigh', 9),
      stack_item('0xb', '0xtpl-wool', 5, 3),
      single_item('0xlow', 1),
      stack_item('0xc', '0xtpl-linen', 2, 7),
    ]
    const out = aggregate_listable(rows)

    expect(out.map((it: any) => it.id)).toEqual(['stack:0xtpl-wool', 'stack:0xtpl-linen', '0xlow', '0xhigh'])
  })
})

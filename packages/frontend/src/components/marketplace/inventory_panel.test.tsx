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

const { InventoryPanel } = await import('./inventory_panel')

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

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { configure_walrus_assets, item_icon_url } from '@aresrpg/sdk/jobs'

import en from '../i18n/locales/en.json'

import { shop_item_icon } from './shop_icon'
import { VitrineCard, type CardItem } from './shop_vitrine'
import { SHOP_AVAILABLE } from '../test_helpers/shop_fixture.js'

const read_json = (relative_url: string) => JSON.parse(readFileSync(new URL(relative_url, import.meta.url), 'utf8'))
// MISSING-ARTIFACT (#117): seed/mainnet/{shop,pet_boxes}.json is content-pipeline output, absent by design
// in this public repo — see test_helpers/shop_fixture.js.
const pet_boxes = SHOP_AVAILABLE ? read_json('../../../../seed/mainnet/pet_boxes.json') : { boxes: [] }
const asset_manifest = read_json('../../public/asset_manifest.json')

const rows = SHOP_AVAILABLE
  ? [
      ...read_json('../../../../seed/mainnet/shop.json').cosmetics.map((row: Record<string, string>) => ({
        ...row,
        stage: 'mannequin' as const,
      })),
      ...pet_boxes.boxes.map((row: Record<string, string>) => ({ ...row, stage: 'box' as const })),
    ]
  : []

const test_i18n = i18next.createInstance()
test_i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const BUY = { on_buy: () => {}, buying: false, disabled: false, sold_out: false }

function card_item(row: Record<string, string>): CardItem {
  return {
    item_id: `sale-${row.slug}`,
    item_template_id: row.itemType,
    render_name: row.name,
    category: row.category.toUpperCase(),
    price_mist: 1n,
    stock: 1,
    minted: 0,
    supply_cap: 1,
    percent_minted: 0,
  }
}

describe.skipIf(!SHOP_AVAILABLE)('live shop icon resolution', () => {
  test('all 37 sale templates render their exact published icon URL', () => {
    configure_walrus_assets(asset_manifest)
    expect(rows).toHaveLength(37)

    for (const row of rows) {
      const wearable = row.category === 'hat' || row.category === 'cloak'
      const icon = row.icon || row.itemType
      const hd = !wearable
      const asset_class = wearable ? 'cosmetic_icon' : 'item'
      const expected_url = item_icon_url(icon, { hd, asset_class })
      expect(expected_url, `${row.name}: empty resolver result`).toBeTruthy()

      const resolved = shop_item_icon(card_item(row), { hd })
      expect(resolved.image_url, `${row.name}: unresolved live template`).toBe(expected_url)

      const stage = row.name === 'Mark of the Unbroken' ? 'icon' : row.stage
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={test_i18n}>
          <VitrineCard
            item={card_item(row)}
            stage={stage}
            display_name={row.name}
            on_open_encyclopedia={() => {}}
            buy={BUY}
          />
        </I18nextProvider>
      )
      expect(html, `${row.name}: ${expected_url}`).toContain(`src="${expected_url}"`)
    }
  })
})

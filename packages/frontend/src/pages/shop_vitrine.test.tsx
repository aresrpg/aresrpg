// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { configure_assets } from '@aresrpg/sdk/jobs'

import en from '../i18n/locales/en.json'

import {
  VitrineCard,
  VaultCard,
  ordered_shop_section_keys,
  resolve_shop_render,
  shop_asset_url,
  sort_shop_items_by_price,
  type CardItem,
} from './shop_vitrine'

const CDN = 'https://cdn.aresrpg.world'
configure_assets({ aggregator: CDN, classes: { shop_render: { published: true } } })
const shop_url = (file: string) => `${CDN}/shop/${file}`

const test_i18n = i18next.createInstance()
test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const BUY = { on_buy: () => {}, buying: false, disabled: false, sold_out: false }
const ITEM: CardItem = {
  item_id: 'sale-1',
  item_template_id: 'hat',
  category: 'HAT',
  price_mist: 1_000_000_000n,
  stock: 10,
  minted: 0,
  supply_cap: 10,
  percent_minted: 0,
}

function render_card(item: CardItem) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <VitrineCard
        item={item}
        stage="mannequin"
        display_name={item.render_name ?? 'Missing cosmetic'}
        on_open_encyclopedia={() => {}}
        buy={BUY}
      />
    </I18nextProvider>
  )
}

describe('shop render aliases and published media', () => {
  test('resolves cosmetic reslugs and pet identity to CDN-backed media', () => {
    const bara = resolve_shop_render('bara_hood')
    const kamui = resolve_shop_render('kamui_cloak')
    const pet = resolve_shop_render('pet_bouloute')

    expect(bara).toMatchObject({
      identifier: 'capuche_bara',
      entry: { png_hd: 'capuche_bara_hd.png', video: 'capuche_bara_worn.webm' },
    })
    expect(kamui).toMatchObject({
      identifier: 'cape_kamui',
      entry: { video: 'cape_kamui_worn.webm' },
    })
    expect(pet).toMatchObject({
      identifier: 'pet_bouloute',
      entry: { kind: 'pet', video: 'pet_bouloute_pet.webm' },
    })
    expect(shop_asset_url(bara?.entry.video)).toBe(shop_url('capuche_bara_worn.webm'))
    expect(shop_asset_url(kamui?.entry.video)).toBe(shop_url('cape_kamui_worn.webm'))
    expect(shop_asset_url(pet?.entry.video)).toBe(shop_url('pet_bouloute_pet.webm'))
  })

  test('Bara Hood recolor: the old vitality/wisdom keys still resolve, now through to the renamed obsidian/moonstone media', () => {
    // seed-side shipped the recolor as NEW render files (unlike Lorito's label-only gem rename); the old
    // canonical keys become compat aliases so a legacy Display name or a saved selection never dead-ends.
    const legacy_vitality = resolve_shop_render('capuche_bara_vitality')
    const legacy_wisdom = resolve_shop_render('capuche_bara_wisdom')
    const legacy_bara_hood_vitality = resolve_shop_render('bara_hood_vitality')
    const legacy_bara_hood_wisdom = resolve_shop_render('bara_hood_wisdom')

    expect(legacy_vitality).toMatchObject({
      identifier: 'capuche_bara_obsidian',
      entry: { video: 'capuche_bara_obsidian_worn.webm' },
    })
    expect(legacy_wisdom).toMatchObject({
      identifier: 'capuche_bara_moonstone',
      entry: { video: 'capuche_bara_moonstone_worn.webm' },
    })
    expect(legacy_bara_hood_vitality?.identifier).toBe('capuche_bara_obsidian')
    expect(legacy_bara_hood_wisdom?.identifier).toBe('capuche_bara_moonstone')

    // The renamed identifiers resolve directly too (new inputs, not just old ones translating forward).
    expect(resolve_shop_render('capuche_bara_obsidian')?.identifier).toBe('capuche_bara_obsidian')
    expect(resolve_shop_render('capuche_bara_moonstone')?.identifier).toBe('capuche_bara_moonstone')
    expect(resolve_shop_render('bara_hood_obsidian')?.identifier).toBe('capuche_bara_obsidian')
    expect(resolve_shop_render('bara_hood_moonstone')?.identifier).toBe('capuche_bara_moonstone')

    expect(shop_asset_url(legacy_vitality?.entry.video)).toBe(shop_url('capuche_bara_obsidian_worn.webm'))
    expect(shop_asset_url(legacy_wisdom?.entry.video)).toBe(shop_url('capuche_bara_moonstone_worn.webm'))
  })

  test('resolves corrected cloak names and canonical Lorito gemstone names', () => {
    expect(resolve_shop_render('Momaku Cloak')?.identifier).toBe('momaku')
    expect(resolve_shop_render('Enka Muru Cloak')?.identifier).toBe('enka_muru')
    expect(resolve_shop_render('Lorito Cloak (Emerald)')?.identifier).toBe('cape_lorito_agility')
    expect(resolve_shop_render('Lorito Cloak (Rose Quartz)')?.identifier).toBe('cape_lorito_vitality')
  })

  test('a genuine render miss keeps the mannequin and emits no broken video element', () => {
    expect(resolve_shop_render('cosmetic_without_a_quilt_patch')).toBeNull()
    const html = render_card({ ...ITEM, render_name: 'Cosmetic Without A Quilt Patch' })
    expect(html).toContain('class="mannequin"')
    expect(html).not.toContain('<video')
    expect(html).not.toContain('class="preview-btn')
  })

  test('a live cosmetic renders the worn still full-case — no video, no PREVIEW button (removed 2026-07-17)', () => {
    const html = render_card({ ...ITEM, render_name: 'Bara Hood' })
    expect(html).not.toContain('class="mannequin"')
    expect(html).toContain('class="case-worn"')
    expect(html).toContain(shop_url('capuche_bara_hd.png'))
    expect(html).not.toContain('<video')
    expect(html).not.toContain('preview-btn')
  })
})

describe('shop section presentation', () => {
  test('pins pet lootboxes first, then preserves the cosmetic and remainder order', () => {
    const grouped = Object.fromEntries(
      ['RESOURCE', 'HAT', 'PET_BOX', 'TITLE', 'CONSUMABLE', 'CLOAK', 'COMPANION', 'EQUIPMENT'].map((key) => [key, [{}]])
    )
    expect(ordered_shop_section_keys(grouped)).toEqual([
      'PET_BOX',
      'TITLE',
      'CLOAK',
      'HAT',
      'COMPANION',
      'EQUIPMENT',
      'CONSUMABLE',
      'RESOURCE',
    ])
  })

  test('sorts every section cheapest-first with BigInt-safe prices', () => {
    const items = [
      { id: 'expensive', price_mist: 9_007_199_254_740_993n },
      { id: 'cheap', price_mist: 2n },
      { id: 'middle', price_mist: 1_000_000_000n },
    ]
    expect(sort_shop_items_by_price(items).map((item) => item.id)).toEqual(['cheap', 'middle', 'expensive'])
    expect(items.map((item) => item.id)).toEqual(['expensive', 'cheap', 'middle'])
  })
})

describe('loot-box row encyclopedia affordance', () => {
  test('the full odds row is the pet-slug button', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <VaultCard
          item={{ ...ITEM, item_template_id: 'pet_lootbox', category: 'CONSUMABLE' }}
          display_name="Pet Box"
          pool_rows={[{ pet: 'pet_bouloute', name: 'Bouloute', percent: 43.75 }]}
          on_open_encyclopedia={() => {}}
          on_open_pool_entry={() => {}}
          buy={BUY}
        />
      </I18nextProvider>
    )
    expect(html).toContain('class="pool-row"')
    expect(html).toContain('data-encyclopedia-item="pet_bouloute"')
    expect(html).not.toContain('class="pool-name" type="button"')
  })
})

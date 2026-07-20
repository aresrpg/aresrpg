// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// item_detail_view.test.tsx — DOM-less proof of ItemDetailView's honest-rendering invariants without a
// jsdom/RTL harness (none exists in this repo, and adding one for these would violate minimal-deps):
// react-dom/server's renderToStaticMarkup needs no jsdom, and a scoped i18next instance sidesteps the
// app's default LanguageDetector (i18n/index.ts touches window/navigator, absent in this bun:test env).
//
// Proven here:
//   1. stat labels resolve through STAT_LABEL_KEYS / the humanized fallback — a raw key never leaks, and an
//      unmapped key warns ONCE into the game_log ring buffer (never console).
//   2. the OBTENTION summary line is honest: each channel (dropped / crafted / shop) renders its fragment,
//      multiple channels JOIN into one line (never picks one), the empty case states the honest fallback, and
//      a non-encyclopedia caller (no obtention) stays inert.
// (The forgemagie "taux" row was removed in the 07-13 encyclopedia repair — crush rate belongs to the crush
//  UI, not item characteristics; its get_taux read + row tests retired with it.)

import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../i18n/locales/en.json'
import { get_log_buffer, _reset_log_for_test } from '../core/log.js'

import { ItemDetailImage, ItemDetailView, item_detail_image_key } from './item_detail_view'

const test_i18n = i18next.createInstance()
test_i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const BASE_ITEM = {
  name: 'Test Sword',
  category: 'sword',
  rarity: '',
  level: 40,
  damages: [] as never[],
  stats: {},
  pods: 0,
}

const visible_text = (html: string) => html.replace(/<[^>]+>/g, '')

describe('ItemDetailView — focused image identity', () => {
  test('A -> B -> A produces a different adjacent key on every switch, clearing ItemImage fallback state', () => {
    const a = { id: 'corbac_head', category: 'hat' }
    const b = { id: 'casque_hayate', category: 'hat' }
    const sequence = [item_detail_image_key(a), item_detail_image_key(b), item_detail_image_key(a)]

    expect(sequence[0]).not.toBe(sequence[1])
    expect(sequence[1]).not.toBe(sequence[2])
    expect(ItemDetailImage({ item: a }).key).toBe(sequence[0])
    expect(ItemDetailImage({ item: b }).key).toBe(sequence[1])
  })

  test('a changed Display/appearance candidate also remounts the focused image for the same slug', () => {
    const base = { id: 'same_slug', category: 'hat' }
    expect(item_detail_image_key(base)).not.toBe(item_detail_image_key({ ...base, image_url: '/new.png' }))
    expect(item_detail_image_key(base)).not.toBe(item_detail_image_key({ ...base, appearance: 'new_appearance' }))
    expect(item_detail_image_key(base)).not.toBe(item_detail_image_key({ ...base, category: 'cloak' }))
  })
})

describe('ItemDetailView — stat label truth (unmapped keys never leak raw)', () => {
  test('a stat key covered by STAT_LABEL_KEYS renders its translated label, not the raw key', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM, stats: { vitality: [1, 8] } }} />
      </I18nextProvider>
    )
    expect(html).toContain('Vitality')
    expect(html).not.toContain('vitality')
  })

  test('an unmapped stat key falls back to a humanized (title-cased) label and warns once — never the raw key', () => {
    // The diagnostic outlet is the game_log ring buffer (S-Sentry convention: console is player-silent;
    // the buffer feeds Sentry breadcrumbs) — assert the warning landed there, not on console.
    _reset_log_for_test()
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM, stats: { totally_unmapped_stat: 5 } }} />
      </I18nextProvider>
    )
    expect(html).toContain('Totally Unmapped Stat')
    expect(html).not.toContain('totally_unmapped_stat')
    expect(get_log_buffer().some((e) => e.ns === 'entity_colors' && e.message.includes('totally_unmapped_stat'))).toBe(
      true
    )
  })
})

describe('ItemDetailView — stat ranges', () => {
  test('equal bounds render as one fixed value', () => {
    const text = visible_text(
      renderToStaticMarkup(
        <I18nextProvider i18n={test_i18n}>
          <ItemDetailView item={{ ...BASE_ITEM, stats: { agility: [80, 80] } }} />
        </I18nextProvider>
      )
    )

    expect(text).toContain('+80 Agility')
    expect(text).not.toContain('+80 to 80 Agility')
  })

  test('unequal bounds keep the localized range', () => {
    const text = visible_text(
      renderToStaticMarkup(
        <I18nextProvider i18n={test_i18n}>
          <ItemDetailView item={{ ...BASE_ITEM, stats: { agility: [2, 5] } }} />
        </I18nextProvider>
      )
    )

    expect(text).toContain('+2 to 5 Agility')
  })
})

describe('ItemDetailView — real requirements only', () => {
  test('the item own slot/itemType metadata never renders as a Requires line', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM, category: 'hat', weapon_class: 'hat' }} />
      </I18nextProvider>
    )

    expect(html).toContain('Lv. 40')
    expect(html).not.toContain('Requires')
    expect(html).not.toContain('Requires hat')
  })
})

// Regression guard: a listed cosmetic cloak showed "LV. 0". Cosmetics carry no level, so a level line
// is a lie there — hide it entirely when level is 0/absent; a real level (≥1) still renders.
describe('ItemDetailView — level line honesty (no "Lv. 0")', () => {
  test('a level of 0 hides the level line entirely', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM, category: 'cloak', level: 0 }} />
      </I18nextProvider>
    )
    expect(html).not.toContain('Lv. 0')
    expect(html).not.toContain('Lv.')
  })

  test('a real level still renders its line', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM, level: 12 }} />
      </I18nextProvider>
    )
    expect(html).toContain('Lv. 12')
  })
})

describe('ItemDetailView — OBTENTION honesty', () => {
  test('dropped_count > 0 renders the "dropped by N monsters" fragment', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView
          item={{ ...BASE_ITEM, obtention: { dropped_count: 3, has_recipe: false, sold_in_shop: false } }}
        />
      </I18nextProvider>
    )
    expect(html).toContain('Dropped by 3 mobs')
  })

  test('has_recipe renders the crafted fragment', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView
          item={{ ...BASE_ITEM, obtention: { dropped_count: 0, has_recipe: true, sold_in_shop: false } }}
        />
      </I18nextProvider>
    )
    expect(html).toContain('Craftable')
  })

  test('sold_in_shop renders the shop fragment', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView
          item={{ ...BASE_ITEM, obtention: { dropped_count: 0, has_recipe: false, sold_in_shop: true } }}
        />
      </I18nextProvider>
    )
    expect(html).toContain('Available in the shop')
  })

  test('none of the three known channels apply — honest fallback, never a lie', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView
          item={{ ...BASE_ITEM, obtention: { dropped_count: 0, has_recipe: false, sold_in_shop: false } }}
        />
      </I18nextProvider>
    )
    expect(html).toContain('Obtention unknown')
  })

  test('multiple true channels join into one summary line (never picks only one)', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView
          item={{ ...BASE_ITEM, obtention: { dropped_count: 2, has_recipe: true, sold_in_shop: false } }}
        />
      </I18nextProvider>
    )
    expect(html).toContain('Dropped by 2 mobs')
    expect(html).toContain('Craftable')
  })

  test('omitted entirely when the caller passes no obtention data (non-encyclopedia callers stay inert)', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM }} />
      </I18nextProvider>
    )
    expect(html).not.toContain('Obtention unknown')
    expect(html).not.toContain('Available in the shop')
  })
})

describe('ItemDetailView — TOTAL SUPPLY (indexer feature, encyclopedia-only opt-in fact)', () => {
  test('a supply of zero still renders (honest zero, never hidden like the pods row)', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM, supply: 0 }} />
      </I18nextProvider>
    )
    expect(html).toContain('Total supply')
  })

  test('renders the live count with locale thousands separators', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM, supply: 12345 }} />
      </I18nextProvider>
    )
    expect(html).toContain('12,345')
    expect(html).toContain('Total supply')
  })

  test('omitted entirely when the caller passes no supply (non-encyclopedia callers stay inert)', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM }} />
      </I18nextProvider>
    )
    expect(html).not.toContain('Total supply')
    expect(html).not.toContain('Marketcap')
  })
})

describe('ItemDetailView — MARKETCAP (supply × last per-unit sale price, or the honest unknown)', () => {
  test('a sold template renders supply × last_sale in SUI with 2 decimals (BigInt-safe)', () => {
    // 3 units × 2.5 SUI last sale = 7.50 SUI marketcap.
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM, supply: 3, last_sale_mist: '2500000000' }} />
      </I18nextProvider>
    )
    expect(html).toContain('Marketcap')
    expect(html).toContain('7.50 SUI')
  })

  test('a template that has NEVER sold renders the documented "unknown" value, never a fabricated 0', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM, supply: 42, last_sale_mist: null }} />
      </I18nextProvider>
    )
    expect(html).toContain('Marketcap')
    expect(html).toContain('Unknown')
    expect(html).not.toContain('0.00 SUI')
  })

  test('zero supply with a real last sale is an honest 0.00 SUI (everything burned), not unknown', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={{ ...BASE_ITEM, supply: 0, last_sale_mist: '5000000000' }} />
      </I18nextProvider>
    )
    expect(html).toContain('0.00 SUI')
    expect(html).not.toContain('Unknown')
  })
})

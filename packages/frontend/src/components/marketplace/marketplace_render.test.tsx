// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../../i18n/locales/en.json'
import { ItemDetailView } from '../item_detail_view'

import { BrowseSidebar } from './browse_sidebar'
import { ItemTypeColumn } from './item_type_column'
import { LedgerItemCard } from './ledger_item_card'
import { MarketplaceListingRow } from './marketplace_listing_row'
import { MyLotsPanel } from './my_lots_panel'
import { LotPurchaseConfirmation, StackableLotRows } from './stackable_lot_rows'
import { TemplateUnavailableCard } from './template_unavailable_card'

const test_i18n = i18next.createInstance()
test_i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const DETAIL = {
  name: 'Ember Fang',
  category: 'Daggers',
  rarity: '',
  level: 75,
  damages: [{ element: 'fire', from: 45, to: 62 }],
  stats: { agility: [30, 38] as [number, number], rawDamage: 12 },
  pods: 0,
}

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<I18nextProvider i18n={test_i18n}>{node}</I18nextProvider>)
}

describe('marketplace browse sidebar', () => {
  test('renders the general-category column, and the subcategory column when the category divides into >1 bucket', () => {
    const html = render(
      <BrowseSidebar
        active_category="EQUIPMENT"
        active_item_type="HELMET"
        category_counts={new Map([['EQUIPMENT', 4]])}
        item_types={[
          { item_type: 'HELMET', listing_count: 3 },
          { item_type: 'RING', listing_count: 1 },
        ]}
        mobile={false}
        on_category={() => {}}
        on_item_type={() => {}}
      />
    )

    expect(html).toContain('data-marketplace-general-categories')
    expect(html).toContain('data-marketplace-item-types')
    expect(html.indexOf('data-marketplace-general-categories')).toBeLessThan(
      html.indexOf('data-marketplace-item-types')
    )
    expect(html).toContain('data-marketplace-item-type="HELMET"')
    expect(html).toContain('Helmet')
    expect(html).toMatch(/data-marketplace-item-type="HELMET"[\s\S]*?>3<\/span>/)
  })

  // A lone self-bucket ("pet > pet") earns no column.
  test('hides the subcategory column entirely when the category has a single (self) bucket', () => {
    const html = render(
      <BrowseSidebar
        active_category="PETS"
        active_item_type="PET"
        category_counts={new Map([['PETS', 2]])}
        item_types={[{ item_type: 'PET', listing_count: 2 }]}
        mobile={false}
        on_category={() => {}}
        on_item_type={() => {}}
      />
    )

    expect(html).toContain('data-marketplace-general-categories')
    expect(html).not.toContain('data-marketplace-item-types')
  })
})

describe('marketplace item-type column (report A: the per-template list is column 3)', () => {
  const type = () =>
    ({ template_id: 't1', name: 'Lorito Cloak (Sapphire)', level: 0, listings: [{}], rarity: 'common' }) as never

  test('uses the cascade-safe encyclopedia search padding pattern (search moved here from the subcategory column)', () => {
    const html = render(
      <ItemTypeColumn
        types={[type()]}
        selected_template_id="t1"
        search=""
        mobile={false}
        on_pick={() => {}}
        on_search={() => {}}
      />
    )

    expect(html).toContain('padding-left:36px')
    expect(html).toContain('aria-label="SEARCH..."')
    expect(html).not.toContain('pl-7')
    expect(html).toContain('data-marketplace-template-option="t1"')
    expect(html).toContain('Lorito Cloak (Sapphire)')
  })

  test('a level-0 (cosmetic) template shows no "Lv. 0" line', () => {
    const html = render(
      <ItemTypeColumn
        types={[type()]}
        selected_template_id="t1"
        search=""
        mobile={false}
        on_pick={() => {}}
        on_search={() => {}}
      />
    )
    expect(html).not.toContain('Lv. 0')
  })
})

function row(overrides: Partial<React.ComponentProps<typeof MarketplaceListingRow>> = {}) {
  return (
    <MarketplaceListingRow
      seller_address="0x1234567890abcdef"
      seller_name="merchant.sui"
      item_name="Ember Fang"
      price_label="4.10 SUI"
      own={false}
      armed={false}
      on_arm={() => {}}
      on_confirm={() => {}}
      on_cancel={() => {}}
      {...overrides}
    />
  )
}

describe('LedgerItemCard', () => {
  test('contains the exact shared ItemDetailView output and no purchase control', () => {
    const detail_html = render(<ItemDetailView item={DETAIL} />)
    const card_html = render(<LedgerItemCard item={DETAIL} />)

    expect(card_html).toContain(detail_html)
    expect(card_html).toContain('45')
    expect(card_html).toContain('fire')
    expect(card_html).toContain('Agility')
    expect(card_html).not.toContain('<button')
    expect(card_html).not.toContain('data-marketplace-buy')
  })
})

describe('marketplace template rows', () => {
  test('an unresolved generic template stays honest and contains no purchase control', () => {
    const html = render(<TemplateUnavailableCard item_type="resource" />)
    expect(html).toContain('data-marketplace-template-unavailable')
    expect(html).toContain('Exact template details are unavailable for resource')
    expect(html).not.toContain('<button')
  })
})

function lot_listing(id: string, quantity: number, price_mist: string, seller = `seller-${id}`, category = 'Resource') {
  return {
    id,
    kiosk_id: `kiosk-${id}`,
    seller_sui_address: seller,
    price_mist,
    item: {
      id,
      template_id: `template-${id}`,
      quantity,
      category,
      name: id,
      rarity: 'common',
      appearance: '',
      level: 1,
    },
  } as any
}

describe('StackableLotRows', () => {
  test('renders four exact-size buttons, cheapest labels, disabled none-listed states, and no invalid legacy ask', () => {
    const html = render(
      <StackableLotRows
        listings={[
          lot_listing('expensive-one', 1, '3000000000'),
          lot_listing('cheapest-one', 1, '2000000000'),
          lot_listing('hundred', 100, '5000000000'),
          lot_listing('invalid-seven', 7, '10000000'),
        ]}
        address={null}
        busy={false}
        royalty_min_mist={10_000_000n}
        on_buy={() => {}}
      />
    )

    expect((html.match(/data-lot-size=/g) ?? []).length).toBe(4)
    expect((html.match(/data-marketplace-buy-button/g) ?? []).length).toBe(4)
    expect(html).toContain('Cheapest · 2.00 SUI')
    expect(html).toContain('Cheapest · 5.00 SUI')
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2)
    expect(html).toContain('None listed')
    expect(html).not.toContain('0.01 SUI')
    expect(html).not.toContain('invalid-seven')
  })

  test('labels and buys the cheapest external ask when the global cheapest belongs to the viewer', () => {
    const html = render(
      <StackableLotRows
        listings={[lot_listing('own', 10, '1000000000'), lot_listing('external', 10, '2000000000')]}
        address="seller-own"
        busy={false}
        royalty_min_mist={10_000_000n}
        on_buy={() => {}}
      />
    )

    const [, after_ten] = html.split('data-lot-size="10"')
    const [ten] = after_ten.split('data-lot-size="100"')
    expect(ten).toContain('Cheapest · 2.00 SUI')
    expect(ten).not.toContain('disabled=""')
  })

  test('renders the four-button lot market for Rune asks and hides an invalid Rune amount', () => {
    const html = render(
      <StackableLotRows
        listings={[
          lot_listing('rune-ten', 10, '2000000000', 'rune-seller', 'Rune'),
          lot_listing('rune-seven', 7, '10000000', 'legacy-seller', 'Rune'),
        ]}
        address={null}
        busy={false}
        royalty_min_mist={10_000_000n}
        on_buy={() => {}}
      />
    )

    expect((html.match(/data-lot-size=/g) ?? []).length).toBe(4)
    expect((html.match(/data-marketplace-buy-button/g) ?? []).length).toBe(4)
    expect(html).toContain('Cheapest · 2.00 SUI')
    expect(html).not.toContain('rune-seven')
    expect(html).not.toContain('0.01 SUI')
  })

  test('the armed confirmation shows ask and exact purchase total at 2-decimal precision, never royalty', () => {
    const html = render(
      <LotPurchaseConfirmation
        listing={lot_listing('four-sui', 10, '4000000000')}
        size={10}
        royalty_min_mist={10_000_000n}
        busy={false}
        on_confirm={() => {}}
        on_cancel={() => {}}
      />
    )

    expect(html).toContain('data-marketplace-buy-confirm')
    expect(html).toContain('Ask 4.00 SUI')
    expect(html).toContain('Purchase total 4.40 SUI')
    expect(html).not.toContain('Royalty')
  })
})

describe('MyLotsPanel marketplace visibility', () => {
  test('an invalid legacy stack is absent from MY LOTS as well as the buy ladder', () => {
    const seller = '0xviewer'
    const valid = lot_listing('VALID TEN', 10, '2000000000', seller)
    const invalid = lot_listing('LEGACY SEVEN', 7, '1000000000', seller)

    const html = render(
      <MyLotsPanel
        listings={[valid, invalid]}
        address={seller}
        busy={false}
        on_delist={() => {}}
        name_of={(_template_id, fallback) => fallback}
        asset_slug_of={(template_id) => template_id}
      />
    )
    expect(html).toContain('VALID TEN')
    expect(html).not.toContain('LEGACY SEVEN')
  })
})

describe('MarketplaceListingRow', () => {
  test('always renders seller, SUI price, and a labeled BUY button on the listing row', () => {
    const html = render(row())
    expect(html).toContain('data-marketplace-listing-row')
    expect(html).toContain('@merchant')
    expect(html).toContain('4.10 SUI')
    expect(html).toContain('data-marketplace-buy-button')
    expect(html).toContain('BUY')
  })

  test('an own listing keeps the labeled BUY button visible but disabled', () => {
    const html = render(row({ own: true }))
    expect(html).toMatch(/<button[^>]*data-marketplace-buy-button[^>]*disabled/)
    expect(html).toContain('BUY')
  })

  // Design ruling 2026-07-18: clicking BUY opens the shared confirm MODAL ("are you sure you want to buy X for X SUI"),
  // never the old inline pay strip. The modal portals to <body> (ConfirmDialog) so it is proven by the
  // source-contract test (marketplace_listing_row.test.ts) — the repo has no jsdom to mount a portal. Here we
  // assert the row itself never regrows an inline confirmation strip (armed on an OWN row is the SSR-safe case:
  // the modal stays closed, so no portal is mounted).
  test('the listing row never renders an inline confirmation strip', () => {
    const html = render(row({ armed: true, own: true }))
    expect(html).toContain('data-marketplace-buy-button')
    expect(html).not.toContain('data-marketplace-buy-confirm')
    expect(html).not.toContain('PAY WITH SUI')
  })

  test('BUY markers are nested under listing-row markup and retired money concepts never render', () => {
    const html = render(
      <>
        {row()}
        {row({ seller_name: 'second.sui', price_label: '5.25 SUI' })}
      </>
    )
    expect((html.match(/data-marketplace-listing-row/g) ?? []).length).toBe(2)
    expect((html.match(/data-marketplace-buy-button/g) ?? []).length).toBe(2)
    expect(html).not.toMatch(/\b(?:kares?|bank)\b|Ξ/i)
    for (const fragment of html.split('data-marketplace-listing-row').slice(1)) {
      expect(fragment.split('data-marketplace-listing-row')[0]).toContain('data-marketplace-buy-button')
    }
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../i18n/locales/en.json'
import { ItemDetailView } from '../item_detail_view'

import { BrowseSidebar } from './browse_sidebar'
import { ItemTypeColumn } from './item_type_column'
import { LedgerItemCard } from './ledger_item_card'
import { MarketplaceListingRow } from './marketplace_listing_row'
import { MyLotsPanel } from './my_lots_panel'
import { SellItemHeader } from './sell_item_header'
import { LotPurchaseConfirmation, StackableLotRows } from './stackable_lot_rows'
import { TemplateUnavailableCard } from './template_unavailable_card'

const test_i18n = i18next.createInstance()
test_i18n.init({
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

  // #1227 — the BUY tab's left search-list rows resolve a real item icon off the bucket's already-joined
  // asset_slug, not the placeholder cube. RED before the fix: this column rendered no icon at all.
  test('a row with a resolvable asset_slug renders its real icon path', () => {
    const html = render(
      <ItemTypeColumn
        types={[
          {
            ...type(),
            name: 'Razmoket',
            asset_slug: 'razmoket',
            catalog_name: '',
            classification_item_type: 'resource',
          } as never,
        ]}
        selected_template_id="t1"
        search=""
        mobile={false}
        on_pick={() => {}}
        on_search={() => {}}
      />
    )
    expect(html).toContain('items/razmoket')
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
      purchase_state="ready"
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
        balance_mist={10_000_000_000n}
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
        balance_mist={10_000_000_000n}
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
        balance_mist={10_000_000_000n}
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
        purchase_state="ready"
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
      />
    )
    expect(html).toContain('VALID TEN')
    expect(html).not.toContain('LEGACY SEVEN')
  })

  // #1227 — YOUR LISTINGS resolves the SAME icon the inventory would for the same item: off the listing's own
  // item_type slug (chain truth), never the raw template_id (a grouping/tx identity the private seed catalog
  // is the only thing that can turn into art, and that catalog ships EMPTY in production). RED before the fix:
  // MyLotsPanel had no `item.slug` to read and fed ItemImage the raw template_id, which 404s to the cube.
  test('a listing whose item template is known resolves its real icon path, never the raw template id', () => {
    const seller = '0xviewer'
    const known = lot_listing('KNOWN ONE', 1, '2000000000', seller)
    known.item.slug = 'razmoket'
    known.item.template_id = 'private-catalog-only-id-9999' // not a valid item_icon_url key on its own

    const html = render(
      <MyLotsPanel
        listings={[known]}
        address={seller}
        busy={false}
        on_delist={() => {}}
        name_of={(_template_id, fallback) => fallback}
      />
    )
    expect(html).toContain('items/razmoket')
    expect(html).not.toContain('private-catalog-only-id-9999')
  })

  // Control: a genuinely unresolved item (no slug, an on-chain OBJECT ID for a template_id, no cosmetic name
  // match) must keep degrading to the honest placeholder glyph — never fabricate a URL from an address.
  test('an unknown-template listing (no slug, an object-id template) still degrades to the placeholder glyph', () => {
    const seller = '0xviewer'
    const unknown = lot_listing('MYSTERY ONE', 1, '2000000000', seller)
    unknown.item.slug = undefined
    unknown.item.name = 'Nonexistent Cosmetic Name'
    // Short, non-census-shaped object-id stand-in (the chain-id gate's 64-hex-char detector treats a real
    // one as a hardcoded package/object id needing a baseline entry — this only needs to trip
    // item_icon_url's own `/^0x[0-9a-f]+$/i` object-id guard, which any 0x-hex string satisfies).
    unknown.item.template_id = '0xdeadf00d'

    const html = render(
      <MyLotsPanel
        listings={[unknown]}
        address={seller}
        busy={false}
        on_delist={() => {}}
        name_of={(_template_id, fallback) => fallback}
      />
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('0xdeadf00d')
  })
})

// #1296 — the SELL tab's "LIST FOR SALE" card fed ItemImage `template_id ?? slug`: the NULLABLE, frequently
// unresolvable leg BEFORE the always-present item_type slug — the exact inverse of the ruled chain
// (marketplace_listing_icon_slug). Every item whose template row is missing from templates_item (most
// non-cosmetic owned items) therefore rendered the placeholder cube on the card while the inventory grid
// beside it showed the real icon. The header derives its icon through the ONE chain now.
describe('the SELL card item header', () => {
  const header = (props: Partial<React.ComponentProps<typeof SellItemHeader>> = {}) => (
    <SellItemHeader
      item={{ slug: 'razmoket', template_id: '0xdeadf00d', category: 'RESOURCE' }}
      display_name="Razmoket"
      subtitle="RESOURCE · Lv. 1"
      {...props}
    />
  )

  test('an item whose template id is an unresolvable object id resolves its icon off the item slug', () => {
    const html = render(header())
    expect(html).toContain('items/razmoket')
    expect(html).not.toContain('0xdeadf00d')
  })

  test('an authored catalog slug (a resolved cosmetic) still wins over the item slug', () => {
    const html = render(header({ catalog_name: 'Lorito Cloak (Sapphire)', catalog_slug: 'cape_lorito_chance' }))
    expect(html).toContain('cape_lorito-chance')
  })

  // Control: a genuinely unresolved item keeps degrading to the honest glyph — never a url built from an id.
  test('an unknown item (no slug, an object-id template) degrades to the placeholder glyph', () => {
    const html = render(header({ item: { slug: '', template_id: '0xdeadf00d', category: 'RESOURCE' } }))
    expect(html).not.toContain('<img')
    expect(html).not.toContain('0xdeadf00d')
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

  // A purchase already in flight (the store's single busy flag — use_marketplace_chain) must disarm the
  // BUY button so a second click can't fire a second buy while the first settles. Re-enables the moment
  // the store's .finally(() => set({ busy: false })) fires, on either settle or refusal.
  test('disarms the BUY button while a purchase is in flight', () => {
    const html = render(row({ busy: true }))
    expect(html).toMatch(/<button[^>]*data-marketplace-buy-button[^>]*disabled/)
  })

  test('renders a translated disabled state when the wallet cannot cover the purchase', () => {
    const html = render(row({ purchase_state: 'insufficient_balance' }))
    expect(html).toMatch(/<button[^>]*data-marketplace-buy-button[^>]*disabled/)
    expect(html).toContain('Insufficient balance')
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

import { describe, expect, test } from 'bun:test'

import de from '../../i18n/locales/de.json'
import en from '../../i18n/locales/en.json'
import es from '../../i18n/locales/es.json'
import fr from '../../i18n/locales/fr.json'
import ja from '../../i18n/locales/ja.json'
import uk from '../../i18n/locales/uk.json'

import {
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_CATEGORY_KEYS,
  MARKETPLACE_LOT_SIZES,
  confirm_marketplace_lot_ask,
  marketplace_category_of,
  marketplace_detail_item,
  marketplace_item_type_buckets,
  marketplace_item_type_key,
  marketplace_item_type_of,
  marketplace_listing_is_visible,
  marketplace_lot_sizes_for_owned_quantity,
  marketplace_lot_offers,
  marketplace_purchase_total_mist,
  marketplace_type_matches,
  marketplace_types_for_item_type,
  visible_marketplace_listings,
  type MarketplaceTypeBucket,
} from './marketplace_model'

const LOCALES = [en, fr, de, es, ja, uk] as Record<string, any>[]
const LOT_KEYS = [
  'cheapest_price',
  'none_listed',
  'no_ask',
  'average_unit',
  'confirm_lot',
  'ask_total',
  'royalty_total',
  'wallet_total',
  'confirm_buy',
  'ask_ladder',
  'inventory_total',
  'choose_size',
  'paid_automatically',
  'list_lot',
  'withdraw_proceeds',
  'proceeds_hint',
  'pending_split',
  'toast_split',
  'pending_merge',
  'toast_merged',
  'pending_proceeds',
  'toast_proceeds',
  'not_signed_in',
  'stack_not_found',
  'stacks_not_found',
  'kiosk_not_found',
  'item_not_found',
  'listing_not_found',
  'character_not_found',
]

function value_at(root: Record<string, any>, path: string): unknown {
  return path.split('.').reduce((value, key) => value?.[key], root)
}

const TYPE: MarketplaceTypeBucket = {
  template_id: 'ember_fang',
  asset_slug: 'ember_fang',
  classification_item_type: 'daggers',
  catalog_name: 'Ember Fang',
  name: 'Ember Fang',
  level: 75,
  category: 'Daggers',
  browse_category: 'DAGGERS',
  rarity: '',
  appearance: '',
  stackable: false,
  total: 1,
  cheapest_unit: 1n,
  listings: [],
  detail_resolved: true,
}

describe('marketplace category rail', () => {
  test('uses exactly the seven owner-picked MAIN categories in rail order', () => {
    expect(MARKETPLACE_CATEGORIES).toEqual([
      'COSMETICS',
      'EQUIPMENT',
      'PETS',
      'RUNES',
      'CONSUMABLE',
      'RESOURCES',
      'CHARACTERS',
    ])
    expect(new Set(MARKETPLACE_CATEGORIES).size).toBe(7)
  })

  test('every rail label resolves in every locale', () => {
    for (const category of MARKETPLACE_CATEGORIES) {
      const key = MARKETPLACE_CATEGORY_KEYS[category]
      for (const locale of LOCALES) expect(value_at(locale, key)).toBeString()
    }
  })

  test('cosmetic itemType truth wins over hat/cloak equipment normalization', () => {
    expect(marketplace_category_of('Helmet', 'hat')).toBe('COSMETICS')
    expect(marketplace_category_of('Chestplate', 'cloak')).toBe('COSMETICS')
    expect(marketplace_category_of('Title', 'title')).toBe('COSMETICS')
  })

  test('the remaining real item groups retain their existing category truth', () => {
    expect(marketplace_category_of('Ring', 'ring')).toBe('EQUIPMENT')
    expect(marketplace_category_of('Pet', 'pet')).toBe('PETS')
    expect(marketplace_category_of('Mount', 'mount')).toBe('PETS')
    expect(marketplace_category_of('Rune', 'rune')).toBe('RUNES')
    expect(marketplace_category_of('Consumable', 'potion')).toBe('CONSUMABLE')
    expect(marketplace_category_of('Resource', 'ore')).toBe('RESOURCES')
  })

  test('accepts the uppercase seed-category vocabulary without changing the seven general groups', () => {
    expect(marketplace_category_of('PET', 'pet')).toBe('PETS')
    expect(marketplace_category_of('RUNE', 'rune')).toBe('RUNES')
    expect(marketplace_category_of('CONSUMABLE', 'bag')).toBe('CONSUMABLE')
    expect(marketplace_category_of('RESOURCE', 'resource')).toBe('RESOURCES')
  })
})

describe('marketplace item-type column', () => {
  test('uses semantic category for weapons and aggregates sibling template listing counts', () => {
    const buckets = marketplace_item_type_buckets(
      [
        { category: 'AXE', item_type: 'rojin', listing_count: 2 },
        { category: 'AXE', item_type: 'ikari', listing_count: 3 },
        { category: 'RING', item_type: 'ring', listing_count: 1 },
        { category: 'BELT', item_type: 'belt' },
      ],
      'EQUIPMENT'
    )

    expect(marketplace_item_type_of('AXE', 'rojin')).toBe('AXE')
    expect(buckets).toEqual([
      { item_type: 'AXE', listing_count: 5 },
      { item_type: 'RING', listing_count: 1 },
      { item_type: 'BELT', listing_count: 0 },
    ])

    const sibling_templates = marketplace_types_for_item_type(
      [
        { ...TYPE, template_id: 'ember_axe', browse_category: 'AXE', classification_item_type: 'rojin' },
        { ...TYPE, template_id: 'frost_axe', browse_category: 'AXE', classification_item_type: 'ikari' },
      ],
      'EQUIPMENT',
      'AXE',
      ''
    )
    expect(sibling_templates.map((type) => type.template_id)).toEqual(['ember_axe', 'frost_axe'])
  })

  test('keeps cosmetic slot itemType values instead of the collapsed display category', () => {
    expect(marketplace_item_type_of('Helmet', 'hat')).toBe('HAT')
    expect(marketplace_item_type_of('Chestplate', 'cloak')).toBe('CLOAK')
    expect(
      marketplace_item_type_buckets(
        [
          { category: 'Helmet', item_type: 'hat', listing_count: 2 },
          { category: 'Chestplate', item_type: 'cloak', listing_count: 1 },
        ],
        'COSMETICS'
      )
    ).toEqual([
      { item_type: 'CLOAK', listing_count: 1 },
      { item_type: 'HAT', listing_count: 2 },
    ])
  })

  test('new seeded subtype labels resolve in all six locales', () => {
    for (const item_type of ['KEY', 'TITLE', 'TOOL_FARMER', 'TOOL_HERBALIST', 'TOOL_MINER']) {
      const key = marketplace_item_type_key(item_type)
      for (const locale of LOCALES) expect(value_at(locale, key)).toBeString()
    }
  })
})

describe('marketplace template detail model', () => {
  test('passes the encyclopedia catalog damage/stat payload through unchanged', () => {
    const stats = { agility: [30, 38] as [number, number], rawDamage: 12 }
    const damages = [{ element: 'fire', from: 45, to: 62 }]
    const item = marketplace_detail_item(TYPE, { rarity: '', stats, damages }, 'ember_fang_dagger')

    expect(item.id).toBe('ember_fang_dagger')
    expect(item.stats).toBe(stats)
    expect(item.damages).toBe(damages)
  })

  test('search remains case-insensitive across template name and category', () => {
    expect(marketplace_type_matches(TYPE, 'EMBER')).toBe(true)
    expect(marketplace_type_matches(TYPE, 'dagger')).toBe(true)
    expect(marketplace_type_matches(TYPE, 'pet')).toBe(false)
  })
})

function listing(id: string, quantity: number, price_mist: string, category = 'Resource') {
  return {
    id,
    price_mist,
    seller_sui_address: '0xseller',
    item: { quantity, category },
  } as any
}

describe('native kiosk lot view model', () => {
  test('every lot-market string resolves in all six locales', () => {
    for (const key of LOT_KEYS) {
      for (const locale of LOCALES) expect(value_at(locale, `marketplace.lots.${key}`)).toBeString()
    }
  })

  test('keeps exactly the four legal lots and picks the cheapest exact-size ask', () => {
    const offers = marketplace_lot_offers([
      listing('ten-expensive', 10, '9000000000'),
      listing('one', 1, '2000000000'),
      listing('ten-cheapest', 10, '4000000000'),
      listing('hundred', 100, '12000000000'),
    ])

    expect(offers.map((offer) => offer.size)).toEqual(MARKETPLACE_LOT_SIZES)
    expect(offers.find((offer) => offer.size === 10)?.cheapest?.id).toBe('ten-cheapest')
    expect(offers.find((offer) => offer.size === 1000)?.cheapest).toBeNull()
  })

  test('offers only lot sizes covered by the owned quantity', () => {
    expect(marketplace_lot_sizes_for_owned_quantity(1)).toEqual([1])
    expect(marketplace_lot_sizes_for_owned_quantity(25)).toEqual([1, 10])
    expect(marketplace_lot_sizes_for_owned_quantity(100)).toEqual([1, 10, 100])
    expect(marketplace_lot_sizes_for_owned_quantity(1000)).toEqual([1, 10, 100, 1000])
  })

  test('the buy seam invokes the callback with the cheapest external exact-size ask', () => {
    const own = { ...listing('own-cheapest', 10, '1000000000'), seller_sui_address: '0xviewer' }
    const external = listing('external-cheapest', 10, '2000000000')
    const expensive = listing('external-expensive', 10, '3000000000')
    const asks = marketplace_lot_offers([expensive, own, external]).find((offer) => offer.size === 10)?.asks ?? []
    const bought: string[] = []

    const selected = confirm_marketplace_lot_ask(asks, '0xviewer', (ask) => bought.push(ask.id))

    expect(selected?.id).toBe('external-cheapest')
    expect(bought).toEqual(['external-cheapest'])
  })

  test('filters invalid Resource and Rune amounts but never blocks a non-stackable item', () => {
    const invalid = listing('legacy-seven', 7, '1')
    const unknown = listing('legacy-unknown', 0, '1')
    const invalid_rune = listing('legacy-rune-seven', 7, '1', 'Rune')
    const valid_rune = listing('rune-ten', 10, '20', 'Rune')
    const unique = listing('relic', 7, '1', 'Relic')

    expect(marketplace_listing_is_visible(invalid)).toBe(false)
    expect(marketplace_listing_is_visible(unknown)).toBe(false)
    expect(marketplace_listing_is_visible(invalid_rune)).toBe(false)
    expect(marketplace_listing_is_visible(valid_rune)).toBe(true)
    expect(marketplace_listing_is_visible(unique)).toBe(true)
    expect(
      visible_marketplace_listings([invalid, unknown, invalid_rune, valid_rune, unique]).map((row) => row.id)
    ).toEqual(['rune-ten', 'relic'])
    expect(marketplace_lot_offers([invalid_rune, valid_rune]).find((offer) => offer.size === 10)?.cheapest?.id).toBe(
      'rune-ten'
    )
  })

  test('confirms ask plus the higher of 1000bp royalty or stamped floor', () => {
    expect(marketplace_purchase_total_mist(4_000_000_000n, 10_000_000n)).toEqual({
      royalty_mist: 400_000_000n,
      total_mist: 4_400_000_000n,
    })
    expect(marketplace_purchase_total_mist(10_000_000n, 10_000_000n)).toEqual({
      royalty_mist: 10_000_000n,
      total_mist: 20_000_000n,
    })
  })
})

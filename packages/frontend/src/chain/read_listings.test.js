// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-87 SELL PICKER — offline-fixture proof of `build_listable_items` / `build_listable_characters`, the pure
// mappers behind `get_listable_items` / `get_listable_characters` (S-87: /v1/owner-items + /v1/characters?owner=
// replaced the chain-direct kiosk-SDK sweep — no gRPC, no GraphQL). Locks the resolution rules: category comes
// from the item's authoritative `item_category` (templates are display fallback only; no stored stackable flag),
// while canonical template_id remains distinct even when item_type is generic. `level` is the item's OWN
// event-sourced scribe level when set (else the template's base level — mirrors `build_listing_from_view`'s
// BUY-side precedent), `stackable` derives from the resolved category (§10: only Resource + Consumable stack),
// `kiosk_id` rides through so `list_item`/`list_character` can `kiosk::list` the exact kiosk that locks the row,
// and an already-`listed` row is excluded (it lives in MY LISTINGS instead — never fabricated here).
import { describe, expect, test } from 'bun:test'

import { build_listable_characters, build_listable_items, build_listing_from_view } from './read_listings.js'

// /v1/owner-items rows: gear (unscribed, level 0) + a resource stack + a template-miss consumable + a scribed
// gear row (its OWN level must win over the template) + an already-LISTED row (must be dropped, never shown).
const rows = [
  {
    id: '0xaaa',
    kiosk_id: '0xk1',
    kiosk_cap_id: '0xcap1',
    template_id: '0xtemplate-sword',
    name: 'Iron Sword',
    item_category: 'sword',
    item_set: '',
    item_type: 'iron_sword',
    level: 0,
    amount: 1,
    listed: false,
  },
  {
    id: '0xbbb',
    kiosk_id: '0xk1',
    kiosk_cap_id: '0xcap1',
    template_id: '0xtemplate-wool',
    name: 'Wool',
    item_category: 'resource',
    item_set: '',
    item_type: 'wool',
    level: 0,
    amount: 37,
    listed: false,
  },
  {
    id: '0xccc',
    kiosk_id: '0xk2',
    kiosk_cap_id: '0xcap2',
    template_id: '0xtemplate-brew',
    name: 'Mystery Brew',
    item_category: 'consumable',
    item_set: '',
    item_type: 'mystery_brew',
    level: 0,
    amount: 3,
    listed: false,
  },
  {
    id: '0xeee',
    kiosk_id: '0xk1',
    kiosk_cap_id: '0xcap1',
    template_id: '0xtemplate-scribed',
    name: 'Scribed Blade',
    item_category: 'sword',
    item_set: '',
    item_type: 'iron_sword',
    level: 15, // scribed above the template's base 12 — the item's OWN level must win
    amount: 1,
    listed: false,
  },
  {
    id: '0xddd',
    kiosk_id: '0xk2',
    kiosk_cap_id: '0xcap2',
    template_id: '0xtemplate-listed',
    name: 'Already Listed Blade',
    item_category: 'sword',
    item_set: '',
    item_type: 'iron_sword',
    level: 0,
    amount: 1,
    listed: true, // already on the market — MY LISTINGS shows it, the SELL picker must not
  },
]

// normalize_item_template rows keyed by slug (get_template_by_item_type_map) — category is UPPERCASE there.
const tmpl_by_type = new Map([
  ['iron_sword', { item_type: 'iron_sword', name: 'Iron Sword', category: 'SWORD', level: 12 }],
  ['wool', { item_type: 'wool', name: 'Wool', category: 'RESOURCE', level: 1 }],
])

describe('build_listable_items — /v1/owner-items rows → SELL picker shape', () => {
  const picked = build_listable_items(rows, tmpl_by_type)
  test('lowercase consumables stack in frontend listings', () => expect(picked[2].stackable).toBe(true))

  test('gear resolves category from its template; unscribed (level 0) falls back to template level; kiosk_id rides through', () => {
    expect(picked[0]).toEqual({
      id: '0xaaa',
      kiosk_id: '0xk1',
      template_id: '0xtemplate-sword',
      slug: 'iron_sword',
      name: 'Iron Sword',
      category: 'Sword',
      level: 12,
      quantity: 1,
      stackable: false,
    })
  })

  test('a resource stack is stackable with its full amount as quantity', () => {
    expect(picked[1]).toEqual({
      id: '0xbbb',
      kiosk_id: '0xk1',
      template_id: '0xtemplate-wool',
      slug: 'wool',
      name: 'Wool',
      category: 'Resource',
      level: 1,
      quantity: 37,
      stackable: true,
    })
  })

  test("template miss falls back to the item's own item_category (level 0, still stackable-aware)", () => {
    expect(picked[2]).toEqual({
      id: '0xccc',
      kiosk_id: '0xk2',
      template_id: '0xtemplate-brew',
      slug: 'mystery_brew',
      name: 'Mystery Brew',
      category: 'Consumable',
      level: 0,
      quantity: 3,
      stackable: true,
    })
  })

  test("a SCRIBED item's own level wins over the template's base level", () => {
    expect(picked[3]).toMatchObject({ id: '0xeee', slug: 'iron_sword', level: 15 })
  })

  test('an already-listed row is dropped (lives in MY LISTINGS instead, never fabricated here)', () => {
    expect(picked).toHaveLength(4)
    expect(picked.some((r) => r.id === '0xddd')).toBe(false)
  })

  test('empty rows → empty picker', () => {
    expect(build_listable_items([], new Map())).toEqual([])
  })
})

describe('build_listable_characters — /v1/characters?owner= rows → SELL/kolizeum picker shape', () => {
  const characters = [
    { id: '0xchar1', kiosk_id: '0xk1', name: 'Aiden', class: 'sram', experience: 32600, listed: false },
    { id: '0xchar2', kiosk_id: '0xk2', name: 'Vendor', class: 'iop', experience: 100, listed: true }, // listed → excluded
    { id: '0xchar3', kiosk_id: null, name: 'Escrowed', class: 'osamodas', experience: 500, listed: false }, // no kiosk (escrowed/exploring) → excluded
  ]
  const picked = build_listable_characters(characters)

  test('an unlisted, kiosk-locked character maps class → classe (French field the frontend renders)', () => {
    expect(picked).toEqual([{ id: '0xchar1', kiosk_id: '0xk1', name: 'Aiden', classe: 'sram', experience: 32600 }])
  })

  test('an already-listed character is excluded', () => {
    expect(picked.some((c) => c.id === '0xchar2')).toBe(false)
  })

  test('an escrowed character (no kiosk_id) is excluded — cannot be listed anyway', () => {
    expect(picked.some((c) => c.id === '0xchar3')).toBe(false)
  })

  test('empty characters → empty picker', () => {
    expect(build_listable_characters([])).toEqual([])
  })
})

// S-86 BUY-path mapper — a /v1/listings ROW → the frozen page's MarketplaceListing. The view names an item
// listing's field `category` but it carries the item_type SLUG; display (name/UI-category/level/stats) joins
// from the shared template catalog by that slug, exactly the old chain path's template join.
describe('build_listing_from_view — /v1 row → MarketplaceListing', () => {
  // template catalog keyed by slug (get_item_templates_cached reshaped): UPPERCASE category, full display fields.
  const tmpl_by_slug = new Map([
    [
      'iron_sword',
      {
        item_type: 'iron_sword',
        name: 'Iron Sword',
        category: 'SWORD',
        level: 12,
        pods: 3,
        statsJson: '{"strength":[1,4]}',
        // #619 — the /v1 encyclopedia row's authored DamagesKey lines (raw chain casing)
        damages: [{ from: 16, to: 29, damage_type: 'weapon', element: 'water' }],
      },
    ],
  ])

  test('an item row resolves canonical template, amount, UI category, and name without template-range stats', () => {
    const row = {
      item_id: '0xitem',
      kiosk_id: '0xkiosk',
      category: 'iron_sword', // /v1 puts the item_type slug here
      template_id: '0xtemplate-sword',
      item_category: 'sword',
      amount: 1,
      level: null, // not scribed → fall back to the template level
      price_mist: '5000000000',
      seller: '0xabcdef0000000000000000000000000000000000000000000000000000001234',
    }
    const l = build_listing_from_view(row, tmpl_by_slug)
    expect(l.id).toBe('0xitem')
    expect(l.kiosk_id).toBe('0xkiosk') // load-bearing: buy_item / delist target this exact kiosk
    expect(l.price_mist).toBe('5000000000')
    expect(l.seller_sui_address).toBe(row.seller)
    expect(l.item.template_id).toBe('0xtemplate-sword')
    // #1227 — the raw item_type slug must survive the join (it's the ONE valid item_icon_url key; template_id
    // is a grouping/tx identity a listing icon can't safely resolve from). RED before the fix: no `slug` field
    // existed on the built item at all, so every marketplace icon surface fell back to template_id.
    expect(l.item.slug).toBe('iron_sword')
    expect(l.item.category).toBe('Sword') // ui_category(UPPERCASE template category)
    expect(l.item.name).toBe('Iron Sword')
    expect(l.item.level).toBe(12) // row.level null → template level
    expect(l.item.quantity).toBe(1)
    expect(l.item.stats_json).toBe('{}') // owned listing hover resolves this instance's roll by item id
    // #619 — damage lines are AUTHORED per template (not rolled per instance), so a resolved template lights
    // the lot's damage block; RED before the fix: hardcoded '[]' on every weapon lot.
    expect(JSON.parse(l.item.damages_json)).toEqual([{ from: 16, to: 29, damage_type: 'weapon', element: 'WATER' }])
  })

  test('a template miss still renders — name/category degrade to the slug, never fabricated', () => {
    const l = build_listing_from_view(
      { item_id: '0xz', kiosk_id: '0xk', category: 'unknown_slug', level: 7, price_mist: '1', seller: '' },
      tmpl_by_slug
    )
    expect(l.item.template_id).toBe('unknown_slug')
    expect(l.item.slug).toBe('unknown_slug') // #1227 — the slug still rides along even on a template miss
    expect(l.item.name).toBe('unknown_slug') // no template → slug is the honest display fallback
    expect(l.item.category).toBe('Misc') // ui_category('') → Misc → EQUIPMENT bucket
    expect(l.item.level).toBe(7) // row.level present → used directly
    expect(l.item.damages_json).toBe('[]') // unresolved template → no damage line is fabricated
    expect(l.seller_name).toBe('') // empty seller → no shortened handle
  })

  test('a generic resource type keeps its real rail category when duplicate templates cannot be resolved', () => {
    const l = build_listing_from_view(
      {
        item_id: '0xr',
        kiosk_id: '0xk',
        category: 'resource',
        template_id: '0xtemplate-resource',
        item_category: 'resource',
        amount: 100,
        level: 0,
        price_mist: '1',
        seller: '',
      },
      new Map()
    )
    expect(l.item.name).toBe('resource')
    expect(l.item.category).toBe('Resource')
    expect(l.item.template_id).toBe('0xtemplate-resource')
    expect(l.item.quantity).toBe(100)
  })

  test('an old stackable row without indexed amount fails closed as quantity 0', () => {
    const l = build_listing_from_view(
      { item_id: '0xold', kiosk_id: '0xk', category: 'resource', level: 0, price_mist: '1', seller: '' },
      new Map()
    )
    expect(l.item.category).toBe('Resource')
    expect(l.item.quantity).toBe(0)
  })

  // Regression guard: a listed cosmetic cloak's hover said "Chestplate". Root: the on-chain
  // `item_category` collapses chestplate + cloak onto ONE accepted verify_category word ("cloak") (and
  // hat + helmet onto "hat"), so a read back through item_category alone mislabels a real cloak/hat. The
  // item_type SLUG is the lossless fine category and must win — these lock BOTH sides of each collision.
  test('a cosmetic cloak (item_type slug "cloak") renders "Cloak", never "Chestplate"', () => {
    const l = build_listing_from_view(
      {
        item_id: '0xcloak',
        kiosk_id: '0xk',
        category: 'cloak', // /v1: the item_type slug
        template_id: '0x2521c902ae440a18c3cfd7ca5906b17d6ad6c3d754054c37d861c6b86938d80d',
        item_category: 'cloak', // chain category — chestplate + cloak both collapse here
        amount: 1,
        level: null,
        price_mist: '1000000000',
        seller: '',
      },
      new Map()
    )
    expect(l.item.category).toBe('Cloak')
  })

  test('a real chestplate (slug "chestplate", chain item_category "cloak") still renders "Chestplate"', () => {
    const l = build_listing_from_view(
      {
        item_id: '0xcp',
        kiosk_id: '0xk',
        category: 'chestplate',
        item_category: 'cloak',
        amount: 1,
        level: 4,
        price_mist: '1',
        seller: '',
      },
      new Map()
    )
    expect(l.item.category).toBe('Chestplate')
  })

  test('a cosmetic hat (item_type slug "hat") renders "Hat", never "Helmet"', () => {
    const l = build_listing_from_view(
      {
        item_id: '0xhat',
        kiosk_id: '0xk',
        category: 'hat',
        item_category: 'hat',
        amount: 1,
        level: null,
        price_mist: '1',
        seller: '',
      },
      new Map()
    )
    expect(l.item.category).toBe('Hat')
  })
})

// Regression guard: the SELL picker shares the same collapsed-category hazard: a cosmetic cloak in
// the bag must read "Cloak" (its item_type slug), a real chestplate must stay "Chestplate".
describe('build_listable_items — cosmetic slot categories resolve from the item_type slug', () => {
  test('a cosmetic cloak in the bag categorizes as Cloak (not Chestplate)', () => {
    const [picked] = build_listable_items(
      [
        {
          id: '0xc',
          kiosk_id: '0xk',
          template_id: '0xt',
          name: 'Lorito Cloak (Sapphire)',
          item_category: 'cloak',
          item_type: 'cloak',
          level: 0,
          amount: 1,
          listed: false,
        },
      ],
      new Map()
    )
    expect(picked.category).toBe('Cloak')
  })

  test('a real chestplate in the bag stays Chestplate', () => {
    const [picked] = build_listable_items(
      [
        {
          id: '0xc',
          kiosk_id: '0xk',
          template_id: '0xt',
          name: 'Scrap Cuirass',
          item_category: 'cloak',
          item_type: 'chestplate',
          level: 10,
          amount: 1,
          listed: false,
        },
      ],
      new Map()
    )
    expect(picked.category).toBe('Chestplate')
  })
})

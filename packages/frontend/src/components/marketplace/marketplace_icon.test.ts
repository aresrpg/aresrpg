// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1227 — the marketplace listings rows (SELL "your listings" + BUY per-template rows/detail header/index)
// rendered the placeholder cube because their icon resolution fell back straight to `template_id`: a
// grouping/tx identity that is NOT a valid `item_icon_url` slug for anything the private seed catalog
// doesn't independently resolve (which, in production, is nearly everything — that catalog ships EMPTY,
// see marketplace_icon.ts / shop_icon.ts). `marketplace_listing_icon_slug` is the ONE fallback chain every
// marketplace surface must derive its icon slug through: authored catalog slug → the listing's own raw
// item_type slug (chain truth, always resolvable) → template_id (last-resort, honest-degrade only).
import { describe, expect, test } from 'bun:test'

import { marketplace_listing_icon_slug } from './marketplace_icon'

describe('marketplace_listing_icon_slug — the one asset-slug fallback chain', () => {
  test('a known template: the item carries its own item_type slug, which wins over the raw template id', () => {
    const slug = marketplace_listing_icon_slug({ slug: 'razmoket', template_id: 'private-catalog-only-id' })
    expect(slug).toBe('razmoket')
  })

  test('an authored catalog slug (a resolved cosmetic) wins over the item slug', () => {
    const slug = marketplace_listing_icon_slug({ slug: 'cloak', template_id: 'tid' }, 'lorito_cloak_sapphire')
    expect(slug).toBe('lorito_cloak_sapphire')
  })

  // Control: a genuinely unknown template (no catalog match, no item slug) degrades HONESTLY to the raw
  // template_id — never a fabricated slug. Downstream (item_icon_url / ItemImage) turns this into the
  // placeholder glyph rather than a wrong icon, which is the correct behavior for real unknowns.
  test('unknown-template control: no catalog slug and no item slug falls back to the raw template id', () => {
    const slug = marketplace_listing_icon_slug({ slug: undefined, template_id: '0xdeadbeef' })
    expect(slug).toBe('0xdeadbeef')
  })

  test('an empty-string item slug is treated as absent, not a valid key', () => {
    const slug = marketplace_listing_icon_slug({ slug: '', template_id: 'fallback-id' })
    expect(slug).toBe('fallback-id')
  })
})

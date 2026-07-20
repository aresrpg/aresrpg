// [owner: HD icons 404 for thumb-only assets] regression proof — Fuwa Hood (White) and 60 other item/
// cosmetic slugs have a thumb (`{slug}.png`) but no `_hd.png` variant yet (2026-07-13 icon-cache census:
// 1038 hd files, 61 thumb-only). An `hd` ItemIcon request that 404s must retry the BASE icon before
// falling to the category glyph — never jump straight to a generic glyph while the real art is one URL
// away. No jsdom/RTL in this repo (item_detail_view.test.tsx's precedent): renderToStaticMarkup proves
// the INITIAL candidate picked per `hd` is the right one; the hd→base→ladder→glyph LIFECYCLE (the shared
// reducer + the driven component) is proven in image_retry.test.jsx.

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ItemIcon, category_glyph, item_fallback_glyph } from './ItemIcon.jsx'

describe('ItemIcon — renders the right INITIAL candidate for hd vs. thumb', () => {
  test('hd requests the _hd variant first', () => {
    const html = renderToStaticMarkup(<ItemIcon item="coiffe_fuwa-white" hd alt="Fuwa Hood (White)" />)
    expect(html).toContain('coiffe_fuwa-white_hd.png')
  })

  test('a thumb request (default) never asks for _hd', () => {
    const html = renderToStaticMarkup(<ItemIcon item="coiffe_fuwa-white" alt="Fuwa Hood (White)" />)
    expect(html).toContain('coiffe_fuwa-white.png')
    expect(html).not.toContain('_hd.png')
  })

  test('no item at all → straight to the glyph, no <img> (unchanged degrade for an absent icon key)', () => {
    const html = renderToStaticMarkup(<ItemIcon item={null} hd category="hat" />)
    expect(html).not.toContain('<img')
    expect(html).toContain('item-icon__glyph')
  })
})

describe('category_glyph — unaffected by the fallback-step change (sanity)', () => {
  test('a mapped category still resolves its glyph', () => {
    expect(category_glyph('hat')).not.toBeNull()
  })
  test('an unmapped/absent category resolves to null (the generic-box last resort upstream)', () => {
    expect(category_glyph(undefined)).toBeNull()
  })

  test('the shared terminal fallback covers synthetic cosmetics and unknown categories', () => {
    expect(item_fallback_glyph('COSMETICS')).not.toBeNull()
    expect(item_fallback_glyph(undefined)).not.toBeNull()
  })
})

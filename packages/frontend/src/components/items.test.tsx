// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// items.test.tsx — ItemImage's HOST-FREE guard + HD-detail request, proven via react-dom/server (no jsdom,
// mirroring item_detail_view.test.tsx). The external asset CDN host is DELETED, and a
// stale on-chain Display `image_url` still pointing at ANY external host must be dropped to the origin-relative
// /assets slug builder — never rendered. (The fake `legacy-cdn.example` host below stands in for the retired one
// so this file itself stays free of the banned literal — the guard drops every non-Walrus absolute http url.)

import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { configure_walrus_assets } from '@aresrpg/sdk/jobs'

import en from '../i18n/locales/en.json'
import type { ItemInfo } from '../types/chain'

import { ItemDetailView } from './item_detail_view'
import { ItemImage, ItemTooltipContent, onchain_template_to_detail_props } from './items'

// configure_walrus_assets has no test-reset seam (it MERGES classes and overwrites the aggregator, with no
// way to clear either — packages/sdk/src/jobs.js) — an earlier-run file (asset_manifest.test.ts) leaves the
// item class + aggregator configured for the rest of the process (bun test runs every file in ONE process).
// This suite's whole point is the host-FREE / unconfigured-fallback path, so force it back to that state
// (item/cosmetic undefined ⇒ walrus_asset_url returns null, falling through to the /assets local slug).
configure_walrus_assets({
  aggregator: 'https://cdn.aresrpg.world/walrus',
  classes: { item: undefined, cosmetic: undefined },
})

const src_of = (el: React.ReactElement): string =>
  (renderToStaticMarkup(el).match(/<img[^>]*\bsrc="([^"]*)"/) ?? [])[1] ?? ''

describe('ItemImage — host-free guard + HD', () => {
  test('a stale external-host Display url is DROPPED to the origin-relative /assets slug builder', () => {
    const src = src_of(
      <ItemImage
        id="tool_herbalist"
        image_url="https://legacy-cdn.example/items/tool_herbalist.png"
        hd
        category="sword"
      />
    )
    expect(src.startsWith('http')).toBe(false) // never an absolute external host
    expect(src).toBe('/assets/items/tool_herbalist_hd.png') // host-free, HD variant requested
  })

  test('hd derives the _hd variant of a host-free (relative) Display url first', () => {
    const src = src_of(<ItemImage id="x" image_url="/assets/items/wooden_sword.png" hd category="sword" />)
    expect(src).toBe('/assets/items/wooden_sword_hd.png')
  })

  test('a Walrus Display path is re-homed onto the configured CDN base', () => {
    const raw = 'https://raw-origin.example/v1/blobs/by-quilt-id/Q/tool_herbalist.png'
    const src = src_of(<ItemImage id="tool_herbalist" image_url={raw} category="sword" />)
    expect(src).toBe('https://cdn.aresrpg.world/walrus/v1/blobs/by-quilt-id/Q/tool_herbalist.png')
  })

  test('non-hd (list/grid) keeps the BASE slug — the _hd request is detail-only', () => {
    const src = src_of(
      <ItemImage id="tool_herbalist" image_url="https://legacy-cdn.example/items/tool_herbalist.png" category="sword" />
    )
    expect(src).toBe('/assets/items/tool_herbalist.png')
  })

  test('a template object address is refused before <img> and renders the shared placeholder', () => {
    const object_id = `0x${'25'.repeat(32)}`
    const html = renderToStaticMarkup(<ItemImage id={object_id} category="COSMETICS" />)
    expect(html).not.toContain('<img')
    expect(html).toContain('inline-flex')
    expect(html).not.toContain(object_id)
  })
})

const test_i18n = i18next.createInstance()
test_i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const HAT_ITEM: ItemInfo = {
  id: 'i',
  template_id: 'not_in_catalog',
  quantity: 1,
  pods: 0,
  stats_json: '{}',
  slot: 'hat',
  name: 'Hat',
  description: '',
  rarity: 'common',
  category: 'HAT',
  level: 1,
  damages_json: '[]',
  consumable_json: '',
  particle_trail_json: '',
  appearance: '',
  weapon_class: 'hat',
  pet_power: 0,
  pet_stats_json: '{}',
}

// OWNER BUG (night batch #3): the inventory hover card rendered NO item icon — the adapter's image id fell
// back to the /v1 row's GENERIC item_type ('cloak' for every cosmetic → items/cloak.png 404 → nothing),
// and when the template map was cold the payload had no usable id at all. The call site that KNOWS the
// resolved icon slug (inventory_item_icon — the same home the bag cell paints with) now threads it as
// `icon_slug`, and the adapter prefers it for the ItemDetailImage id.
describe('onchain_template_to_detail_props — icon_slug wins for the detail image', () => {
  test('a resolved icon slug beats the generic item_type', () => {
    const detail = onchain_template_to_detail_props({
      icon_slug: 'cape_lorito-chance',
      item_type: 'cloak',
      category: 'cloak',
      level: 1,
    } as any)

    expect(detail.id).toBe('cape_lorito-chance')
  })

  test('without an icon_slug the template item_type keeps winning (findables/recall unchanged)', () => {
    const detail = onchain_template_to_detail_props({ item_type: 'ableton_scythe', category: 'scythe', level: 10 })

    expect(detail.id).toBe('ableton_scythe')
  })
})

// CONTRACT (issue #437): template stat RANGES (stats_min/stats_max, the 32768-biased encoding — one
// possible roll) render only on TEMPLATE surfaces (findables/encyclopedia/shop). An OWNED instance
// (Inventory bag/equipment) has its OWN fixed rolled stat — showing the template's full spread there is a
// lie ("+3 to 0 Vitality" prod regression). `owned: true` marks the payload as an instance surface: a
// genuine range (min !== max — we don't know which value THIS item rolled) is dropped; a degenerate pair
// (min === max) is safe to keep because item_stats.move's roll_field always rolls that fixed value.
describe('onchain_template_to_detail_props — owned instances never show a template RANGE (#437)', () => {
  test('a genuine template range is suppressed on an owned surface', () => {
    const detail = onchain_template_to_detail_props({
      item_type: 'iron_sword',
      category: 'sword',
      level: 10,
      statsJson: JSON.stringify({ vitality: [3, 8] }),
      owned: true,
    } as any)
    expect(detail.stats).toEqual({})
  })

  test('a degenerate (fixed) template value still renders — it IS the instance real stat', () => {
    const detail = onchain_template_to_detail_props({
      item_type: 'iron_sword',
      category: 'sword',
      level: 10,
      statsJson: JSON.stringify({ vitality: [3, 3], rawDamage: [5, 8] }),
      owned: true,
    } as any)
    expect(detail.stats).toEqual({ vitality: [3, 3] })
  })

  test('a template surface (owned unset) keeps the full range — findables/encyclopedia/shop unaffected', () => {
    const detail = onchain_template_to_detail_props({
      item_type: 'iron_sword',
      category: 'sword',
      level: 10,
      statsJson: JSON.stringify({ vitality: [3, 8] }),
    } as any)
    expect(detail.stats).toEqual({ vitality: [3, 8] })
  })

  test('end-to-end: a variable-roll stat never renders as "N to M" on an owned item hover card', () => {
    const detail = onchain_template_to_detail_props({
      item_type: 'iron_sword',
      category: 'sword',
      level: 10,
      statsJson: JSON.stringify({ vitality: [3, 8] }),
      owned: true,
    } as any)
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemDetailView item={detail as any} />
      </I18nextProvider>
    )
    expect(html).not.toContain('CHARACTERISTICS')
    expect(html).not.toContain('Vitality')
  })
})

describe('ItemTooltipContent — real requirements only', () => {
  test('the item own slot/itemType metadata never renders as a Requires line', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <ItemTooltipContent item={HAT_ITEM} />
      </I18nextProvider>
    )

    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    expect(text).toContain('Hat Lvl 1 HAT')
    expect(text).not.toContain('Requires')
  })
})

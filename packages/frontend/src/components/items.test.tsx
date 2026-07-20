// items.test.tsx — ItemImage's HOST-FREE guard + HD-detail request, proven via react-dom/server (no jsdom,
// mirroring item_detail_view.test.tsx). The external asset CDN host is DELETED, and a
// stale on-chain Display `image_url` still pointing at ANY external host must be dropped to the origin-relative
// /assets slug builder — never rendered. (The fake `legacy-cdn.example` host below stands in for the retired one
// so this file itself stays free of the banned literal — the guard drops every non-Walrus absolute http url.)

import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../i18n/locales/en.json'
import type { ItemInfo } from '../types/chain'

import { ItemImage, ItemTooltipContent, onchain_template_to_detail_props } from './items'

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

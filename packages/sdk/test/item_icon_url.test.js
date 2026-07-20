// Regression gate for the item-icon resolver (src/jobs.js) — the SDK SSOT the whole HUD renders item art through
// (ItemIcon.jsx). Pins BOTH resolution modes: the CDN fallback (default, no quilt configured) and the S-20 Walrus
// path (by-quilt-id/<quilt>/<item_type>.png — the exact shape the on-chain Item Display uses, ported from koshi-2d).
// The config is module-global (koshi's configure_resolver pattern), so each test resets it back to the CDN default.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  configure_item_icons,
  configure_walrus_assets,
  item_icon_url,
  spell_icon_url,
  ASSET_BASE,
} from '../src/jobs.js'

// Host-free origin-relative fallback (the external asset CDN host is DELETED). `item`
// has no Walrus quilt, so with no quilt configured every item resolves to this /assets public path.
const CDN = '/assets/items'
const AGG = 'https://cdn.aresrpg.world/walrus'
const QUILT = 'abc123QuiltId'

// Reset the module-global resolver config to the shipped default after every test (no leakage across tests).
afterEach(() => {
  configure_item_icons({ aggregator: AGG, item_quilt: null })
  configure_walrus_assets({ classes: { cosmetic_icon: {} } })
})

describe('item_icon_url — CDN fallback (no quilt configured)', () => {
  test('string key → CDN url', () => {
    expect(item_icon_url('longsword')).toBe(`${CDN}/longsword.png`)
  })

  test('item object resolves template slug fields before a legacy slug-valued id', () => {
    expect(item_icon_url({ slug: 'walker_hat', id: '0xdead' })).toBe(
      `${CDN}/walker_hat.png`,
    )
    expect(item_icon_url({ icon: 'heal_potion', id: '0xdead' })).toBe(
      `${CDN}/heal_potion.png`,
    )
    expect(item_icon_url({ id: 'daggers' })).toBe(`${CDN}/daggers.png`)
  })

  test('a Sui object id can never become an icon filename', () => {
    const object_id = `0x${'25'.repeat(32)}`
    expect(() => item_icon_url(object_id)).toThrow('requires a template slug')
    expect(() => item_icon_url({ id: object_id })).toThrow(
      'requires a template slug',
    )
  })

  test('hd variant appends _hd', () => {
    expect(item_icon_url('bow', { hd: true })).toBe(`${CDN}/bow_hd.png`)
  })

  test('an authored cosmetic identifier uses the cosmetic icon quilt through the same resolver', () => {
    configure_walrus_assets({
      classes: { cosmetic_icon: { quilt: 'cosmeticQuilt' } },
    })
    expect(
      item_icon_url('cape_lorito-agility', { asset_class: 'cosmetic_icon' }),
    ).toBe(`${AGG}/v1/blobs/by-quilt-id/cosmeticQuilt/cape_lorito-agility.png`)
  })

  test('empty / null key → null', () => {
    expect(item_icon_url(null)).toBeNull()
    expect(item_icon_url('')).toBeNull()
    expect(item_icon_url({})).toBeNull()
    expect(item_icon_url(undefined)).toBeNull()
  })
})

describe('item_icon_url — Walrus quilt (S-20)', () => {
  test('a configured quilt id switches to the aggregator by-quilt-id shape', () => {
    configure_item_icons({ item_quilt: QUILT })
    expect(item_icon_url('longsword')).toBe(
      `${AGG}/v1/blobs/by-quilt-id/${QUILT}/longsword.png`,
    )
  })

  test('hd keeps the _hd identifier under the quilt', () => {
    configure_item_icons({ item_quilt: QUILT })
    expect(item_icon_url('mace', { hd: true })).toBe(
      `${AGG}/v1/blobs/by-quilt-id/${QUILT}/mace_hd.png`,
    )
  })

  test('the Walrus identifier matches the on-chain Item Display pattern <item_type>.png', () => {
    // item.move Display image_url = ${agg}/v1/blobs/by-quilt-id/<quilt>/{item_type}.png — app + wallet identical.
    configure_item_icons({ item_quilt: QUILT })
    const url = item_icon_url({ icon: 'spellbook' })
    expect(url.endsWith('/spellbook.png')).toBe(true)
    expect(url).toContain(`/by-quilt-id/${QUILT}/`)
  })

  test('aggregator override strips a trailing slash', () => {
    configure_item_icons({
      aggregator: 'https://agg.example/',
      item_quilt: QUILT,
    })
    expect(item_icon_url('axe')).toBe(
      `https://agg.example/v1/blobs/by-quilt-id/${QUILT}/axe.png`,
    )
  })

  test('clearing the quilt (empty string) falls back to the CDN — progressive migration', () => {
    configure_item_icons({ item_quilt: QUILT })
    expect(item_icon_url('club')).toContain('/by-quilt-id/')
    configure_item_icons({ item_quilt: '' })
    expect(item_icon_url('club')).toBe(`${CDN}/club.png`)
  })

  test('null key still short-circuits to null under a quilt', () => {
    configure_item_icons({ item_quilt: QUILT })
    expect(item_icon_url(null)).toBeNull()
  })
})

describe('aggregator trailing-slash strip — linear time (js/polynomial-redos)', () => {
  // CodeQL flagged /\/+$/ on the caller/manifest-supplied aggregator in configure_item_icons and
  // configure_walrus_assets: that regex backtracks quadratically on adversarial slash runs
  // (measured ~3.1s at n=100k under Bun/JSC). The strip must be linear — microseconds at any n.
  const HOSTILE = `https://agg.example${'/'.repeat(100_000)}x`

  test('configure_item_icons on a 100k-slash-run aggregator stays under 500ms', () => {
    const t0 = performance.now()
    configure_item_icons({ aggregator: HOSTILE })
    expect(performance.now() - t0).toBeLessThan(500)
  })

  test('configure_walrus_assets on the same hostile aggregator stays under 500ms', () => {
    const t0 = performance.now()
    configure_walrus_assets({ aggregator: HOSTILE })
    expect(performance.now() - t0).toBeLessThan(500)
  })

  test('the strip keeps the old /\\/+$/ semantics — one trailing slash-run removed, nothing else', () => {
    for (const input of [
      'https://agg.example/',
      'https://agg.example///',
      'https://agg.example',
      'https://agg.example/path//',
      'https://agg.example//x/',
      '///',
    ]) {
      configure_item_icons({ aggregator: input, item_quilt: QUILT })
      // the retired regex is the oracle — safe here, these inputs are tiny
      const expected = input.replace(/\/+$/, '')
      expect(item_icon_url('axe')).toBe(
        `${expected}/v1/blobs/by-quilt-id/${QUILT}/axe.png`,
      )
    }
  })
})

describe('ASSET_BASE — host-free fallback (the external asset CDN host is DELETED)', () => {
  // The fallback base is ORIGIN-RELATIVE — never an absolute host. This pin fails loudly if a future edit
  // re-hardcodes any external asset host: the grep-zero acceptance made mechanical.
  test('is the origin-relative /assets path — never an absolute host', () => {
    expect(ASSET_BASE).toBe('/assets')
    expect(ASSET_BASE.startsWith('http')).toBe(false)
  })

  test('item AND spell fallback urls are host-free and derive from ASSET_BASE', () => {
    // No Walrus class configured here ⇒ both fall back to the relative base (item has no quilt in prod either).
    expect(item_icon_url('longsword')).toBe(`${ASSET_BASE}/items/longsword.png`)
    expect(spell_icon_url('ikari_haki')).toBe(
      `${ASSET_BASE}/spells/ikari_haki.png`,
    )
    expect(spell_icon_url('ikari_haki', { hd: true })).toBe(
      `${ASSET_BASE}/spells/ikari_haki_hd.png`,
    )
    for (const u of [item_icon_url('x'), spell_icon_url('y')])
      expect(u.startsWith('/assets/')).toBe(true)
  })
})

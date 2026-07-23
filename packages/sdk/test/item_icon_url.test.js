// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression gate for the item-icon resolver (src/jobs.js) — the SDK SSOT the whole HUD renders item art through
// (ItemIcon.jsx). Pins BOTH resolution modes: the CDN fallback (default, no class published) and the asset-host
// path (#650: MinIO behind assets.aresrpg.world — {host}/items/{item_type}.png, the exact shape the on-chain
// Item Display now uses).
// The config is module-global (koshi's configure_resolver pattern), so each test resets it back to the CDN default.

import { afterEach, describe, expect, test } from 'bun:test'

import { ASSET_BASE, configure_walrus_assets, item_icon_url, spell_icon_url } from '../src/jobs.js'

// Host-free origin-relative fallback (the external asset CDN host is DELETED). `item`
// resolves here whenever its class isn't published — every item resolves to this /assets public path.
const CDN = '/assets/items'
const AGG = 'https://cdn.aresrpg.world'

// Defensive reset BEFORE the first test too (not just afterEach): `bun test packages/sdk packages/frontend`
// shares ONE process, and components/item_hover_tooltip.test.tsx loads the REAL public/asset_manifest.json
// elsewhere in that run, which publishes `item` — this file's baseline is the unpublished CDN-fallback state
// regardless of what ran before it (order-independence-gate.sh is the tooth for this exact class of leak).
configure_walrus_assets({ aggregator: AGG, classes: { item: {}, cosmetic_icon: {} } })

// Reset the module-global resolver config to the shipped default after every test (no leakage across tests).
afterEach(() => {
  configure_walrus_assets({ aggregator: AGG, classes: { item: {}, cosmetic_icon: {} } })
})

describe('item_icon_url — CDN fallback (no class published)', () => {
  test('string key → CDN url', () => {
    expect(item_icon_url('longsword')).toBe(`${CDN}/longsword.png`)
  })

  test('item object resolves template slug fields before a legacy slug-valued id', () => {
    expect(item_icon_url({ slug: 'walker_hat', id: '0xdead' })).toBe(`${CDN}/walker_hat.png`)
    expect(item_icon_url({ icon: 'heal_potion', id: '0xdead' })).toBe(`${CDN}/heal_potion.png`)
    expect(item_icon_url({ id: 'daggers' })).toBe(`${CDN}/daggers.png`)
  })

  test('a Sui object id can never become an icon filename', () => {
    const object_id = `0x${'25'.repeat(32)}`
    expect(() => item_icon_url(object_id)).toThrow('requires a template slug')
    expect(() => item_icon_url({ id: object_id })).toThrow('requires a template slug')
  })

  test('hd variant appends _hd', () => {
    expect(item_icon_url('bow', { hd: true })).toBe(`${CDN}/bow_hd.png`)
  })

  test('an authored cosmetic identifier uses the cosmetic_icon class through the same resolver', () => {
    configure_walrus_assets({ aggregator: AGG, classes: { cosmetic_icon: { published: true } } })
    // cosmetic_icon shares the `items` family with `item` (#650 — a cosmetic's 2D icon IS an item icon;
    // only its AUTHORED slug differs from the chain's generic item_type).
    expect(item_icon_url('cape_lorito-agility', { asset_class: 'cosmetic_icon' })).toBe(
      `${AGG}/items/cape_lorito-agility.png`,
    )
  })

  test('empty / null key → null', () => {
    expect(item_icon_url(null)).toBeNull()
    expect(item_icon_url('')).toBeNull()
    expect(item_icon_url({})).toBeNull()
    expect(item_icon_url(undefined)).toBeNull()
  })
})

describe('item_icon_url — the asset host (#650)', () => {
  test('a published item class switches to the asset-host shape', () => {
    configure_walrus_assets({ aggregator: AGG, classes: { item: { published: true } } })
    expect(item_icon_url('longsword')).toBe(`${AGG}/items/longsword.png`)
  })

  test('hd keeps the _hd identifier under the asset host', () => {
    configure_walrus_assets({ aggregator: AGG, classes: { item: { published: true } } })
    expect(item_icon_url('mace', { hd: true })).toBe(`${AGG}/items/mace_hd.png`)
  })

  test('the asset-host identifier matches the on-chain Item Display pattern items/<item_type>.png', () => {
    // item.move Display image_url = ${host}/items/{item_type}.png — app + wallet identical (#650).
    configure_walrus_assets({ aggregator: AGG, classes: { item: { published: true } } })
    const url = item_icon_url({ icon: 'spellbook' })
    expect(url.endsWith('/spellbook.png')).toBe(true)
    expect(url).toContain('/items/')
  })

  test('aggregator override strips a trailing slash', () => {
    configure_walrus_assets({ aggregator: 'https://agg.example/', classes: { item: { published: true } } })
    expect(item_icon_url('axe')).toBe('https://agg.example/items/axe.png')
  })

  test('un-publishing the class (empty object) falls back to the CDN — progressive migration', () => {
    configure_walrus_assets({ aggregator: AGG, classes: { item: { published: true } } })
    expect(item_icon_url('club')).toContain(AGG)
    configure_walrus_assets({ aggregator: AGG, classes: { item: {} } })
    expect(item_icon_url('club')).toBe(`${CDN}/club.png`)
  })

  test('null key still short-circuits to null under a published class', () => {
    configure_walrus_assets({ aggregator: AGG, classes: { item: { published: true } } })
    expect(item_icon_url(null)).toBeNull()
  })
})

describe('aggregator trailing-slash strip — linear time (js/polynomial-redos)', () => {
  // CodeQL flagged /\/+$/ on the caller/manifest-supplied aggregator in configure_walrus_assets: that regex
  // backtracks quadratically on adversarial slash runs (measured ~3.1s at n=100k under Bun/JSC). The strip
  // must be linear — microseconds at any n.
  const HOSTILE = `https://agg.example${'/'.repeat(100_000)}x`

  test('configure_walrus_assets on a 100k-slash-run aggregator stays under 500ms', () => {
    const t0 = performance.now()
    configure_walrus_assets({ aggregator: HOSTILE })
    expect(performance.now() - t0).toBeLessThan(500)
  })

  test('the strip keeps the old /\\/+$/ semantics — one trailing slash-run removed, nothing else', () => {
    configure_walrus_assets({ classes: { item: { published: true } } })
    for (const input of [
      'https://agg.example/',
      'https://agg.example///',
      'https://agg.example',
      'https://agg.example/path//',
      'https://agg.example//x/',
      '///',
    ]) {
      configure_walrus_assets({ aggregator: input })
      // the retired regex is the oracle — safe here, these inputs are tiny
      const expected = input.replace(/\/+$/, '')
      expect(item_icon_url('axe')).toBe(`${expected}/items/axe.png`)
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
    // No class published here ⇒ both fall back to the relative base (item has no published class in prod
    // until the manifest lands either).
    configure_walrus_assets({ classes: { item: {}, spell: {} } })
    expect(item_icon_url('longsword')).toBe(`${ASSET_BASE}/items/longsword.png`)
    expect(spell_icon_url('ikari_haki')).toBe(`${ASSET_BASE}/spells/ikari_haki.png`)
    expect(spell_icon_url('ikari_haki', { hd: true })).toBe(`${ASSET_BASE}/spells/ikari_haki_hd.png`)
    for (const u of [item_icon_url('x'), spell_icon_url('y')]) expect(u.startsWith('/assets/')).toBe(true)
  })
})

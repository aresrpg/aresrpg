// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression gate for the item-icon resolver (src/jobs.js) — the SDK SSOT the whole HUD renders item art through
// (ItemIcon.jsx). Pins BOTH resolution modes: the CDN fallback (default, no class published) and the asset-host
// path (#650: MinIO behind assets.aresrpg.world — {host}/items/{item_type}.png, the exact shape the on-chain
// Item Display now uses).
// The config is module-global (koshi's configure_resolver pattern), so each test resets it back to the CDN default.

import { afterEach, describe, expect, test } from 'bun:test'

import { ASSET_BASE, configure_assets, item_icon_url, reset_assets_for_test, spell_icon_url } from '../src/jobs.js'

const AGG = 'https://cdn.aresrpg.world'
const publish_items = (...files) =>
  configure_assets({ aggregator: AGG, classes: { item: { published: true } }, files: { items: files } })

// Defensive reset BEFORE the first test too (not just afterEach): `bun test packages/sdk packages/frontend`
// shares ONE process, and components/item_hover_tooltip.test.tsx loads the REAL public/asset_manifest.json
// elsewhere in that run, which publishes `item` — this file's baseline is the unpublished CDN-fallback state
// regardless of what ran before it (order-independence-gate.sh is the tooth for this exact class of leak).
reset_assets_for_test()

// Reset the module-global resolver config to the shipped default after every test (no leakage across tests).
afterEach(() => {
  reset_assets_for_test()
})

describe('item_icon_url — unpublished/absent art is honest-empty', () => {
  test('an unpublished class returns null without minting a local request', () => {
    expect(item_icon_url('longsword')).toBeNull()
  })

  test('item object resolves template slug fields before a legacy slug-valued id', () => {
    publish_items('walker_hat.png', 'heal_potion.png', 'daggers.png')
    expect(item_icon_url({ slug: 'walker_hat', id: '0xdead' })).toBe(`${AGG}/items/walker_hat.png`)
    expect(item_icon_url({ icon: 'heal_potion', id: '0xdead' })).toBe(`${AGG}/items/heal_potion.png`)
    expect(item_icon_url({ id: 'daggers' })).toBe(`${AGG}/items/daggers.png`)
  })

  test('a Sui object id can never become an icon filename', () => {
    const object_id = `0x${'25'.repeat(32)}`
    expect(() => item_icon_url(object_id)).toThrow('requires a template slug')
    expect(() => item_icon_url({ id: object_id })).toThrow('requires a template slug')
  })

  test('an unlisted hd variant returns null', () => {
    publish_items('bow.png')
    expect(item_icon_url('bow', { hd: true })).toBeNull()
  })

  test('an authored cosmetic identifier uses the cosmetic_icon class through the same resolver', () => {
    configure_assets({
      aggregator: AGG,
      classes: { cosmetic_icon: { published: true } },
      files: { items: ['cape_lorito-agility.png'] },
    })
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
    publish_items('longsword.png')
    expect(item_icon_url('longsword')).toBe(`${AGG}/items/longsword.png`)
  })

  test('hd keeps the _hd identifier under the asset host', () => {
    publish_items('mace_hd.png')
    expect(item_icon_url('mace', { hd: true })).toBe(`${AGG}/items/mace_hd.png`)
  })

  test('the asset-host identifier matches the on-chain Item Display pattern items/<item_type>.png', () => {
    // item.move Display image_url = ${host}/items/{item_type}.png — app + wallet identical (#650).
    publish_items('spellbook.png')
    const url = item_icon_url({ icon: 'spellbook' })
    expect(url.endsWith('/spellbook.png')).toBe(true)
    expect(url).toContain('/items/')
  })

  test('aggregator override strips a trailing slash', () => {
    configure_assets({
      aggregator: 'https://agg.example/',
      classes: { item: { published: true } },
      files: { items: ['axe.png'] },
    })
    expect(item_icon_url('axe')).toBe('https://agg.example/items/axe.png')
  })

  test('un-publishing the class returns to honest-empty', () => {
    publish_items('club.png')
    expect(item_icon_url('club')).toContain(AGG)
    configure_assets({ aggregator: AGG, classes: { item: {} } })
    expect(item_icon_url('club')).toBeNull()
  })

  test('null key still short-circuits to null under a published class', () => {
    publish_items()
    expect(item_icon_url(null)).toBeNull()
  })
})

describe('aggregator trailing-slash strip — linear time (js/polynomial-redos)', () => {
  // CodeQL flagged /\/+$/ on the caller/manifest-supplied aggregator in configure_assets: that regex
  // backtracks quadratically on adversarial slash runs (measured ~3.1s at n=100k under Bun/JSC). The strip
  // must be linear — microseconds at any n.
  const HOSTILE = `https://agg.example${'/'.repeat(100_000)}x`

  test('configure_assets on a 100k-slash-run aggregator stays under 500ms', () => {
    const t0 = performance.now()
    configure_assets({ aggregator: HOSTILE })
    expect(performance.now() - t0).toBeLessThan(500)
  })

  test('the strip keeps the old /\\/+$/ semantics — one trailing slash-run removed, nothing else', () => {
    configure_assets({ classes: { item: { published: true } }, files: { items: ['axe.png'] } })
    for (const input of [
      'https://agg.example/',
      'https://agg.example///',
      'https://agg.example',
      'https://agg.example/path//',
      'https://agg.example//x/',
      '///',
    ]) {
      configure_assets({ aggregator: input })
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

  test('spell fallback remains host-free while unpublished item art stays empty', () => {
    configure_assets({ classes: { item: {}, spell: {} } })
    expect(item_icon_url('longsword')).toBeNull()
    // Spells are .webp and single-size (#884) — the fallback keeps the family's own file shape.
    expect(spell_icon_url('ikari_haki')).toBe(`${ASSET_BASE}/spells/ikari_haki.webp`)
    expect(spell_icon_url('y').startsWith('/assets/')).toBe(true)
  })
})

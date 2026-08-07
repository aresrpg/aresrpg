// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #884 — the spells family is served as .webp, single-size. RED-FIRST provenance, probed 2026-07-26
// against the live host:
//   GET /spells/senshi_warcleave.webp  → 200 image/webp 25188B   (240 icons live, `<corpus_id>.webp`, 128px)
//   GET /spells/tomoda_lashline.webp   → 200 image/webp 26714B
//   GET /spells/tomoda_lashline.png    → 404 application/xml     (the shape the client used to ask for)
// Two facts are pinned here, both red against the pre-#884 resolver:
//   1. the extension is .webp — for the asset host AND the host-free fallback path alike;
//   2. there is no `_hd` variant for spells by contract (128px single-size), so the resolver takes no
//      size option at all — it cannot mint a URL the store does not serve.
// Items are NOT part of this: item art stays .png (item_icon_url.test.js pins that side).

import { afterEach, describe, expect, test } from 'bun:test'

import { ASSET_BASE, configure_assets, item_icon_url, spell_icon_url } from '../src/jobs.js'

const HOST = 'https://assets.aresrpg.world'

afterEach(() => {
  // bun shares this module across the whole run — explicitly unpublish, never leak `spell` forward.
  configure_assets({ aggregator: HOST, classes: { spell: {}, item: {} } })
})

describe('#884 — spell icons resolve to the served .webp', () => {
  test('the asset host serves {host}/spells/{icon}.webp — the 404-ing .png shape is gone', () => {
    configure_assets({ aggregator: HOST, classes: { spell: { published: true } } })
    expect(spell_icon_url('tomoda_lashline')).toBe(`${HOST}/spells/tomoda_lashline.webp`)
    expect(spell_icon_url('senshi_warcleave')).toBe(`${HOST}/spells/senshi_warcleave.webp`)
    expect(spell_icon_url({ icon: 'rojin_greed' })).toBe(`${HOST}/spells/rojin_greed.webp`)
  })

  test('the host-free fallback keeps the SAME extension — one home for the spell file shape', () => {
    // Explicit, never ambient: an earlier FILE in the same bun process may have published `spell`.
    configure_assets({ aggregator: HOST, classes: { spell: {} } })
    expect(spell_icon_url('tomoda_lashline')).toBe(`${ASSET_BASE}/spells/tomoda_lashline.webp`)
  })

  test('an address-like garbage key is refused instead of becoming a bare fallback URL', () => {
    configure_assets({ aggregator: HOST, classes: { spell: {} } })
    const malformed_id = '0xnot-an-object-id'
    let returned
    let refusal
    try {
      returned = spell_icon_url(malformed_id)
    } catch (error) {
      refusal = error
    }
    expect({ returned, refusal }).toEqual({
      returned: undefined,
      refusal: expect.any(TypeError),
    })
    expect(refusal?.message).toContain('malformed Sui object id')
    expect(() => spell_icon_url(`0x${'25'.repeat(32)}`)).toThrow(
      'not a Sui object id',
    )
  })

  test('no `_hd` variant can be minted — spells are 128px single-size by contract', () => {
    configure_assets({ aggregator: HOST, classes: { spell: { published: true } } })
    // The old `{ hd: true }` option is DELETED: a stale caller passing it gets the base icon, never a
    // `_hd` URL the store has never served.
    // @ts-expect-error — the option no longer exists; this is the regression, pinned.
    expect(spell_icon_url('tomoda_lashline', { hd: true })).toBe(`${HOST}/spells/tomoda_lashline.webp`)
  })

  test('items are untouched — item art is still .png, hd variant included', () => {
    configure_assets({
      aggregator: HOST,
      classes: { item: { published: true } },
      files: { items: ['longsword.png', 'longsword_hd.png'] },
    })
    expect(item_icon_url('longsword')).toBe(`${HOST}/items/longsword.png`)
    expect(item_icon_url('longsword', { hd: true })).toBe(`${HOST}/items/longsword_hd.png`)
  })

  test('an empty key still returns null', () => {
    expect(spell_icon_url(null)).toBeNull()
    expect(spell_icon_url('')).toBeNull()
    expect(spell_icon_url({ icon: null })).toBeNull()
  })
})

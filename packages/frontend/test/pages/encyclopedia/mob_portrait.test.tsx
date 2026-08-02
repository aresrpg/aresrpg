// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1880 — mob portraits derive from the catalog row's OWN key, bounded to the LIVE population.
//
// Measured ground truth (2026-08-02, cache-busted probes against https://assets.aresrpg.world):
//   · the CDN serves the live roster EXACTLY — all 374 keys in mob_slugs.json return 200 (`mobs/<key>.png`),
//     zero orphans, zero renames.
//   · the published mob_catalog.json blob is a 779-key HISTORICAL UNION and all 779 carry a `glb`, so the
//     old `catalog[key]?.glb` gate rejected NOTHING: every derived key reached the network.
//   · the old derivation slugified the display NAME (`name.toLowerCase().replace(/[^a-z0-9]+/g,'_')`).
//     135 of the 374 live names slugify to something that is NOT their catalog key, and all 135 of those
//     slugs exist in the union — so all 135 fired a real request and took a 404. `Aragog's child` →
//     `aragog_s_child` (404) instead of `aragog_child` (200): the `_s_` is the slugifier's fingerprint.
//   · names outside the live population (fire_goblin, shore_gull, plaza_chicklet, gobadoc_the_gourmand …)
//     live in the union but have no art: 404 as well.
// The retry ladder in mob_image.tsx multiplies every one of those misses by 3 attempts.
import { afterEach, expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { configure_assets, item_icon_url, reset_assets_for_test } from '@aresrpg/sdk/jobs'

import { set_catalog_for_test } from '../../../src/game/data/mob_catalog.js'
import {
  encyclopedia_mob_icon_url,
  mob_portrait_key,
  reset_portrait_misses_for_test,
} from '../../../src/pages/encyclopedia/encyclopedia_assets'
import { EncyclopediaMobImage } from '../../../src/pages/encyclopedia/mob_image'
import live_population from '../../../src/pages/encyclopedia/mob_slugs.json'
import encyclopedia_fixture from '../../../src/rpc/fixtures/encyclopedia.json'

/** The exact shape of the historical union that caused the bug: every key resolvable, every key `glb`-bearing.
 * Seeded so the tests prove the boundary holds even while the union is loaded — the union is the trap. */
const HISTORICAL_UNION = {
  aragog_child: { appearance: 'Custom_aragog_child', glb: 'hy_custom_aragog_child' },
  aragog_s_child: { appearance: 'Custom_aragog_child', glb: 'hy_custom_aragog_child' },
  alley_bunny: { appearance: 'Bunny', glb: 'hy_bunny' },
  fire_goblin: { appearance: 'Goblin_Lobber', glb: 'hy_goblin_moldy' },
  shore_gull: { appearance: 'Crow_variant', glb: 'hy_crow_variant' },
  plaza_chicklet: { appearance: 'Chick', glb: 'hy_chick' },
  gobadoc_the_gourmand: { appearance: 'Goblin_Ogre', glb: 'hy_goblin_moldy' },
}

const asset_host = () => {
  configure_assets({ classes: { item: { published: true } } })
  const control = item_icon_url('asset_host_control')
  if (!control) throw new Error('expected the item icon control URL — asset host not configured')
  return control.slice(0, -'/items/asset_host_control.png'.length)
}

afterEach(() => {
  set_catalog_for_test()
  reset_assets_for_test()
  reset_portrait_misses_for_test()
})

// ── (a) a live-population mob resolves by its CATALOG KEY, never a name transform ────────────────
test('a live mob resolves its portrait by the catalog key, not the slugified display name', () => {
  set_catalog_for_test(HISTORICAL_UNION)
  const host = asset_host()

  // The canonical repro: the slugifier turns the apostrophe into `_s_`; the real catalog key is `aragog_child`.
  expect(mob_portrait_key("Aragog's child")).toBe('aragog_child')
  expect(encyclopedia_mob_icon_url({ name: "Aragog's child" })).toBe(`${host}/mobs/aragog_child.png`)
  expect(encyclopedia_mob_icon_url({ name: "Aragog's child" })).not.toContain('aragog_s_child')

  // Ruled-mapping rows: the key carries an authored prefix the display name never mentions.
  expect(encyclopedia_mob_icon_url({ name: 'Aloe Gaia' })).toBe(`${host}/mobs/protector_aloe_gaia.png`)
  expect(encyclopedia_mob_icon_url({ name: 'Anglerqueen' })).toBe(`${host}/mobs/aw_anglerqueen.png`)
  expect(encyclopedia_mob_icon_url({ name: 'Ashskin' })).toBe(`${host}/mobs/cendroling.png`)

  // The _hd tier rides the same key.
  expect(encyclopedia_mob_icon_url({ name: 'Alley Bunny' }, true)).toBe(`${host}/mobs/alley_bunny_hd.png`)
})

test('every live-population name resolves to its own key — no name transform survives anywhere', () => {
  set_catalog_for_test(HISTORICAL_UNION)
  const host = asset_host()
  const wrong = Object.entries(live_population as Record<string, string>).filter(
    ([name, key]) => encyclopedia_mob_icon_url({ name }) !== `${host}/mobs/${key}.png`
  )
  expect(wrong).toEqual([])
})

// ── (b) the union is not the boundary: a union key with no live row never becomes a URL ──────────
test('a key that exists only in the historical union never becomes a portrait URL', () => {
  set_catalog_for_test(HISTORICAL_UNION)
  asset_host()

  // `aragog_s_child` is the slugifier's output AND a real 779-union entry with a glb — the old gate waved
  // it through and it 404s. No live mob is NAMED that, so the population map can never produce it.
  expect(Object.values(live_population as Record<string, string>)).not.toContain('aragog_s_child')
  expect(mob_portrait_key('Definitely Not A Mob')).toBeNull()
  expect(encyclopedia_mob_icon_url({ name: 'Definitely Not A Mob' })).toBeNull()
  expect(encyclopedia_mob_icon_url({ name: undefined })).toBeNull()

  // Mob names arrive off-chain: an Object.prototype member must never be mistaken for a key.
  for (const name of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
    expect(mob_portrait_key(name)).toBeNull()
    expect(encyclopedia_mob_icon_url({ name })).toBeNull()
  }
})

// The four names issue #1880 cited as "not in the live population" are in fact live mobs — the issue
// listed them by the SLUGIFIED keys the buggy client requested. Their real keys serve 200 (probed
// 2026-08-02), so the fix RECOVERS these portraits rather than degrading them to the glyph.
test('the mobs whose slugified keys 404d now resolve to their real, serving keys', () => {
  set_catalog_for_test(HISTORICAL_UNION)
  const host = asset_host()

  expect(encyclopedia_mob_icon_url({ name: 'Fire Goblin' })).toBe(`${host}/mobs/firegoblin.png`)
  expect(encyclopedia_mob_icon_url({ name: 'Shore Gull' })).toBe(`${host}/mobs/gull_campcaw.png`)
  expect(encyclopedia_mob_icon_url({ name: 'Plaza Chicklet' })).toBe(`${host}/mobs/plaza_pecker.png`)
  expect(encyclopedia_mob_icon_url({ name: 'Gobadoc the Gourmand' })).toBe(`${host}/mobs/gobadoc.png`)
})

test('an out-of-population mob renders the fallback glyph and issues NO request', () => {
  set_catalog_for_test(HISTORICAL_UNION)
  asset_host()

  for (const name of ['Maldur the Gravehog', 'Captain Wrackbone', 'Definitely Not A Mob']) {
    const html = renderToStaticMarkup(<EncyclopediaMobImage mob={{ name }} />)
    expect(html).toContain('<svg') // the shield glyph
    expect(html).not.toContain('<img') // no <img> mounted ⇒ the browser can issue no request
    expect(html).not.toContain('/mobs/')
  }
})

// ── the 9 hand-authored bosses have no art yet: fallback, no crash, no flood ─────────────────────
/** The exact rows live /v1 serves (383) that mob_slugs.json (374) has no key for — enumerated against
 * https://rpc.aresrpg.world/v1/encyclopedia on 2026-08-02 and probed on the CDN (all 404, no art anywhere).
 * They must paint the glyph until their art lands; when it does, they join mob_slugs.json and this list shrinks. */
const ARTLESS_BOSSES = [
  'Maldur the Gravehog',
  'Vornest the Galecaller',
  'Hogrune the Sown',
  'Varagh the Rootshell',
  'Captain Wrackbone',
  'Scyllar the Coral King',
  'Voltstripe the Stormfang',
  'Deadmaw the Silent',
  'Pyrlach the Forgemaw',
]

test('the 9 art-less bosses take the fallback path instead of a 404', () => {
  set_catalog_for_test(HISTORICAL_UNION)
  asset_host()

  expect(ARTLESS_BOSSES).toHaveLength(9)
  for (const name of ARTLESS_BOSSES) {
    expect(encyclopedia_mob_icon_url({ name })).toBeNull()
    const html = renderToStaticMarkup(<EncyclopediaMobImage mob={{ name }} hd />)
    expect(html).toContain('<svg')
    expect(html).not.toContain('<img')
  }
})

// ── the interim display override must not cost a mob its portrait ────────────────────────────────
test('a display-overridden name still resolves its raw-chain catalog key', () => {
  set_catalog_for_test(HISTORICAL_UNION)
  const host = asset_host()

  // /v1 serves the DISPLAY string ('Shambling Draugr'); mob_slugs.json is keyed by the raw chain name
  // ('Retarded Draugr'). `mobs/draugr_retarded.png` serves 200 — dropping the reverse override 404s it.
  expect(encyclopedia_mob_icon_url({ name: 'Shambling Draugr' })).toBe(`${host}/mobs/draugr_retarded.png`)
  expect(encyclopedia_mob_icon_url({ name: 'Retarded Draugr' })).toBe(`${host}/mobs/draugr_retarded.png`)
})

// ── one aggregated warn, never per-mob console spam ──────────────────────────────────────────────
test('unresolved portraits emit ONE aggregated warn, not one per mob', async () => {
  set_catalog_for_test(HISTORICAL_UNION)
  asset_host()
  const warn = spyOn(console, 'warn').mockImplementation(() => {})

  try {
    // Four distinct art-less mobs, each re-resolved 3 times (mob_image's retry ladder does exactly this).
    for (const name of ARTLESS_BOSSES.slice(0, 4))
      for (let repeat = 0; repeat < 3; repeat++) encyclopedia_mob_icon_url({ name })

    await Promise.resolve() // let the flush microtask run
    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0] as [string]
    expect(message).toContain('4') // the aggregate count, not four separate lines
    expect(message).toContain('Maldur the Gravehog')
    expect(message).toContain('Vornest the Galecaller')

    // Already-reported names never warn again.
    encyclopedia_mob_icon_url({ name: 'Maldur the Gravehog' })
    await Promise.resolve()
    expect(warn).toHaveBeenCalledTimes(1)
  } finally {
    warn.mockRestore()
  }
})

// ── the population map must stay the projection of the live corpus ───────────────────────────────
test('mob_slugs.json is exactly the /v1 mob population, one unique key per row', () => {
  const population = live_population as Record<string, string>
  const rows = (encyclopedia_fixture as { mobs: { name: string }[] }).mobs
  const names = new Set(Object.keys(population))

  expect(rows.filter(({ name }) => !names.has(name))).toEqual([])
  expect(new Set(Object.values(population)).size).toBe(Object.keys(population).length)
})

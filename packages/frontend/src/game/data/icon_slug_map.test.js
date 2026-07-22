// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #160: the icon slug recovery map is a RUNTIME blob (never a repo artifact — the content pipeline
// authors it privately). An unpublished / absent blob must DEGRADE LOUDLY — one console.error naming the
// missing asset, the cache left empty AND retryable — never a throw. Mirrors game/data/spell_corpus.test.js.
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { reset_walrus_assets_for_test } from '@aresrpg/sdk/jobs'

import { get_icon_slug_map, load_icon_slug_map, set_icon_slug_map_for_test } from './icon_slug_map.js'

// The shared Walrus resolver (packages/sdk/src/jobs.js) has no per-file isolation of its own — bun test
// shares that module process-wide, sorted by path. Reset it before every test so an earlier-sorted file
// that configured the real manifest (e.g. components/item_hover_tooltip.test.tsx) can never make
// 'icon_slug_map' look published here.
beforeEach(() => reset_walrus_assets_for_test())
afterEach(() => set_icon_slug_map_for_test()) // reset module state between tests

describe('icon slug map runtime loader (issue #160)', () => {
  test('absent blob (unpublished — walrus_asset_url → null) → ONE console.error, cache stays {}, never throws', async () => {
    set_icon_slug_map_for_test() // empty + resets the once-per-session warn latch
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    // 'icon_slug_map' is not a configured asset class in the offline test manifest, so the URL resolves null —
    // the exact open-source / pre-publish state. No fetch, no throw, just the loud degrade.
    await expect(load_icon_slug_map()).resolves.toBeUndefined()
    expect(get_icon_slug_map()).toEqual({})
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('[icon-slug-map] no icon_slug_map runtime asset')
    expect(spy.mock.calls[0][0]).toContain('issue #160')
    spy.mockRestore()
  })

  test('the degrade shout is deduped — a second load does not re-scream', async () => {
    set_icon_slug_map_for_test()
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    await load_icon_slug_map()
    await load_icon_slug_map()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  test('set_icon_slug_map_for_test seeds the cache; get_icon_slug_map reads it synchronously', () => {
    const rows = { 'Bag of Nightcaps': 'bag_nightcap' }
    set_icon_slug_map_for_test(rows)
    expect(get_icon_slug_map()).toBe(rows)
  })
})

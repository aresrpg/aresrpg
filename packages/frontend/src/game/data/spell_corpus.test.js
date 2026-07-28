// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #106 regression: the spell corpus is a RUNTIME blob (never a repo artifact). An unpublished / absent
// blob must DEGRADE LOUDLY — one console.error naming the missing asset, the cache left empty AND retryable —
// never a throw. Mirrors game/data/mob_catalog.js and resolve_seed_manifest (#94).
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { reset_assets_for_test } from '@aresrpg/sdk/jobs'

import { get_spell_corpus, load_spell_corpus, set_spell_corpus_for_test } from './spell_corpus.js'

// The shared Walrus resolver (packages/sdk/src/jobs.js) has no per-file isolation of its own — bun test
// shares that module process-wide, sorted by path. Reset it before every test so an earlier-sorted file
// that configured the real manifest (e.g. components/item_hover_tooltip.test.tsx) can never make
// 'spell_corpus' look published here.
beforeEach(() => reset_assets_for_test())
afterEach(() => set_spell_corpus_for_test()) // reset module state between tests

describe('spell corpus runtime loader (issue #106)', () => {
  test('absent blob (unpublished — asset_url → null) → ONE console.error, cache stays [], never throws', async () => {
    set_spell_corpus_for_test() // empty + resets the once-per-session warn latch
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    // 'spell_corpus' is not a configured asset class in the offline test manifest, so the URL resolves null —
    // the exact open-source / pre-publish state. No fetch, no throw, just the loud degrade.
    await expect(load_spell_corpus()).resolves.toBeUndefined()
    expect(get_spell_corpus()).toEqual([])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('[spell-corpus] no spell_corpus runtime asset')
    expect(spy.mock.calls[0][0]).toContain('issue #106')
    spy.mockRestore()
  })

  test('the degrade shout is deduped — a second load does not re-scream', async () => {
    set_spell_corpus_for_test()
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    await load_spell_corpus()
    await load_spell_corpus()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  test('set_spell_corpus_for_test seeds the cache; get_spell_corpus reads it synchronously', () => {
    const rows = [{ id: 's1', classType: 'senshi', unlock: 1, name: 'Warcleave' }]
    set_spell_corpus_for_test(rows)
    expect(get_spell_corpus()).toBe(rows)
  })
})

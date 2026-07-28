// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The pet catalog runtime loader — mirrors mob_catalog.js's own (untested-but-established) contract via its
// sibling spell_corpus.test.js pattern: absence stays retryable, a load caches the published rows, the test
// seam resets cleanly between cases.
import { afterEach, describe, expect, test } from 'bun:test'
import { configure_assets } from '@aresrpg/sdk/jobs'

import { get_pet_catalog, load_pet_catalog, set_pet_catalog_for_test } from './pet_catalog.js'

afterEach(() => {
  set_pet_catalog_for_test() // reset module state between tests
  configure_assets({ classes: { pet_catalog: {} } }) // clear so the next test's manifest state is honest
})

describe('pet catalog runtime loader', () => {
  test('unpublished (no pet_catalog manifest row) -> no fetch, cache stays {}', async () => {
    await expect(load_pet_catalog()).resolves.toBeUndefined()
    expect(get_pet_catalog()).toEqual({})
  })

  test('fetches pet_catalog.json once and caches the published rows', async () => {
    configure_assets({ classes: { pet_catalog: { published: true } } })
    const rows = { pet_aloe_gaia: { appearance: 'Armadillo_Aloe', glb: 'hy_armadillo_aloe' } }
    const original_fetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (/** @type {any} */ url) => {
      calls += 1
      expect(url).toContain('/data/pet_catalog.json')
      return Promise.resolve(new Response(JSON.stringify(rows)))
    }
    try {
      await load_pet_catalog()
      await load_pet_catalog() // second call is a no-op (loaded latch)
      expect(calls).toBe(1)
      expect(get_pet_catalog()).toEqual(rows)
    } finally {
      globalThis.fetch = original_fetch
    }
  })

  test('a failed fetch leaves the cache empty and retryable (never cached as truth)', async () => {
    configure_assets({ classes: { pet_catalog: { published: true } } })
    const original_fetch = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(new Response('', { status: 500 }))
    try {
      await load_pet_catalog()
      expect(get_pet_catalog()).toEqual({})
    } finally {
      globalThis.fetch = original_fetch
    }
  })

  test('set_pet_catalog_for_test seeds the cache; get_pet_catalog reads it synchronously', () => {
    const rows = { pet_gaia: { appearance: 'Armadilla_Gaia', glb: 'hy_armadilla_gaia' } }
    set_pet_catalog_for_test(rows)
    expect(get_pet_catalog()).toBe(rows)
  })
})

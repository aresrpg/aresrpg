// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pet companion models are a runtime join: slug -> pet_catalog row -> the row's `glb` (a bare hy_<appearance>
// reference-corpus id) resolved through the EXISTING published `mob` quilt (mobs.js's resolve_mob_visual_url
// convention). These tests pin the published shape and the structural no-request miss path.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { reset_walrus_assets_for_test } from '@aresrpg/sdk/jobs'

import { get_pet_catalog, get_pet_model_url, load_pet_catalog, set_pet_catalog_for_test } from './pet_catalog.js'

// Every test here injects its own resolve_asset mock, so the shared Walrus resolver (packages/sdk/src/jobs.js)
// is currently inert to this file — reset it anyway (SAME isolation as icon_slug_map.test.js / spell_corpus.test.js)
// so a future test that falls back to the real walrus_asset_url default stays honest regardless of file order.
beforeEach(() => reset_walrus_assets_for_test())
afterEach(() => set_pet_catalog_for_test())

describe('pet catalog runtime loader', () => {
  test('fetches pet_catalog.json once and preserves the published rows', async () => {
    const rows = { pet_bouloute: { appearance: 'bouloute', glb: 'hy_bouloute' } }
    const resolve_asset = mock((url_class, filename) => `https://assets.test/${url_class}/${filename}`)
    const fetch_impl = mock(async () => new Response(JSON.stringify(rows)))

    await load_pet_catalog(resolve_asset, fetch_impl)
    await load_pet_catalog(resolve_asset, fetch_impl)

    expect(resolve_asset).toHaveBeenCalledTimes(1)
    expect(resolve_asset).toHaveBeenCalledWith('pet_catalog', 'pet_catalog.json')
    expect(fetch_impl).toHaveBeenCalledTimes(1)
    expect(fetch_impl).toHaveBeenCalledWith('https://assets.test/pet_catalog/pet_catalog.json')
    expect(get_pet_catalog()).toEqual(rows)
  })

  test('resolves a catalog row glb through the mob quilt, appending .glb like mob rendering does', () => {
    const resolve_asset = mock(
      (_url_class, filename) => `https://assets.test/v1/blobs/by-quilt-id/mob-test/${filename}`
    )
    set_pet_catalog_for_test({ pet_bouloute: { appearance: 'bouloute', glb: 'hy_bouloute' } })

    expect(get_pet_model_url('pet_bouloute', resolve_asset)).toBe(
      'https://assets.test/v1/blobs/by-quilt-id/mob-test/hy_bouloute.glb'
    )
    expect(resolve_asset).toHaveBeenCalledWith('mob', 'hy_bouloute.glb')
  })

  test('absent rows and null glbs never consult the model URL resolver (pure defensiveness)', () => {
    const resolve_asset = mock(() => 'must-not-resolve')

    set_pet_catalog_for_test({})
    expect(get_pet_model_url('pet_bouloute', resolve_asset)).toBeNull()
    set_pet_catalog_for_test({ pet_bouloute: { appearance: 'bouloute', glb: null } })
    expect(get_pet_model_url('pet_bouloute', resolve_asset)).toBeNull()
    expect(resolve_asset).not.toHaveBeenCalled()
  })
})

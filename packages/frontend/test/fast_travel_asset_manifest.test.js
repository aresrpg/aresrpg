// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, test } from 'bun:test'
import { asset_url, configure_assets, reset_assets_for_test } from '@aresrpg/sdk/jobs'

import { fast_travel_asset_refs, fast_travel_dragon_file } from '../src/game/fast_travel_assets.js'

const manifest = JSON.parse(readFileSync(new URL('../public/asset_manifest.json', import.meta.url), 'utf8'))

afterEach(reset_assets_for_test)

describe('fast-travel assets in the built manifest', () => {
  test('every asset referenced by the sequence is sealed into the manifest and resolves', () => {
    expect(manifest.sequences?.fast_travel).toEqual(fast_travel_asset_refs)

    configure_assets(manifest)
    for (const { url_class, filename } of fast_travel_asset_refs) {
      expect(asset_url(url_class, filename)).toBe(`${manifest.aggregator}/models/mobs/${filename}`)
    }
  })

  test('the production and preview variants select only sealed assets', () => {
    expect(['fire', 'frost', 'void', 'unknown'].map(fast_travel_dragon_file)).toEqual([
      'dragon-fire.glb',
      'dragon-frost.glb',
      'dragon-void.glb',
      'dragon-fire.glb',
    ])
  })

  // ROW #2199 — the ridden dragon 404'd because the code asked for an internal codename (`ln.glb`) the bucket
  // never held. The key the flight mount resolves is pinned here, and the shape gate below is the CLASS fix: a
  // codename cannot ship in a public URL, whatever it is called next time.
  test('the flight mount resolves the published dragon-fire key, and no ref is a codename', () => {
    configure_assets(manifest)
    expect(asset_url('mob', fast_travel_dragon_file())).toBe(`${manifest.aggregator}/models/mobs/dragon-fire.glb`)
    for (const { filename } of fast_travel_asset_refs) expect(filename).toMatch(/^dragon-(fire|frost|void)\.glb$/)
  })
})

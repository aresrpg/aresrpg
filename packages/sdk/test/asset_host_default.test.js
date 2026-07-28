// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #650: the asset host is MinIO (assets.aresrpg.world). This pins the default and the re-homing
// guard's general host-confinement property.
import { describe, expect, test } from 'bun:test'

import {
  canonical_asset_url,
  configure_assets,
  item_icon_url,
  asset_url,
} from '../src/jobs.js'

const CDN = 'https://cdn.aresrpg.world'

describe('asset resolver — configured-host default', () => {
  test('a fresh resolver uses the configured host once its classes are published', () => {
    configure_assets({
      aggregator: CDN,
      classes: { item: { published: true }, music: { published: true } },
    })

    expect(item_icon_url('longsword')).toBe(`${CDN}/items/longsword.png`)
    expect(asset_url('music', 'arctic.mp3')).toBe(`${CDN}/music/arctic.mp3`)
  })

  test('runtime Display paths re-home onto the configured host — ANY absolute origin, not just a asset-host shape', () => {
    // A legacy asset-host-shaped path still re-homes (an old minted Display must keep resolving).
    expect(
      canonical_asset_url(
        'https://raw-origin.example/v1/blobs/by-quilt-id/ITEM_Q/longsword.png',
      ),
    ).toBe(`${CDN}/v1/blobs/by-quilt-id/ITEM_Q/longsword.png`)
    // A plain asset-host-shaped path (#650: what a chain Display actually carries today) re-homes too — the
    // OLD guard returned null here (no `/v1/blobs/` marker); the new one keeps the host-confinement property
    // for ANY absolute origin, never just the retired asset-host shape.
    expect(
      canonical_asset_url('https://legacy-origin.example/items/longsword.png'),
    ).toBe(`${CDN}/items/longsword.png`)
  })
})

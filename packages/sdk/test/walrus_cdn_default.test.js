import { describe, expect, test } from 'bun:test'

import {
  canonical_walrus_asset_url,
  configure_item_icons,
  configure_walrus_assets,
  item_icon_url,
  walrus_asset_url,
} from '../src/jobs.js'

const CDN = 'https://cdn.aresrpg.world/walrus'

describe('Walrus runtime CDN default', () => {
  test('a fresh resolver uses the CDN when class ids are supplied without an aggregator', () => {
    configure_item_icons({ item_quilt: 'ITEM_Q' })
    configure_walrus_assets({ classes: { music: { quilt: 'MUSIC_Q' } } })

    expect(item_icon_url('longsword')).toBe(
      `${CDN}/v1/blobs/by-quilt-id/ITEM_Q/longsword.png`,
    )
    expect(walrus_asset_url('music', 'arctic.mp3')).toBe(
      `${CDN}/v1/blobs/by-quilt-id/MUSIC_Q/arctic.mp3`,
    )
  })

  test('runtime Display blob paths are re-homed onto the configured CDN base', () => {
    expect(
      canonical_walrus_asset_url(
        'https://raw-origin.example/v1/blobs/by-quilt-id/ITEM_Q/longsword.png',
      ),
    ).toBe(`${CDN}/v1/blobs/by-quilt-id/ITEM_Q/longsword.png`)
    expect(
      canonical_walrus_asset_url(
        'https://legacy-origin.example/items/longsword.png',
      ),
    ).toBeNull()
  })
})

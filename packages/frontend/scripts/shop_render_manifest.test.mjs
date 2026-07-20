// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { manifest_media_for_item } from './shop_render_manifest.mjs'

const item = Object.freeze({
  appearance: 'momaku',
  category: 'hat',
  render_key: 'momaku',
  skin: null,
  variant: null,
})

const previous = Object.freeze({
  ...item,
  png: 'worn/momaku.png',
  png_hd: 'worn/momaku_hd.png',
  video: 'video/momaku_worn.webm',
})

describe('shop render manifest media', () => {
  test('a selected missing GLB retains prior still references', () => {
    expect(manifest_media_for_item({ item, previous, renderable: false, rendered_now: false, selected: true })).toEqual(
      {
        png: 'worn/momaku.png',
        png_hd: 'worn/momaku_hd.png',
        video: 'video/momaku_worn.webm',
      }
    )
  })

  test('a successful render replaces still paths', () => {
    expect(
      manifest_media_for_item({ item, previous: null, renderable: true, rendered_now: true, selected: true })
    ).toEqual({
      png: 'worn/momaku.png',
      png_hd: 'worn/momaku_hd.png',
      video: null,
    })
  })

  test.each([
    ['appearance', { appearance: 'cape_kamui' }],
    ['category', { category: 'cloak' }],
    ['render key', { render_key: 'momaku_black' }],
    ['skin', { skin: 'black' }],
    ['variant', { variant: 'black' }],
  ])('a changed %s clears the preserved video', (_, change) => {
    const changed_item = { ...item, ...change }
    const media = manifest_media_for_item({
      item: changed_item,
      previous,
      renderable: true,
      rendered_now: true,
      selected: true,
    })

    expect(media.video).toBeNull()
  })
})

import { describe, expect, test } from 'bun:test'

import { resolve_shop_render_url, shop_render_identifier } from './shop_render_url'

describe('shop render Walrus resolution', () => {
  test('uses basename patch identifiers for image and video media', () => {
    const calls: [string, string][] = []
    const resolve_asset = (url_class: string, filename: string) => {
      calls.push([url_class, filename])
      return `/walrus/${url_class}/${filename}`
    }

    expect(resolve_shop_render_url('worn/cape_kamui_hd.png', resolve_asset)).toBe(
      '/walrus/shop_render/cape_kamui_hd.png'
    )
    expect(resolve_shop_render_url('video/cape_kamui_worn.webm', resolve_asset)).toBe(
      '/walrus/shop_render/cape_kamui_worn.webm'
    )
    expect(calls).toEqual([
      ['shop_render', 'cape_kamui_hd.png'],
      ['shop_render', 'cape_kamui_worn.webm'],
    ])
  })

  test('keeps a null URL when the class is not published', () => {
    expect(resolve_shop_render_url('worn/cape_kamui.png', () => null)).toBeNull()
    expect(resolve_shop_render_url(null, () => '/unexpected')).toBeNull()
    expect(shop_render_identifier('')).toBeNull()
  })
})

import { describe, expect, test } from 'bun:test'

import { framing_for_slot, framing_search_params, worn_slot_for_category } from './shop_render_framing.mjs'

describe('shop render slot framing', () => {
  test('hats default to the sane-distance front view — the reframe law, never a close-up', () => {
    const head = framing_for_slot('head')
    const back = framing_for_slot('back')

    expect(worn_slot_for_category('hat')).toBe('head')
    expect(head).toEqual({
      camera_radius: 3.6,
      camera_y: 1.15,
      face_radians: 0,
      orbit_degrees: 42,
      seek_seconds: 2.25,
      target_y: 1.15,
    })
    // Same showcase distance as the cloak view; only the facing flips (front vs back-quarter).
    expect(head.camera_radius).toBe(back.camera_radius)
    expect(head.face_radians).toBe(0)
    expect(back.face_radians).toBe(Math.PI)
  })

  test('cloak/back keeps the existing back-quarter framing', () => {
    const framing = framing_for_slot(worn_slot_for_category('cloak'))
    const params = framing_search_params('back')

    expect(framing).toEqual({
      camera_radius: 3.6,
      camera_y: 1.65,
      face_radians: Math.PI,
      orbit_degrees: 42,
      seek_seconds: 2.25,
      target_y: 1.3,
    })
    expect(Object.fromEntries(params)).toEqual({
      camr: '3.6',
      camy: '1.65',
      face: String(Math.PI),
      orbit: '42',
      ty: '1.3',
    })
  })

  test('rejects unsupported categories and slots', () => {
    expect(() => worn_slot_for_category('title')).toThrow('unsupported worn cosmetic category: title')
    expect(() => framing_for_slot('feet')).toThrow('unsupported worn cosmetic slot: feet')
  })
})

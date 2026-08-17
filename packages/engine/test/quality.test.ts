// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { QUALITY_OPTIONS, QUALITY_PROFILES, quality_pixel_ratio, uses_world_post_processing } from '../src/quality.ts'

describe('engine quality profiles', () => {
  test('all three tiers remain strictly sub-native', () => {
    expect(Object.keys(QUALITY_PROFILES)).toEqual(['low', 'medium', 'high'])
    expect(Object.values(QUALITY_PROFILES).every(({ render }) => render.scale < 1)).toBe(true)
  })

  test('does not stack redundant multisampling or bloom under the post anti-aliasing pass', () => {
    expect(Object.values(QUALITY_PROFILES).map(({ effects }) => Object.keys(effects))).toEqual([
      ['atmosphere'],
      ['atmosphere'],
      ['atmosphere'],
    ])
  })

  test('keeps local volumetrics off low and bounded on the richer tiers', () => {
    expect(QUALITY_PROFILES.low.effects.atmosphere).toBeNull()
    expect(QUALITY_PROFILES.medium.effects.atmosphere).toEqual({ resolution_scale: 0.35, steps: 6 })
    expect(QUALITY_PROFILES.high.effects.atmosphere).toEqual({ resolution_scale: 0.4, steps: 8 })
  })

  test('the high tier caps a 5120x1440 display below native pixels', () => {
    const ratio = quality_pixel_ratio({
      quality: 'high',
      css_width: 5120,
      css_height: 1440,
      device_pixel_ratio: 1,
    })

    expect(ratio).toBe(0.8)
    expect(5120 * 1440 * ratio * ratio).toBeLessThan(6_000_000)
  })

  test('the pixel ceiling protects dense displays independently of DPR', () => {
    const ratio = quality_pixel_ratio({
      quality: 'medium',
      css_width: 3840,
      css_height: 2160,
      device_pixel_ratio: 2,
    })

    expect(3840 * 2160 * ratio * ratio).toBeCloseTo(3_500_000)
  })

  test('the isolated fight presentation keeps the former medium-tier sharpness', () => {
    expect(
      quality_pixel_ratio({
        quality: 'medium',
        css_width: 1000,
        css_height: 800,
        device_pixel_ratio: 2,
        presentation: 'fight',
      })
    ).toBe(1.5)
  })

  test('fight rendering stays direct at every quality instead of running exploration post effects', () => {
    expect(QUALITY_OPTIONS.map((quality) => uses_world_post_processing(quality, 'fight'))).toEqual([
      false,
      false,
      false,
    ])
    expect(uses_world_post_processing('medium', 'world')).toBeTrue()
  })
})

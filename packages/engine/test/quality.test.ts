// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { QUALITY_OPTIONS, QUALITY_PROFILES, quality_pixel_ratio, uses_world_post_processing } from '../src/quality.ts'

describe('engine quality profiles', () => {
  test('only high renders the exploration scene at native scale', () => {
    expect(Object.keys(QUALITY_PROFILES)).toEqual(['low', 'medium', 'high'])
    expect(Object.values(QUALITY_PROFILES).map(({ render }) => [render.scale, render.scene_scale])).toEqual([
      [0.75, 0.88],
      [0.9, 0.82],
      [1, 1],
    ])
  })

  test('reconstructs a cheaper scene into a sharper display buffer', () => {
    expect(
      Object.values(QUALITY_PROFILES).map(({ render }) => ({
        display: render.scale,
        scene: render.scale * render.scene_scale,
      }))
    ).toEqual([
      { display: 0.75, scene: 0.66 },
      { display: 0.9, scene: 0.738 },
      { display: 1, scene: 1 },
    ])
  })

  test('reserves selective HDR bloom for high quality', () => {
    expect(Object.values(QUALITY_PROFILES).map(({ effects }) => Object.keys(effects))).toEqual([
      ['bloom'],
      ['bloom'],
      ['bloom'],
    ])
    expect(QUALITY_PROFILES.low.effects.bloom).toBeNull()
    expect(QUALITY_PROFILES.medium.effects.bloom).toBeNull()
    expect(QUALITY_PROFILES.high.effects.bloom).toEqual({ strength: 0.13, radius: 0.6, threshold: 2.05 })
  })

  test('the high tier caps a 5120x1440 display below native pixels', () => {
    const ratio = quality_pixel_ratio({
      quality: 'high',
      css_width: 5120,
      css_height: 1440,
      device_pixel_ratio: 1,
    })

    expect(ratio).toBeLessThan(1)
    expect(5120 * 1440 * ratio * ratio).toBeCloseTo(6_000_000)
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
    expect(QUALITY_OPTIONS.map((quality) => uses_world_post_processing(quality, 'world'))).toEqual([false, true, true])
  })
})

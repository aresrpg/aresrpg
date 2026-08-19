// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { cloud_coverage_threshold, cloud_sample_xz, cloud_shadow_strength } from '../src/clouds.ts'
import { grade_rgb, grade_rgb_low_frequency } from '../src/grading.ts'
import { HEIGHT_FOG, height_fog_density } from '../src/height_fog.ts'
import {
  sun_shafts_sample_gain,
  sun_shafts_source_threshold,
  sun_shafts_visibility,
  sun_shafts_visible,
} from '../src/sun_shafts.ts'
import { ao_brightness, face_brightness, lit_face_brightness } from '../src/terrain_lighting.ts'

describe('fast cloud field', () => {
  test('visible clouds and their ground shadow share one drifted sample space', () => {
    const drift = [12, -7] as const
    const visible = cloud_sample_xz([80, 40], drift)
    const shadow = cloud_sample_xz([20, 10], drift, {
      height: 0,
      sun_direction: [0.4, 0.8, 0.2],
      cloud_height: 120,
    })

    expect(shadow[0]).toBeCloseTo(visible[0])
    expect(shadow[1]).toBeCloseTo(visible[1])
  })

  test('cloud shadows scale with quality, and dry climates retain sparse readable cover', () => {
    expect(cloud_shadow_strength('low')).toBe(0)
    expect(cloud_shadow_strength('medium')).toBeGreaterThan(0)
    expect(cloud_shadow_strength('high')).toBeGreaterThan(cloud_shadow_strength('medium'))
    expect(cloud_shadow_strength('high')).toBeGreaterThanOrEqual(0.5)
    expect(cloud_coverage_threshold(0)).toBeLessThanOrEqual(0.6)
    expect(cloud_coverage_threshold(1)).toBeLessThan(cloud_coverage_threshold(0))
  })
})

describe('sun shafts', () => {
  test('exist only for a visible daylight sun above water', () => {
    expect(sun_shafts_visible({ sun_y: 0.6, view_dot_sun: 0.8, ndc_x: 0.2, ndc_y: -0.3, submerged: false })).toBeTrue()
    expect(sun_shafts_visible({ sun_y: -0.1, view_dot_sun: 0.8, ndc_x: 0, ndc_y: 0, submerged: false })).toBeFalse()
    expect(sun_shafts_visible({ sun_y: 0.6, view_dot_sun: -0.2, ndc_x: 0, ndc_y: 0, submerged: false })).toBeFalse()
    expect(sun_shafts_visible({ sun_y: 0.6, view_dot_sun: 0.3, ndc_x: 1.4, ndc_y: 0, submerged: false })).toBeTrue()
    expect(
      sun_shafts_visibility({ sun_y: 0.6, view_dot_sun: 0.3, ndc_x: 1.4, ndc_y: 0, submerged: false })
    ).toBeLessThan(1)
    expect(sun_shafts_visible({ sun_y: 0.6, view_dot_sun: 0.3, ndc_x: 2.3, ndc_y: 0, submerged: false })).toBeFalse()
    expect(sun_shafts_visible({ sun_y: 0.6, view_dot_sun: 0.8, ndc_x: 0, ndc_y: 0, submerged: true })).toBeFalse()
  })

  test('more samples preserve brightness, and a peripheral shaft accepts the bright sky around it', () => {
    expect(sun_shafts_sample_gain(12)).toBe(1)
    expect(sun_shafts_sample_gain(24)).toBe(0.5)
    expect(sun_shafts_source_threshold(1.45, 1.8, 0)).toBeLessThan(1.45)
    expect(sun_shafts_source_threshold(1.45, 0.5, 0)).toBe(1.45)
  })
})

describe('height fog', () => {
  test('pools in humid valleys and clears above them', () => {
    const dry_valley = height_fog_density(100, 100, 0)
    const wet_valley = height_fog_density(100, 100, 1)
    const wet_peak = height_fog_density(180, 100, 1)

    expect(wet_valley).toBeGreaterThan(dry_valley)
    expect(wet_peak).toBeLessThan(wet_valley * 0.1)
    expect(HEIGHT_FOG.max_opacity).toBeLessThanOrEqual(0.25)
  })
})

describe('display grade', () => {
  test('preserves the neutral axis, keeps every channel display-safe, and adds bounded local separation', () => {
    const neutral = grade_rgb([0.4, 0.4, 0.4])
    expect(neutral[0]).toBeCloseTo(neutral[1], 12)
    expect(neutral[1]).toBeCloseTo(neutral[2], 12)
    expect(neutral.every((channel) => channel >= 0 && channel <= 1)).toBe(true)

    const dark = grade_rgb_low_frequency([0.3, 0.32, 0.28], 0.25)
    const light = grade_rgb_low_frequency([0.3, 0.32, 0.28], 0.7)
    const detail_before = 0.32 - 0.3
    const detail_after = dark[1] - dark[0]

    expect(light).not.toEqual(dark)
    expect(Math.abs(detail_after)).toBeGreaterThan(Math.abs(detail_before))
    expect(Math.abs(detail_after)).toBeLessThan(0.04)
  })
})

describe('voxel lighting contract', () => {
  test('authored directional contrast is the unlit fallback, and contact shade stays readable', () => {
    expect(Array.from({ length: 6 }, (_, face) => face_brightness(face))).toEqual([0.6, 0.6, 1, 0.5, 0.8, 0.8])
    expect(Array.from({ length: 6 }, (_, face) => lit_face_brightness(face))).toEqual([1, 1, 1, 1, 1, 1])
    expect(ao_brightness(0, true)).toBeCloseTo(0.6425)
    expect(ao_brightness(0, false)).toBeCloseTo(0.727)
    expect(ao_brightness(3, true)).toBe(1)
  })
})

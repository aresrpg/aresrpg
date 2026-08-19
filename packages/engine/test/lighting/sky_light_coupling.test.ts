// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { couple_lighting, fill_dir_of, shadow_direction_changed } from '../../src/lighting/sky_light_coupling.ts'

const unit = (v: readonly number[]) => Math.hypot(v[0]!, v[1]!, v[2]!)

describe('sky-coupled lighting', () => {
  test('the fill is a low unit bounce opposite the key that follows it and never degenerates', () => {
    const key = [0.6, 0.5, -0.62] as const
    const fill = fill_dir_of([...key])
    expect(unit(fill)).toBeCloseTo(1)
    expect(Math.sign(fill[0]!)).toBe(-Math.sign(key[0]))
    expect(Math.sign(fill[2]!)).toBe(-Math.sign(key[2]))
    expect(fill[1]!).toBeGreaterThan(0) // above the horizon: bounce, never an underground light
    expect(fill[1]!).toBeLessThan(0.6) // but low — a second overhead sun is the bug this replaces

    // It follows the key instead of staying put.
    const morning = fill_dir_of([0.9, 0.3, 0])
    const evening = fill_dir_of([-0.9, 0.3, 0])
    expect(morning[0]).toBeCloseTo(-evening[0]!)

    // A key straight overhead keeps a finite direction.
    const overhead = fill_dir_of([0, 1, 0])
    expect(unit(overhead)).toBeCloseTo(1)
    expect(Number.isFinite(overhead[0]!)).toBeTrue()
  })

  test('the fill cools with the sky at night, and the shadow projection holds below a quarter-degree', () => {
    const baseline = {
      sun_color: [1, 0.95, 0.87] as const,
      sun_intensity: 3,
      fill_color: [1, 0.84, 0.66] as const,
      fill_intensity: 1.35,
      hemi_sky: [0.74, 0.7, 0.63] as const,
      hemi_ground: [0.59, 0.5, 0.34] as const,
      hemi_intensity: 0.9,
    }
    const noon = couple_lighting([0, 1, 0], baseline)
    const night = couple_lighting([0, -0.8, 0.6], baseline)
    const warmth = (rgb: readonly number[]) => rgb[0]! / Math.max(rgb[2]!, 1e-4)
    expect(warmth(night.fill_color)).toBeLessThan(warmth(noon.fill_color))
    expect(night.fill_intensity).toBeLessThan(noon.fill_intensity)
    expect(night.hemi_intensity).toBeCloseTo(baseline.hemi_intensity * 0.6)
    expect(night.hemi_intensity).toBeLessThan(noon.hemi_intensity)

    const cosine = (degrees: number): number => Math.cos((degrees * Math.PI) / 180)
    expect(shadow_direction_changed(cosine(0.2))).toBe(false)
    expect(shadow_direction_changed(cosine(0.3))).toBe(true)
  })
})

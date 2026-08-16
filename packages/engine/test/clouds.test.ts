// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { cloud_coverage_threshold, cloud_sample_xz, cloud_shadow_strength } from '../src/clouds.ts'

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

  test('low quality pays for no cloud shadows', () => {
    expect(cloud_shadow_strength('low')).toBe(0)
    expect(cloud_shadow_strength('medium')).toBeGreaterThan(0)
    expect(cloud_shadow_strength('high')).toBeGreaterThan(cloud_shadow_strength('medium'))
  })

  test('dry climates retain sparse readable cloud cover', () => {
    expect(cloud_coverage_threshold(0)).toBeLessThanOrEqual(0.6)
    expect(cloud_coverage_threshold(1)).toBeLessThan(cloud_coverage_threshold(0))
    expect(cloud_shadow_strength('high')).toBeGreaterThanOrEqual(0.5)
  })
})

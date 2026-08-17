// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { grade_rgb, grade_rgb_low_frequency } from '../src/grading.ts'

describe('display grade', () => {
  test('preserves the neutral axis and keeps every channel display-safe', () => {
    const neutral = grade_rgb([0.4, 0.4, 0.4])
    expect(neutral[0]).toBeCloseTo(neutral[1], 12)
    expect(neutral[1]).toBeCloseTo(neutral[2], 12)
    expect(neutral.every((channel) => channel >= 0 && channel <= 1)).toBe(true)
  })

  test('uses regional luminance and adds bounded local separation', () => {
    const dark = grade_rgb_low_frequency([0.3, 0.32, 0.28], 0.25)
    const light = grade_rgb_low_frequency([0.3, 0.32, 0.28], 0.7)
    const detail_before = 0.32 - 0.3
    const detail_after = dark[1] - dark[0]

    expect(light).not.toEqual(dark)
    expect(Math.abs(detail_after)).toBeGreaterThan(Math.abs(detail_before))
    expect(Math.abs(detail_after)).toBeLessThan(0.04)
  })
})

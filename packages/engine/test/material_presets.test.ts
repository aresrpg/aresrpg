// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { MATERIAL_PRESET_DEFINITIONS, material_pattern } from '../src/material_presets.ts'

describe('material presets', () => {
  test('produce deterministic but semantically distinct surface detail', () => {
    const samples = (preset: keyof typeof MATERIAL_PRESET_DEFINITIONS) =>
      Array.from({ length: 64 }, (_, index) => material_pattern(preset, index % 8, Math.floor(index / 8), 2))

    expect(samples('grass')).toEqual(samples('grass'))
    expect(samples('grass')).not.toEqual(samples('stone'))
    expect(samples('snow')).not.toEqual(samples('sand'))
    expect(samples('ice')).not.toEqual(samples('water'))
    expect(Math.max(...samples('sand')) - Math.min(...samples('sand'))).toBeLessThan(
      Math.max(...samples('grass')) - Math.min(...samples('grass'))
    )
  })

  test('keeps every dielectric response in a physically useful range', () => {
    Object.values(MATERIAL_PRESET_DEFINITIONS).forEach(({ roughness }) => {
      expect(roughness).toBeGreaterThanOrEqual(0.1)
      expect(roughness).toBeLessThanOrEqual(0.95)
    })
  })
})

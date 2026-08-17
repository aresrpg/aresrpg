// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { shore_foam_profile, shore_wave_displacement } from '../src/water.ts'
import { WATER_SURFACE_LAYOUT } from '../src/water_surface_layout.ts'

describe('water surface detail', () => {
  test('foam is a shoreline band, not a tint over the whole ocean', () => {
    expect(shore_foam_profile(0)).toBe(0)
    expect(shore_foam_profile(0.45)).toBeGreaterThan(0.5)
    expect(shore_foam_profile(2)).toBe(0)
  })

  test('wave troughs cannot fall through the last shoreline block', () => {
    expect(shore_wave_displacement(-0.27, 0)).toBe(0)
    expect(shore_wave_displacement(-0.27, 0.65)).toBeGreaterThan(-0.27)
    expect(shore_wave_displacement(-0.27, 2)).toBe(-0.27)
    expect(shore_wave_displacement(0.27, 0)).toBe(0.27)
  })

  test('the sampled bed covers both the near surface and the complete horizon', () => {
    const points = new Set<string>()
    for (let index = 0; index < WATER_SURFACE_LAYOUT.positions.length; index += 3)
      points.add(`${WATER_SURFACE_LAYOUT.positions[index]},${WATER_SURFACE_LAYOUT.positions[index + 2]}`)
    expect(points.has('0,0')).toBeTrue()
    expect(points.has('256,256')).toBeTrue()
    expect(points.has('4096,4096')).toBeTrue()
    expect(WATER_SURFACE_LAYOUT.indices.length).toBeGreaterThan(0)
  })

  test('transmission color follows bed depth, never the camera elevation', () => {
    const source = readFileSync(join(import.meta.dir, '../src/water.ts'), 'utf8')

    expect(source).toContain('const optical_depth = vdepth')
    expect(source).not.toContain('vdepth.div(view_up)')
    expect(source).not.toContain('WATER_ALPHA_VIEW_LEAN')
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { atmosphere_profile, validate_atmosphere } from '../src/atmosphere_profile.ts'
import { HEIGHT_FOG } from '../src/height_fog.ts'

test('omitting an atmosphere preset preserves the shipped cinematic settings', () => {
  expect(atmosphere_profile()).toBe(atmosphere_profile('cinematic'))
  expect(atmosphere_profile()).toMatchObject({
    ambient_gain: 1,
    ambient_tint: [1, 1, 1],
    tint: 1,
    density: 8,
    max_opacity: 0.85,
    near: 40,
    full: 150,
    height_density: HEIGHT_FOG.density,
    height_max: HEIGHT_FOG.max_opacity,
    distance_near_scale: 1,
    distance_far_scale: 1,
  })
})

test('clear atmosphere keeps an ordered haze range and the quality tier’s distant horizon closure', () => {
  const clear = atmosphere_profile('clear')
  expect(clear.near).toBeGreaterThanOrEqual(0)
  expect(clear.full).toBeGreaterThan(clear.near)
  expect(clear.density).toBeGreaterThan(0)
  expect(clear.max_opacity).toBeLessThan(1)
  expect(clear.distance_near_scale).toBe(1)
  expect(clear.distance_far_scale).toBe(1)
  expect(clear.height_max).toBeLessThan(atmosphere_profile().height_max)
  expect(validate_atmosphere('clear')).toEqual([])
  expect(validate_atmosphere(undefined)).toEqual([])
  expect(validate_atmosphere({ density: 0 })).toHaveLength(1)
})

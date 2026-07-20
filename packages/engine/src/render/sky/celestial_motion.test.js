// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  CELESTIAL_CYCLE_MS,
  celestial_angle_at,
  celestial_tod_at,
  is_linear_celestial_step,
  moon_dir_from_tod,
  sun_dir_from_tod,
} from './celestial_motion.js'

const TAU = Math.PI * 2

/** @param {import('three').Vector3} a @param {import('three').Vector3} b @returns {number} */
const angle_between = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b))))

describe('continuous celestial motion', () => {
  test('equal real-time deltas produce equal unwrapped angle deltas across three wraps', () => {
    const steps_per_cycle = 137
    const dt = CELESTIAL_CYCLE_MS / steps_per_cycle
    const expected_delta = TAU / steps_per_cycle
    let previous = celestial_angle_at(0, 0.28)

    for (let step = 1; step <= steps_per_cycle * 3 + 1; step += 1) {
      const current = celestial_angle_at(step * dt, 0.28)
      expect(current - previous).toBeCloseTo(expected_delta, 11)
      previous = current
    }

    expect(celestial_angle_at(CELESTIAL_CYCLE_MS, 0.28) - celestial_angle_at(0, 0.28)).toBeCloseTo(TAU, 12)
    expect(celestial_tod_at(CELESTIAL_CYCLE_MS * 3, 0.28)).toBeCloseTo(0.28, 12)
  })

  test('recognises a paced linear publisher without mistaking pins or seeks for a clock', () => {
    const elapsed_ms = 2000
    const previous_tod = 0.999
    const next_tod = celestial_tod_at(elapsed_ms, previous_tod)

    expect(is_linear_celestial_step(previous_tod, next_tod, elapsed_ms)).toBe(true)
    expect(is_linear_celestial_step(previous_tod, previous_tod, elapsed_ms)).toBe(false)
    expect(is_linear_celestial_step(previous_tod, 0.5, elapsed_ms)).toBe(false)
  })

  test('equal phase deltas produce equal direction angles through every seam', () => {
    const steps_per_cycle = 120
    const expected = angle_between(sun_dir_from_tod(0), sun_dir_from_tod(1 / steps_per_cycle))

    for (let step = 1; step <= steps_per_cycle * 3; step += 1) {
      const before = sun_dir_from_tod((step - 1) / steps_per_cycle)
      const after = sun_dir_from_tod(step / steps_per_cycle)
      expect(angle_between(before, after)).toBeCloseTo(expected, 11)
      expect(after.length()).toBeCloseTo(1, 12)
    }
  })

  test('moon remains in exact opposition across three wraps', () => {
    for (let step = 0; step <= 360; step += 1) {
      const tod = step / 120
      const sun = sun_dir_from_tod(tod)
      const moon = moon_dir_from_tod(tod)
      expect(sun.dot(moon)).toBeCloseTo(-1, 12)
      expect(sun.clone().add(moon).length()).toBeCloseTo(0, 12)
    }
  })
})

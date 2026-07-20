// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit tests for the pure joystick math (M-03). No DOM, no React — see touch_stick.js header for the
// sign-convention + no-independent-axis-clamp contracts this asserts.
import { describe, expect, test } from 'bun:test'

import { compute_stick_vector, clamp_stick_origin, STICK_MAX_RADIUS_PX, STICK_DEAD_ZONE_RATIO } from './touch_stick.js'

describe('compute_stick_vector — dead zone', () => {
  test('at rest (0,0) → zero vector, no NaN', () => {
    const v = compute_stick_vector(0, 0)
    expect(v.forward).toBe(0)
    expect(v.strafe).toBe(0)
    expect(v.magnitude).toBe(0)
    expect(Number.isNaN(v.forward)).toBe(false)
  })

  test('drag inside the dead zone radius → zero magnitude (absorbs thumb-rest jitter)', () => {
    const dead_radius = STICK_DEAD_ZONE_RATIO * STICK_MAX_RADIUS_PX
    const v = compute_stick_vector(dead_radius * 0.5, 0)
    expect(v.magnitude).toBe(0)
    expect(v.strafe).toBe(0)
  })

  test('drag exactly at the dead zone boundary → magnitude starts at 0 (continuous, no jump)', () => {
    const dead_radius = STICK_DEAD_ZONE_RATIO * STICK_MAX_RADIUS_PX
    const v = compute_stick_vector(dead_radius, 0)
    expect(v.magnitude).toBeCloseTo(0, 5)
  })

  test('drag just past the dead zone → small positive magnitude, not a discontinuous jump to 1', () => {
    const dead_radius = STICK_DEAD_ZONE_RATIO * STICK_MAX_RADIUS_PX
    const usable = STICK_MAX_RADIUS_PX - dead_radius
    const v = compute_stick_vector(dead_radius + usable * 0.1, 0)
    expect(v.magnitude).toBeGreaterThan(0)
    expect(v.magnitude).toBeCloseTo(0.1, 1)
  })
})

describe('compute_stick_vector — max clamp', () => {
  test('drag far beyond max_radius clamps to magnitude 1, not >1', () => {
    const v = compute_stick_vector(0, -STICK_MAX_RADIUS_PX * 10)
    expect(v.magnitude).toBe(1)
    expect(v.forward).toBeCloseTo(1, 5)
  })

  test('clamped_dx/dy pin to the outer radius along the same angle (visual thumb never leaves the base)', () => {
    const v = compute_stick_vector(STICK_MAX_RADIUS_PX * 5, 0)
    expect(v.clamped_dx).toBeCloseTo(STICK_MAX_RADIUS_PX, 5)
    expect(v.clamped_dy).toBeCloseTo(0, 5)
  })
})

describe('compute_stick_vector — cardinal directions match character_controller contract (forward=up, strafe=right)', () => {
  test('drag straight up (screen -dy) → forward +1, strafe 0', () => {
    const v = compute_stick_vector(0, -STICK_MAX_RADIUS_PX)
    expect(v.forward).toBeCloseTo(1, 5)
    expect(v.strafe).toBeCloseTo(0, 5)
  })

  test('drag straight down (screen +dy) → forward -1', () => {
    const v = compute_stick_vector(0, STICK_MAX_RADIUS_PX)
    expect(v.forward).toBeCloseTo(-1, 5)
  })

  test('drag right (+dx) → strafe +1, forward 0', () => {
    const v = compute_stick_vector(STICK_MAX_RADIUS_PX, 0)
    expect(v.strafe).toBeCloseTo(1, 5)
    expect(v.forward).toBeCloseTo(0, 5)
  })

  test('drag left (-dx) → strafe -1', () => {
    const v = compute_stick_vector(-STICK_MAX_RADIUS_PX, 0)
    expect(v.strafe).toBeCloseTo(-1, 5)
  })
})

describe('compute_stick_vector — diagonals never exceed unit magnitude (no independent-axis clamp)', () => {
  test('a 45° drag at 2x max_radius on EACH axis still clamps to a unit vector, not sqrt(2)', () => {
    // A naive implementation clamping forward/strafe independently (e.g. clamp(dy/max,-1,1) and
    // clamp(dx/max,-1,1) done separately) would report forward=1 AND strafe=1 here — hypot = sqrt(2), a
    // free diagonal speed boost. This asserts the actual, magnitude-derived behavior instead.
    const v = compute_stick_vector(STICK_MAX_RADIUS_PX * 2, -STICK_MAX_RADIUS_PX * 2)
    expect(Math.hypot(v.forward, v.strafe)).toBeCloseTo(1, 5)
    expect(v.forward).toBeCloseTo(v.strafe, 5) // symmetric 45° drag → equal components
  })

  test('a diagonal drag anywhere in range keeps hypot(forward,strafe) <= 1', () => {
    for (const frac of [0.2, 0.4, 0.6, 0.8, 1, 1.5]) {
      const d = STICK_MAX_RADIUS_PX * frac
      const v = compute_stick_vector(d, d)
      expect(Math.hypot(v.forward, v.strafe)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})

describe('compute_stick_vector — custom options override the defaults', () => {
  test('a larger max_radius rescales the same px drag to a smaller magnitude', () => {
    const default_v = compute_stick_vector(24, 0)
    const wider_v = compute_stick_vector(24, 0, { max_radius: 96 })
    expect(wider_v.magnitude).toBeLessThan(default_v.magnitude)
  })

  test('a zero dead_zone means any nonzero drag produces nonzero magnitude', () => {
    const v = compute_stick_vector(1, 0, { dead_zone: 0 })
    expect(v.magnitude).toBeGreaterThan(0)
  })
})

describe('clamp_stick_origin — dynamic-spawn stick center stays fully inside its zone', () => {
  const bounds = { radius: 48, min_x: 0, min_y: 400, max_x: 200, max_y: 800 }

  test('a spawn point already clear of every edge is left untouched', () => {
    const p = clamp_stick_origin(100, 600, bounds)
    expect(p).toEqual({ x: 100, y: 600 })
  })

  test('a spawn point past the left/top edge is pulled inward by exactly the radius', () => {
    const p = clamp_stick_origin(-50, 350, bounds)
    expect(p.x).toBe(bounds.min_x + bounds.radius)
    expect(p.y).toBe(bounds.min_y + bounds.radius)
  })

  test('a spawn point past the right/bottom edge is pulled inward by exactly the radius', () => {
    const p = clamp_stick_origin(500, 900, bounds)
    expect(p.x).toBe(bounds.max_x - bounds.radius)
    expect(p.y).toBe(bounds.max_y - bounds.radius)
  })
})

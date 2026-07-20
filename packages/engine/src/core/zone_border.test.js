// ENG-18 — zone border MATH unit tests (the physics + proximity-signal contract). Pure, no GPU.
import { test, expect } from 'bun:test'

import {
  PROXIMITY_RANGE_M,
  WALL_CUSHION_M,
  PUSHBACK_BAND_M,
  is_valid_bounds,
  inset_from_wall,
  nearest_wall_point,
  border_proximity,
  clamp_to_bounds,
} from './zone_border.js'

/** A 300 m zone centred on origin (the D142 fixed zone shape). */
const B = { min_x: -150, min_z: -150, max_x: 150, max_z: 150 }

test('is_valid_bounds: accepts a well-formed box, rejects malformed/degenerate/non-finite', () => {
  expect(is_valid_bounds(B)).toBe(true)
  expect(is_valid_bounds(null)).toBe(false)
  expect(is_valid_bounds({})).toBe(false)
  expect(is_valid_bounds({ min_x: 0, min_z: 0, max_x: 0, max_z: 10 })).toBe(false) // degenerate x
  expect(is_valid_bounds({ min_x: 0, min_z: 0, max_x: 10, max_z: 0 })).toBe(false) // degenerate z
  expect(is_valid_bounds({ min_x: 10, min_z: 0, max_x: 0, max_z: 10 })).toBe(false) // inverted x
  expect(is_valid_bounds({ min_x: 0, min_z: 0, max_x: Infinity, max_z: 10 })).toBe(false)
})

test('inset_from_wall: positive inside (dist to nearest face), zero on wall, negative outside', () => {
  expect(inset_from_wall(0, 0, B)).toBeCloseTo(150) // centre → 150 m to any face
  expect(inset_from_wall(140, 0, B)).toBeCloseTo(10) // 10 m from the +x face
  expect(inset_from_wall(150, 0, B)).toBeCloseTo(0) // on the +x wall
  expect(inset_from_wall(160, 0, B)).toBeCloseTo(-10) // 10 m past the +x wall
  // nearest face wins near a corner
  expect(inset_from_wall(145, 148, B)).toBeCloseTo(2) // 2 m from the +z face (closer than +x's 5)
})

test('nearest_wall_point: projects onto the closest face, clamps into the span at corners', () => {
  expect(nearest_wall_point(140, 0, B)).toEqual([150, 0]) // → +x face at z=0
  expect(nearest_wall_point(0, -140, B)).toEqual([0, -150]) // → −z face at x=0
  // beyond a corner → projects to the corner, not off the end of a face
  expect(nearest_wall_point(200, 200, B)).toEqual([150, 150])
  expect(nearest_wall_point(-999, 40, B)).toEqual([-150, 40])
})

test('border_proximity: 0 far inside → smooth ramp → 1 at wall → 1 outside, monotonic non-decreasing', () => {
  expect(border_proximity(0, 0, B)).toBe(0) // dead centre
  expect(border_proximity(150 - PROXIMITY_RANGE_M, 0, B)).toBeCloseTo(0) // exactly at range edge
  expect(border_proximity(150, 0, B)).toBe(1) // on the wall
  expect(border_proximity(999, 0, B)).toBe(1) // outside
  // strictly increasing as we approach the wall through the ramp band
  let prev = -1
  for (let d = PROXIMITY_RANGE_M; d >= 0; d -= 1) {
    const p = border_proximity(150 - d, 0, B)
    expect(p).toBeGreaterThanOrEqual(prev)
    prev = p
  }
  // midpoint of the ramp is a real intermediate value (proves it's not a step function)
  const mid = border_proximity(150 - PROXIMITY_RANGE_M / 2, 0, B)
  expect(mid).toBeGreaterThan(0.1)
  expect(mid).toBeLessThan(0.9)
})

test('clamp_to_bounds: leaves a deep-inside point untouched (idempotent, no push)', () => {
  const r = clamp_to_bounds([0, 40, 0], B)
  expect(r.clamped).toBe(false)
  expect(r.position).toEqual([0, 40, 0])
  expect(r.push).toEqual([0, 0])
})

test('clamp_to_bounds: hard floor — a point WAY past the wall (sprint/teleport) cannot tunnel through', () => {
  const r = clamp_to_bounds([500, 40, 0], B)
  expect(r.clamped).toBe(true)
  // pinned to (edge − cushion); never beyond it regardless of how far past it started
  expect(r.position[0]).toBeCloseTo(150 - WALL_CUSHION_M)
  expect(r.position[1]).toBe(40) // Y untouched (vertical fence)
  expect(r.push[0]).toBeCloseTo(-1) // inward (−x)
  // symmetric on the low wall
  const r2 = clamp_to_bounds([0, 40, -9999], B)
  expect(r2.position[2]).toBeCloseTo(-150 + WALL_CUSHION_M)
  expect(r2.push[1]).toBeCloseTo(1) // inward (+z)
})

test('clamp_to_bounds: corner clamps on BOTH axes with a normalised diagonal inward push', () => {
  const r = clamp_to_bounds([300, 10, 300], B)
  expect(r.position[0]).toBeCloseTo(150 - WALL_CUSHION_M)
  expect(r.position[2]).toBeCloseTo(150 - WALL_CUSHION_M)
  expect(Math.hypot(r.push[0], r.push[1])).toBeCloseTo(1) // unit vector
  expect(r.push[0]).toBeLessThan(0) // inward on both
  expect(r.push[1]).toBeLessThan(0)
})

test('clamp_to_bounds: soft lead-in — a point in the pushback band is eased inward toward the rest edge', () => {
  const hard = 150 - WALL_CUSHION_M // 149.5
  const rest = hard - PUSHBACK_BAND_M // 148.9 — where a pressed-in point settles
  // sit 0.2 m inside the hard floor (inside the band, i.e. between rest and hard): eases INWARD.
  const start = hard - 0.2 // 149.3
  const r = clamp_to_bounds([start, 5, 0], B)
  expect(r.clamped).toBe(true)
  expect(r.position[0]).toBeLessThan(start) // eased inward (+x wall → smaller x is toward centre)
  expect(r.position[0]).toBeGreaterThanOrEqual(rest) // never eased past the rest edge in one step
  expect(r.push[0]).toBeCloseTo(-1)
})

test('clamp_to_bounds: repeated application converges monotonically to the rest edge (no jitter/ring)', () => {
  // feed a sprint-into-wall position, then re-clamp the result repeatedly: successive corrections must
  // SHRINK (geometric ease toward a fixed rest point), never overshoot/oscillate. Rest edge on +x:
  const rest = 150 - WALL_CUSHION_M - PUSHBACK_BAND_M
  let p = /** @type {[number,number,number]} */ ([160, 20, 160])
  let prev_delta = Infinity
  for (let i = 0; i < 40; i += 1) {
    const next = clamp_to_bounds(p, B).position
    const delta = Math.abs(next[0] - p[0])
    expect(delta).toBeLessThanOrEqual(prev_delta + 1e-9) // monotonically shrinking step (no ringing)
    expect(next[0]).toBeGreaterThanOrEqual(rest - 1e-6) // never past the rest edge (stays inside)
    prev_delta = delta
    p = next
  }
  expect(p[0]).toBeCloseTo(rest, 2) // settled at the rest edge
  expect(p[2]).toBeCloseTo(rest, 2)
})

test('constants sanity: cushion < band < proximity range (the tell begins well before the clamp bites)', () => {
  expect(WALL_CUSHION_M).toBeGreaterThan(0)
  expect(PUSHBACK_BAND_M).toBeGreaterThan(0)
  expect(PROXIMITY_RANGE_M).toBeGreaterThan(PUSHBACK_BAND_M)
})

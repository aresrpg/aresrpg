// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  LENS_WATER,
  build_droplets,
  build_trails,
  burst_shape,
  decay_intensity,
  droplet_state_at,
  rand01,
  region_level,
  sheet_envelope,
  trail_halfwidth,
  trail_state_at,
} from '../src/lens_water_field.ts'

test('the field is deterministic per seed and inactive when never triggered', () => {
  expect(build_droplets(7)).toEqual(build_droplets(7))
  expect(rand01(7, 3)).toBeGreaterThanOrEqual(0)
  expect(rand01(7, 3)).toBeLessThan(1)
  expect(decay_intensity(null)).toBe(0)
  expect(decay_intensity(0)).toBe(1)
  expect(decay_intensity(LENS_WATER.tau)).toBeCloseTo(Math.exp(-1))
})

test('the wet sheet opens fully then recedes; regions dry the whole frame by region_end', () => {
  expect(sheet_envelope(0)).toBe(1)
  expect(sheet_envelope(LENS_WATER.sheet_hold)).toBe(1)
  expect(sheet_envelope(LENS_WATER.sheet_hold + LENS_WATER.sheet_fade)).toBe(0)
  // during the hold everything is wet; past region_end everything is dry
  for (const [x, y] of [
    [0.1, 0.1],
    [0.5, 0.5],
    [0.9, 0.8],
  ] as const) {
    expect(region_level(x, y, 0)).toBe(1)
    expect(region_level(x, y, LENS_WATER.region_end + 0.01)).toBe(0)
  }
})

test('a burst swells then fades to nothing with no single-frame pop', () => {
  const burst_at = 1
  expect(burst_shape(0, burst_at)).toEqual({ radius_mul: 1, alpha_mul: 1 })
  expect(burst_shape(burst_at, burst_at).radius_mul).toBeCloseTo(LENS_WATER.burst_swell_scale)
  expect(burst_shape(burst_at + LENS_WATER.burst_collapse, burst_at)).toEqual({ radius_mul: 0, alpha_mul: 0 })
  expect(burst_shape(5, Infinity)).toEqual({ radius_mul: 1, alpha_mul: 1 })
  // the collapse lands smoothly: the last 60fps frame's alpha step stays small (the no-pop law)
  const step = 1 / 60
  const before_end = burst_shape(burst_at + LENS_WATER.burst_collapse - step, burst_at).alpha_mul
  expect(before_end).toBeLessThan(0.15)
})

test('every bead, splinter, and trail is finished by the park time', () => {
  const drops = build_droplets(42)
  const trails = build_trails(drops, 42)
  expect(drops).toHaveLength(LENS_WATER.count + LENS_WATER.splinter_slots)
  expect(trails).toHaveLength(LENS_WATER.trail_slots)
  for (const drop of drops) expect(droplet_state_at(drop, LENS_WATER.max_active_s).alpha).toBe(0)
  for (const trail of trails) expect(trail_state_at(trail, LENS_WATER.max_active_s).alpha).toBe(0)
})

test('splinters are born at their bursting parent and trails anchor at the burst point', () => {
  const drops = build_droplets(11)
  const primaries = drops.slice(0, LENS_WATER.count)
  const splinters = drops.slice(LENS_WATER.count)
  const bursting = primaries.filter((d) => Number.isFinite(d.burst_at))
  expect(bursting.length).toBeGreaterThan(0)
  for (const splinter of splinters) {
    expect(Number.isFinite(splinter.burst_at)).toBeFalse()
    expect(bursting.some((parent) => parent.burst_at === splinter.birth && parent.x0 === splinter.x0)).toBeTrue()
    expect(droplet_state_at(splinter, splinter.birth - 0.01).alpha).toBe(0) // invisible pre-birth
  }
  const [first_trail] = build_trails(drops, 11)
  expect(Number.isFinite(first_trail!.birth)).toBeTrue()
  expect(trail_state_at(first_trail!, first_trail!.birth + LENS_WATER.trail_grow).length).toBeCloseTo(
    first_trail!.max_len
  )
})

test('the fluid law: descent never reverses and trail width stays positive', () => {
  const [drop] = build_droplets(3)
  const previous = { y: -Infinity }
  for (let t = drop!.birth; t < LENS_WATER.max_active_s; t += 0.02) {
    const { y } = droplet_state_at(drop!, t)
    expect(y).toBeGreaterThanOrEqual(previous.y) // wavy-time fall: slows and rushes, never uphill
    previous.y = y
  }
  for (let y = 0; y <= 1; y += 0.05) expect(trail_halfwidth(0.37, y)).toBeGreaterThan(0)
})

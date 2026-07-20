// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pandora sky-island generator unit tests (gen/sky_islands.js). These pin the DETERMINISM law and the
// grammar/shape guarantees of the module in isolation (its integration into the density field + the
// block palette + the LOD far-shell are covered by density.test.js, column_gen.test.js, and
// sky_island.test.js). The transcendental ban (§3.7) over this file is enforced by column_gen.test.js's
// gen/ grep guard — this file only checks BEHAVIOUR.

import { test, expect, describe } from 'bun:test'

import { derive_world_seeds } from '../config/world_config.js'

import {
  SKY_ISLANDS_CONFIG,
  create_sky_islands_context,
  region_islands,
  sky_islands_density,
  sky_island_at,
  column_has_sky,
} from './sky_islands.js'

const C = SKY_ISLANDS_CONFIG
const carve = derive_world_seeds().carvers >>> 0
const sk = create_sky_islands_context(carve)

/** The nearest sky-island region to origin (deterministic scan) + its biggest island. */
function nearest_region() {
  const found = []
  for (let rz = -8; rz <= 8; rz += 1)
    for (let rx = -8; rx <= 8; rx += 1) {
      const isl = region_islands(sk, rx, rz)
      if (isl.length) found.push({ rx, rz, d2: rx * rx + rz * rz, isl })
    }
  if (!found.length) throw new Error('no sky-island region within reach')
  found.sort((a, b) => a.d2 - b.d2)
  return found[0]
}

describe('sky islands: determinism (world-identity, §3.7)', () => {
  test('two independent contexts yield identical archipelagos for the same region', () => {
    const a = create_sky_islands_context(carve)
    const b = create_sky_islands_context(carve)
    for (let rz = -3; rz <= 3; rz += 1)
      for (let rx = -3; rx <= 3; rx += 1) {
        expect(region_islands(b, rx, rz)).toEqual(region_islands(a, rx, rz))
      }
  })

  test('two independent contexts sample the density field bit-identically', () => {
    const b = create_sky_islands_context(carve)
    const { rx, rz } = nearest_region()
    // Sweep a 3D grid through the archipelago region; every sample must match to the bit.
    let checked = 0
    for (let x = rx * C.region_size; x < (rx + 1) * C.region_size; x += 23) {
      for (let z = rz * C.region_size; z < (rz + 1) * C.region_size; z += 23) {
        for (let y = C.low_y - C.thickness; y <= C.high_y + C.thickness; y += 11) {
          expect(sky_islands_density(b, x, y, z)).toBe(sky_islands_density(sk, x, y, z))
          checked += 1
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
  })

  test('the field is independent of scan order / cache state (region memo is a pure memo)', () => {
    // A fresh context queried in a scattered order must equal one queried in raster order — proves the
    // region_cache is a pure memo (bounded eviction is world-neutral), not hidden state.
    const raster = create_sky_islands_context(carve)
    const scattered = create_sky_islands_context(carve)
    const { rx, rz } = nearest_region()
    const pts = []
    for (let x = rx * C.region_size; x < (rx + 1) * C.region_size; x += 40)
      for (let z = rz * C.region_size; z < (rz + 1) * C.region_size; z += 40) pts.push([x, z])
    const y = Math.floor((C.low_y + C.high_y) / 2)
    // raster order
    const raster_vals = pts.map(([x, z]) => sky_islands_density(raster, x, y, z))
    // scattered order (reverse + interleave)
    const order = pts.map((_, i) => i).sort((a, b) => ((a * 7) % pts.length) - ((b * 7) % pts.length))
    const scattered_vals = new Array(pts.length)
    for (const i of order) scattered_vals[i] = sky_islands_density(scattered, pts[i][0], y, pts[i][1])
    expect(scattered_vals).toEqual(raster_vals)
  })
})

describe('sky islands: region gating (dedicated sky regions, not everywhere)', () => {
  test('only a MINORITY of regions are sky-island regions (near the configured rate)', () => {
    let sky = 0
    let total = 0
    for (let rz = -10; rz <= 10; rz += 1)
      for (let rx = -10; rx <= 10; rx += 1) {
        total += 1
        if (region_islands(sk, rx, rz).length > 0) sky += 1
      }
    const rate = sky / total
    // Rare + special: within a factor of the configured region_rate (0.13), and never "everywhere".
    expect(rate).toBeGreaterThan(0) // some regions DO have islands
    expect(rate).toBeLessThan(0.35) // but the sky is mostly empty (not a slab)
    expect(rate).toBeLessThan(C.region_rate * 2.5) // in the ballpark of the intended rate
  })

  test('a non-sky region has an EMPTY archipelago and column_has_sky agrees', () => {
    // Find a non-sky region and assert: zero islands AND every interior column reports has_sky=false.
    let empty = null
    for (let rz = 0; rz <= 10 && !empty; rz += 1)
      for (let rx = 0; rx <= 10 && !empty; rx += 1) if (region_islands(sk, rx, rz).length === 0) empty = { rx, rz }
    if (!empty) throw new Error('no empty region found')
    expect(region_islands(sk, empty.rx, empty.rz).length).toBe(0)
    // Interior columns (away from edges, where a neighbor archipelago could reach) must be has_sky=false.
    const inset = C.cap_radius_max * 4 // well beyond ISLAND_REACH
    let checked = 0
    for (let x = empty.rx * C.region_size + inset; x < (empty.rx + 1) * C.region_size - inset; x += 37) {
      for (let z = empty.rz * C.region_size + inset; z < (empty.rz + 1) * C.region_size - inset; z += 37) {
        expect(column_has_sky(sk, x, z)).toBe(false)
        // And nowhere in the band is solid over this column.
        for (let y = C.low_y - C.thickness; y <= C.high_y + C.thickness; y += 9) {
          expect(sky_island_at(sk, x, y, z)).toBe(false)
        }
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  test('column_has_sky is true over a real archipelago', () => {
    const { isl } = nearest_region()
    const big = isl.reduce((a, b) => (b.cap_r > a.cap_r ? b : a))
    expect(column_has_sky(sk, big.cx, big.cz)).toBe(true)
  })
})

describe('sky islands: Hallelujah-mountain shape (broad cap, tapering root)', () => {
  test('an archipelago has ≥ islands_min islands with in-bounds caps + roots', () => {
    const { isl } = nearest_region()
    expect(isl.length).toBeGreaterThanOrEqual(C.islands_min)
    for (const i of isl) {
      expect(i.cap_r).toBeGreaterThan(0)
      expect(i.cap_r).toBeLessThanOrEqual(C.cap_radius_max + 1e-6)
      // root_depth = cap_r × ratio ∈ [root_ratio_min, root_ratio_max].
      expect(i.root_depth).toBeGreaterThanOrEqual(i.cap_r * C.root_ratio_min - 1e-6)
      expect(i.root_depth).toBeLessThanOrEqual(i.cap_r * C.root_ratio_max + 1e-6)
      // The lowest root tip never dips below the scanned band (no clipping).
      expect(i.cy - i.root_depth).toBeGreaterThanOrEqual(C.low_y - C.thickness - 1e-6)
      // Cap top sits inside the cap band.
      expect(i.cy).toBeGreaterThanOrEqual(C.low_y - C.cap_radius_max) // satellites can be a touch lower
      expect(i.cy).toBeLessThanOrEqual(C.high_y + C.cap_radius_max)
    }
    // At least one PRIMARY island is a ground-readable landmass (cap ≥ the min).
    expect(isl.some((i) => i.cap_r >= C.cap_radius_min)).toBe(true)
  })

  test('the body TAPERS: solid width shrinks monotonically-ish from cap toward the root tip', () => {
    // Measure the solid half-width along the island axis at several depths; the cap is the widest and
    // the tip is the narrowest — the hanging-mountain silhouette (never a straight cylinder).
    const { isl } = nearest_region()
    const big = isl.reduce((a, b) => (b.cap_r > a.cap_r ? b : a))
    const width_at = (/** @type {number} */ y) => {
      let w = 0
      for (let dx = -Math.ceil(big.cap_r * 1.4); dx <= Math.ceil(big.cap_r * 1.4); dx += 1)
        if (sky_island_at(sk, big.cx + dx, y, big.cz)) w += 1
      return w
    }
    const near_cap = width_at(Math.round(big.cy) - 2) // just under the cap top
    const mid = width_at(Math.round(big.cy - big.root_depth * 0.5))
    const near_tip = width_at(Math.round(big.cy - big.root_depth * 0.9))
    expect(near_cap).toBeGreaterThan(mid) // cap is broader than the mid-body
    expect(mid).toBeGreaterThan(near_tip) // mid is broader than the root tip
    expect(near_cap).toBeGreaterThanOrEqual(2 * C.cap_radius_min) // caps read as landmasses (≥ ~2·min wide)
  })

  test('the cap has a CROWN: solid rises a little ABOVE the cap-top altitude near the axis', () => {
    const { isl } = nearest_region()
    const big = isl.reduce((a, b) => (b.cap_r > a.cap_r ? b : a))
    // Somewhere at/above the cap top on the axis is solid (the crown dome), and it's bounded.
    let crown_top = 0
    for (let y = Math.round(big.cy) + Math.ceil(big.cap_r * C.crown_ratio) + 3; y >= Math.round(big.cy); y -= 1) {
      if (sky_island_at(sk, big.cx, y, big.cz)) {
        crown_top = y
        break
      }
    }
    expect(crown_top).toBeGreaterThanOrEqual(Math.round(big.cy)) // crown reaches the cap top
    expect(crown_top - big.cy).toBeLessThanOrEqual(big.cap_r * C.crown_ratio + 2) // but stays a shallow dome
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD ↔ CHAIN coordinate codec (2026-07-10 signed-world ruling). The chain keeps UNSIGNED u32 block
// coords in [0, bounds); the client works in SIGNED world space centred on bounds/2. These tests pin the
// round-trip, the boundary vectors, the offset derivation, and — the load-bearing one — that zone keys
// floor the CHAIN value (never the signed world value), so a negative world coord still lands in the right
// u32 zone west of the origin.

import { describe, it, expect } from 'bun:test'

import {
  world_to_chain,
  chain_to_world,
  world_offsets,
  zone_of,
  zone_of_world,
  DEFAULT_ZONE_SIZE,
  DEFAULT_WORLD_OFFSET,
} from '../src/coords.js'

const OFF = 250_000 // Testlands bounds/2

describe('constants', () => {
  it('SPEC defaults', () => {
    expect(DEFAULT_ZONE_SIZE).toBe(512)
    expect(DEFAULT_WORLD_OFFSET).toBe(250_000) // DEFAULT_BOUND (500k) / 2
  })
})

describe('world_to_chain / chain_to_world', () => {
  it('the origin sits at the chain centre', () => {
    expect(world_to_chain(0, OFF)).toBe(250_000)
    expect(chain_to_world(250_000, OFF)).toBe(0)
  })

  it('the low edge maps to chain 0, the high edge to just under bounds', () => {
    expect(world_to_chain(-250_000, OFF)).toBe(0) // west/north fence → chain 0
    expect(world_to_chain(249_999, OFF)).toBe(499_999) // last in-bounds block → chain < 500k
  })

  it('round-trips exactly across the whole signed span incl. the −33k..+33k band and the boundaries', () => {
    for (const w of [-250_000, -249_999, -33_000, -512, -145, -1, 0, 1, 145, 512, 33_000, 249_999]) {
      expect(chain_to_world(world_to_chain(w, OFF), OFF)).toBe(w)
    }
  })

  it('every in-span world coord translates to a valid unsigned u32 chain coord in [0, bounds)', () => {
    for (const w of [-250_000, -100_000, -1, 0, 1, 100_000, 249_999]) {
      const c = world_to_chain(w, OFF)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThan(500_000)
      expect(Number.isInteger(c)).toBe(true)
    }
  })
})

describe('world_offsets — per-world bounds/2, off the World doc', () => {
  it('derives bounds/2 per axis', () => {
    expect(world_offsets({ bounds_x: 500_000, bounds_z: 500_000 })).toEqual({ x: 250_000, z: 250_000 })
    expect(world_offsets({ bounds_x: 20_000, bounds_z: 40_000 })).toEqual({ x: 10_000, z: 20_000 })
  })

  it('floors an odd bound (chain coords are integers)', () => {
    expect(world_offsets({ bounds_x: 1001, bounds_z: 1001 })).toEqual({ x: 500, z: 500 })
  })

  it('falls back to the default half-extent when the doc or its bounds are absent/invalid', () => {
    expect(world_offsets(null)).toEqual({ x: 250_000, z: 250_000 })
    expect(world_offsets({})).toEqual({ x: 250_000, z: 250_000 })
    expect(world_offsets({ bounds_x: 0, bounds_z: -5 })).toEqual({ x: 250_000, z: 250_000 })
  })
})

describe('zone_of — the CHAIN-space primitive (floor(chain / zone_size), u32 non-negative)', () => {
  it('floors chain coords to the zone grid', () => {
    expect(zone_of(0, 0, 512)).toEqual({ zx: 0, zy: 0 })
    expect(zone_of(250_000, 250_000, 512)).toEqual({ zx: 488, zy: 488 }) // origin's chain zone
    expect(zone_of(511, 512, 512)).toEqual({ zx: 0, zy: 1 })
  })

  it('defaults zone_size to 512', () => {
    expect(zone_of(1024, 2048)).toEqual({ zx: 2, zy: 4 })
  })

  it('a coord below the world low edge (chain < 0) or non-finite has no zone → null', () => {
    expect(zone_of(-1, 0, 512)).toBeNull()
    expect(zone_of(0, -1, 512)).toBeNull()
    expect(zone_of(NaN, 0, 512)).toBeNull()
  })
})

describe('zone_of_world — CHAIN zone key from a SIGNED world position', () => {
  it('the origin maps to the origin chain zone', () => {
    expect(zone_of_world(0, 0, 512, OFF, OFF)).toEqual({ zx: 488, zy: 488 })
  })

  // The load-bearing case: a world coord just past a CHAIN zone boundary must floor to the LOWER chain
  // zone (west of origin). The origin's chain zone (488) starts at chain 488*512 = 249856 = world −144.
  it('floors on the CHAIN value — a negative world coord west of a boundary lands in the lower zone, NOT a bogus negative', () => {
    // world −144 → chain 249856 → still zone 488 (the boundary block)
    expect(zone_of_world(-144, 0, 512, OFF, OFF).zx).toBe(488)
    // world −145 → chain 249855 → zone 487 (one zone WEST) — the "all directions" symmetry
    expect(zone_of_world(-145, 0, 512, OFF, OFF).zx).toBe(487)
    // proves it did NOT floor the signed world value: Math.floor(-145/512) would be −1 (a bogus u32 zone)
    expect(zone_of_world(-145, 0, 512, OFF, OFF).zx).not.toBe(-1)
  })

  it('the west/north span stays valid down to the low edge, then falls off the grid', () => {
    expect(zone_of_world(-250_000, -250_000, 512, OFF, OFF)).toEqual({ zx: 0, zy: 0 }) // chain (0,0)
    expect(zone_of_world(-250_001, 0, 512, OFF, OFF)).toBeNull() // past the west fence → chain < 0
  })

  it('matches zone_of applied to the manually-translated chain coord (composition law)', () => {
    for (const [wx, wz] of [
      [0, 0],
      [-33_000, 12_345],
      [50_000, -50_000],
      [-1, -1],
    ]) {
      expect(zone_of_world(wx, wz, 512, OFF, OFF)).toEqual(
        zone_of(world_to_chain(wx, OFF), world_to_chain(wz, OFF), 512)
      )
    }
  })
})

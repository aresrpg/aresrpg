// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seam 7 gate — deterministic roam-near-anchor placement, bounded roam, and the nametag aging math.

import { test, expect, describe } from 'bun:test'

import { DEFAULT_WORLD_GEN_CONFIG } from '../../src/config/world_gen_config.js'
import { ground_height } from '../../src/binding/ground_height.js'
import {
  mob_group_placement,
  mob_roam_offset,
  mob_aging_fraction,
  MAX_GROUP_SIZE,
  MOB_SCATTER_RADIUS_BLOCKS,
  MOB_ROAM_RADIUS_BLOCKS,
  AGING_CAP_HOURS,
} from '../../src/binding/world_mobs.js'

const cfg = DEFAULT_WORLD_GEN_CONFIG
const HOUR_MS = 3_600_000

describe('binding/mob_group_placement', () => {
  test('member count clamps to 1..6', () => {
    expect(mob_group_placement(cfg, 0, 0, 0).length).toBe(1)
    expect(mob_group_placement(cfg, 0, 0, 1).length).toBe(1)
    expect(mob_group_placement(cfg, 0, 0, 6).length).toBe(6)
    expect(mob_group_placement(cfg, 0, 0, 99).length).toBe(MAX_GROUP_SIZE)
  })

  test('member 0 sits ON the anchor; anchor floors to the voxel column', () => {
    const p = mob_group_placement(cfg, 100.9, -50.2, 3)
    expect(p[0].x).toBe(100)
    expect(p[0].z).toBe(-51)
  })

  test('every member is grounded by the canonical Y-oracle', () => {
    for (const m of mob_group_placement(cfg, 640, 640, 6, { group_seed: 42 })) {
      expect(m.y).toBe(ground_height(cfg, m.x, m.z))
    }
  })

  test('members scatter WITHIN the cluster radius of the anchor ("never far")', () => {
    const p = mob_group_placement(cfg, 300, 300, 6, { group_seed: 7 })
    for (const m of p) {
      const d = Math.hypot(m.x - 300, m.z - 300)
      expect(d).toBeLessThanOrEqual(MOB_SCATTER_RADIUS_BLOCKS + 1) // +1 = integer-round slack
    }
  })

  test('deterministic: same (config, anchor, size, group_seed) → identical layout', () => {
    const a = mob_group_placement(cfg, 12, 34, 5, { group_seed: 0xdeadbeef })
    const b = mob_group_placement(cfg, 12, 34, 5, { group_seed: 0xdeadbeef })
    expect(a).toEqual(b)
  })

  test('a different group_seed → a different layout (member 0 aside, which is always the anchor)', () => {
    const a = mob_group_placement(cfg, 12, 34, 6, { group_seed: 1 })
    const b = mob_group_placement(cfg, 12, 34, 6, { group_seed: 2 })
    expect(a.slice(1)).not.toEqual(b.slice(1))
  })

  test('group_seed accepts a bigint (u64) and reduces to the same layout as its low-32 bits', () => {
    const big = 0x1_0000_002an // low-32 = 0x2a = 42
    expect(mob_group_placement(cfg, 5, 5, 6, { group_seed: big })).toEqual(
      mob_group_placement(cfg, 5, 5, 6, { group_seed: 42 })
    )
  })

  test('no group_seed → falls back to the world-seed+anchor hash (still deterministic)', () => {
    expect(mob_group_placement(cfg, 9, 9, 4)).toEqual(mob_group_placement(cfg, 9, 9, 4))
  })
})

describe('binding/mob_roam_offset', () => {
  test('bounded within [-R, R] on each axis across a time sweep', () => {
    for (let t = 0; t < 120; t += 0.5) {
      const [dx, dz] = mob_roam_offset(123, t)
      expect(Math.abs(dx)).toBeLessThanOrEqual(MOB_ROAM_RADIUS_BLOCKS + 1e-9)
      expect(Math.abs(dz)).toBeLessThanOrEqual(MOB_ROAM_RADIUS_BLOCKS + 1e-9)
    }
  })

  test('deterministic in (member_seed, t) — a shared clock keeps clients in sync', () => {
    expect(mob_roam_offset(77, 12.5)).toEqual(mob_roam_offset(77, 12.5))
  })

  test('different members wander out of phase', () => {
    expect(mob_roam_offset(1, 3)).not.toEqual(mob_roam_offset(2, 3))
  })

  test('a custom roam radius scales the bound', () => {
    const [dx, dz] = mob_roam_offset(5, 4.2, 10)
    expect(Math.abs(dx)).toBeLessThanOrEqual(10 + 1e-9)
    expect(Math.abs(dz)).toBeLessThanOrEqual(10 + 1e-9)
  })
})

describe('binding/mob_aging_fraction (SPEC §8: +1%/h, cap +100% @ 100h)', () => {
  test('0 at spawn', () => {
    expect(mob_aging_fraction(0, 0)).toBe(0)
  })
  test('0.5 at 50 hours', () => {
    expect(mob_aging_fraction(0, 50 * HOUR_MS)).toBeCloseTo(0.5, 10)
  })
  test('caps at 1.0 at 100h and never exceeds it', () => {
    expect(mob_aging_fraction(0, AGING_CAP_HOURS * HOUR_MS)).toBe(1)
    expect(mob_aging_fraction(0, 500 * HOUR_MS)).toBe(1)
  })
  test('a negative interval (clock skew) clamps to 0, never negative', () => {
    expect(mob_aging_fraction(10 * HOUR_MS, 0)).toBe(0)
  })
  test('accepts bigint (u64) timestamps', () => {
    expect(mob_aging_fraction(0n, BigInt(25 * HOUR_MS))).toBeCloseTo(0.25, 10)
  })
  test('rate/cap overrides win', () => {
    expect(mob_aging_fraction(0, 10 * HOUR_MS, { rate_per_hour: 0.05 })).toBeCloseTo(0.5, 10)
    expect(mob_aging_fraction(0, 100 * HOUR_MS, { cap_hours: 10, rate_per_hour: 0.01 })).toBeCloseTo(0.1, 10)
  })
})

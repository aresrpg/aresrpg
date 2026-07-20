// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure headless tests for the resurrected per-member WANDER core: the on-chain mob-group
// members amble a few blocks around their spawn anchor. The invariants that matter are the LEASH (a member
// never strays past its anchor radius), DETERMINISM (a seed replays the same amble → refreshes don't teleport),
// and the CONSTANT-SPEED glide (no distance-proportional slide). feet_of is covered by ambient_grounding.test.

import { describe, expect, it } from 'bun:test'

import { WANDER, advance_member_wander, feet_of, make_rng } from './ambient_placement.js'

/** A fresh member wander state anchored at (ax, az), seeded off `seed`. */
const member = (ax, az, seed) => ({
  ax,
  az,
  mx: ax,
  mz: az,
  tx: ax,
  tz: az,
  mrng: make_rng(seed),
  walking: false,
  moving: false,
  decide_t: 0,
})

/** A member whose rng is a SCRIPTED sequence (drains, then repeats the last) — to force idle vs walk branches. */
const scripted_member = (ax, az, seq) => {
  let i = 0
  return {
    ax,
    az,
    mx: ax,
    mz: az,
    tx: ax,
    tz: az,
    mrng: () => seq[Math.min(i++, seq.length - 1)],
    walking: false,
    moving: false,
    decide_t: 0,
  }
}

describe('make_rng', () => {
  it('is deterministic — the same seed replays the same stream', () => {
    const a = make_rng(12345)
    const b = make_rng(12345)
    for (let i = 0; i < 50; i += 1) expect(a()).toBe(b())
  })

  it('decorrelates adjacent seeds (refreshing gives each member its own amble)', () => {
    expect(make_rng(1)()).not.toBe(make_rng(2)())
  })

  it('stays in [0, 1)', () => {
    const r = make_rng(999)
    for (let i = 0; i < 200; i += 1) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('advance_member_wander', () => {
  it('LEASH: never strays past WAYPOINT_R from its spawn anchor, over thousands of steps', () => {
    const m = member(100, -50, 7)
    let max_d = 0
    for (let f = 0; f < 5000; f += 1) {
      advance_member_wander(m, 1 / 60, 0.9, 0.03)
      max_d = Math.max(max_d, Math.hypot(m.mx - m.ax, m.mz - m.az))
    }
    expect(max_d).toBeLessThanOrEqual(WANDER.WAYPOINT_R + 1e-9) // both step endpoints lie in the anchor disk
    expect(WANDER.WAYPOINT_R).toBeLessThanOrEqual(WANDER.LEASH_R) // …and the disk is within the hard leash
  })

  it('DETERMINISM: two members with the same seed trace identical paths (refresh = no teleport)', () => {
    const a = member(0, 0, 424242)
    const b = member(0, 0, 424242)
    for (let f = 0; f < 600; f += 1) {
      advance_member_wander(a, 1 / 60, 0.9, 0.03)
      advance_member_wander(b, 1 / 60, 0.9, 0.03)
      expect(a.mx).toBe(b.mx)
      expect(a.mz).toBe(b.mz)
    }
  })

  it('CONSTANT SPEED: no single step ever exceeds speed·dt (a glide, never a distance-proportional slide)', () => {
    const m = member(0, 0, 31)
    const speed = 0.9
    const dt = 1 / 60
    for (let f = 0; f < 3000; f += 1) {
      const px = m.mx
      const pz = m.mz
      advance_member_wander(m, dt, speed, 0.03)
      expect(Math.hypot(m.mx - px, m.mz - pz)).toBeLessThanOrEqual(speed * dt + 1e-9)
    }
  })

  it('a WALK decision heads toward a waypoint on the anchor ring and sets moving', () => {
    // scripted: [0.1 → walk (<WALK_CHANCE)], [0.0 → angle 0], [1.0 → rr = WAYPOINT_R], [0.5 → walk duration]
    const m = scripted_member(10, 0, [0.1, 0.0, 1.0, 0.5])
    advance_member_wander(m, 1 / 60, 0.9, 0.03) // first tick decides + steps
    expect(m.walking).toBe(true)
    expect(m.moving).toBe(true)
    expect(m.tx).toBeCloseTo(10 + WANDER.WAYPOINT_R, 6) // waypoint = anchor + rr·(cos0, sin0)
    expect(m.tz).toBeCloseTo(0, 6)
    expect(m.mx).toBeGreaterThan(10) // stepped toward it
  })

  it('an IDLE decision holds position and clears moving', () => {
    const m = scripted_member(5, 5, [0.9, 0.9]) // ≥ WALK_CHANCE → idle
    advance_member_wander(m, 1 / 60, 0.9, 0.03)
    expect(m.walking).toBe(false)
    expect(m.moving).toBe(false)
    expect(m.mx).toBe(5)
    expect(m.mz).toBe(5)
  })
})

describe('feet_of (grounding helper still lives here)', () => {
  it('lifts a ground-block y to the feet y above it', () => {
    expect(feet_of(63)).toBe(64)
  })
  it('propagates null/undefined (unstreamed / fluid columns place nothing)', () => {
    expect(feet_of(null)).toBeNull()
    expect(feet_of(undefined)).toBeNull()
  })
})

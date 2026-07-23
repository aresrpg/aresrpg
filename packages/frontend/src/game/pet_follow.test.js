// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #593 — the pet is a NORMAL independent world entity, not a welded attachment. These tests pin the pure
// steering core (pet_follow.js) with no @aresrpg/engine3 / GLB import (issue #117) so the whole contract runs
// in this public checkout: the DETACH (a pet inside the dead zone does NOT track its owner in lockstep — the
// red-first assertion against the old weld), the 5-block dead-zone gate, chase activation beyond it at the
// pet's own speed, the seedable roam bounded to the zone, and the hopelessly-far snap-catch-up.

import { describe, expect, test } from 'bun:test'

import { step_pet_follow, empty_pet_motion, DEAD_ZONE_M, ROAM_RADIUS_M, CHASE_SPEED, SNAP_FAR_M } from './pet_follow.js'

const DT = 1 / 60

/** Deterministic, seedable [0,1) source (mulberry32) — the roam wander must be reproducible for tests. */
const rng_from = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

describe('#593 pet_follow — the pet steers as its own world entity', () => {
  test('DETACH (red-first) — a pet inside the dead zone does NOT track the owner in lockstep', () => {
    // rng()=0 → the roam target lands exactly on the spawn spot (radius 0), isolating the dead-zone gate from
    // any wander so this measures ONLY whether the pet chases the owner. A welded/parent-transform pet eases
    // onto the owner (pet.x → 4); a detached pet stays put.
    const rng = () => 0
    let m = step_pet_follow(empty_pet_motion(), { x: 0, z: 0 }, DT, rng)
    expect(m.x).toBeCloseTo(0, 6)
    expect(m.z).toBeCloseTo(0, 6)
    const start = { x: m.x, z: m.z }
    // walk the owner 4 blocks along +x over one second — every frame still inside the 5-block dead zone
    for (let i = 1; i <= 60; i++) m = step_pet_follow(m, { x: (4 * i) / 60, z: 0 }, DT, rng)
    const owner = { x: 4, z: 0 }
    expect(dist(m, start)).toBeLessThan(0.5) // the pet barely moved…
    expect(dist(m, owner)).toBeGreaterThan(3) // …and is ~4 blocks from the owner now, NOT glued to it
  })

  test('② dead zone — a stationary owner is never chased down; the pet stays bounded to the wander disc', () => {
    const rng = rng_from(7)
    let m = step_pet_follow(empty_pet_motion(), { x: 0, z: 0 }, DT, rng)
    let max_d = 0
    for (let i = 0; i < 2000; i++) {
      m = step_pet_follow(m, { x: 0, z: 0 }, DT, rng)
      max_d = Math.max(max_d, dist(m, { x: 0, z: 0 }))
    }
    expect(max_d).toBeGreaterThan(0.3) // it actually wanders (reads alive, not frozen on the owner)…
    expect(max_d).toBeLessThanOrEqual(ROAM_RADIUS_M + 1e-6) // …but never past the wander disc — bounded to the zone
  })

  test('③ chase — beyond the dead zone the pet closes the gap at its own CHASE_SPEED', () => {
    const rng = rng_from(1)
    let m = { ...empty_pet_motion(), x: 0, z: 0, roam_cd: 999 } // pet at origin, owner far off
    const owner = { x: 20, z: 0 }
    const before = { x: m.x, z: m.z }
    m = step_pet_follow(m, owner, DT, rng)
    expect(dist(m, before)).toBeCloseTo(CHASE_SPEED * DT, 5) // moved exactly one step at its own speed…
    expect(m.x).toBeGreaterThan(before.x) // …toward the owner
    for (let i = 0; i < 600 && dist(m, owner) > DEAD_ZONE_M; i++) m = step_pet_follow(m, owner, DT, rng)
    expect(dist(m, owner)).toBeLessThanOrEqual(DEAD_ZONE_M + 1e-6) // and it catches up into the dead zone
  })

  test('④ roam — same seed → identical wander (deterministic + seedable)', () => {
    const trajectory = (seed) => {
      const rng = rng_from(seed)
      let m = step_pet_follow(empty_pet_motion(), { x: 0, z: 0 }, DT, rng)
      const pts = []
      for (let i = 0; i < 300; i++) {
        m = step_pet_follow(m, { x: 0, z: 0 }, DT, rng)
        pts.push([m.x, m.z])
      }
      return pts
    }
    expect(trajectory(42)).toEqual(trajectory(42)) // reproducible
    expect(trajectory(42)).not.toEqual(trajectory(43)) // the seed genuinely drives the wander
  })

  test('⑤ snap — a hopelessly-far owner is caught up in one step, landing inside the dead zone', () => {
    const rng = rng_from(3)
    let m = { ...empty_pet_motion(), x: 0, z: 0, roam_cd: 999 }
    const owner = { x: SNAP_FAR_M + 50, z: 0 } // way past the snap threshold
    m = step_pet_follow(m, owner, DT, rng)
    expect(dist(m, owner)).toBeLessThanOrEqual(DEAD_ZONE_M) // one step → inside the dead zone (snap-catch-up)
  })
})

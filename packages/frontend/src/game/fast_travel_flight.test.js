// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST-TRAVEL FLIGHT math — proves the pure autopilot step: RUN-speed cap (never ×1.5), no overshoot, heading
// straight at the target, altitude shaping (climb → FLAT cruise @ CRUISE_ALTITUDE, v2 #370 — no heightmap
// following mid-cruise → glide-slope descend → ground+3), hold-last-y on a null ground sample, and the arrival
// test. No engine, no effects — the same headless discipline as auto_run.test.js.
import { describe, expect, test } from 'bun:test'

import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): fast_travel_flight.js itself imports CONTROLLER_CONSTANTS from
// @aresrpg/engine3/player (character_controller.js), which unconditionally re-exports create_character_avatar
// — a static import of the absent-by-design senshi_male.glb — see test_helpers/glb_fixture.js. The whole
// module (every export below) is unreachable without the asset, so the whole file guards together.
const {
  ARRIVAL_RADIUS,
  CRUISE_ALTITUDE,
  FT_SPEED,
  LAND_CLEARANCE,
  MOUNT_MOVE_THRESHOLD,
  flight_step,
  is_arrived,
  mount_is_moving,
  target_altitude,
} = SENSHI_MALE_GLB_AVAILABLE ? await import('./fast_travel_flight.js') : {}
const { CONTROLLER_CONSTANTS } = SENSHI_MALE_GLB_AVAILABLE ? await import('@aresrpg/engine3/player') : {}

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('FT_SPEED — run speed, never pet speed', () => {
  test('is exactly the controller RUN_SPEED (single home, no ×1.5)', () => {
    expect(FT_SPEED).toBe(CONTROLLER_CONSTANTS.RUN_SPEED)
    expect(FT_SPEED).not.toBe(CONTROLLER_CONSTANTS.RUN_SPEED * 1.5) // the mount-roam multiplier is forbidden here
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('flight_step — horizontal beeline at ≤ RUN speed', () => {
  const dt = 1 / 60
  test('a far target moves exactly FT_SPEED·dt and never faster', () => {
    const pos = [0, 20, 0]
    const target = { x: 1000, z: 0 }
    const out = flight_step({ pos, target, ground_y: 8, dt })
    const moved = Math.hypot(out.pos[0] - pos[0], out.pos[2] - pos[2])
    expect(moved).toBeCloseTo(FT_SPEED * dt, 6)
    expect(moved).toBeLessThanOrEqual(FT_SPEED * dt + 1e-9)
  })
  test('heading points straight at the target (moves toward it on both axes)', () => {
    const pos = [10, 20, -10]
    const target = { x: 40, z: 50 }
    const out = flight_step({ pos, target, ground_y: 8, dt })
    // the XZ delta is colinear with (target - pos): cross product ≈ 0 and it advances (not retreats)
    const dx = target.x - pos[0]
    const dz = target.z - pos[2]
    const mx = out.pos[0] - pos[0]
    const mz = out.pos[2] - pos[2]
    expect(dx * mz - dz * mx).toBeCloseTo(0, 6)
    expect(mx).toBeGreaterThan(0)
    expect(mz).toBeGreaterThan(0)
  })
  test('never overshoots — a target inside one step plants exactly on it', () => {
    const pos = [0, 20, 0]
    const target = { x: 0.05, z: 0 } // far inside FT_SPEED·dt
    const out = flight_step({ pos, target, ground_y: 8, dt })
    expect(out.pos[0]).toBeCloseTo(target.x, 6)
    expect(out.pos[2]).toBeCloseTo(target.z, 6)
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('flight_step — altitude shaping', () => {
  const dt = 1 / 60
  test('climbs toward the flat 300 ceiling far out, bounded (never a teleport in Y)', () => {
    const pos = [0, 8, 0] // on the ground
    const out = flight_step({ pos, target: { x: 1000, z: 0 }, ground_y: 8, dt })
    expect(out.pos[1]).toBeGreaterThan(8) // rising toward CRUISE_ALTITUDE
    expect(out.pos[1]).toBeLessThan(CRUISE_ALTITUDE) // but not instantly — bounded ascent
  })
  test('a null ground sample HOLDS altitude (never descend blind)', () => {
    const pos = [0, 55, 0]
    const out = flight_step({ pos, target: { x: 1000, z: 0 }, ground_y: null, dt })
    expect(out.pos[1]).toBe(55)
  })
  test('inside the glide-slope the dragon sinks toward ground+LAND', () => {
    const pos = [0, 20, 0] // cruising high, but close to the target
    const out = flight_step({ pos, target: { x: 2, z: 0 }, ground_y: 8, dt })
    expect(out.pos[1]).toBeLessThan(20) // sinking toward ground+3
  })
})

// v2 (#370, owner spec verbatim): "the flight path takes off, ramps to ALTITUDE 300, cruises FLAT (zero
// heightmap following mid-cruise), ramps down at the destination" — the .46 live report showed the OLD
// ground+30 cruise contouring the terrain (reading as ground-walking near trees/hills). This is the RED-FIRST
// repro: today (pre-fix) the SAME cruise step gives a DIFFERENT altitude depending on what's sampled
// underneath; post-fix it must be IDENTICAL — the ground sample must not move the cruise line at all.
describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('CRUISE_ALTITUDE — v2 flat sky cruise, no heightmap (#370)', () => {
  test('is exactly 300, absolute — not a ground-relative clearance', () => {
    expect(CRUISE_ALTITUDE).toBe(300)
  })
  test('holding cruise: the SAME step from y=300 is identical regardless of the ground sample underneath (flat, not terrain-following)', () => {
    const target = { x: 1000, z: 0 } // far outside any descent window — pure cruise
    const low = flight_step({ pos: [0, CRUISE_ALTITUDE, 0], target, ground_y: 8, dt: 1 / 60 }) // flat ground below
    const high = flight_step({ pos: [0, CRUISE_ALTITUDE, 0], target, ground_y: 280, dt: 1 / 60 }) // a hill/mountain below
    expect(low.pos[1]).toBe(CRUISE_ALTITUDE) // no terrain-driven nudge at all
    expect(high.pos[1]).toBe(CRUISE_ALTITUDE) // identical — a mountain underneath changes NOTHING mid-cruise
  })
  test('a long cruise never exceeds 300 regardless of ground height (climb ceiling, not a ground-relative target)', () => {
    const dt = 1 / 30
    // 2500 frames = ~83s: comfortably past the worst-case climb-to-300 convergence (300/VERT_RATE = 50s from
    // ground_y=0) but well short of covering the 5000m trip (~14300 frames) — asserts mid-cruise, pre-descent.
    for (const ground_y of [0, 8, 150, 280]) {
      let out = { pos: [0, ground_y, 0], arrived: false }
      for (let i = 0; i < 2500; i++) out = flight_step({ pos: out.pos, target: { x: 5000, z: 0 }, ground_y, dt })
      expect(out.pos[1]).toBeCloseTo(CRUISE_ALTITUDE, 0)
    }
  })
})

// v2 (#370): CRUISE_ALTITUDE is now ABSOLUTE, so the altitude that must shed before arrival is NOT a constant
// (it was 27m — CRUISE_CLEARANCE−LAND_CLEARANCE — under the old ground-relative design). target_altitude is a
// glide slope whose crossover point auto-scales to however much altitude actually needs to shed, so this must
// hold for a sea-level AND a mountain-top destination alike, at the SAME VERT_RATE, with zero fixed-radius
// tuning. This is what "ramps down at the destination" (owner spec item 1) actually requires once the cruise
// is a fixed 300 rather than ground+30 — a fixed-radius trigger sized for the old 27m shed cannot possibly
// cover a shed of up to ~300m without either an absurd dive rate or stalling hundreds of metres up at arrival.
describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('target_altitude — glide-slope descent reaches the destination regardless of terrain height', () => {
  test('at the destination (dist=0) the target is exactly ground+LAND_CLEARANCE, for any ground height', () => {
    expect(target_altitude(0, 8)).toBeCloseTo(8 + LAND_CLEARANCE, 6)
    expect(target_altitude(0, 250)).toBeCloseTo(250 + LAND_CLEARANCE, 6)
  })
  test('far from the destination the target is flat CRUISE_ALTITUDE regardless of ground height', () => {
    expect(target_altitude(5000, 8)).toBe(CRUISE_ALTITUDE)
    expect(target_altitude(5000, 250)).toBe(CRUISE_ALTITUDE)
  })
  test('end-to-end: a sea-level arrival reaches LAND_CLEARANCE by ARRIVAL_RADIUS, starting from full cruise far out', () => {
    const dt = 1 / 30
    const ground_y = 8
    let out = { pos: [600, CRUISE_ALTITUDE, 0], arrived: false } // 600 > the ground_y=8 glide crossover (~506m)
    for (let i = 0; i < 200000 && !out.arrived; i++) out = flight_step({ pos: out.pos, target: { x: 0, z: 0 }, ground_y, dt })
    expect(out.arrived).toBe(true)
    expect(out.pos[1]).toBeCloseTo(ground_y + LAND_CLEARANCE, 0)
  })
  test('end-to-end: a mountain-top arrival ALSO reaches LAND_CLEARANCE by ARRIVAL_RADIUS (the old fixed-radius shed could only ever cover ~27m)', () => {
    const dt = 1 / 30
    const ground_y = 250
    let out = { pos: [600, CRUISE_ALTITUDE, 0], arrived: false } // 600 > the ground_y=250 glide crossover (~82m)
    for (let i = 0; i < 200000 && !out.arrived; i++) out = flight_step({ pos: out.pos, target: { x: 0, z: 0 }, ground_y, dt })
    expect(out.arrived).toBe(true)
    expect(out.pos[1]).toBeCloseTo(ground_y + LAND_CLEARANCE, 0)
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('is_arrived', () => {
  test('true within ARRIVAL_RADIUS, false beyond', () => {
    expect(is_arrived(ARRIVAL_RADIUS - 0.1)).toBe(true)
    expect(is_arrived(ARRIVAL_RADIUS)).toBe(true)
    expect(is_arrived(ARRIVAL_RADIUS + 0.1)).toBe(false)
  })
  test('flight_step reports arrived exactly at the arrival radius', () => {
    const near = flight_step({ pos: [0, 11, 0], target: { x: 2, z: 0 }, ground_y: 8, dt: 1 / 60 })
    expect(near.arrived).toBe(true)
    const far = flight_step({ pos: [0, 20, 0], target: { x: 1000, z: 0 }, ground_y: 8, dt: 1 / 60 })
    expect(far.arrived).toBe(false)
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('mount_is_moving — the #175 animation root-cause fix', () => {
  // ROOT CAUSE (both #175 reports: "still not animated"): fast-travel drives the body via ctl.teleport()
  // every frame, never ctl.tick() — and the controller's teleport() zeroes velocity, so state.speed (the
  // ONLY thing a naive `speed > threshold` check can read) is frozen at whatever it was the instant before
  // takeoff — typically 0, since a player idle-clicks the travel menu. mount_rig.js's idle↔move blend then
  // decays to idle for the entire flight: the mixer runs, the flap/fly clip just never gets weight.
  test('a real ground speed above the threshold reads as moving regardless of flight', () => {
    expect(mount_is_moving(MOUNT_MOVE_THRESHOLD + 0.01, false)).toBe(true)
    expect(mount_is_moving(MOUNT_MOVE_THRESHOLD + 0.01, true)).toBe(true)
  })
  test('a frozen (post-teleport) zero speed still reads as moving WHILE fast-travel is flying', () => {
    expect(mount_is_moving(0, true)).toBe(true) // the exact #175 repro: speed frozen at 0, dragon mid-flight
  })
  test('a frozen zero speed reads as NOT moving when no flight is active (idle stays idle, unrelated riders unaffected)', () => {
    expect(mount_is_moving(0, false)).toBe(false)
  })
})

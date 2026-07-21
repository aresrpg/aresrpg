// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST-TRAVEL FLIGHT math — proves the pure autopilot step: RUN-speed cap (never ×1.5), no overshoot, heading
// straight at the target, altitude shaping (climb → cruise ground+12 → descend ground+3), hold-last-y on a null
// ground sample, and the arrival test. No engine, no effects — the same headless discipline as auto_run.test.js.
import { describe, expect, test } from 'bun:test'

import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): fast_travel_flight.js itself imports CONTROLLER_CONSTANTS from
// @aresrpg/engine3/player (character_controller.js), which unconditionally re-exports create_character_avatar
// — a static import of the absent-by-design senshi_male.glb — see test_helpers/glb_fixture.js. The whole
// module (every export below) is unreachable without the asset, so the whole file guards together.
const {
  ARRIVAL_RADIUS,
  CRUISE_CLEARANCE,
  DESCEND_RADIUS,
  FT_SPEED,
  LAND_CLEARANCE,
  MOUNT_MOVE_THRESHOLD,
  VERT_RATE,
  flight_step,
  is_arrived,
  mount_is_moving,
  target_clearance,
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
  test('climbs toward ground+CRUISE far out, bounded (never a teleport in Y)', () => {
    const pos = [0, 8, 0] // on the ground
    const out = flight_step({ pos, target: { x: 1000, z: 0 }, ground_y: 8, dt })
    expect(out.pos[1]).toBeGreaterThan(8) // rising toward ground+12
    expect(out.pos[1]).toBeLessThan(8 + CRUISE_CLEARANCE) // but not instantly — bounded ascent
  })
  test('a null ground sample HOLDS altitude (never descend blind)', () => {
    const pos = [0, 55, 0]
    const out = flight_step({ pos, target: { x: 1000, z: 0 }, ground_y: null, dt })
    expect(out.pos[1]).toBe(55)
  })
  test('descent precedes arrival — clearance drops to LAND before the arrival radius', () => {
    expect(DESCEND_RADIUS).toBeGreaterThan(ARRIVAL_RADIUS) // structural: descent window opens well before arrival
    expect(target_clearance(DESCEND_RADIUS + 5)).toBe(CRUISE_CLEARANCE) // far out = cruise high
    expect(target_clearance(DESCEND_RADIUS - 1)).toBe(LAND_CLEARANCE) // inside the window = descending
    expect(target_clearance(ARRIVAL_RADIUS)).toBe(LAND_CLEARANCE) // at arrival = already at the drop clearance
  })
  test('inside the descend window the dragon sinks toward ground+LAND', () => {
    const pos = [0, 20, 0] // cruising high, but close (within DESCEND_RADIUS) to the target
    const out = flight_step({ pos, target: { x: 2, z: 0 }, ground_y: 8, dt })
    expect(out.pos[1]).toBeLessThan(20) // sinking toward ground+3
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

// #175 second live report ("STILL not animated, and it should fly WAY higher" — priority bumped on recurrence).
describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('CRUISE_CLEARANCE — "way higher" (#175)', () => {
  test('cruise sits well above the old 12m ceiling that read as skimming the terrain', () => {
    // floor = 2× the pre-#175 value — the owner's own range was "2-3×"; this is the low end of that promise.
    expect(CRUISE_CLEARANCE).toBeGreaterThanOrEqual(24)
  })
  test('DESCEND_RADIUS gives the descent enough runway to shed the taller cruise before arrival (else a taller cruise force-unmounts the rider mid-air)', () => {
    const shed_needed = CRUISE_CLEARANCE - LAND_CLEARANCE
    const time_available = DESCEND_RADIUS / FT_SPEED // s to cross the descend window at cruise ground-speed
    const shed_available = VERT_RATE * time_available
    expect(shed_available).toBeGreaterThanOrEqual(shed_needed)
  })
  test('end-to-end: starting a descent at DESCEND_RADIUS actually reaches LAND_CLEARANCE by ARRIVAL_RADIUS', () => {
    // Simulate the last leg frame-by-frame (dt=1/30, a rough frame budget) — no shortcuts, the same
    // flight_step the pilot drives — and assert the body is AT (not just "below") land clearance on arrival.
    const dt = 1 / 30
    const ground_y = 8
    const target = { x: 0, z: 0 }
    let out = { pos: [DESCEND_RADIUS, ground_y + CRUISE_CLEARANCE, 0], arrived: false }
    for (let i = 0; i < 100000 && !out.arrived; i++) {
      out = flight_step({ pos: out.pos, target, ground_y, dt })
    }
    expect(out.arrived).toBe(true)
    expect(out.pos[1]).toBeCloseTo(ground_y + LAND_CLEARANCE, 0)
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

// FAST-TRAVEL FLIGHT math — proves the pure autopilot step: RUN-speed cap (never ×1.5), no overshoot, heading
// straight at the target, altitude shaping (climb → cruise ground+12 → descend ground+3), hold-last-y on a null
// ground sample, and the arrival test. No engine, no effects — the same headless discipline as auto_run.test.js.
import { describe, expect, test } from 'bun:test'

import { CONTROLLER_CONSTANTS } from '@aresrpg/engine3/player'

import {
  ARRIVAL_RADIUS,
  CRUISE_CLEARANCE,
  DESCEND_RADIUS,
  FT_SPEED,
  LAND_CLEARANCE,
  flight_step,
  is_arrived,
  target_clearance,
} from './fast_travel_flight.js'

describe('FT_SPEED — run speed, never pet speed', () => {
  test('is exactly the controller RUN_SPEED (single home, no ×1.5)', () => {
    expect(FT_SPEED).toBe(CONTROLLER_CONSTANTS.RUN_SPEED)
    expect(FT_SPEED).not.toBe(CONTROLLER_CONSTANTS.RUN_SPEED * 1.5) // the mount-roam multiplier is forbidden here
  })
})

describe('flight_step — horizontal beeline at ≤ RUN speed', () => {
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

describe('flight_step — altitude shaping', () => {
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

describe('is_arrived', () => {
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

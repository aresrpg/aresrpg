// GAME-FEEL regression fixture (2026-07-07 pro-feel pass — still-to-run felt too fast and sliding,
// tight spaces were hard to control, and jumps/parkour on single blocks were very hard). Pure math, no
// renderer: a seeded human-like bot drives the REAL controller across a single-block parkour course,
// plus direct assertions on the ground curves, jump invariants (apex height is the approved reach —
// it must NEVER drift), variable jump height, gravity asymmetry, jump buffering, corner forgiveness
// and anim cadence sync. Baselines (pre-pass, exp accel/decel): parkour 26% naive-bot success, 100 ms
// tap traveled 1.35 m, full-run release slid 1.22 m over 583 ms, doorway approach dead-stuck.

import { describe, it, expect } from 'bun:test'

import { create_controller_state, step_controller, ground_controller, CONTROLLER_CONSTANTS } from './controller.js'

const DT = 1 / 60
const YAW_PLUS_X = -Math.PI / 2 // forward → +X
const flat = { solid_at: (/** @type {number} */ _x, /** @type {number} */ y) => y < 0, liquid_at: () => false }
const fwd = (/** @type {number} */ f = 1, jump = false) => ({ forward: f, strafe: 0, jump, yaw: YAW_PLUS_X })

/** deterministic LCG so the parkour trials are identical run-to-run */
const make_rng = (/** @type {number} */ seed) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('game feel — ground curves (the anti-"sliding" pass)', () => {
  it('a 100 ms forward tap stays a small adjustment (<0.5 m travel, was 1.35 m)', () => {
    const s = create_controller_state([0.5, 0, 0.5])
    ground_controller(s, flat)
    for (let f = 0; f < 6; f += 1) step_controller(s, fwd(), flat, DT)
    expect(s.speed).toBeLessThan(6) // linear accel: no exp front-load (was 7.34 m/s after 100 ms)
    for (let f = 0; f < 300 && s.speed > 0.05; f += 1) step_controller(s, fwd(0), flat, DT)
    expect(s.position[0] - 0.5).toBeLessThan(0.5)
  })

  it('full-run release stops in <0.8 m and <250 ms (was 1.22 m / 583 ms)', () => {
    const s = create_controller_state([0.5, 0, 0.5])
    ground_controller(s, flat)
    for (let f = 0; f < 120; f += 1) step_controller(s, fwd(), flat, DT)
    expect(s.speed).toBeCloseTo(CONTROLLER_CONSTANTS.RUN_SPEED, 1) // top speed unchanged
    const [x0] = s.position
    let frames = 0
    while (s.speed > 0.1 && frames < 300) {
      step_controller(s, fwd(0), flat, DT)
      frames += 1
    }
    expect(s.position[0] - x0).toBeLessThan(0.8)
    expect(frames * DT).toBeLessThan(0.25)
  })

  it('still→run takes a readable ramp (~0.23 s), not an instant max', () => {
    const s = create_controller_state([0.5, 0, 0.5])
    ground_controller(s, flat)
    let frames = 0
    while (s.speed < CONTROLLER_CONSTANTS.RUN_SPEED - 0.1 && frames < 120) {
      step_controller(s, fwd(), flat, DT)
      frames += 1
    }
    const t = frames * DT
    expect(t).toBeGreaterThan(0.15) // not instant…
    expect(t).toBeLessThan(0.4) // …but still responsive
  })
})

describe('game feel — jump invariants (approved reach must never drift)', () => {
  it('held jump apex ≈ JUMP_APEX_M and full-run air time ≈ 0.5 s (reach preserved)', () => {
    const s = create_controller_state([0.5, 0, 0.5])
    ground_controller(s, flat)
    for (let f = 0; f < 120; f += 1) step_controller(s, fwd(), flat, DT)
    const [x0] = s.position
    step_controller(s, fwd(1, true), flat, DT)
    let [, apex] = s.position
    let air = DT
    while (!s.on_ground && air < 3) {
      step_controller(s, fwd(1, true), flat, DT)
      apex = Math.max(apex, s.position[1])
      air += DT
    }
    expect(apex).toBeGreaterThan(1.4) // the legacy ~1.44 m apex (+ discrete-integration epsilon)
    expect(apex).toBeLessThan(1.65)
    expect(air).toBeGreaterThan(0.45) // legacy full-run arc was ~0.50 s / ~5.7 m — both preserved
    expect(air).toBeLessThan(0.58)
    expect(s.position[0] - x0).toBeGreaterThan(5.0)
  })

  it('release-to-cut: a tapped jump is a short hop (variable height)', () => {
    const s = create_controller_state([0.5, 0, 0.5])
    ground_controller(s, flat)
    step_controller(s, fwd(0, true), flat, DT) // press one frame, then release
    let [, apex] = s.position
    for (let f = 0; f < 120 && !s.on_ground; f += 1) {
      step_controller(s, fwd(0), flat, DT)
      apex = Math.max(apex, s.position[1])
    }
    expect(apex).toBeLessThan(0.8) // well under the held apex — the cut fired
    expect(apex).toBeGreaterThan(0.2) // but still a real hop
  })

  it('gravity asymmetry: the fall half of the arc is FALL_GRAVITY_MULT× steeper than the rise', () => {
    const s = create_controller_state([0.5, 0, 0.5])
    ground_controller(s, flat)
    step_controller(s, fwd(0, true), flat, DT)
    let rise_frames = 0
    while (s.velocity[1] > 0) {
      step_controller(s, { forward: 0, strafe: 0, jump: true, yaw: YAW_PLUS_X }, flat, DT)
      rise_frames += 1
    }
    let fall_frames = 0
    while (!s.on_ground && fall_frames < 300) {
      step_controller(s, { forward: 0, strafe: 0, jump: true, yaw: YAW_PLUS_X }, flat, DT)
      fall_frames += 1
    }
    // same height both halves ⇒ t ∝ 1/√g ⇒ rise/fall ≈ √mult (≈1.26 at 1.6) — assert direction + rough size
    expect(rise_frames).toBeGreaterThan(fall_frames)
    expect(rise_frames / fall_frames).toBeGreaterThan(1.1)
  })

  it('jump buffering: a press just before landing fires on touchdown', () => {
    const s = create_controller_state([0.5, 2.0, 0.5]) // small drop
    let pressed = false
    let relaunched = false
    for (let f = 0; f < 240; f += 1) {
      // press (and hold) jump while STILL AIRBORNE, within the buffer window of touchdown
      if (!pressed && !s.on_ground && s.position[1] < 0.5 && s.velocity[1] < 0) pressed = true
      step_controller(s, { forward: 0, strafe: 0, jump: pressed && !relaunched, yaw: YAW_PLUS_X }, flat, DT)
      if (pressed && s.velocity[1] > 2) {
        relaunched = true // the buffered press fired as a jump on landing
        break
      }
    }
    expect(relaunched).toBe(true)
  })
})

describe('game feel — tight spaces (corner forgiveness + wall slide)', () => {
  it('threads a 1-block doorway approached 0.25 m off-center (dead-stuck before the nudge)', () => {
    const doorway = {
      solid_at: (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
        y < 0 || (x === 5 && z !== 2 && y < 3),
      liquid_at: () => false,
    }
    const s = create_controller_state([3.0, 0, 2.75])
    ground_controller(s, doorway)
    let passed = false
    for (let f = 0; f < 300 && !passed; f += 1) {
      step_controller(s, fwd(), doorway, DT)
      if (s.position[0] > 6.2) passed = true
    }
    expect(passed).toBe(true)
  })

  it('slides (not sticks) along a 2-block corridor wall on diagonal input', () => {
    const corridor = {
      solid_at: (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
        y < 0 || ((z <= 0 || z >= 3) && y < 3),
      liquid_at: () => false,
    }
    const s = create_controller_state([0.5, 0, 1.5])
    ground_controller(s, corridor)
    for (let f = 0; f < 180; f += 1)
      step_controller(s, { forward: 1, strafe: 1, jump: false, yaw: YAW_PLUS_X }, corridor, DT)
    expect(s.position[0] - 0.5).toBeGreaterThan(15) // forward progress despite hugging the wall
    expect(s.position[2]).toBeLessThan(2.61) // and the wall was never crossed (body half-width 0.4)
  })
})

describe('game feel — anim cadence sync', () => {
  it('gait_scale tracks actual speed ÷ clip speed for loco states, 1 otherwise', () => {
    const s = create_controller_state([0.5, 0, 0.5])
    ground_controller(s, flat)
    step_controller(s, fwd(0), flat, DT)
    expect(s.gait_scale).toBe(1) // IDLE
    for (let f = 0; f < 120; f += 1) step_controller(s, fwd(), flat, DT)
    expect(s.anim).toBe('RUN')
    expect(s.gait_scale).toBeCloseTo(1, 1) // full run on the RUN clip = authored cadence
    // mid-accel: WALK clip plays faster than authored (speed above WALK_SPEED), clamped ≤1.6
    const s2 = create_controller_state([0.5, 0, 0.5])
    ground_controller(s2, flat)
    for (let f = 0; f < 8; f += 1) step_controller(s2, fwd(), flat, DT)
    expect(s2.anim).toBe('WALK')
    expect(s2.gait_scale).toBeGreaterThan(0.4)
    expect(s2.gait_scale).toBeLessThanOrEqual(1.6)
  })
})

describe('game feel — the parkour oracle (single-block course, seeded human bot)', () => {
  // 5 single-block pillars, +1 block rise each, 2-block gaps: pillar n = cell (x=3n, z=0), top y=n.
  const N = 5
  const course = {
    solid_at: (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
      z === 0 && x >= 0 && x % 3 === 0 && x / 3 < N && y < x / 3,
    liquid_at: () => false,
  }

  /** One trial: settle → creep to the edge (jittered takeoff margin) → jump (jittered reaction) →
   *  steer mid-air toward the next pillar with a rough fixed-g mental model → brake on landing.
   *  @param {() => number} rng @returns {boolean} reached the last pillar */
  const trial = (rng) => {
    const s = create_controller_state([0.5, 0, 0.5])
    ground_controller(s, course)
    let n = 0
    let phase = 'SETTLE'
    let jump_hold = 0
    let react = 0
    let margin = 0
    let airtime = 0
    for (let t = 0; t < 25; t += DT) {
      let forward = 0
      let jump = false
      if (phase === 'SETTLE') {
        if (s.on_ground && s.speed < 0.4) {
          phase = 'APPROACH'
          margin = 0.2 + rng() * 0.3
          react = rng() * 0.1
        }
      } else if (phase === 'APPROACH') {
        forward = 1
        if (s.position[0] >= 3 * n + 1 - margin) phase = 'REACT'
      } else if (phase === 'REACT') {
        forward = 1
        react -= DT
        if (react <= 0) {
          phase = 'AIR'
          jump_hold = 0.3
          airtime = 0
        }
      } else {
        jump = jump_hold > 0
        jump_hold -= DT
        airtime += DT
        const target_x = 3 * (n + 1) + 0.5
        const [, vy] = s.velocity
        const dy = s.position[1] - (n + 1)
        const disc = vy * vy + 2 * 55 * dy // g=55 mental model — deliberately inexact
        const t_rem = disc > 0 ? (vy + Math.sqrt(disc)) / 55 : 0.1
        const x_land = s.position[0] + s.velocity[0] * t_rem
        forward = x_land < target_x - 0.15 ? 1 : x_land > target_x + 0.15 ? -1 : 0
        if (s.on_ground && airtime > 0.15) phase = 'SETTLE'
      }
      step_controller(s, { forward, strafe: 0, jump, yaw: YAW_PLUS_X }, course, DT)
      if (s.position[1] < n - 1.2) return false // fell into a gap
      if (s.on_ground) {
        const m = Math.round(s.position[1])
        if (m > n) {
          n = m
          phase = 'SETTLE'
        }
        if (n === N - 1 && s.speed < 0.4) return true
      }
    }
    return false
  }

  it('clears the course ≥90% of trials (pre-pass kit: 26% naive / needed inhuman air authority)', () => {
    const rng = make_rng(1337)
    let ok = 0
    const TRIALS = 100
    for (let i = 0; i < TRIALS; i += 1) if (trial(rng)) ok += 1
    expect(ok / TRIALS).toBeGreaterThanOrEqual(0.9)
  })
})

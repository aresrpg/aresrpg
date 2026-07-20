// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

// Pure-math coverage only (mirrors sfx.test.js's convention: the Audio/DOM-touching side — play_footstep,
// tick_footsteps — is a thin, best-effort application of these, untested here, same as play_element_sfx).
import { accumulate_step, jitter } from './footstep_sfx.js'

describe('jitter — ± fractional randomization, injectable rng', () => {
  it('rng=0 -> the low bound (1-frac); rng near 1 -> the high bound (1+frac)', () => {
    expect(jitter(100, 0.1, () => 0)).toBeCloseTo(90, 5)
    expect(jitter(100, 0.1, () => 0.999999)).toBeCloseTo(110, 4)
  })

  it('rng=0.5 -> the base unchanged', () => {
    expect(jitter(100, 0.15, () => 0.5)).toBeCloseTo(100, 5)
  })
})

describe('accumulate_step — distance-accumulator step trigger (fixed rng for determinism)', () => {
  const no_jitter = () => 0.5 // rng=0.5 -> jitter(...) returns the base stride unchanged

  it('below the stride threshold: no fire, the distance is carried', () => {
    const r = accumulate_step(0, 1.0, 1.8, 0.12, no_jitter)
    expect(r.fired).toBe(false)
    expect(r.acc).toBeCloseTo(1.0, 5)
  })

  it('crossing the threshold fires exactly once and carries the REMAINDER (never resets to 0)', () => {
    const r = accumulate_step(1.5, 0.5, 1.8, 0.12, no_jitter) // 1.5+0.5=2.0 >= 1.8 stride
    expect(r.fired).toBe(true)
    expect(r.acc).toBeCloseTo(0.2, 5) // 2.0 - 1.8, not 0 — the lazy-accrual remainder-carry law
  })

  it('landing exactly on the stride fires with a zero remainder', () => {
    const r = accumulate_step(0, 1.8, 1.8, 0.12, no_jitter)
    expect(r.fired).toBe(true)
    expect(r.acc).toBeCloseTo(0, 5)
  })

  it('a teleport-sized delta_m is clamped (never queues a multi-step burst) and still fires at most once', () => {
    const r = accumulate_step(0, 500, 1.8, 0.12, no_jitter) // a 500m jump — clamp caps the ADDED delta
    expect(r.fired).toBe(true)
    expect(r.acc).toBeLessThan(1.8) // remainder stays small — no backlog to burst-fire over the next frames
  })

  it('a negative delta_m (defensive) never decrements the accumulator below what was carried', () => {
    const r = accumulate_step(0.5, -10, 1.8, 0.12, no_jitter)
    expect(r.fired).toBe(false)
    expect(r.acc).toBeCloseTo(0.5, 5) // clamped to 0 before adding — acc unchanged
  })

  it('the stride jitter widens/narrows the effective threshold — never fires early past the low bound', () => {
    // stride jittered to the LOW bound (1.8 * 0.88 = 1.584) via rng=0 — 1.5m alone must NOT fire yet
    const under = accumulate_step(0, 1.5, 1.8, 0.12, () => 0)
    expect(under.fired).toBe(false)
    // the same 1.5m against the HIGH bound (1.8 * 1.12 = 2.016) also must not fire
    const under_high = accumulate_step(0, 1.5, 1.8, 0.12, () => 0.999999)
    expect(under_high.fired).toBe(false)
  })
})

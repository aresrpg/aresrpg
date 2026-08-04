// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Dynamic-resolution governor policy tests. The policy is a pure state machine over frame-time samples
// (no GPU, no renderer) — feed synthetic frame traces, assert the applied render_scale. These prove the
// policy's guarantee mechanically: rest = native (identical to today), sustained load = trimmed to hold
// 120, recovery = slow + full, a hitch = instant relief, and LOW stays static.

import { test, expect, describe } from 'bun:test'

import { create_governor, TARGET_FPS, SETTLE_DEBOUNCE_MS_FOR_TEST } from '../../../src/core/quality/governor.js'

const BUDGET_MS = 1000 / TARGET_FPS // 8.33 — a healthy 120fps frame under vsync
const FLOOR = 0.72
const STEP = 0.04

/** Build a governor whose applied scales are captured, plus a driver that feeds N frames of `ms`. */
function harness(/** @type {import('../../../src/core/quality/tiers.js').TierName} */ initial_tier = 'high') {
  /** @type {number[]} */
  const applied = []
  const gov = create_governor({
    initial_tier,
    set_tier: () => {},
    set_render_scale: (s) => applied.push(s),
  })
  const feed = (/** @type {number} */ ms, /** @type {number} */ n) => {
    for (let i = 0; i < n; i += 1) gov.record_frame(ms)
  }
  return { gov, applied, feed }
}

describe('governor — dynamic resolution', () => {
  test('at rest the scale stays native (1.0) — identical to today, no realloc', () => {
    const { gov, applied, feed } = harness('high')
    feed(BUDGET_MS, 600) // 10s of steady 120fps
    expect(gov.get_render_scale()).toBe(1)
    expect(applied.length).toBe(0) // never touched the swapchain — pixel-identical at rest
  })

  test('sustained over-budget load trims resolution down to the floor, never below', () => {
    const { gov, feed } = harness('high')
    feed(1000 / 60, 400) // sustained 60fps (16.6ms) — clearly over the 8.3ms budget
    expect(gov.get_render_scale()).toBeCloseTo(FLOOR, 5)
    expect(gov.get_render_scale()).toBeGreaterThanOrEqual(FLOOR)
  })

  test('a single hitch does NOT resize — only sustained pressure does (realloc-safe)', () => {
    const { gov, applied, feed } = harness('high')
    feed(BUDGET_MS, 60) // settle at rest (1.0)
    gov.record_frame(30) // one 30ms hitch — a lone spike must NEVER trigger a swapchain realloc (its own
    gov.record_frame(30) // ~100ms frame would just cascade); the slow EMA barely moves on two stray frames
    expect(applied.length).toBe(0)
    expect(gov.get_render_scale()).toBe(1)
  })

  test('after load clears, resolution recovers slowly and fully back to native', () => {
    const { gov, feed } = harness('high')
    feed(1000 / 60, 400) // drive down to the floor
    expect(gov.get_render_scale()).toBeCloseTo(FLOOR, 5)
    feed(BUDGET_MS, 900) // ~7.5s of healthy frames — past the 2s hold + the ~2s paced climb
    expect(gov.get_render_scale()).toBe(1) // fully restored, never overshoots the ceiling
  })

  test('recovery is GRADUAL, not a snap — mid-recovery it sits between floor and ceiling', () => {
    const { gov, feed } = harness('high')
    feed(1000 / 60, 400)
    feed(BUDGET_MS, 300) // mid-climb — past the hold + a couple of paced steps, not yet at the ceiling
    const mid = gov.get_render_scale()
    expect(mid).toBeGreaterThan(FLOOR)
    expect(mid).toBeLessThan(1)
  })

  test('every applied scale is on the quantised 0.04 grid (bounded discrete swapchain sizes)', () => {
    const { applied, feed } = harness('high')
    feed(1000 / 60, 400)
    feed(BUDGET_MS, 900)
    for (const s of applied) expect(Math.abs(s / STEP - Math.round(s / STEP))).toBeLessThan(1e-6)
  })

  test('LOW tier is static — the governor never touches its resolution', () => {
    const { gov, applied, feed } = harness('low')
    feed(50, 400) // brutal sustained load
    expect(applied.length).toBe(0)
    expect(gov.is_auto_managed()).toBe(false)
    expect(gov.get_render_scale()).toBeCloseTo(0.66, 5) // stays at LOW's static ceiling
  })

  test('MEDIUM is managed (the tuned tier still holds 120 under load)', () => {
    const { gov, feed } = harness('medium')
    expect(gov.is_auto_managed()).toBe(true)
    feed(1000 / 60, 400)
    expect(gov.get_render_scale()).toBeCloseTo(FLOOR, 5)
  })

  test('set_tier resets the policy to the new tier ceiling', () => {
    const { gov, feed } = harness('high')
    feed(1000 / 60, 400) // shrink to floor
    expect(gov.get_render_scale()).toBeCloseTo(FLOOR, 5)
    gov.set_tier('high') // re-assert high → ceiling restored (engine applies it to the renderer too)
    expect(gov.get_render_scale()).toBe(1)
    gov.set_tier('low')
    expect(gov.get_render_scale()).toBeCloseTo(0.66, 5)
  })

  test('does not oscillate at the budget boundary — bounded changes when frames hover at budget', () => {
    const { gov, applied, feed } = harness('high')
    // frames right at the 120fps budget with mild jitter: the dead-band between grow/shrink trips must
    // keep this from thrashing the swapchain. Feed 1000 near-budget frames.
    for (let i = 0; i < 1000; i += 1) gov.record_frame(BUDGET_MS + (i % 2 === 0 ? -0.2 : 0.2))
    // A steady-at-budget stream must not churn resolution every few frames — a handful of changes at most.
    expect(applied.length).toBeLessThan(10)
  })
})

// THE RESIZE-SAFETY GATE: a render_scale change is a setPixelRatio swapchain
// realloc; landing one while a streaming MeshStandardNodeMaterial (terrain / water / far-field / GLB) is
// mid async-pipeline-compile is the "depthStencil.format undefined" flash. So record_frame's `settled`
// flag FREEZES the whole policy while the scene is unsettled (booting / streaming), and even once settled
// holds off the first resize for SETTLE_DEBOUNCE_MS so in-flight compiles finish first. These prove it.
describe('governor — the resize-safety gate (no realloc races a pipeline compile)', () => {
  const HITCH = 1000 / 30 // 33ms — a brutal, unambiguously over-budget frame

  test('UNSETTLED (streaming): never resizes, even under sustained brutal load', () => {
    const { gov, applied } = harness('high')
    for (let i = 0; i < 600; i += 1) gov.record_frame(HITCH, false) // ~20s of 30fps while streaming
    expect(applied.length).toBe(0) // zero swapchain reallocs while a compile could be in flight
    expect(gov.get_render_scale()).toBe(1) // stays native — no scale drift accrued during the freeze
  })

  test('a single hitch while UNSETTLED does not spike-shrink (the spike bypass is gated too)', () => {
    const { gov, applied } = harness('high')
    for (let i = 0; i < 30; i += 1) gov.record_frame(BUDGET_MS, false) // healthy but unsettled
    gov.record_frame(30, false) // a 30ms spike — but unsettled ⇒ no resize
    expect(applied.length).toBe(0)
  })

  test('once SETTLED it still waits the debounce before the first resize (compiles finish first)', () => {
    const { gov, applied } = harness('high')
    // stream first (unsettled) so no EMA/scale state is built, then settle under continued over-budget load.
    for (let i = 0; i < 40; i += 1) gov.record_frame(HITCH, false)
    expect(applied.length).toBe(0)
    // feed just UNDER the debounce worth of settled over-budget frames — still no resize (compiles protected).
    const debounce_frames = Math.floor(SETTLE_DEBOUNCE_MS_FOR_TEST / HITCH)
    for (let i = 0; i < debounce_frames - 1; i += 1) gov.record_frame(HITCH, true)
    expect(applied.length).toBe(0)
    // cross the debounce → the sustained over-budget pressure is now corrected (it survived into the window).
    for (let i = 0; i < 20; i += 1) gov.record_frame(HITCH, true)
    expect(applied.length).toBeGreaterThan(0)
    expect(gov.get_render_scale()).toBeLessThan(1)
  })
})

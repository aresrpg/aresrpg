// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { MEASURING_TIMEOUT_MS, fold_sync_sample, format_eta_duration, project_sync_status } from './sync_eta'

describe('sync_eta · fold_sync_sample (pure EMA fold)', () => {
  test('converging: a steady shrink yields a negative rate and a matching ETA', () => {
    let state = fold_sync_sample(null, { t: 0, remaining: 100 })
    state = fold_sync_sample(state, { t: 15_000, remaining: 90 })
    state = fold_sync_sample(state, { t: 30_000, remaining: 80 })
    state = fold_sync_sample(state, { t: 45_000, remaining: 70 })

    const projection = project_sync_status(state)
    expect(projection.status).toBe('converging')
    expect(projection.eta_ms).not.toBeNull()
    expect(projection.eta_ms as number).toBeCloseTo(105_000, 0) // 70 remaining / (10/15 per ms) checkpoints-per-sec
    expect(projection.progress).toBeCloseTo(0.3, 5) // consumed 30 of the peak 100
  })

  test('stalled: a flat remaining count (rate ~= 0) reports stalled with no ETA', () => {
    let state = fold_sync_sample(null, { t: 0, remaining: 50 })
    state = fold_sync_sample(state, { t: 15_000, remaining: 50 })
    state = fold_sync_sample(state, { t: 30_000, remaining: 50 })

    const projection = project_sync_status(state)
    expect(projection.status).toBe('stalled')
    expect(projection.eta_ms).toBeNull()
  })

  test('stalled: growing for more than 3 consecutive samples trips the stall even while the rate is still positive-but-small-magnitude', () => {
    let state = fold_sync_sample(null, { t: 0, remaining: 50 })
    state = fold_sync_sample(state, { t: 15_000, remaining: 55 }) // streak 1
    state = fold_sync_sample(state, { t: 30_000, remaining: 60 }) // streak 2
    state = fold_sync_sample(state, { t: 45_000, remaining: 65 }) // streak 3 — not yet over the threshold

    expect(project_sync_status(state).status).toBe('unknown') // growing but not proven stalled yet

    state = fold_sync_sample(state, { t: 60_000, remaining: 70 }) // streak 4 — trips it

    const projection = project_sync_status(state)
    expect(projection.status).toBe('stalled')
    expect(projection.eta_ms).toBeNull()
  })

  test('accelerating: an EMA rate responds to a faster shrink and predicts a shorter ETA than a naive first-sample projection', () => {
    let state = fold_sync_sample(null, { t: 0, remaining: 1000 })
    state = fold_sync_sample(state, { t: 15_000, remaining: 990 }) // delta -10
    const rate_1 = state.rate_per_sec as number
    state = fold_sync_sample(state, { t: 30_000, remaining: 970 }) // delta -20
    const rate_2 = state.rate_per_sec as number
    state = fold_sync_sample(state, { t: 45_000, remaining: 940 }) // delta -30
    const rate_3 = state.rate_per_sec as number
    state = fold_sync_sample(state, { t: 60_000, remaining: 900 }) // delta -40
    const rate_4 = state.rate_per_sec as number

    // Each step drops faster than the last — the EMA must trend more negative every step, not average flat.
    expect(rate_2).toBeLessThan(rate_1)
    expect(rate_3).toBeLessThan(rate_2)
    expect(rate_4).toBeLessThan(rate_3)

    const naive_eta_ms = (900 / Math.abs(rate_1)) * 1000
    const projection = project_sync_status(state)
    expect(projection.status).toBe('converging')
    expect(projection.eta_ms as number).toBeLessThan(naive_eta_ms)
  })

  test('progress tracks consumed/peak and never regresses when a later sample sets a new peak below an old one', () => {
    let state = fold_sync_sample(null, { t: 0, remaining: 200 })
    state = fold_sync_sample(state, { t: 15_000, remaining: 150 })
    expect(project_sync_status(state).progress).toBeCloseTo(0.25, 5)

    state = fold_sync_sample(state, { t: 30_000, remaining: 50 })
    expect(project_sync_status(state).progress).toBeCloseTo(0.75, 5)
  })

  test('a non-positive dt (duplicate or out-of-order timestamp) is ignored for rate but still feeds the peak', () => {
    const first = fold_sync_sample(null, { t: 1000, remaining: 80 })
    const guarded = fold_sync_sample(first, { t: 1000, remaining: 90 })

    expect(guarded.rate_per_sec).toBeNull()
    expect(guarded.peak_remaining).toBe(90)
    expect(guarded.last).toEqual({ t: 1000, remaining: 80 })
  })

  test('the very first sample is "unknown" — not enough history for a rate yet', () => {
    const state = fold_sync_sample(null, { t: 0, remaining: 42 })
    expect(project_sync_status(state)).toEqual({ status: 'unknown', eta_ms: null, progress: 0 })
  })

  test('project_sync_status(null) is the safe zero value', () => {
    expect(project_sync_status(null)).toEqual({ status: 'unknown', eta_ms: null, progress: 0 })
  })

  // RED-FIRST (#293): the sync header's "measuring speed…" phase used to have no exit besides a 2nd sample
  // landing — under the SAME gateway throttling #242 fixes, RpcLagBanner's own poll could go starved long
  // enough that a 2nd sample never arrives, and `rate_per_sec == null` short-circuits BEFORE the growing-
  // streak stall check ever runs, so the header claimed "measuring" forever. RpcLagBanner re-renders (and
  // re-derives this projection) on every poll ATTEMPT — success or failure — so passing the real wall clock
  // in is enough to bound the phase even while the estimator itself stays frozen.
  test('measuring never claims "speed" forever — a long-stuck first sample times out into stalled', () => {
    const state = fold_sync_sample(null, { t: 0, remaining: 42 })

    const still_measuring = project_sync_status(state, MEASURING_TIMEOUT_MS - 1)
    expect(still_measuring.status).toBe('unknown') // under the ceiling — an honest "not enough history yet"

    const timed_out = project_sync_status(state, MEASURING_TIMEOUT_MS)
    expect(timed_out.status).toBe('stalled') // the SAME honest label a flat-rate stall already uses
    expect(timed_out.eta_ms).toBeNull()
  })

  test('a converging/stalled-via-growing-streak projection is unaffected by the measuring-timeout param', () => {
    // Once rate_per_sec is non-null, the timeout branch never runs — `now` defaulting to state.last.t is a
    // pure convenience for existing single-arg call sites, never a second clock disagreeing with the fold.
    let state = fold_sync_sample(null, { t: 0, remaining: 100 })
    state = fold_sync_sample(state, { t: 15_000, remaining: 90 })
    expect(project_sync_status(state, 999_999_999).status).toBe('converging')
  })
})

describe('sync_eta · format_eta_duration (pure humanizer)', () => {
  test('renders whole minutes under an hour', () => {
    expect(format_eta_duration(23 * 60_000)).toEqual({ value: 23, unit: 'min' })
  })

  test('renders one-decimal hours at or beyond 60 minutes', () => {
    expect(format_eta_duration(84 * 60_000)).toEqual({ value: 1.4, unit: 'hour' })
  })

  test('never claims "~0 min" — floors sub-minute durations to 1', () => {
    expect(format_eta_duration(10_000)).toEqual({ value: 1, unit: 'min' })
  })
})

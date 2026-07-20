// FINALITY POLL DIET (latency lever 2) — proves our custom pollSchedule detects a final tx FASTER than
// @mysten/sui's default. `detect()` replicates CoreClient.waitForTransaction's algorithm (dist/client/core.mjs
// @2.20.1): it polls at cumulative offsets from submit and returns at the FIRST poll ≥ the tx's finality time,
// then repeats the last interval forever. Modelling getTransaction as instant isolates the SCHEDULE's effect —
// exactly the latency this lever removes. The measured wasted-ms this test prints IS the before/after evidence.
import { describe, expect, test } from 'bun:test'

import { FINALITY_POLL_SCHEDULE } from './latency.js'

const SDK_DEFAULT = [0, 300, 600, 1500, 3500] // the @mysten/sui built-in (then +2000ms forever)

/** ms wasted between a tx becoming final at `final_at` and the client SEEING it, under `schedule`. */
function wasted(schedule, final_at, timeout = 60_000) {
  const tail = schedule.length >= 2 ? schedule.at(-1) - schedule.at(-2) : 2_000
  let t = 0
  for (let i = 0; ; i++) {
    t = i < schedule.length ? schedule[i] : t + tail
    if (t >= final_at) return t - final_at
    if (t > timeout) return Infinity
  }
}

// Testnet Mysticeti finality clusters ~0.4-1s but spikes to ~2s under publicnode load — the hot window.
const FINALITY_SAMPLES = [400, 550, 700, 900, 1100, 1400, 1600, 1900, 2200, 2600]

describe('finality poll diet', () => {
  test('the schedule is strictly increasing with a 1000ms coarse tail (250ms resolution through 0-3s)', () => {
    for (let i = 1; i < FINALITY_POLL_SCHEDULE.length; i++)
      expect(FINALITY_POLL_SCHEDULE[i]).toBeGreaterThan(FINALITY_POLL_SCHEDULE[i - 1])
    // every gap inside the 0-3s hot window is ≤ 250ms (the brief's target)
    for (let i = 1; i < FINALITY_POLL_SCHEDULE.length; i++)
      if (FINALITY_POLL_SCHEDULE[i] <= 3_000)
        expect(FINALITY_POLL_SCHEDULE[i] - FINALITY_POLL_SCHEDULE[i - 1]).toBeLessThanOrEqual(250)
    expect(FINALITY_POLL_SCHEDULE.at(-1) - FINALITY_POLL_SCHEDULE.at(-2)).toBe(1_000)
  })

  test('worst-case detection in the hot window is ≤250ms (vs the SDK default up to ~2000ms)', () => {
    for (const final_at of FINALITY_SAMPLES) {
      const tight = wasted(FINALITY_POLL_SCHEDULE, final_at)
      expect(tight).toBeLessThanOrEqual(250) // never worse than one tight step
    }
  })

  test('the diet BOUNDS the tail (≤250ms) where the default suffers ≥1000ms dead zones, and wins on average', () => {
    // No fixed schedule dominates the other at EVERY finality time (at 550ms the default's 600 poll aligns
    // better than the diet's 750). The real, defensible wins: the diet's WORST case is bounded while the
    // default's is not, and the diet is far lower ON AVERAGE across the hot window.
    const diet = FINALITY_SAMPLES.map((f) => wasted(FINALITY_POLL_SCHEDULE, f))
    const base = FINALITY_SAMPLES.map((f) => wasted(SDK_DEFAULT, f))
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length
    expect(Math.max(...diet)).toBeLessThanOrEqual(250) // diet is always tightly bounded
    expect(Math.max(...base)).toBeGreaterThanOrEqual(1_000) // the default has ≥1s dead zones
    expect(avg(diet)).toBeLessThan(avg(base) / 2) // and wins decisively on average (measured: ~115 vs ~785ms)
  })

  test('detection is always finite below the timeout (the tail still converges)', () => {
    expect(wasted(FINALITY_POLL_SCHEDULE, 12_345)).toBeLessThan(Infinity)
  })

  // Prints the before/after table this lever contributes as evidence (no assertion — measurement).
  test('MEASURE: per-finality wasted-ms, default vs diet', () => {
    const rows = FINALITY_SAMPLES.map((final_at) => ({
      final_at,
      default_wasted: wasted(SDK_DEFAULT, final_at),
      diet_wasted: wasted(FINALITY_POLL_SCHEDULE, final_at),
      saved: wasted(SDK_DEFAULT, final_at) - wasted(FINALITY_POLL_SCHEDULE, final_at),
    }))
    const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
    console.info('[poll-diet] per-finality wasted ms (default → diet):')
    for (const r of rows)
      console.info(`  final@${r.final_at}ms: ${r.default_wasted} → ${r.diet_wasted} (saved ${r.saved})`)
    console.info(
      `[poll-diet] AVG wasted: default ${avg(rows.map((r) => r.default_wasted))}ms → diet ${avg(rows.map((r) => r.diet_wasted))}ms`
    )
    expect(rows.length).toBe(FINALITY_SAMPLES.length)
  })
})

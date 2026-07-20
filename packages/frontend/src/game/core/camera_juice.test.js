// WALK-CAMERA FOV PULSE unit proof (SEARCH-ZONE JUICE) — the reward-beat zoom-punch math. Pure, no DOM.
// The module holds one process-global pulse clock, so each test first DRAINS it (advance past the duration)
// back to idle before firing a fresh pulse.
import { test, expect } from 'bun:test'

import { pulse_walk_fov, walk_fov_pulse } from './camera_juice.js'

const drain = () => walk_fov_pulse(1) // advance well past PULSE_DUR → idle

test('walk_fov_pulse returns 0 when idle (no pulse fired / after one ends)', () => {
  drain()
  expect(walk_fov_pulse(0.016)).toBe(0)
})

test('pulse_walk_fov fires a one-shot negative FOV dip that deepens then eases back to 0', () => {
  drain()
  pulse_walk_fov()
  const quarter = walk_fov_pulse(0.08) // ~u=0.25 into the 0.32s punch
  expect(quarter).toBeLessThan(0) // a zoom-IN dip (narrower fov = objects push closer)
  expect(quarter).toBeGreaterThanOrEqual(-6) // never past the peak amplitude
  const middle = walk_fov_pulse(0.08) // ~u=0.5 — the trough
  expect(middle).toBeLessThanOrEqual(quarter) // deeper toward the middle
  walk_fov_pulse(0.4) // advance past the end
  expect(walk_fov_pulse(0.016)).toBe(0) // fully recovered
})

test('a fresh pulse restarts the dip mid-flight (re-search before the last punch settles)', () => {
  drain()
  pulse_walk_fov()
  walk_fov_pulse(0.3) // nearly done (near 0)
  pulse_walk_fov() // restart
  expect(walk_fov_pulse(0.01)).toBeLessThan(0) // dipping again from the top
})

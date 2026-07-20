// ENG-13 underwater — pure-logic tests for the submerged-flag HYSTERESIS (the CPU detection). The TSL
// immersion/warp nodes are GPU wiring (bench/eng13_underwater.spec.js verifies them live); here we pin
// the pure state machine that decides submerged vs not, which is the one piece with real branching to
// get wrong (the waterline flicker explicitly barred). 2026-07-03.

import { test, expect, describe } from 'bun:test'

import { compute_underwater_state, warp_enabled_for_tier, water_surface_plane, UNDERWATER } from './underwater.js'

const H = UNDERWATER.hysteresis_m // 0.1

describe('compute_underwater_state — waterline hysteresis', () => {
  test('no water over the eye ⇒ never submerged, hard exit regardless of previous state', () => {
    expect(compute_underwater_state(100, null, false)).toEqual({ submerged: false, depth: 0 })
    // was_submerged true but water gone (flew out sideways) → must NOT latch submerged
    expect(compute_underwater_state(100, null, true)).toEqual({ submerged: false, depth: 0 })
    // NaN/inf surface guarded the same way
    expect(compute_underwater_state(100, NaN, true).submerged).toBe(false)
  })

  test('clearly below the surface ⇒ submerged, depth = surface − eye', () => {
    const r = compute_underwater_state(120, 127, false) // 7 blocks under
    expect(r.submerged).toBe(true)
    expect(r.depth).toBeCloseTo(7, 6)
  })

  test('clearly above the surface ⇒ not submerged even if previously in', () => {
    const r = compute_underwater_state(130, 127, true) // 3 blocks over the surface
    expect(r.submerged).toBe(false)
    expect(r.depth).toBe(0)
  })

  test('DEAD-BAND holds the previous state — no flicker as the eye grazes the waterline', () => {
    const surface = 127
    // eye a hair BELOW the plane but within the half-band: hold whatever we were
    const just_below = surface - H * 0.5
    expect(compute_underwater_state(just_below, surface, false).submerged).toBe(false)
    expect(compute_underwater_state(just_below, surface, true).submerged).toBe(true)
    // eye a hair ABOVE the plane but within the half-band: still hold
    const just_above = surface + H * 0.5
    expect(compute_underwater_state(just_above, surface, false).submerged).toBe(false)
    expect(compute_underwater_state(just_above, surface, true).submerged).toBe(true)
  })

  test('just past the threshold edges: enter below −H, exit above +H', () => {
    const surface = 127
    // a hair MORE than H below the plane → enters (the exact edge is float-fuzzy and correctly falls in
    // the dead-band, so we assert the robust "clearly past" contract, not a float-exact boundary).
    expect(compute_underwater_state(surface - H - 1e-4, surface, false).submerged).toBe(true)
    // a hair MORE than H above → exits
    expect(compute_underwater_state(surface + H + 1e-4, surface, true).submerged).toBe(false)
  })

  test('a full crossing sequence produces exactly ONE enter and ONE exit (no chatter)', () => {
    const surface = 127
    // Descend from above → below, then ascend back — track transitions.
    const path = [128.0, 127.3, 127.05, 126.95, 126.5, 126.95, 127.05, 127.3, 128.0]
    let state = false
    let enters = 0
    let exits = 0
    for (const eye of path) {
      /** @type {boolean} */
      const next = compute_underwater_state(eye, surface, state).submerged
      if (next && !state) enters += 1
      if (!next && state) exits += 1
      state = next
    }
    expect(enters).toBe(1)
    expect(exits).toBe(1)
  })

  test('depth is clamped to ≥0 and 0 whenever not submerged', () => {
    // marginally above but held submerged by hysteresis (below is negative) → depth floored to 0
    const held = compute_underwater_state(127.05, 127, true)
    expect(held.submerged).toBe(true)
    expect(held.depth).toBe(0)
  })

  test('custom half-band widens the dead-band', () => {
    const surface = 127
    // with a 1-block band, 0.5 below still holds the previous state
    expect(compute_underwater_state(surface - 0.5, surface, false, 1).submerged).toBe(false)
    expect(compute_underwater_state(surface - 0.5, surface, true, 1).submerged).toBe(true)
    // 1.0 below crosses the wider band
    expect(compute_underwater_state(surface - 1.0, surface, false, 1).submerged).toBe(true)
  })
})

describe('warp_enabled_for_tier — LOW is tint-only', () => {
  test('LOW has NO distortion warp; every higher tier does', () => {
    expect(warp_enabled_for_tier('low')).toBe(false)
    expect(warp_enabled_for_tier('medium')).toBe(true)
    expect(warp_enabled_for_tier('high')).toBe(true)
  })
})

describe('UNDERWATER config — knobs in sane ranges (accept criteria)', () => {
  test('fog visibility in the briefed 12-18 block band', () => {
    expect(UNDERWATER.visibility_m).toBeGreaterThanOrEqual(12)
    expect(UNDERWATER.visibility_m).toBeLessThanOrEqual(18)
  })
  test('warp amplitude in the briefed 0.004-0.006 NDC band', () => {
    expect(UNDERWATER.warp_amp).toBeGreaterThanOrEqual(0.004)
    expect(UNDERWATER.warp_amp).toBeLessThanOrEqual(0.006)
  })
  test('darken floor ~0.5 so the bed stays legible however deep', () => {
    expect(UNDERWATER.darken_floor).toBeGreaterThanOrEqual(0.4)
    expect(UNDERWATER.darken_floor).toBeLessThanOrEqual(0.6)
  })
  test('warp speeds are SLOW (undulate, not shimmer) per brief 0.6-1.0', () => {
    for (const sp of UNDERWATER.warp_speed) {
      expect(sp).toBeGreaterThanOrEqual(0.6)
      expect(sp).toBeLessThanOrEqual(1.0)
    }
  })
})

describe('water_surface_plane — column walk over the eye', () => {
  const WATER = 5
  const AIR = 0
  const STONE = 1
  /** Build a block_at over a vertical column map { y: id } at a fixed (x,z); anything unset = air.
   * @param {Record<number, number>} map */
  const column = (map) => (/** @type {number} */ _x, /** @type {number} */ y, /** @type {number} */ _z) => map[y] ?? AIR

  test('eye NOT in water ⇒ null (no column over the eye)', () => {
    const block_at = column({ 120: AIR })
    expect(water_surface_plane(block_at, 0, 120.5, 0, WATER)).toBeNull()
  })

  test('eye in a single water cell ⇒ surface is that cell top', () => {
    // water at y=126 only, air above → surface plane = 127
    const block_at = column({ 126: WATER, 127: AIR })
    expect(water_surface_plane(block_at, 0, 126.4, 0, WATER)).toBe(127)
  })

  test('eye deep in a tall water column ⇒ surface is the highest water top', () => {
    // water fills 120..126 (7 cells), air at 127 → surface = 127 regardless of how deep the eye sits
    /** @type {Record<number, number>} */
    const map = {}
    for (let y = 120; y <= 126; y += 1) map[y] = WATER
    map[127] = AIR
    const block_at = column(map)
    expect(water_surface_plane(block_at, 0, 120.1, 0, WATER)).toBe(127) // near the bed
    expect(water_surface_plane(block_at, 0, 126.9, 0, WATER)).toBe(127) // just under the surface
  })

  test('water capped by a solid (not air) still surfaces at the top water cell', () => {
    // e.g. water under an overhang: water 124..125, stone at 126
    const block_at = column({ 124: WATER, 125: WATER, 126: STONE })
    expect(water_surface_plane(block_at, 0, 124.5, 0, WATER)).toBe(126)
  })

  test('scan cap bounds a pathological column (never spins the frame)', () => {
    // an all-water column; with max_scan=4 from eye cell 100 it returns cap top = 100+4+1
    const block_at = () => WATER
    expect(water_surface_plane(block_at, 0, 100.0, 0, WATER, 4)).toBe(105)
  })
})

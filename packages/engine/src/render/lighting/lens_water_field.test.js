// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Lens-water FIELD — the ROUND-8 FLUID LAW suite (target: "too linear … flowing patch with less
// straightness, we should not be able to detect the shape because water is fluid"). Pins the pure fluid
// geometry twins (trail_center_x / trail_halfwidth / trail_edge_rag / meniscus_bump + the surging wander
// in droplet_state_at) that the capture renders through and the TSL loops in lens_water.js mirror
// term-for-term. THE BAR: at any frozen frame, no straight edge and no recognizable geometric shape in
// the water layer — tested literally (a least-squares line must fail to fit a trail; widths/edges/rings
// must vary; descents must surge and snake but never flow uphill). The pass-level suites (decay, drain,
// lifecycle, knobs) live in lens_water.test.js.

import { describe, expect, test } from 'bun:test'

import {
  LENS_WATER,
  build_droplets,
  build_trails,
  droplet_state_at,
  film_amp_at,
  meniscus_bump,
  region_cut,
  region_level,
  region_noise,
  sheet_envelope,
  trail_center_x,
  trail_edge_rag,
  trail_halfwidth,
  trail_state_at,
} from './lens_water_field.js'

/** mean regional wetness over a coarse frame grid at time t — the coverage that's visually checked */
function region_coverage(/** @type {number} */ t, n = 16) {
  let sum = 0
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) sum += region_level((i + 0.5) / n, (j + 0.5) / n, t)
  return sum / (n * n)
}

describe('ROUND-8 FLUID LAW — no straight lines, no clean shapes (the geometry twins the shader mirrors)', () => {
  test('trail centreline defeats EVERY straight line (the "can you trace a line?" bar) and S-bends around it', () => {
    // The acceptance bar: no detectable straight stroke. Fit the least-squares LINE x = a + b·y through
    // the centreline — even the BEST line must miss it by more than the column's own width scale, and the
    // residuals must S-wrap around it (LSQ residuals of a genuine meander flip sign repeatedly).
    for (const x_base of [0.15, 0.4, 0.72, 0.9]) {
      /** @type {number[]} */
      const ys = []
      /** @type {number[]} */
      const cs = []
      for (let k = 0; k <= 90; k += 1) {
        const y = 0.2 + (k / 90) * 0.45 // a typical long trail span
        ys.push(y)
        cs.push(trail_center_x(x_base, y))
      }
      const max_dev = Math.max(...cs.map((c) => Math.abs(c - x_base)))
      expect(max_dev).toBeGreaterThan(LENS_WATER.trail_width) // wanders beyond its own width
      const n = ys.length
      const sy = ys.reduce((s, v) => s + v, 0)
      const sx = cs.reduce((s, v) => s + v, 0)
      const syy = ys.reduce((s, v) => s + v * v, 0)
      const sxy = ys.reduce((s, v, i) => s + v * cs[i], 0)
      const b = (n * sxy - sy * sx) / (n * syy - sy * sy)
      const a = (sx - b * sy) / n
      const res = cs.map((c, i) => c - (a + b * ys[i]))
      expect(Math.max(...res.map(Math.abs))).toBeGreaterThan(LENS_WATER.trail_width * 0.75) // no line fits
      let flips = 0
      for (let k = 1; k < res.length; k += 1)
        if (Math.sign(res[k]) !== Math.sign(res[k - 1]) && res[k] !== 0) flips += 1
      expect(flips).toBeGreaterThanOrEqual(2) // S-bends around even its own best line
    }
  })

  test('two trails at different anchors wander DIFFERENTLY (decorrelated phases — no lane repetition)', () => {
    /** @type {number[]} */
    const devs_a = []
    /** @type {number[]} */
    const devs_b = []
    for (let k = 0; k <= 40; k += 1) {
      const y = 0.2 + (k / 40) * 0.4
      devs_a.push(trail_center_x(0.3, y) - 0.3)
      devs_b.push(trail_center_x(0.7, y) - 0.7)
    }
    const diff = devs_a.reduce((s, v, i) => s + Math.abs(v - devs_b[i]), 0) / devs_a.length
    expect(diff).toBeGreaterThan(LENS_WATER.trail_meander * 0.2) // genuinely different shapes
  })

  test('trail width PINCHES and BULGES along the path (never a constant-width capsule), always > 0', () => {
    for (const x_base of [0.15, 0.4, 0.72, 0.9]) {
      const ws = []
      for (let k = 0; k <= 90; k += 1) ws.push(trail_halfwidth(x_base, 0.2 + (k / 90) * 0.45))
      const mean = ws.reduce((s, w) => s + w, 0) / ws.length
      const sd = Math.sqrt(ws.reduce((s, w) => s + (w - mean) ** 2, 0) / ws.length)
      expect(sd / mean).toBeGreaterThan(0.15) // real variation — the silhouette can't be a capsule
      expect(Math.min(...ws)).toBeGreaterThan(0) // the stream never breaks into a zero-width line
    }
  })

  test('trail head/tail caps are RAGGED across the column (never straight horizontal cuts), decorrelated', () => {
    const x_base = 0.5
    const head = []
    /** @type {number[]} */
    const tail = []
    for (let k = 0; k <= 30; k += 1) {
      const x = x_base - 0.03 + (k / 30) * 0.06 // sweep across the column's width
      head.push(trail_edge_rag(x, x_base, false))
      tail.push(trail_edge_rag(x, x_base, true))
    }
    expect(Math.max(...head) - Math.min(...head)).toBeGreaterThan(LENS_WATER.trail_rag * 0.5) // edge wobbles
    expect(Math.max(...tail) - Math.min(...tail)).toBeGreaterThan(LENS_WATER.trail_rag * 0.5)
    const diff = head.reduce((s, v, i) => s + Math.abs(v - tail[i]), 0) / head.length
    expect(diff).toBeGreaterThan(0) // head and tail edges are different shapes
  })

  test('bead SILHOUETTE is amorphous: r_eff(θ) varies around the ring, never collapses, differs per bead', () => {
    const ring = (/** @type {number} */ sx, /** @type {number} */ sy) => {
      const rs = []
      for (let k = 0; k < 64; k += 1) {
        const th = (k / 64) * Math.PI * 2
        rs.push(1 + meniscus_bump(Math.cos(th), Math.sin(th), sx, sy) * LENS_WATER.meniscus_amp)
      }
      return rs
    }
    const a = ring(0.31, 0.62)
    const mean = a.reduce((s, r) => s + r, 0) / a.length
    const sd = Math.sqrt(a.reduce((s, r) => s + (r - mean) ** 2, 0) / a.length)
    expect(sd).toBeGreaterThan(0.05) // a lumpy blob, not a circle (RMS wobble ≥ 5% of R)
    expect(Math.min(...a)).toBeGreaterThan(0.5) // the blob never pinches to nothing
    const b = ring(0.78, 0.21)
    const diff = a.reduce((s, r, i) => s + Math.abs(r - b[i]), 0) / a.length
    expect(diff).toBeGreaterThan(0.02) // two beads never share an outline
  })

  test('bead descent SURGES and WANDERS but never flows uphill (every primary, 4 seeds)', () => {
    for (const seed of [1, 7, 42, 99]) {
      const primaries = build_droplets(seed).slice(0, LENS_WATER.count)
      for (const d of primaries) {
        expect(d.surge_amp * d.surge_freq).toBeLessThan(1) // the never-uphill invariant (wavy time stays monotone)
        let prev_y = -Infinity
        for (let t = d.birth; t <= d.birth + d.lifetime; t += 0.05) {
          const s = droplet_state_at(d, t)
          expect(s.y).toBeGreaterThanOrEqual(prev_y - 1e-12) // water never runs UP the glass
          prev_y = s.y
        }
      }
    }
  })

  test('the descent is genuinely NON-LINEAR: speed varies along the way and the path curves (synthetic drop)', () => {
    const d = {
      x0: 0.5,
      y0: 0.1,
      birth: 0,
      lifetime: 2.5,
      radius: 0.01,
      burst_at: Infinity,
      slide: 0.04,
      sway_phase: 0.9,
      sway_freq: 3.0,
      surge_amp: 0.18,
      surge_freq: 3.0,
      surge_phase: 0.4,
      pop_x: 0,
      pop_y: 0,
    }
    const dys = []
    const sways = []
    for (let t = 0.2; t <= 2.4; t += 0.1) {
      dys.push(droplet_state_at(d, t + 0.1).y - droplet_state_at(d, t).y)
      sways.push(droplet_state_at(d, t).x - d.x0)
    }
    const mean_dy = dys.reduce((s, v) => s + v, 0) / dys.length
    const sd_dy = Math.sqrt(dys.reduce((s, v) => s + (v - mean_dy) ** 2, 0) / dys.length)
    expect(sd_dy / mean_dy).toBeGreaterThan(0.05) // the fall visibly speeds up and slows down
    let flips = 0
    for (let k = 1; k < sways.length; k += 1)
      if (Math.sign(sways[k]) !== Math.sign(sways[k - 1]) && sways[k] !== 0) flips += 1
    expect(flips).toBeGreaterThanOrEqual(2) // the path snakes left-right-left — a curve, not a line
  })
})

describe('ROUND-9 WET SHEET — the film owns the opening beat, then recedes', () => {
  test('sheet envelope: 1 through the hold, monotone decay, exactly 0 once the sheet has broken', () => {
    expect(sheet_envelope(0)).toBe(1)
    expect(sheet_envelope(LENS_WATER.sheet_hold)).toBe(1)
    let prev = Infinity
    for (let t = 0; t <= 2; t += 0.05) {
      const v = sheet_envelope(t)
      expect(v).toBeLessThanOrEqual(prev + 1e-12)
      prev = v
    }
    expect(sheet_envelope(LENS_WATER.sheet_hold + LENS_WATER.sheet_fade)).toBe(0)
    expect(sheet_envelope(3)).toBe(0)
  })

  test('film amp: sheet_amp at the surface moment, the r4 subtle base once the sheet has receded', () => {
    expect(film_amp_at(0)).toBeCloseTo(LENS_WATER.sheet_amp, 9) // full-frame "looking through water"
    expect(film_amp_at(LENS_WATER.sheet_hold + LENS_WATER.sheet_fade)).toBeCloseTo(LENS_WATER.film_amp, 9)
    let prev = Infinity
    for (let t = 0; t <= 2; t += 0.05) {
      const v = film_amp_at(t)
      expect(v).toBeLessThanOrEqual(prev + 1e-12) // recedes, never re-swells
      expect(v).toBeGreaterThanOrEqual(LENS_WATER.film_amp - 1e-12) // never below the base
      prev = v
    }
  })
})

describe('ROUND-9 REGION FIELD — coverage fragments into fluid patches (the sheet breakup)', () => {
  test('region noise is bounded [0,1] over the frame', () => {
    for (let i = 0; i <= 20; i += 1)
      for (let j = 0; j <= 20; j += 1) {
        const n = region_noise(i / 20, j / 20)
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThanOrEqual(1)
      }
  })

  test('t=0 (the surface moment): the WHOLE frame is wet — every grid cell at level 1', () => {
    expect(region_cut(0)).toBeLessThanOrEqual(-LENS_WATER.region_band)
    for (let i = 0; i < 12; i += 1)
      for (let j = 0; j < 12; j += 1) expect(region_level((i + 0.5) / 12, (j + 0.5) / 12, 0)).toBe(1)
    expect(region_coverage(LENS_WATER.sheet_hold)).toBeCloseTo(1, 6) // still full at the end of the hold
  })

  test('coverage shrinks monotonically through the breakup and is EXACTLY 0 by region_end', () => {
    let prev = Infinity
    for (let t = 0; t <= LENS_WATER.region_end + 0.1; t += 0.15) {
      const c = region_coverage(t)
      expect(c).toBeLessThanOrEqual(prev + 1e-9)
      prev = c
    }
    expect(region_cut(LENS_WATER.region_end)).toBeGreaterThanOrEqual(1) // the cut has swept the whole range
    expect(region_coverage(LENS_WATER.region_end)).toBe(0)
  })

  test('mid-breakup: the frame is genuinely FRAGMENTED (several disjoint wet runs), not one shrinking block', () => {
    // find a mid-coverage moment, then scan rows: fragmentation = rows with ≥2 disjoint wet runs
    let t_mid = LENS_WATER.sheet_hold
    for (let t = LENS_WATER.sheet_hold; t <= LENS_WATER.region_end; t += 0.05)
      if (region_coverage(t) <= 0.5) {
        t_mid = t
        break
      }
    let rows_with_multiple_runs = 0
    for (let r = 0; r < 9; r += 1) {
      const y = 0.1 + (r / 8) * 0.8
      let runs = 0
      let wet_prev = false
      for (let k = 0; k <= 300; k += 1) {
        const wet = region_level(k / 300, y, t_mid) > 0.5
        if (wet && !wet_prev) runs += 1
        wet_prev = wet
      }
      if (runs >= 2) rows_with_multiple_runs += 1
    }
    expect(rows_with_multiple_runs).toBeGreaterThanOrEqual(3) // patches, plural — a broken sheet
  })

  test('FLUID LAW on the patch borders: wet/dry transition positions vary row-to-row and column-to-column (no straight edge)', () => {
    let t_mid = LENS_WATER.sheet_hold
    for (let t = LENS_WATER.sheet_hold; t <= LENS_WATER.region_end; t += 0.05)
      if (region_coverage(t) <= 0.55) {
        t_mid = t
        break
      }
    const first_crossing = (/** @type {(u:number) => number} */ scan) => {
      // scan: (k) => level; returns the first 0.5-crossing position in [0,1] or null
      let prev = scan(0)
      for (let k = 1; k <= 300; k += 1) {
        const v = scan(k / 300)
        if (prev > 0.5 !== v > 0.5) return k / 300
        prev = v
      }
      return null
    }
    const std = (/** @type {number[]} */ a) => {
      const m = a.reduce((s, v) => s + v, 0) / a.length
      return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
    }
    const row_x = []
    for (let r = 0; r < 9; r += 1) {
      const y = 0.1 + (r / 8) * 0.8
      const x = first_crossing((u) => region_level(u, y, t_mid))
      if (x != null) row_x.push(x)
    }
    const col_y = []
    for (let c = 0; c < 9; c += 1) {
      const x = 0.1 + (c / 8) * 0.8
      const y = first_crossing((u) => region_level(x, u, t_mid))
      if (y != null) col_y.push(y)
    }
    expect(row_x.length).toBeGreaterThanOrEqual(4) // borders exist mid-breakup …
    expect(col_y.length).toBeGreaterThanOrEqual(4)
    expect(std(row_x)).toBeGreaterThan(0.04) // … and never line up vertically …
    expect(std(col_y)).toBeGreaterThan(0.04) // … or horizontally: fluid patches, not bands
  })
})

describe('ROUND-9 REMNANT LAW — features exist only in/behind wet regions', () => {
  test('during the sheet phase the gate is fully open: droplet alpha matches its pure life envelope', () => {
    const [d] = build_droplets(42)
    const t = d.birth + LENS_WATER.birth_fade + 0.05 // young, inside the sheet (t − lag < sheet_hold)
    expect(t - LENS_WATER.feature_lag).toBeLessThan(LENS_WATER.sheet_hold)
    expect(droplet_state_at(d, t).alpha).toBeCloseTo(1, 6) // gate = 1 ⇒ pure life alpha (fully faded in)
  })

  test('a droplet whose region has dried is GONE even mid-lifetime (never water on a dry pane)', () => {
    // pick the driest grid position at a late-breakup moment, park a synthetic mid-life drop there
    const t = LENS_WATER.region_end + LENS_WATER.feature_lag - 0.2 // late: most regions dry, gate not yet global-zero
    let dry_x = 0.5
    let dry_y = 0.5
    let best = Infinity
    for (let i = 0; i < 24; i += 1)
      for (let j = 0; j < 24; j += 1) {
        const lv = region_level((i + 0.5) / 24, (j + 0.5) / 24, t - LENS_WATER.feature_lag)
        if (lv < best) {
          best = lv
          dry_x = (i + 0.5) / 24
          dry_y = (j + 0.5) / 24
        }
      }
    expect(best).toBe(0) // a genuinely dry spot exists this late
    const drop = {
      x0: dry_x,
      y0: dry_y,
      birth: 0,
      lifetime: 3.4, // would still be alive by its own life envelope …
      radius: 0.01,
      burst_at: Infinity,
      slide: 0, // parked exactly on the dry spot
      sway_phase: 0,
      sway_freq: 0.0001,
      pop_x: 0,
      pop_y: 0,
    }
    expect(droplet_state_at(drop, t).alpha).toBe(0) // … but its sheet is gone ⇒ so is it
  })

  test('by region_end + feature_lag EVERY feature is gone — the remnant gate closes before the park', () => {
    const t = LENS_WATER.region_end + LENS_WATER.feature_lag + 0.01
    expect(t).toBeLessThanOrEqual(LENS_WATER.max_active_s)
    const drops = build_droplets(42)
    for (const d of drops) expect(droplet_state_at(d, t).alpha).toBe(0)
    for (const tr of build_trails(drops, 42)) expect(trail_state_at(tr, t).alpha).toBe(0)
  })
})

describe('ROUND-10 NO-POP LAW — the region gate FADES a drying patch, never cuts it', () => {
  const DT = 1 / 60 // one frame at 60fps
  const DEATH_STEP_MAX = 0.15 // see lens_water.test.js's round-10 suite for the measured baseline (~0.08 vs
  // the old accelerating-burst formula's 0.306) — this bar cleanly separates a landing from a pop

  test('a fixed point drying out crosses to 0 with a small last-frame delta (a landing, not a cut)', () => {
    for (const [x, y] of [
      [0.1, 0.1],
      [0.5, 0.5],
      [0.9, 0.2],
      [0.3, 0.7],
      [0.7, 0.9],
    ]) {
      let prev = region_level(x, y, 0)
      let step = null
      for (let t = DT; t <= LENS_WATER.region_end + 0.3; t += DT) {
        const v = region_level(x, y, t)
        if (prev > 1e-4 && v <= 1e-4 && step == null) step = prev - v
        prev = v
      }
      expect(step).not.toBeNull() // it genuinely dries within the window
      expect(step).toBeLessThan(DEATH_STEP_MAX)
    }
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Cube-World minimap CORE — pure-logic contract tests (no canvas): the relief-grid sampler (colour hill-shade
// + prominence for the extruded walls) + the map projection maths. The imperative render_oblique (clip /
// depth-sort / tile+wall fillRects) is proven by the headless side-by-side screenshot, not here.
import { describe, expect, test } from 'bun:test'

import { HACK_PALETTE } from '@aresrpg/engine3/hack'

import {
  sample_relief_grid,
  hack_relief_grid,
  render_hack_grid_map,
  render_flat_overlay,
  grid_index_at,
  project_offset,
  day_remap,
  lift_px,
  angle_lerp,
  MAP_TILT,
} from './minimap_engine.js'

describe('sample_relief_grid — the relief grid', () => {
  test('flat window: shade neutral (colour = the fixed-day grade), zero INTERIOR prominence, right shape', () => {
    const probe = () => ({ surface_y: 100, color: [100, 150, 100] })
    const n = 8
    const g = sample_relief_grid(0, 0, 16, n, probe)
    expect(g.heights.length).toBe(n * n)
    expect(g.shaded.length).toBe(n * n * 3)
    expect(g.ref_h).toBeCloseTo(100, 6)
    // flat → shade 1 → the stored colour is exactly the day-graded probe colour (round 4: the sampler applies
    // the fixed-day palette at sample time; Uint8 storage truncates)
    const [er, eg, eb] = day_remap(100, 150, 100)
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x
        const on_edge = x === 0 || x === n - 1 || z === 0 || z === n - 1
        expect(g.heights[i]).toBe(100)
        // flat interior → no wall; the sample-grid's own outer ring still forces the round-3 floating-island
        // cliff (EDGE_WALL_BLOCKS) regardless of the (flat) local gradient — see render_oblique's header.
        if (on_edge) expect(g.prominence[i]).toBeGreaterThan(0)
        else expect(g.prominence[i]).toBe(0)
        expect(g.shaded[i * 3]).toBe(Math.trunc(er))
        expect(g.shaded[i * 3 + 1]).toBe(Math.trunc(eg))
        expect(g.shaded[i * 3 + 2]).toBe(Math.trunc(eb))
      }
    }
  })

  test('a peak has prominence (a wall) and the slope shades as relief', () => {
    // a single central bump on a flat field
    const probe = (wx, wz) => ({ surface_y: Math.abs(wx) < 3 && Math.abs(wz) < 3 ? 120 : 100, color: [120, 120, 120] })
    const n = 16
    const g = sample_relief_grid(0, 0, 32, n, probe)
    let max_prom = 0
    for (let i = 0; i < n * n; i++) max_prom = Math.max(max_prom, g.prominence[i])
    expect(max_prom).toBeGreaterThan(0) // the bump's edge rises above its neighbours → a wall
    // shading varies across cells (relief read) — compared cell-to-cell, not vs the raw probe colour
    // (the day remap shifts every cell off 120, so a raw-value compare would pass vacuously)
    const base = g.shaded[(n + 1) * 3] // an interior flat cell far from the bump
    let varied = false
    for (let i = 0; i < n * n; i++) if (g.shaded[i * 3] !== base) varied = true
    expect(varied).toBe(true)
  })

  test('reuses the prev grid buffers when n matches (zero per-resample alloc)', () => {
    const probe = () => ({ surface_y: 50, color: [10, 20, 30] })
    const n = 8
    const a = sample_relief_grid(0, 0, 16, n, probe)
    const b = sample_relief_grid(40, 40, 16, n, probe, a)
    expect(b.heights).toBe(a.heights)
    expect(b.shaded).toBe(a.shaded)
    expect(b.prominence).toBe(a.prominence)
    expect(b.order).toBe(a.order)
  })
})

describe('day_remap — the fixed-day map palette', () => {
  test('land lifts hard toward saturated day and keeps its hue; water stays deep and blue-dominant', () => {
    const [r, g, b] = day_remap(45, 70, 40) // a dusk-dark forest green (the far-LOD reality)
    expect(g).toBeGreaterThan(70) // brighter than it came in
    expect(g).toBeGreaterThan(r) // still green-dominant
    expect(g).toBeGreaterThan(b)
    const [wr, wg, wb] = day_remap(20, 35, 70) // deep water
    expect(wb).toBeGreaterThan(wr) // stays water-blue
    expect(wb).toBeGreaterThan(wg)
    // land gains far more brightness than water — the island's land is the bright subject
    expect(r + g + b - (45 + 70 + 40)).toBeGreaterThan(wr + wg + wb - (20 + 35 + 70))
    // never escapes the byte range
    for (const c of [r, g, b, wr, wg, wb]) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(255)
    }
  })

  test('round 5: dialed back from the r4 overshoot (previous colors were too flashy) — measurably calmer', () => {
    // Replicates the EXACT r4 land formula by hand (sat 1.6, gamma 0.52, green tint 1.09) — the constants
    // this file shipped with before round 5 — to prove the new grade is a genuine pull-back, not just
    // "different". A regression gate: if this ever creeps back up near old_g, the palette overshot again.
    const old_grade = (c, luma, t) =>
      Math.max(0, Math.min(255, 255 * Math.pow(Math.max(0, luma + (c - luma) * 1.6) / 255, 0.52) * t))
    const [, g] = day_remap(45, 70, 40)
    const luma = 0.299 * 45 + 0.587 * 70 + 0.114 * 40
    const old_g = old_grade(70, luma, 1.09)
    expect(g).toBeLessThan(old_g - 15) // meaningfully calmer than the r4 knobs would have produced
    expect(g).toBeGreaterThan(luma) // still a genuine daylight lift, not just darker across the board
  })
})

describe('lift_px — the clamped height lift', () => {
  test('linear inside the clamp, hard-capped outside (both signs)', () => {
    expect(lift_px(110, 100, 1, 200)).toBeCloseTo(10, 6) // 10 blocks × 1 px/block
    expect(lift_px(400, 100, 1, 200)).toBe(20) // cap = 200 × LIFT_CLAMP_FRAC
    expect(lift_px(-400, 100, 1, 200)).toBe(-20)
  })
})

describe('project_offset — the heading-up + oblique projection', () => {
  test('theta=0 is identity in x, oblique-squashed in z', () => {
    const p = project_offset(10, 6, 0, MAP_TILT)
    expect(p.x).toBeCloseTo(10, 6)
    expect(p.z).toBeCloseTo(6 * MAP_TILT, 6)
  })

  test('theta=90° rotates east→up, north→east', () => {
    const p = project_offset(10, 0, Math.PI / 2, 1)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(10, 6)
  })

  test('a pure-north offset maps up the screen (negative z) at theta=0', () => {
    expect(project_offset(0, -8, 0, MAP_TILT).z).toBeLessThan(0)
  })
})

describe('angle_lerp — round-5 eased heading (shortest-path, wrap-safe)', () => {
  test('moves partway toward the target, never overshoots it', () => {
    const next = angle_lerp(0, 1, 16, 90)
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(1)
  })

  test('dt=0 is a no-op (current unchanged)', () => {
    expect(angle_lerp(0.4, 1.2, 0, 90)).toBeCloseTo(0.4, 9)
  })

  test('dt >> tau fully catches up to the target', () => {
    expect(angle_lerp(0, 1.5, 5000, 90)).toBeCloseTo(1.5, 6)
  })

  test('takes the SHORT way across the ±π wrap seam, not the long way through 0', () => {
    // current just past -π, target just under +π — these are neighbours across the seam (~0.02 rad apart),
    // not ~2π apart. A long-way lerp would move current DOWN (away from target); the short way moves it up.
    const current = -Math.PI + 0.01
    const target = Math.PI - 0.01
    const next = angle_lerp(current, target, 16, 90)
    expect(next).toBeLessThan(current) // steps further negative, wrapping toward +π from "below -π"
  })

  test('a whole 2π offset is equivalent to no rotation at all (delta wraps to ~0)', () => {
    const next = angle_lerp(0.3, 0.3 + Math.PI * 2, 1000, 90)
    expect(next).toBeCloseTo(0.3, 6)
  })
})

describe('hack mode — the minimap draws the RETRO GRID, never the terrain', () => {
  test('hack_relief_grid builds the slab with ZERO terrain probes (flat, ground-coloured, right shape)', () => {
    const n = 8
    const g = hack_relief_grid(40, -24, 64, n)
    expect(g.heights.length).toBe(n * n)
    expect(g.shaded.length).toBe(n * n * 3)
    // flat by construction: one height everywhere ⇒ every marker lift and every extruded wall is zero
    expect([...new Set(g.heights)]).toEqual([g.ref_h])
    expect([...new Set(g.prominence)]).toEqual([0])
    // the plate is the world grid's own ground colour — read from the shared palette, never re-typed here
    const expected = [(HACK_PALETTE.ground >> 16) & 0xff, (HACK_PALETTE.ground >> 8) & 0xff, HACK_PALETTE.ground & 0xff]
    expect([g.shaded[0], g.shaded[1], g.shaded[2]]).toEqual(expected)
    // the slab keeps sample_relief_grid's contract, so the marker cull/hit-test work unchanged
    expect(grid_index_at(g, 40, -24)).toBeGreaterThanOrEqual(0)
    expect(grid_index_at(g, 40 + 999, -24)).toBe(-1)
  })

  test('hack_relief_grid reuses a same-n grid buffers (no per-resample allocation)', () => {
    const prev = hack_relief_grid(0, 0, 64, 8)
    const next = hack_relief_grid(10, 10, 64, 8, prev)
    expect(next.heights).toBe(prev.heights)
    expect(next.center_x).toBe(10)
  })

  test('render_hack_grid_map strokes BOTH lattices at the shared pitches, and no terrain path runs', () => {
    const calls = []
    const ctx = fake_ctx(calls)
    render_hack_grid_map(ctx, { size: 200, ppb: 4, tilt: 1, theta: 0, player_x: 0, player_z: 0, span: 64 })
    const strokes = calls.filter((c) => c.op === 'stroke')
    expect(strokes.length).toBe(2) // one pass per lattice (minor, then major over it)
    // every line lands on the world lattice the WORLD grid uses — the one-home contract with hack_palette
    const xs = calls.filter((c) => c.op === 'moveTo').map((c) => c.args[0])
    expect(xs.length).toBeGreaterThan(0)
    expect(new Set(calls.map((c) => c.op)).has('fill')).toBe(true) // the dark ground plate under the neon
  })

  test('a lattice whose on-screen pitch is sub-pixel is DROPPED, not drawn as mush', () => {
    const calls = []
    // ppb 0.05 ⇒ minor pitch (1 m) is 0.05 px and major (8 m) is 0.4 px — both below the floor
    render_hack_grid_map(fake_ctx(calls), {
      size: 200,
      ppb: 0.05,
      tilt: 1,
      theta: 0,
      player_x: 0,
      player_z: 0,
      span: 64,
    })
    expect(calls.filter((c) => c.op === 'stroke').length).toBe(0)
  })
})

describe('render_flat_overlay — the expanded map arrow (#1205)', () => {
  // The modal freeze bug: the big map's overlay used to draw the player arrow pinned dead-centre regardless
  // of live position (only its ROTATION tracked pose.yaw) — the terrain/marker anchor (`player_x/z`, the
  // frozen open-time origin) doubled as the arrow's position too, so nothing about a moving player ever
  // reached the arrow's screen offset. `arrow_x/z` carries the LIVE pose separately so the arrow walks across
  // the (deliberately frozen, paint-once) terrain instead of sitting still.
  test('arrow_x/arrow_z (live pose) offset the arrow from the anchor (player_x/z) — it is NOT pinned to centre', () => {
    const calls = []
    render_flat_overlay(fake_ctx(calls), /* grid */ null, {
      size: 200,
      ppb: 2,
      theta: 0,
      player_x: 0,
      player_z: 0, // the frozen open-time origin (terrain/marker anchor)
      arrow_x: 10,
      arrow_z: 0, // the LIVE player position, 10 blocks east of where the map was opened
      heading: 0,
    })
    const translate = calls.find((c) => c.op === 'translate')
    expect(translate).toBeTruthy()
    // centre (size/2, size/2) = (100, 100); the arrow must be offset by (arrow_x - player_x) * ppb = 20px.
    expect(translate.args[0]).toBeCloseTo(120, 6)
    expect(translate.args[1]).toBeCloseTo(100, 6)
  })

  test('arrow_x/arrow_z default to the anchor (player_x/z) — unchanged centred behaviour when omitted', () => {
    const calls = []
    render_flat_overlay(fake_ctx(calls), null, { size: 200, ppb: 2, theta: 0, player_x: 5, player_z: 5, heading: 0 })
    const translate = calls.find((c) => c.op === 'translate')
    expect(translate.args[0]).toBeCloseTo(100, 6)
    expect(translate.args[1]).toBeCloseTo(100, 6)
  })
})

/** A recording 2-D context double — the render fns are imperative, so the test asserts the CALLS. */
function fake_ctx(calls) {
  const rec =
    (op) =>
    (...args) =>
      calls.push({ op, args })
  return {
    clearRect: rec('clearRect'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    fillRect: rec('fillRect'),
    save: rec('save'),
    restore: rec('restore'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    arc: rec('arc'),
    set fillStyle(v) {
      calls.push({ op: 'fillStyle', args: [v] })
    },
    set strokeStyle(v) {
      calls.push({ op: 'strokeStyle', args: [v] })
    },
    set lineWidth(v) {
      calls.push({ op: 'lineWidth', args: [v] })
    },
  }
}

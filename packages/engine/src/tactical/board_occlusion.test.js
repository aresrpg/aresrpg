// D167-B (2026-07-05) — feathered occlusion mask (pure host mirror) + centroid + seating quantization.
//
// The TSL node fn can't run under bun (no WebGPU), so we pin its RAMP against the pure JS mirror
// `occlusion_fade_value` (same pattern terrain_tint uses with straw_tip_ratio) — the shader and the
// host share the exact math, so a green pixel-lens verification in the browser plus these ramp locks
// keep the two from drifting. Also locks the centroid (asymmetric masks) + the terrain-follow seating
// quantization (subtle steps, clamped relief, flat when unsampled).

import { test, expect, describe } from 'bun:test'

import { occlusion_fade_value } from './board_occlusion.js'
import {
  mask_centroid,
  compute_cell_heights,
  GROUND_STEP,
  GROUND_MAX_RELIEF,
  CELL_OBSTACLE,
  CELL_HOLE,
  mask_index,
} from './board.js'

// ── OCCLUSION FADE (screen-space) ────────────────────────────────────────────────────────────────
describe('occlusion_fade_value — the feathered screen-space mask ramp', () => {
  // The board projects to a screen AABB centred at NDC (0,0) with half-extent 0.35; its centre is 40 m
  // in front of the eye. fade: 1 = visible, 0 = dissolved. Fragments are given in the shader frame
  // (NDC + view distance).
  const center_ndc = /** @type {[number,number]} */ ([0, 0])
  const half_ndc = /** @type {[number,number]} */ ([0.35, 0.3])
  const view_dist = 40

  test('inert when no board is mounted (active=false → always fully visible)', () => {
    expect(
      occlusion_fade_value({ frag_ndc: [0, 0], frag_dist: 15, center_ndc, half_ndc, view_dist, active: false })
    ).toBe(1)
  })

  test('a fragment OVER the arena screen-rect and IN FRONT of the board dissolves (fade ≈ 0)', () => {
    // dead centre of the board on screen, well nearer than the board → melts.
    expect(occlusion_fade_value({ frag_ndc: [0, 0], frag_dist: 15, center_ndc, half_ndc, view_dist })).toBeLessThan(
      0.05
    )
  })

  test('a tree over the arena CORNER (edge of the screen rect) still dissolves — screen-space catches it', () => {
    // near a rect corner but inside it, in front → the world-space centroid cone missed these; screen
    // overlap does not. (0.3,0.25) is inside the 0.35×0.30 rect.
    expect(
      occlusion_fade_value({ frag_ndc: [0.3, 0.25], frag_dist: 12, center_ndc, half_ndc, view_dist })
    ).toBeLessThan(0.1)
  })

  test('a fragment OFF the arena screen-rect stays fully visible (world beside the board untouched)', () => {
    expect(
      occlusion_fade_value({ frag_ndc: [0.9, 0.1], frag_dist: 12, center_ndc, half_ndc, view_dist })
    ).toBeGreaterThan(0.99)
  })

  test('a fragment over the rect but BEHIND the board is not dissolved (arena + world behind stay)', () => {
    expect(occlusion_fade_value({ frag_ndc: [0, 0], frag_dist: 55, center_ndc, half_ndc, view_dist })).toBeGreaterThan(
      0.9
    )
  })

  test('FEATHER: the screen edge is soft — a band of partial fade between full-hide and full-show', () => {
    // sweep across the rect's right edge (x from inside to outside) at a nearer depth; must pass through
    // intermediate fade values — the "never a hard clip" law.
    let partials = 0
    for (let x = 0.2; x <= 0.7; x += 0.01) {
      const f = occlusion_fade_value({ frag_ndc: [x, 0], frag_dist: 12, center_ndc, half_ndc, view_dist })
      if (f > 0.02 && f < 0.98) partials += 1
    }
    expect(partials).toBeGreaterThan(3) // a soft NDC-wide rim, not a one-sample cliff
  })
})

// ── [WORLD FOOTPRINT CLEAR] depth-INDEPENDENT AABB clear (the world board "carve") ─────────────────────
describe('occlusion_fade_value — the world footprint clear (terrain/grass poking through a world board)', () => {
  // A world board seated FLAT at floor_y=80, footprint AABB centred at world XZ (100, 200), half 12×14 (+margin).
  // The peephole here is OFF-screen/behind (center far away) so we isolate the footprint term.
  const off = {
    center_ndc: /** @type {[number,number]} */ ([5, 5]),
    half_ndc: /** @type {[number,number]} */ ([0.3, 0.3]),
    view_dist: 40,
  }
  const clear_center = /** @type {[number,number]} */ ([100, 200])
  const clear_half = /** @type {[number,number]} */ ([12, 14])
  const floor_y = 80

  test('a voxel poking up INSIDE the footprint clears at the BOARD DEPTH — the peephole (depth-gated) misses it', () => {
    // frag AT the board depth (frag_dist == view_dist ⇒ in_front ≈ 0 ⇒ the peephole leaves it visible), but it
    // sits inside the AABB and above the board plane → the depth-INDEPENDENT clear dissolves it (fade ≈ 0).
    const fade = occlusion_fade_value({
      frag_ndc: [5, 5],
      frag_dist: 40,
      ...off,
      active: true,
      frag_world: [100, 81, 200],
      floor_y,
      clear_center,
      clear_half,
      clear_active: true,
    })
    expect(fade).toBeLessThan(0.02)
  })

  test('cave regression: clear_active=false leaves the SAME fragment fully visible (dungeon boards unchanged)', () => {
    const fade = occlusion_fade_value({
      frag_ndc: [5, 5],
      frag_dist: 40,
      ...off,
      active: true,
      frag_world: [100, 81, 200],
      floor_y,
      clear_center,
      clear_half,
      clear_active: false,
    })
    expect(fade).toBeGreaterThan(0.99) // no board term reaches this fragment → world renders untouched
  })

  test('the ground plane is immune: a fragment AT/below the board floor inside the AABB is never cleared', () => {
    const fade = occlusion_fade_value({
      frag_ndc: [5, 5],
      frag_dist: 40,
      ...off,
      active: true,
      frag_world: [100, floor_y - 0.2, 200],
      floor_y,
      clear_center,
      clear_half,
      clear_active: true,
    })
    expect(fade).toBeGreaterThan(0.99) // below the tile line → the ground the board rests on stays solid
  })

  test('a fragment OUTSIDE the footprint AABB is untouched (the world beside the board renders)', () => {
    const fade = occlusion_fade_value({
      frag_ndc: [5, 5],
      frag_dist: 40,
      ...off,
      active: true,
      frag_world: [100 + 20, 90, 200],
      floor_y,
      clear_center,
      clear_half,
      clear_active: true, // 20 m east, well past half 12+feather
    })
    expect(fade).toBeGreaterThan(0.99)
  })

  test('FEATHER: the AABB rim is soft — a world-metre band of partial fade, never a hard clip line', () => {
    // sweep X across the east edge (well above the plane so the vertical gate is saturated); must pass partials.
    let partials = 0
    for (let x = 100 + 10; x <= 100 + 14; x += 0.1) {
      const f = occlusion_fade_value({
        frag_ndc: [5, 5],
        frag_dist: 40,
        ...off,
        active: true,
        frag_world: [x, 90, 200],
        floor_y,
        clear_center,
        clear_half,
        clear_active: true,
      })
      if (f > 0.02 && f < 0.98) partials += 1
    }
    expect(partials).toBeGreaterThan(3)
  })
})

// ── CENTROID ──────────────────────────────────────────────────────────────────────────────────────
describe('mask_centroid — center of mass of walkable + obstacle cells (irregular masks)', () => {
  test('a symmetric full rectangle centroids at the bbox center', () => {
    const w = 5
    const h = 3
    const mask = new Uint8Array(w * h) // all floor
    const { cx, cy } = mask_centroid(mask, w, h)
    expect(cx).toBeCloseTo(2, 6) // (0+1+2+3+4)/5
    expect(cy).toBeCloseTo(1, 6)
  })

  test('an ASYMMETRIC L-shape centroid ≠ bbox center (proves it tracks the tiles, not the box)', () => {
    // 4×4 grid; carve the top-right 2×2 block into holes → an L. bbox center = (1.5,1.5); the mass sits
    // toward the bottom-left, so the centroid must be strictly less than 1.5 on at least one axis.
    const w = 4
    const h = 4
    const mask = new Uint8Array(w * h)
    for (const [x, y] of [
      [2, 0],
      [3, 0],
      [2, 1],
      [3, 1],
    ])
      mask[mask_index(x, y, w)] = CELL_HOLE
    const { cx, cy } = mask_centroid(mask, w, h)
    const bbox_cx = (w - 1) / 2 // 1.5
    const bbox_cy = (h - 1) / 2 // 1.5
    expect(cx < bbox_cx || cy > bbox_cy).toBe(true) // shifted off the bbox center by the missing corner
    expect(cx).toBeLessThan(bbox_cx) // mass pulled left (right column half-missing)
  })

  test('obstacle cells COUNT toward the centroid (they are occupied surface, not void)', () => {
    // one lone obstacle far from a floor cluster shifts the centroid toward it vs floors alone.
    const w = 6
    const h = 1
    const floors_only = new Uint8Array(w * h)
    const with_obstacle = new Uint8Array(w * h)
    with_obstacle[mask_index(5, 0, w)] = CELL_OBSTACLE // same cell either way is counted → identical here
    // Instead compare: holes at the right vs obstacles at the right.
    const holes_right = new Uint8Array(w * h)
    holes_right[mask_index(5, 0, w)] = CELL_HOLE
    expect(mask_centroid(with_obstacle, w, h).cx).toBeCloseTo(mask_centroid(floors_only, w, h).cx, 6)
    // a hole at 5 REMOVES that cell from the mass → centroid shifts left of the all-included case.
    expect(mask_centroid(holes_right, w, h).cx).toBeLessThan(mask_centroid(with_obstacle, w, h).cx)
  })
})

// ── SEATING QUANTIZATION ────────────────────────────────────────────────────────────────────────────
describe('compute_cell_heights — terrain-follow relief, quantized + clamped', () => {
  const w = 4
  const h = 4

  test('no sampler → every cell flat (relief 0) — grounding is purely additive', () => {
    const relief = compute_cell_heights(undefined, w, h)
    expect(relief.length).toBe(w * h)
    expect([...relief].every((r) => r === 0)).toBe(true)
  })

  test('all-null sampler (open sky / unstreamed) → flat', () => {
    const relief = compute_cell_heights(() => null, w, h)
    expect([...relief].every((r) => r === 0)).toBe(true)
  })

  test('relief is QUANTIZED to GROUND_STEP multiples', () => {
    // a smooth slope 100.0 … 100.0+2.4 across the board → every relief lands on a GROUND_STEP grid.
    const relief = compute_cell_heights((x, y) => 100 + (x + y) * 0.37, w, h)
    for (const r of relief) {
      const q = Math.round(r / GROUND_STEP) * GROUND_STEP
      expect(Math.abs(r - q)).toBeLessThan(1e-6)
    }
  })

  test('relief is CLAMPED to ±GROUND_MAX_RELIEF (a steep site never becomes a hillside)', () => {
    // a violent ramp far exceeding the band → every offset stays inside the clamp.
    const relief = compute_cell_heights((x, y) => 100 + (x + y) * 50, w, h)
    for (const r of relief) {
      expect(r).toBeGreaterThanOrEqual(-GROUND_MAX_RELIEF)
      expect(r).toBeLessThanOrEqual(GROUND_MAX_RELIEF)
    }
    // and the ramp actually USES the extremes (top-left low, bottom-right high) — it's not flattened.
    expect(relief[mask_index(0, 0, w)]).toBeLessThan(relief[mask_index(w - 1, h - 1, w)])
  })

  test('a flat terrain patch → flat board (median base cancels the constant)', () => {
    const relief = compute_cell_heights(() => 137, w, h)
    expect([...relief].every((r) => r === 0)).toBe(true)
  })

  test('a single gentle step in the terrain shows up as a subtle relief step, readable', () => {
    // left half at y=100, right half at y=101 → a 1-block step, exactly one GROUND_STEP of relief spread.
    const relief = compute_cell_heights((x) => (x < 2 ? 100 : 101), w, h)
    const lo = relief[mask_index(0, 0, w)]
    const hi = relief[mask_index(3, 0, w)]
    expect(hi - lo).toBeCloseTo(GROUND_STEP, 6) // exactly one readable tier, not a smear
  })
})

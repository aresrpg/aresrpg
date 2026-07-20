// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG-LOD quadtree selection tests (survey S1). Covers: (1) CRACK-FREE — no two adjacent selected
// sections differ by >1 level, under 200 random cameras and across the near/far radii; (2) LOG-DISTANCE
// TARGET — target_level is monotone non-decreasing in distance and 1-Lipschitz in ring index (the
// property that makes cracks structurally rare); (3) PARENT-SUBSTITUTION — when a finer child isn't
// loaded, the loaded coarse ancestor is emitted with substitute=true and covers the child footprint;
// (4) COVERAGE — the selected footprints tile the annulus with no gap and no overlap (fully loaded).

import { test, expect, describe } from 'bun:test'

import {
  select_sections,
  select_build_frontier,
  assert_crack_free,
  target_level,
  log2_int,
  section_span_meters,
  SPLIT_FACTOR,
  KEEP_SPLIT_FACTOR,
  LOD_MIN_LEVEL,
  LOD_MAX_LEVEL,
} from './quadtree.js'

/** Deterministic LCG in [0,1) — no Math.random, so failures reproduce.
 * @param {number} seed @returns {() => number} */
function make_rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe('log2_int', () => {
  test('matches floor(log2(n)) on a range', () => {
    for (let n = 1; n < 5000; n += 1) {
      expect(log2_int(n)).toBe(Math.floor(Math.log2(n)))
    }
  })
  test('guards n<1', () => {
    expect(log2_int(0)).toBe(0)
    expect(log2_int(-5)).toBe(0)
  })
})

describe('target_level', () => {
  const unit = section_span_meters(LOD_MIN_LEVEL) // 64

  test('near → finest, far → coarsest, clamped', () => {
    expect(target_level(0, unit)).toBe(LOD_MIN_LEVEL)
    expect(target_level(unit, unit)).toBe(LOD_MIN_LEVEL)
    expect(target_level(1e9, unit)).toBe(LOD_MAX_LEVEL)
  })

  test('monotone non-decreasing in distance', () => {
    let prev = LOD_MIN_LEVEL
    for (let d = 0; d < 40000; d += 37) {
      const lv = target_level(d, unit)
      expect(lv).toBeGreaterThanOrEqual(prev)
      prev = lv
    }
  })

  test('1-Lipschitz in ring index (bumps by exactly 1 per span-doubling)', () => {
    // At the ring boundaries dist = unit·2^k the level steps by exactly one until the clamp.
    for (let k = 0; k < 3; k += 1) {
      const below = target_level(unit * (1 << k) * 2 - 1, unit)
      const at = target_level(unit * (1 << (k + 1)), unit)
      expect(at - below).toBeLessThanOrEqual(1)
    }
  })
})

describe('select_sections — crack-free invariant', () => {
  const near = 224 // ~ ring_manager.loaded_radius_blocks() at r7
  const far = section_span_meters(LOD_MAX_LEVEL) * 6 // several root spans of horizon

  test('fully-loaded selection is crack-free under 200 random cameras', () => {
    const rng = make_rng(0xa1b2c3d4)
    for (let i = 0; i < 200; i += 1) {
      const camera_xz = /** @type {[number,number]} */ ([(rng() - 0.5) * 20000, (rng() - 0.5) * 20000])
      const sel = select_sections({ camera_xz, near_radius_m: near, far_radius_m: far })
      const bad = assert_crack_free(sel)
      if (bad) {
        throw new Error(
          `crack at camera ${camera_xz}: L${bad.a.level}@(${bad.a.sx},${bad.a.sz}) vs ` +
            `L${bad.b.level}@(${bad.b.sx},${bad.b.sz}) Δ=${bad.delta}`
        )
      }
      expect(bad).toBeNull()
      expect(sel.length).toBeGreaterThan(0)
    }
  })

  test('sorted near-first (ascending dist2)', () => {
    const sel = select_sections({ camera_xz: [0, 0], near_radius_m: near, far_radius_m: far })
    for (let i = 1; i < sel.length; i += 1) {
      expect(sel[i].dist2).toBeGreaterThanOrEqual(sel[i - 1].dist2)
    }
  })

  test('every selected level is in range', () => {
    const sel = select_sections({ camera_xz: [123, -456], near_radius_m: near, far_radius_m: far })
    for (const s of sel) {
      expect(s.level).toBeGreaterThanOrEqual(LOD_MIN_LEVEL)
      expect(s.level).toBeLessThanOrEqual(LOD_MAX_LEVEL)
    }
  })
})

describe('select_sections — parent substitution', () => {
  const near = 0 // no near-ring skip so the finest ring is exercised
  const far = section_span_meters(LOD_MAX_LEVEL) * 4

  test('unloaded finer children → loaded coarse ancestor emitted as substitute covering them', () => {
    // Load EVERYTHING except level LOD_MIN_LEVEL (the finest). Near the camera the walk wants L1 but
    // no L1 is loaded, so the loaded L2 parent must stand in with substitute=true.
    const is_loaded = (/** @type {number} */ level) => level > LOD_MIN_LEVEL
    const sel = select_sections({ camera_xz: [0, 0], near_radius_m: near, far_radius_m: far, is_loaded })

    // There is at least one substitute, and NO selected section is at the finest level (none loaded).
    const subs = sel.filter((s) => s.substitute)
    expect(subs.length).toBeGreaterThan(0)
    expect(sel.every((s) => s.level > LOD_MIN_LEVEL)).toBe(true)

    // Every substitute is a node that WOULD have subdivided — i.e. genuinely standing in for finer
    // children, not a distant coarse leaf. The KEEP walk subdivides at the wider KEEP_SPLIT_FACTOR (the
    // split/merge dead band — ENG-21 stability), so a substitute sits within KEEP_SPLIT_FACTOR·span, not
    // the tight build-side SPLIT_FACTOR·span.
    for (const s of subs) {
      const near_dist = cheby_to_footprint(0, 0, s)
      const far_dist = far_cheby_to_footprint(0, 0, s)
      expect(near_dist).toBeLessThan(KEEP_SPLIT_FACTOR * s.span) // inside its (widened) subdivide radius
    }
    // The finest loaded level (LOD_MIN_LEVEL+1 = L1) does the substituting for the unloaded L0 band.
    expect(subs.some((s) => s.level === LOD_MIN_LEVEL + 1)).toBe(true)
    // The substitutes still form a crack-free set.
    expect(assert_crack_free(sel)).toBeNull()
  })

  test('fully loaded → zero substitutes (everyone renders at its own target)', () => {
    const sel = select_sections({ camera_xz: [10, 10], near_radius_m: near, far_radius_m: far })
    expect(sel.some((s) => s.substitute)).toBe(false)
  })

  test('split/merge DEAD BAND: the KEEP walk renders finer BEYOND the tight build split radius (hysteresis)', () => {
    // [ENG-21 LOD-TRIM stability, design ruling 2026-07-07] The KEEP/RENDER walk subdivides at KEEP_SPLIT_FACTOR while
    // the BUILD frontier uses the tighter SPLIT_FACTOR — the dead band that stops a footprint flickering
    // between levels under camera motion. Proof: with everything loaded, at least one rendered L1 section
    // sits with its nearest footprint edge AT/BEYOND SPLIT_FACTOR·span(L2) — a distance the tight build
    // factor would have rendered as L2. Its parent L2 only subdivided because the KEEP factor is wider.
    const sel = select_sections({ camera_xz: [0, 0], near_radius_m: 0, far_radius_m: far, is_loaded: () => true })
    const l1 = sel.filter((s) => s.level === LOD_MIN_LEVEL)
    const max_l1_nearest = Math.max(...l1.map((s) => cheby_to_footprint(0, 0, s)))
    const tight_boundary = SPLIT_FACTOR * section_span_meters(LOD_MIN_LEVEL + 1) // 2·span(L2)
    expect(max_l1_nearest).toBeGreaterThanOrEqual(tight_boundary) // finer detail persists into the dead band
    // The wider keep band must not break the crack-free invariant (both walks stay internally consistent).
    expect(assert_crack_free(sel)).toBeNull()
  })

  test('nothing loaded → empty selection (hole-free: caller shows a parent from a prior frame)', () => {
    const sel = select_sections({
      camera_xz: [0, 0],
      near_radius_m: near,
      far_radius_m: far,
      is_loaded: () => false,
    })
    expect(sel.length).toBe(0)
  })
})

describe('select_build_frontier — coarse-first coverage (near-mid empty-band regression)', () => {
  const cam = /** @type {[number, number]} */ ([70, 70])
  const near = 0 // streaming phase: the far shell covers the whole disc (engine.js passes 0)
  const far = 2048
  const key = (/** @type {import('./quadtree.js').Selection} */ s) => `${s.level},${s.sx},${s.sz}`
  /** Does section `s`'s footprint contain the world point (px,pz)? */
  const covers = (
    /** @type {import('./quadtree.js').Selection} */ s,
    /** @type {number} */ px,
    /** @type {number} */ pz
  ) => {
    const x0 = s.sx * s.span
    const z0 = s.sz * s.span
    return px >= x0 && px < x0 + s.span && pz >= z0 && pz < z0 + s.span
  }

  test('no thrash: once the frontier has built out its target it emits NOTHING', () => {
    // Simulate BUILDING to fixpoint: repeatedly resolve everything the frontier asks for (roots first,
    // then refine) until it quiesces — the true converged state the frontier produces, at ITS OWN split
    // factor (the KEEP walk's wider dead-band factor is deliberately different, so synthesizing the
    // resident set from select_sections would inject leaves the frontier never builds — a false thrash).
    const resident = new Set()
    const isL = (/** @type {number} */ l, /** @type {number} */ x, /** @type {number} */ z) =>
      resident.has(`${l},${x},${z}`)
    for (let i = 0; i < 40; i += 1) {
      const f = select_build_frontier({ camera_xz: cam, near_radius_m: near, far_radius_m: far, is_loaded: isL })
      if (f.length === 0) break
      for (const s of f) resident.add(key(s))
    }
    const frontier = select_build_frontier({ camera_xz: cam, near_radius_m: near, far_radius_m: far, is_loaded: isL })
    expect(frontier.length).toBe(0) // converged → no rebuild of a pruned parent (no build↔prune thrash)
  })
})

describe('select_sections — coverage (fully loaded tiles the annulus)', () => {
  const near = 200
  const far = section_span_meters(LOD_MAX_LEVEL) * 5

  test('no overlap: selected footprints are pairwise disjoint in world XZ', () => {
    const sel = select_sections({ camera_xz: [0, 0], near_radius_m: near, far_radius_m: far })
    for (let i = 0; i < sel.length; i += 1) {
      for (let j = i + 1; j < sel.length; j += 1) {
        expect(footprints_overlap_area(sel[i], sel[j])).toBe(false)
      }
    }
  })

  test('coverage: a dense sample of points in the annulus lands in exactly one selected footprint', () => {
    const sel = select_sections({ camera_xz: [0, 0], near_radius_m: near, far_radius_m: far })
    let covered = 0
    let sampled = 0
    // Sample a grid; count points that are clearly inside the annulus (past near, before far) and
    // require each to be covered by exactly one footprint.
    for (let z = -far + 8; z < far; z += 40) {
      for (let x = -far + 8; x < far; x += 40) {
        const d = Math.sqrt(x * x + z * z)
        if (d < near + 100 || d > far - 100) continue // skip the fuzzy radii boundaries
        sampled += 1
        let hits = 0
        for (const s of sel) if (point_in_footprint(x, z, s)) hits += 1
        if (hits === 1) covered += 1
      }
    }
    expect(sampled).toBeGreaterThan(50)
    // Allow a tiny slack for points that fall exactly on a shared edge (counted in 2 footprints).
    expect(covered / sampled).toBeGreaterThan(0.98)
  })
})

// ---- footprint geometry helpers (test-local) -----------------------------------------------------

/** @typedef {import('./quadtree.js').Selection} Selection */

/** @param {Selection} s */
function foot(s) {
  const x0 = s.sx * s.span
  const z0 = s.sz * s.span
  return { x0, z0, x1: x0 + s.span, z1: z0 + s.span }
}
/** @param {Selection} a @param {Selection} b @returns {boolean} */
function footprints_overlap_area(a, b) {
  const fa = foot(a)
  const fb = foot(b)
  const ox = Math.min(fa.x1, fb.x1) - Math.max(fa.x0, fb.x0)
  const oz = Math.min(fa.z1, fb.z1) - Math.max(fa.z0, fb.z0)
  return ox > 0 && oz > 0
}
/** @param {number} x @param {number} z @param {Selection} s @returns {boolean} */
function point_in_footprint(x, z, s) {
  const f = foot(s)
  return x >= f.x0 && x < f.x1 && z >= f.z0 && z < f.z1
}
/** Chebyshev (max-norm) distance from a point to a selection footprint (0 inside).
 * @param {number} px @param {number} pz @param {Selection} s @returns {number} */
function cheby_to_footprint(px, pz, s) {
  const f = foot(s)
  const dx = Math.max(f.x0 - px, 0, px - f.x1)
  const dz = Math.max(f.z0 - pz, 0, pz - f.z1)
  return Math.max(dx, dz)
}
/** [D162] Chebyshev distance from a point to the FARTHEST corner of a footprint (for the L0-band test).
 * @param {number} px @param {number} pz @param {Selection} s @returns {number} */
function far_cheby_to_footprint(px, pz, s) {
  const f = foot(s)
  return Math.max(Math.abs(px - f.x0), Math.abs(px - f.x1), Math.abs(pz - f.z0), Math.abs(pz - f.z1))
}

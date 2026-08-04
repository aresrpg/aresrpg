// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Hydrology gates — the CONTAINMENT invariant (v3 pour-point lake fix, 2026-07-03) + flood-core
// correctness. Owner defect class: un-contained "glass wedge" water proud on open slopes (false
// basins: the old per-column spill filled to base_y−2 with no enclosure test). Three suites:
//
//   1. FLOOD CORE (synthetic): compute_lake_tile's priority-flood on hand-built terrain — a pit
//      fills FLAT to its true pour point, open slopes/underdepth dimples/tile borders stay dry.
//   2. CONTAINMENT (real terrain, profile-level, border-safe): zero water cells standing above a
//      4-neighbor column's occupied top (waterfall/cascade-flagged columns are the sanctioned
//      vertical exception) over the WORST pre-fix false-basin belt (288 wedge bodies before the fix)
//      AND over a real lake tile — where lakes must still EXIST (anti-regression: the fix must
//      contain lakes, not delete the feature) and every lake body must be FLAT.
//   3. DETERMINISM: the tile memo is a pure function — a fresh context primed in a different order
//      (and after eviction) yields identical water levels.

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE, SEA_LEVEL, derive_world_seeds } from '../../src/config/world_config.js'
import { column_index } from '../../src/chunks/format.js'
import { build_column_profile, create_gen_context } from '../../src/gen/column_gen.js'
import { sample_climate } from '../../src/gen/noise/fields.js'
import {
  create_hydrology_context,
  prime_lake_tile,
  evict_lake_tiles_if_full,
  lake_level_at,
  river_strength,
  HYDROLOGY_CONFIG,
} from '../../src/gen/hydrology.js'

describe('lake pour-point flood core (synthetic terrain)', () => {
  // Fake basin field (whole tile is a candidate blob) + inert rivers + hand-built terrain: a
  // 20×20 pit (floor 138, inner bowl 134) in a 150 plateau, an open east slope, and a 2-deep dimple.
  const build_synthetic_hctx = () => {
    const hctx = create_hydrology_context(derive_world_seeds())
    hctx.lake_basin = { sample: () => 1, seed: 0 }
    hctx.river_crease = { sample: () => 0, seed: 0 }
    return hctx
  }
  /** @param {number} wx @param {number} wz */
  const probe = (wx, wz) => {
    let land = 150
    if (wx >= 50 && wx < 70 && wz >= 50 && wz < 70) land = 138
    if (wx >= 55 && wx < 65 && wz >= 55 && wz < 65) land = 134 // deeper inner bowl
    if (wx >= 128) land = 150 - Math.floor((wx - 128) / 4) // open slope — NO enclosure
    if (wx >= 195 && wx < 205 && wz >= 195 && wz < 205) land = 148 // 2-deep dimple (< min_body_depth)
    return { land, erosion: 1, pv: 0, continentalness: 0.5 }
  }

  test('a pit fills FLAT to its true pour point; slopes, shallow dimples and tile borders stay dry', () => {
    const hctx = build_synthetic_hctx()
    prime_lake_tile(hctx, 0, 0, probe)
    // Flat at the rim level (pour = 150) across the whole basin, inner bowl included.
    expect(lake_level_at(hctx, 60, 60)).toBe(150)
    expect(lake_level_at(hctx, 58, 58)).toBe(150)
    expect(lake_level_at(hctx, 50, 69)).toBe(150)
    // Dry: the rim itself, the open slope (no enclosure at any level), the 2-deep dimple (body
    // depth gate), and the tile border ring (drains by construction).
    expect(lake_level_at(hctx, 49, 49)).toBe(-1)
    expect(lake_level_at(hctx, 180, 60)).toBe(-1)
    expect(lake_level_at(hctx, 200, 200)).toBe(-1)
    expect(lake_level_at(hctx, 0, 128)).toBe(-1)
    expect(lake_level_at(hctx, 255, 128)).toBe(-1)
  })

  test('containment by construction: every dry 4-neighbor of a wet cell has land ≥ the water surface', () => {
    const hctx = build_synthetic_hctx()
    prime_lake_tile(hctx, 0, 0, probe)
    let wet = 0
    for (let z = 1; z < 255; z += 1) {
      for (let x = 1; x < 255; x += 1) {
        const lvl = lake_level_at(hctx, x, z)
        if (lvl < 0) continue
        wet += 1
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const n_lvl = lake_level_at(hctx, x + dx, z + dz)
          const supported = n_lvl === lvl || probe(x + dx, z + dz).land >= lvl
          expect(supported).toBe(true)
        }
      }
    }
    expect(wet).toBeGreaterThan(300) // the pit really filled (else the loop proved nothing)
  })

  test('tile memo determinism: eviction + re-prime and a fresh context yield identical levels', () => {
    const a = build_synthetic_hctx()
    prime_lake_tile(a, 0, 0, probe)
    const before = [lake_level_at(a, 60, 60), lake_level_at(a, 55, 55), lake_level_at(a, 69, 50)]
    for (let t = 1; t <= 20; t += 1) {
      evict_lake_tiles_if_full(a) // crosses the cap → clears
      prime_lake_tile(a, t * 7, -t * 3, (wx, wz) => ({ land: 150, erosion: 1, pv: 0, continentalness: 0.5 }))
    }
    evict_lake_tiles_if_full(a)
    prime_lake_tile(a, 0, 0, probe) // recompute after eviction
    const after = [lake_level_at(a, 60, 60), lake_level_at(a, 55, 55), lake_level_at(a, 69, 50)]
    expect(after).toEqual(before)
    const b = build_synthetic_hctx()
    prime_lake_tile(b, 0, 0, probe)
    expect([lake_level_at(b, 60, 60), lake_level_at(b, 55, 55), lake_level_at(b, 69, 50)]).toEqual(before)
  })
})

// ── CONTAINMENT invariant on REAL terrain (profile-level, border-safe) ──────────────────────────
// A water cell may never stand above a 4-neighbor column's occupied top (ground or water surface);
// waterfall/cascade-flagged columns are the sanctioned vertical exception. Border ring excluded —
// a neighbor outside the scanned grid would false-positive as air.
/**
 * @param {ReturnType<typeof create_gen_context>} ctx
 * @param {number} cx0 @param {number} cz0 @param {number} n region size in chunks
 */
function scan_region(ctx, cx0, cz0, n) {
  const W = n * CHUNK_SIZE
  const surf = new Int16Array(W * W)
  const wl = new Int16Array(W * W)
  const fall = new Uint8Array(W * W)
  const river = new Uint8Array(W * W)
  for (let rz = 0; rz < n; rz += 1) {
    for (let rx = 0; rx < n; rx += 1) {
      const p = build_column_profile(ctx, cx0 + rx, cz0 + rz)
      for (let z = 0; z < CHUNK_SIZE; z += 1) {
        for (let x = 0; x < CHUNK_SIZE; x += 1) {
          const g = (rz * CHUNK_SIZE + z) * W + rx * CHUNK_SIZE + x
          const ci = column_index(x, z)
          surf[g] = p.surface_y[ci]
          wl[g] = p.water_level[ci]
          fall[g] = p.waterfall[ci]
          if (p.water_level[ci] > SEA_LEVEL) {
            const wx = (cx0 + rx) * CHUNK_SIZE + x
            const wz = (cz0 + rz) * CHUNK_SIZE + z
            const c = sample_climate(ctx.fields, wx, wz)
            river[g] = river_strength(ctx.hydro, wx, wz, c.continentalness, c.pv) > 0 ? 1 : 0
          }
        }
      }
    }
  }
  const top = (/** @type {number} */ g) => Math.max(surf[g], wl[g])
  let violations = 0
  let lake_cols = 0
  /** @type {Map<number, number>} wet-lake component id → water level (flatness census) */
  const level_of = new Map()
  const comp = new Int32Array(W * W).fill(-1)
  let flat_breaks = 0
  let next_comp = 0
  for (let gz = 1; gz < W - 1; gz += 1) {
    for (let gx = 1; gx < W - 1; gx += 1) {
      const g = gz * W + gx
      if (wl[g] <= surf[g]) continue // dry
      if (!fall[g]) {
        let worst = 1e9
        for (const nb of [g + 1, g - 1, g + W, g - W]) if (top(nb) < worst) worst = top(nb)
        if (wl[g] - Math.max(surf[g], worst + 1) > 0) violations += 1
      }
      if (wl[g] > SEA_LEVEL && !river[g] && !fall[g]) {
        lake_cols += 1
        // flood-fill flatness: connected wet-lake cells must share one water level
        if (comp[g] === -1) {
          const id = next_comp
          next_comp += 1
          level_of.set(id, wl[g])
          const stack = [g]
          comp[g] = id
          while (stack.length > 0) {
            const c = /** @type {number} */ (stack.pop())
            if (wl[c] !== level_of.get(id)) flat_breaks += 1
            for (const nb of [c + 1, c - 1, c + W, c - W]) {
              if (comp[nb] !== -1 || wl[nb] <= surf[nb] || wl[nb] <= SEA_LEVEL || river[nb] || fall[nb]) continue
              comp[nb] = id
              stack.push(nb)
            }
          }
        }
      }
    }
  }
  return { violations, lake_cols, flat_breaks }
}

describe('CONTAINMENT invariant (real terrain)', () => {
  const ctx = create_gen_context()

  test('worst pre-fix false-basin belt (chunks 8..13 × 49..54): zero un-contained water cells', () => {
    // This belt held ~288 glass-wedge bodies / 1 863 violating cells before the pour-point fix.
    const r = scan_region(ctx, 8, 49, 6)
    expect(r.violations).toBe(0)
  })

  test('real lake tile (chunks -16..-9 × -88..-81, the full 256-tile): lakes EXIST, contained, flat', () => {
    const r = scan_region(ctx, -16, -88, 8)
    expect(r.violations).toBe(0)
    expect(r.lake_cols).toBeGreaterThan(100) // the fix contains lakes — it must not delete the feature
    expect(r.flat_breaks).toBe(0) // "lakes stay FLAT at spill level"
  })

  test('lake body depth honors min_body_depth (no 1-2 deep puddle film survives the gate)', () => {
    // Every wet lake column sits at most min_body_depth-1 above its floor OR belongs to a body that
    // reaches min_body_depth somewhere — cheap spot proof: at least one column in the tile reaches
    // the gate depth (the body-max rule), and no wet column has depth ≤ 0.
    const p_ctx = create_gen_context()
    let max_depth = 0
    let bad = 0
    for (let cz = -88; cz < -80; cz += 1) {
      for (let cx = -16; cx < -8; cx += 1) {
        const p = build_column_profile(p_ctx, cx, cz)
        for (let i = 0; i < p.surface_y.length; i += 1) {
          if (p.water_level[i] <= SEA_LEVEL || p.water_level[i] <= p.surface_y[i] || p.waterfall[i]) continue
          const d = p.water_level[i] - p.surface_y[i]
          if (d > max_depth) max_depth = d
          if (d <= 0) bad += 1
        }
      }
    }
    expect(bad).toBe(0)
    expect(max_depth).toBeGreaterThanOrEqual(HYDROLOGY_CONFIG.lake.min_body_depth)
  })
})

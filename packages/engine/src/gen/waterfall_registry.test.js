// Waterfall registry gates (ENGINE_AAA_PLAN.md §4.2 step 1, lane A5). Two suites:
//
//   1. SPAN MERGING (synthetic): hand-built ColumnWindow fixtures prove the merge rules in isolation
//      — adjacent same-face/same-height falls merge into one span, a gap splits a run into two,
//      an isolated column survives as a width-1 span, ties/mismatches never spuriously merge, and
//      both wall orientations (X-normal "z-run" and Z-normal "x-run") produce the right axis ranges.
//   2. REAL-WORLD ORACLE (default world, real hydrology): over a chunk with real waterfall columns,
//      every FallColumn/FallSpan the registry emits must correspond to a column the hydrology pass
//      itself flagged `waterfall === 1` — the registry may never invent or drop a column.

import { test, expect, describe } from 'bun:test'

import { CHUNK_SIZE } from '../config/world_config.js'
import { column_index } from '../chunks/format.js'

import { create_gen_context, build_column_profile } from './column_gen.js'
import {
  resolve_fall_columns,
  merge_fall_spans,
  build_fall_registry,
  column_window_from_profile,
} from './waterfall_registry.js'

/**
 * Builds a synthetic `ColumnWindow` from a plain per-column override map, so tests can express only
 * the columns they care about. Base terrain is flat, dry land (`surface_y=100`, `water_level=50`,
 * `waterfall=0`) everywhere; `overrides` is a sparse `{ "x,z": {surface_y?, water_level?, waterfall?} }`
 * map layered on top. Row-major index = `z*size_x+x` (mirrors chunks/format.js `column_index`).
 * @param {number} size_x @param {number} size_z
 * @param {Record<string, {surface_y?: number, water_level?: number, waterfall?: number}>} overrides
 */
function make_window(size_x, size_z, overrides) {
  const n = size_x * size_z
  const surface_y = new Int16Array(n).fill(100)
  const water_level = new Int16Array(n).fill(50)
  const waterfall = new Uint8Array(n)
  const index = (/** @type {number} */ x, /** @type {number} */ z) => z * size_x + x
  for (const [key, v] of Object.entries(overrides)) {
    const [x, z] = key.split(',').map(Number)
    const i = index(x, z)
    if (v.surface_y !== undefined) surface_y[i] = v.surface_y
    if (v.water_level !== undefined) water_level[i] = v.water_level
    if (v.waterfall !== undefined) waterfall[i] = v.waterfall
  }
  return { origin_x: 0, origin_z: 0, size_x, size_z, index, surface_y, water_level, waterfall }
}

describe('resolve_fall_columns — face resolution', () => {
  test('a higher +X neighbor resolves face 0 (toward +X)', () => {
    const win = make_window(4, 1, {
      '2,0': { waterfall: 1, water_level: 108, surface_y: 95 },
      '3,0': { water_level: 120 }, // upstream plateau, not itself a fall
    })
    const [c] = resolve_fall_columns(win)
    expect(c).toMatchObject({ x: 2, z: 0, face: 0, y_top: 108, y_bot: 95 })
  })

  test('a higher -Z neighbor resolves face 5 (toward -Z)', () => {
    const win = make_window(1, 4, {
      '0,2': { waterfall: 1, water_level: 108, surface_y: 95 },
      '0,1': { water_level: 120 },
    })
    const [c] = resolve_fall_columns(win)
    expect(c.face).toBe(5)
  })

  test('two neighbors tied at the max ⇒ face null (never guesses)', () => {
    const win = make_window(3, 3, {
      '1,1': { waterfall: 1, water_level: 100, surface_y: 90 },
      '2,1': { water_level: 130 }, // +X
      '1,2': { water_level: 130 }, // +Z, same height ⇒ ambiguous
    })
    const [c] = resolve_fall_columns(win)
    expect(c.face).toBe(null)
  })

  test('no neighbor higher than own water_level ⇒ face null', () => {
    const win = make_window(3, 3, { '1,1': { waterfall: 1, water_level: 100, surface_y: 90 } })
    const [c] = resolve_fall_columns(win)
    expect(c.face).toBe(null)
  })

  test('a neighbor outside the window is simply skipped, never treated as higher', () => {
    const win = make_window(1, 1, { '0,0': { waterfall: 1, water_level: 100, surface_y: 90 } })
    const [c] = resolve_fall_columns(win)
    expect(c.face).toBe(null)
  })

  test('y_top/y_bot normalize via max/min when water_level sits BELOW surface_y (flag-only cascade fringe)', () => {
    // Real-world shape (hydrology.js case (b)): water_level can sit below the column's own carved
    // surface_y. top must still be ≥ bottom.
    const win = make_window(1, 1, { '0,0': { waterfall: 1, water_level: 90, surface_y: 100 } })
    const [c] = resolve_fall_columns(win)
    expect(c.y_top).toBe(100)
    expect(c.y_bot).toBe(90)
  })
})

describe('merge_fall_spans — the proof bar', () => {
  test('adjacent falls merge: a contiguous z-run behind one +X wall becomes ONE span', () => {
    const win = make_window(4, 4, {
      '2,0': { waterfall: 1, water_level: 108, surface_y: 95 },
      '2,1': { waterfall: 1, water_level: 108, surface_y: 95 },
      '2,2': { waterfall: 1, water_level: 108, surface_y: 95 },
      '2,3': { waterfall: 1, water_level: 108, surface_y: 95 },
      '3,0': { water_level: 120 },
      '3,1': { water_level: 120 },
      '3,2': { water_level: 120 },
      '3,3': { water_level: 120 },
    })
    const spans = build_fall_registry(win)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ x0: 2, x1: 2, z0: 0, z1: 3, face: 0, width: 4, y_top: 108, y_bot: 95 })
  })

  test('gaps split: a non-waterfall column in the middle breaks one run into two spans', () => {
    const win = make_window(4, 4, {
      '2,0': { waterfall: 1, water_level: 108, surface_y: 95 },
      '2,1': { waterfall: 1, water_level: 108, surface_y: 95 },
      // z=2 stays dry land — the gap
      '2,3': { waterfall: 1, water_level: 108, surface_y: 95 },
      '3,0': { water_level: 120 },
      '3,1': { water_level: 120 },
      '3,2': { water_level: 120 },
      '3,3': { water_level: 120 },
    })
    const spans = build_fall_registry(win)
    expect(spans).toHaveLength(2)
    const widths = spans.map((s) => s.width).sort()
    expect(widths).toEqual([1, 2])
  })

  test('single-column falls survive: an isolated fall with no matching-face neighbor stays width 1', () => {
    const win = make_window(5, 5, { '2,2': { waterfall: 1, water_level: 100, surface_y: 90 } })
    const spans = build_fall_registry(win)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ x0: 2, x1: 2, z0: 2, z1: 2, width: 1, face: null })
  })

  test('an x-run behind one +Z wall (face 4) merges along X with z fixed', () => {
    const win = make_window(4, 4, {
      '0,1': { waterfall: 1, water_level: 108, surface_y: 95 },
      '1,1': { waterfall: 1, water_level: 108, surface_y: 95 },
      '2,1': { waterfall: 1, water_level: 108, surface_y: 95 },
      '0,2': { water_level: 120 },
      '1,2': { water_level: 120 },
      '2,2': { water_level: 120 },
    })
    const spans = build_fall_registry(win)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ x0: 0, x1: 2, z0: 1, z1: 1, face: 4, width: 3 })
  })

  test('same face + adjacent, but different y_top/y_bot ⇒ does NOT merge', () => {
    const win = make_window(4, 1, {
      '2,0': { waterfall: 1, water_level: 108, surface_y: 95 },
    })
    // Build two side-by-side single-row windows differing only in height, merge their column lists
    // directly (bypassing window adjacency) — the function under test is merge_fall_spans itself.
    const a = resolve_fall_columns(win)
    const b = [{ x: 3, z: 0, y_top: 140, y_bot: 130, face: /** @type {const} */ (0) }] // adjacent x, different height
    const spans = merge_fall_spans([...a, ...b])
    expect(spans).toHaveLength(2)
    expect(spans.every((s) => s.width === 1)).toBe(true)
  })

  test('null-face columns never merge even when adjacent and same height', () => {
    const win = make_window(4, 1, {
      '1,0': { waterfall: 1, water_level: 100, surface_y: 90 },
      '2,0': { waterfall: 1, water_level: 100, surface_y: 90 },
    })
    const spans = build_fall_registry(win)
    expect(spans).toHaveLength(2)
    expect(spans.every((s) => s.width === 1 && s.face === null)).toBe(true)
  })
})

// COVERAGE FALLBACK (defect 2026-07-11 — dense cascades read as "stepped glass blocks" because
// ~80-95% of a cascade's flagged columns were the high LIP with no upstream neighbor → face:null →
// no sheet). The fallback resolves a null-by-upstream column toward its steepest DOWNSTREAM drop.
describe('resolve_fall_columns — downstream coverage fallback', () => {
  test('a lip with no higher neighbor resolves toward its lowest downstream neighbor', () => {
    // center is a water lip (110 over ground 100); +X neighbor is a cliff down to 80 — the fall face.
    const win = make_window(3, 3, {
      '1,1': { waterfall: 1, water_level: 110, surface_y: 100 },
      '2,1': { surface_y: 80 }, // downstream cliff toward +X (effective top 80)
    })
    const [c] = resolve_fall_columns(win)
    expect(c.face).toBe(0) // toward +X, the steepest drop — NOT null
  })

  test('picks the STEEPEST of several downstream drops (lowest visible top wins)', () => {
    const win = make_window(3, 3, {
      '1,1': { waterfall: 1, water_level: 120, surface_y: 100 },
      '2,1': { surface_y: 90 }, // +X drop to 90
      '1,2': { surface_y: 70 }, // +Z drop to 70 — steeper
    })
    const [c] = resolve_fall_columns(win)
    expect(c.face).toBe(4) // +Z, the lower top
  })

  test('a flat lip with NO lower neighbor stays null (nothing to hang)', () => {
    // all neighbors sit at/above this column's own visible top ⇒ not a fall in any direction.
    const win = make_window(3, 3, {
      '1,1': { waterfall: 1, water_level: 100, surface_y: 90 },
      '0,1': { surface_y: 105 },
      '2,1': { surface_y: 105 },
      '1,0': { surface_y: 105 },
      '1,2': { surface_y: 105 },
    })
    const [c] = resolve_fall_columns(win)
    expect(c.face).toBe(null)
  })

  test('a resolved UPSTREAM face is never overridden by the fallback', () => {
    // higher +X neighbor (water 130) resolves face 0 upstream; a lower -X drop must not steal it.
    const win = make_window(3, 1, {
      '1,0': { waterfall: 1, water_level: 108, surface_y: 95 },
      '2,0': { water_level: 130 }, // upstream (higher water) at +X ⇒ primary face 0
      '0,0': { surface_y: 60 }, // a deeper drop at -X — must NOT override the upstream face
    })
    const [c] = resolve_fall_columns(win)
    expect(c.face).toBe(0)
  })

  test('adjacent fallback lips sharing a downstream face + height merge into one wide span', () => {
    const win = make_window(4, 4, {
      '1,1': { waterfall: 1, water_level: 110, surface_y: 100 },
      '1,2': { waterfall: 1, water_level: 110, surface_y: 100 },
      '2,1': { surface_y: 80 },
      '2,2': { surface_y: 80 }, // +X cliff for both ⇒ face 0, merges along z
    })
    const spans = build_fall_registry(win)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ x0: 1, x1: 1, z0: 1, z1: 2, face: 0, width: 2, y_top: 110, y_bot: 100 })
  })

  test('coverage floor: the real dense cascade chunk (-11,-24) now resolves a face for ≥80% of columns', () => {
    // Regression guard for the defect: before the fallback this chunk was 42% null (glassy blocks).
    const win = column_window_from_profile(build_column_profile(create_gen_context(), -11, -24), -11, -24)
    const cols = resolve_fall_columns(win)
    const resolved = cols.filter((c) => c.face !== null).length
    expect(resolved / cols.length).toBeGreaterThanOrEqual(0.8)
  })
})

describe('real-world oracle (default world, real hydrology)', () => {
  // Chunk (-11,-24) carries real waterfall columns in the DEFAULT world (found by scanning chunks
  // -24..23 × -24..23 for `profile.waterfall` hits — 3020 columns/70 chunks total; this one alone
  // carries 88). No seed/config threaded ⇒ the default recipe (§3.7).
  const ctx = create_gen_context()
  const CX = -11,
    CZ = -24
  const profile = build_column_profile(ctx, CX, CZ)

  test('the profile itself really carries waterfall columns here (fixture sanity)', () => {
    let hits = 0
    for (let i = 0; i < profile.waterfall.length; i += 1) if (profile.waterfall[i]) hits += 1
    expect(hits).toBeGreaterThan(0)
  })

  test('every FallColumn the registry resolves maps back to a real waterfall===1 cell', () => {
    const win = column_window_from_profile(profile, CX, CZ)
    const columns = resolve_fall_columns(win)
    expect(columns.length).toBeGreaterThan(0)
    for (const c of columns) {
      const lx = c.x - CX * CHUNK_SIZE
      const lz = c.z - CZ * CHUNK_SIZE
      expect(profile.waterfall[column_index(lx, lz)]).toBe(1)
    }
    // Exact count match: resolve_fall_columns must neither drop nor invent a column.
    let hits = 0
    for (let i = 0; i < profile.waterfall.length; i += 1) if (profile.waterfall[i]) hits += 1
    expect(columns.length).toBe(hits)
  })

  test('every FallSpan is FULLY covered by real waterfall===1 columns (not just its endpoints)', () => {
    const win = column_window_from_profile(profile, CX, CZ)
    const spans = build_fall_registry(win)
    expect(spans.length).toBeGreaterThan(0)
    for (const s of spans) {
      for (let x = s.x0; x <= s.x1; x += 1) {
        for (let z = s.z0; z <= s.z1; z += 1) {
          const lx = x - CX * CHUNK_SIZE
          const lz = z - CZ * CHUNK_SIZE
          expect(profile.waterfall[column_index(lx, lz)]).toBe(1)
        }
      }
    }
  })

  test('determinism: rebuilding the profile from a fresh context yields an identical registry', () => {
    const ctx2 = create_gen_context()
    const profile2 = build_column_profile(ctx2, CX, CZ)
    const spans1 = build_fall_registry(column_window_from_profile(profile, CX, CZ))
    const spans2 = build_fall_registry(column_window_from_profile(profile2, CX, CZ))
    expect(spans2).toEqual(spans1)
  })
})

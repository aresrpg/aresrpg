// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Waterfall fall registry (ENGINE_AAA_PLAN.md §4.2 step 1, lane A5) — PURE gen-side detection only.
// Turns the hydrology pass's per-column `is_waterfall` flag into FALL SPANS: runs of adjacent
// waterfall columns sharing a fall face, merged so a later render wave (B4, `render/waterfall_sheet.js`)
// can drop one wide sheet quad-strip instead of one per column. Data only — no rendering, no
// materials; this file never imports mesh/ or render/.
//
// SOURCE FIELDS (hydrology.js `hydrology_column` §4.4, surfaced per-column by column_gen.js
// `build_column_profile` → `ColumnProfile`, index = column_index):
//   `waterfall` (Uint8Array) — 1 where the column spills water down a face (a fall/cascade), else 0
//     (hydrology.js:421-448 sets `is_waterfall`: case (a) an uphill river neighbor overflows onto
//     this column and RAISES `water_level` to the (capped) spill height; case (b) THIS column is a
//     river standing ≥ cascade_drop above a neighbor's top — flag-only, never raises `water_level`).
//   `water_level` (Int16Array) — per-column water surface world-y (column_gen.js:274-275).
//   `surface_y` (Int16Array) — effective land surface world-y after the hydrology carve
//     (column_gen.js:267-269) — the ground a fall lands on.
// HYDROLOGY_CONFIG.waterfall (hydrology.js:62-68): `min_drop:6` (uphill-spill gate), `fall_max:28`
// (sheet height cap), `cascade_drop:2` (flag-only lip gate) — cited here for provenance only; this
// module reads the boolean/heights it already produced, never re-derives them.
//
// FACE CONVENTION: mirrors mesh/mesher.js's axis-aligned QuadFace ids (kept as a bare numeric
// constant here, NOT imported — this file stays render/mesh-free): axis = face>>1, sign = face%2===0
// ? +1 : -1 → 0 = +X, 1 = -X, 4 = +Z, 5 = -Z (2/3 = ±Y are never used — a fall wall is always
// vertical, i.e. its normal is horizontal). `face` on a fall column/span is the sheet-mount direction:
// TOWARD the higher (upstream) neighbor when one resolves; else (coverage fallback in resolve_fall_
// columns) TOWARD the lowest downstream neighbor — the fall face the water pours over. `null` only for
// a flat lip with no lower in-window neighbor (nothing to hang). The fallback trades a small
// orientation-guess for dense-cascade coverage: a bare glassy voxel-water cascade (defect
// 2026-07-11: "stepped transparent glass blocks") reads far worse than a sheet on the steepest drop.
//
// DETERMINISM (§3.7): pure integer/array arithmetic over caller-supplied data; same input ⇒ same
// output. No transcendentals, no randomness, no module-level mutable state.

import { column_index } from '../chunks/format.js'
import { CHUNK_SIZE } from '../config/world_config.js'

/** @typedef {0 | 1 | 4 | 5 | null} FallFace */

/**
 * @typedef {object} ColumnWindow a rectangular window of per-column hydrology fields, ORIGIN-anchored.
 *   Field names match `ColumnProfile` (column_gen.js) exactly, so a real chunk profile can be passed
 *   straight through via `column_window_from_profile` below; a caller that needs correct face
 *   resolution AT a chunk edge merges several neighboring profiles into one larger window instead
 *   (this module has no opinion on chunk residency/streaming — that is the render wave's concern).
 * @property {number} origin_x world_x of local (0,0)
 * @property {number} origin_z world_z of local (0,0)
 * @property {number} size_x window width in columns (local x: 0..size_x-1)
 * @property {number} size_z window depth in columns (local z: 0..size_z-1)
 * @property {(local_x: number, local_z: number) => number} index local (x,z) → flat array offset
 * @property {Int16Array} surface_y flat, `index()`-addressed effective land surface
 * @property {Int16Array} water_level flat, `index()`-addressed hydrology water surface
 * @property {Uint8Array} waterfall flat, `index()`-addressed `is_waterfall` flag (1/0)
 */

/**
 * @typedef {object} FallColumn one waterfall-flagged world column with resolved sheet geometry.
 * @property {number} x world_x
 * @property {number} z world_z
 * @property {number} y_top sheet top, world-y — `max(water_level, surface_y)` at this column (see
 *   normalization note on `resolve_fall_columns`)
 * @property {number} y_bot sheet bottom, world-y — `min(water_level, surface_y)` at this column
 * @property {FallFace} face sheet-mount direction: the higher UPSTREAM neighbor when one resolves
 *   (module doc above), else the downstream fall face (lowest visible neighbor) via the coverage
 *   fallback in `resolve_fall_columns`; null only for a flat lip with no lower neighbor.
 */

/**
 * @typedef {object} FallSpan a run of adjacent same-face, same-height FallColumns merged into one
 *   descriptor (§4.2 "FALL SPANS {x0..x1, z, face, y_top, y_bot} (or z-runs)"). Both axis ranges are
 *   always present for a uniform shape; exactly one is the real run (the other collapses to a single
 *   value: x0===x1 for a z-run, z0===z1 for an x-run, both for a solo/unresolved-face column).
 * @property {number} x0 @property {number} x1 inclusive world-x range
 * @property {number} z0 @property {number} z1 inclusive world-z range
 * @property {number} y_top @property {number} y_bot
 * @property {FallFace} face
 * @property {number} width columns merged (blocks)
 */

/**
 * Resolves every waterfall column in a window into a `FallColumn`. `face` is resolved in two passes
 * over the 4 in-window cardinal neighbors: (1) UPSTREAM — the neighbor with the strictly-highest
 * `water_level` wins, PROVIDED it beats this column's own `water_level` (a fall's defining trait: the
 * sheet's source sits higher than where it lands); ties/no-qualifier leave it null. (2) COVERAGE
 * FALLBACK — if still null, resolve toward the DOWNSTREAM fall face (the neighbor with the lowest
 * visible top strictly below this column's) so a cascade lip still hangs a sheet instead of exposing
 * bare voxel water. `face: null` remains only for a flat lip with no lower in-window neighbor.
 *
 * `y_top`/`y_bot` are `max`/`min` of (`water_level`, `surface_y`) rather than a fixed assignment,
 * because case-(b) flag-only cascade columns never raise `water_level` — a shallow/fringe river
 * column can carry a `water_level` that sits BELOW its own carved `surface_y` (rs>0 but the carve
 * already exceeds the constant river bank at that point). max/min keeps every span's top ≥ bottom
 * always; it is a geometric safety normalization, not a claim about visible sheet height.
 * @param {ColumnWindow} win
 * @returns {FallColumn[]} unsorted, one entry per `waterfall[index(x,z)] === 1` cell
 */
export function resolve_fall_columns(win) {
  const { origin_x, origin_z, size_x, size_z, index, surface_y, water_level, waterfall } = win
  /** @type {FallColumn[]} */
  const out = []
  for (let lz = 0; lz < size_z; lz += 1) {
    for (let lx = 0; lx < size_x; lx += 1) {
      const i = index(lx, lz)
      if (!waterfall[i]) continue
      const own_wl = water_level[i]
      let best_wl = own_wl
      let tied = false
      /** @type {FallFace} */
      let face = null
      const probe = (/** @type {number} */ nlx, /** @type {number} */ nlz, /** @type {FallFace} */ f) => {
        if (nlx < 0 || nlx >= size_x || nlz < 0 || nlz >= size_z) return
        const n_wl = water_level[index(nlx, nlz)]
        if (n_wl > best_wl) {
          best_wl = n_wl
          face = f
          tied = false
        } else if (n_wl === best_wl && n_wl > own_wl) {
          tied = true
        }
      }
      probe(lx + 1, lz, 0) // neighbor at +X ⇒ face 0 (+X)
      probe(lx - 1, lz, 1) // neighbor at -X ⇒ face 1 (-X)
      probe(lx, lz + 1, 4) // neighbor at +Z ⇒ face 4 (+Z)
      probe(lx, lz - 1, 5) // neighbor at -Z ⇒ face 5 (-Z)
      if (tied) face = null
      const surf = surface_y[i]
      // COVERAGE FALLBACK (dense-cascade fix): the primary rule above resolves `face` toward the
      // higher UPSTREAM neighbor — but a cascade lip IS the high point (no higher neighbor), and a
      // dense multi-step cascade left ~80-95% of its flagged columns face:null → the render overlay
      // (waterfall_sheet.js) skipped them and the bare glassy voxel water read through as "stepped
      // transparent blocks" (2026-07-11). When no upstream face resolves, hang the sheet on the
      // DOWNSTREAM fall face instead: the neighbor with the lowest visible top (`max(water_level,
      // surface_y)`) strictly below this column's own — the direction the water actually pours. Ties
      // broken deterministically (deeper `surface_y`, then lower face-id via probe order); an all-flat
      // lip with no lower neighbor keeps face:null (nothing to hang). Detection-only, no gen/mesh change.
      if (face === null) {
        const own_top = own_wl > surf ? own_wl : surf
        let best_top = own_top
        let best_surf = Infinity
        const drop_probe = (/** @type {number} */ nlx, /** @type {number} */ nlz, /** @type {FallFace} */ f) => {
          if (nlx < 0 || nlx >= size_x || nlz < 0 || nlz >= size_z) return
          const j = index(nlx, nlz)
          const n_sf = surface_y[j]
          const n_wl = water_level[j]
          const n_top = n_wl > n_sf ? n_wl : n_sf
          if (n_top >= own_top) return // only a neighbor strictly below this column is a fall direction
          if (n_top < best_top || (n_top === best_top && n_sf < best_surf)) {
            best_top = n_top
            best_surf = n_sf
            face = f
          }
        }
        drop_probe(lx + 1, lz, 0)
        drop_probe(lx - 1, lz, 1)
        drop_probe(lx, lz + 1, 4)
        drop_probe(lx, lz - 1, 5)
      }
      out.push({
        x: origin_x + lx,
        z: origin_z + lz,
        y_top: own_wl > surf ? own_wl : surf,
        y_bot: own_wl < surf ? own_wl : surf,
        face,
      })
    }
  }
  return out
}

/**
 * Merges adjacent same-face, same-height `FallColumn`s into wider `FallSpan`s. A face ∈ {0,1}
 * (X-normal wall) merges along Z at a fixed x (a "z-run"); a face ∈ {4,5} (Z-normal wall) merges
 * along X at a fixed z. `face === null` columns never merge (no resolved run axis) — each survives
 * as its own width-1 span. Merge requires an EXACT match on (face, y_top, y_bot) — real terrain is
 * noisy, so most real-world spans stay width 1; a render-side tolerance pass is a later wave's call,
 * not this one's (this lane is detection only).
 * @param {FallColumn[]} columns
 * @returns {FallSpan[]}
 */
export function merge_fall_spans(columns) {
  /** @type {Map<string, FallColumn[]>} */
  const groups = new Map()
  for (const c of columns) {
    const key =
      c.face === 0 || c.face === 1
        ? `x:${c.x}|${c.face}|${c.y_top}|${c.y_bot}`
        : c.face === 4 || c.face === 5
          ? `z:${c.z}|${c.face}|${c.y_top}|${c.y_bot}`
          : `solo:${c.x},${c.z}`
    let group = groups.get(key)
    if (!group) {
      group = []
      groups.set(key, group)
    }
    group.push(c)
  }

  /** @type {FallSpan[]} */
  const spans = []
  for (const group of groups.values()) {
    const [{ face }] = group
    const run_along_z = face === 0 || face === 1 // fixed x, z varies
    group.sort((a, b) => (run_along_z ? a.z - b.z : a.x - b.x))
    let start = 0
    for (let i = 1; i <= group.length; i += 1) {
      const broke =
        i === group.length || (run_along_z ? group[i].z - group[i - 1].z !== 1 : group[i].x - group[i - 1].x !== 1)
      if (!broke) continue
      const first = group[start]
      const last = group[i - 1]
      spans.push({
        x0: first.x,
        x1: run_along_z ? first.x : last.x,
        z0: first.z,
        z1: run_along_z ? last.z : first.z,
        y_top: first.y_top,
        y_bot: first.y_bot,
        face,
        width: i - start,
      })
      start = i
    }
  }
  return spans
}

/**
 * One-shot detect+merge: the whole pure-gen half of §4.2 step 1 (span-merging only — the
 * ring_manager chunk-residency hook is a separate, later render-wave concern, not this lane's).
 * @param {ColumnWindow} win
 * @returns {FallSpan[]}
 */
export function build_fall_registry(win) {
  return merge_fall_spans(resolve_fall_columns(win))
}

/**
 * Wraps ONE chunk's `ColumnProfile` (column_gen.js `build_column_profile`) as a `ColumnWindow` — the
 * direct real-world integration seam. Edge columns (local 0 or `CHUNK_SIZE-1` on either axis) lose
 * whichever neighbor probe falls outside this single chunk and degrade to a possibly-null `face`
 * there; a caller wanting exact edge faces merges several neighboring profiles into one larger window
 * (see waterfall_registry.test.js's real-world suite for the pattern) — this module has no opinion on
 * cross-chunk residency.
 * @param {{surface_y: Int16Array, water_level: Int16Array, waterfall: Uint8Array}} profile
 * @param {number} cx chunk x
 * @param {number} cz chunk z
 * @returns {ColumnWindow}
 */
export function column_window_from_profile(profile, cx, cz) {
  return {
    origin_x: cx * CHUNK_SIZE,
    origin_z: cz * CHUNK_SIZE,
    size_x: CHUNK_SIZE,
    size_z: CHUNK_SIZE,
    index: column_index,
    surface_y: profile.surface_y,
    water_level: profile.water_level,
    waterfall: profile.waterfall,
  }
}

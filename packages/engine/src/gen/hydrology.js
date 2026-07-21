// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Hydrology (§4.4 NG1-B, item 4) — rivers, lakes, and waterfalls, all region-local + deterministic
// (NO flow-accumulation, NO hydraulic simulation — DO-NOT #1 / stealmap H2). Water is placed by a
// per-column WATER LEVEL that column_gen's block_at fills up to; the LAND surface is carved by the
// river channel term. Three features:
//
//   RIVER  — the canonical folded-ridge mechanism (§4.4): rivers live where PV ≈ 0. A quadratic
//            width/depth curve carves a channel into the land and sets a water surface `bank` blocks
//            below the un-carved land, so banks stay dry and the channel holds water. Inland only.
//   LAKE   — a low-frequency basin field marks candidate lake AREAS; the actual water level is the
//            TRUE POUR POINT of the terrain depression (priority-flood over a cached 256-block lake
//            tile — see compute_lake_tile), so every lake is FLAT and provably ENCLOSED: a water
//            cell exists only where every horizontal path to lower open ground is blocked by ground
//            at or above the water surface. (v3 containment fix, 2026-07-03 — replaces the
//            per-column spill = base_y − k rule, which sloped with the spline and stood
//            un-contained "glass wedge" water on open slopes.)
//   WATERFALL — where a river/basin column sits directly below a much-higher river neighbor (a canyon
//            lip or terrace edge — "the river band crosses a steep gradient"), the upstream water
//            overflows onto the lower column: its water level is raised to spill down the face, giving
//            the vertically-stacked water sheet v1 renders via the mesher's existing liquid top.
//            Steep river STEPS (water ≥ cascade_drop above a neighbor's water/ground top) are flagged
//            as cascades too — the sanctioned vertical exception of the containment invariant.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/abs/min/max ONLY. The only noise is one seeded fbm
// basin field. Waterfall detection reads a caller-supplied array of NEIGHBOR {land, river_level}
// (column_gen recomputes those deterministically) — region-local, bounded to 4 cardinal samples.
// The lake flood is region-local by construction: bounded to ONE 256-block tile, a pure function of
// (tile coords, seeds, deterministic land probe); the tile cache is a memo — eviction never changes
// output (same guarantee the worm cave cache proves in column_gen.test.js).

import { SEA_LEVEL, CHUNK_SIZE, REGION_SIZE_CHUNKS } from '../config/world_config.js'

import { create_fbm_sampler } from './noise/sampler.js'
import { create_ridged_sampler } from './noise/ridged.js'
import { create_warp_sampler } from './noise/warp.js'

/** Hydrology recipe (const world-recipe — moving these forks the world, §4). */
export const HYDROLOGY_CONFIG = {
  river: {
    // Rivers thread the valleys as THIN meandering lines — the crest network of a domain-warped
    // ridged field (like canyons but shallow + wide-valley + watered), NOT the PV≈0 plateau (which
    // clamps across most of the lowland map → a flood). `width` is the crest-band half-width.
    crease: { period: 560, octaves: 3 },
    warp: { period: 520, octaves: 2, amp: 70 },
    width: 0.12,
    depth: 11, // max channel carve at the center (blocks below land)
    bank: 3, // water surface sits this many blocks below the un-carved land (dry banks)
    continentalness_min: 0.42, // inland of the beach band (no rivers in open ocean)
    pv_max: 0.72, // rivers run through valleys/slopes, not over the highest peaks
    max_step: 1, // CONTAINMENT CLAMP (fixes a 2026-07-11 defect): the raised river surface may stand at
    //   most this many blocks proud of its lowest open cardinal neighbour, so a river descending a grade
    //   forms gentle ≤1-block riffles instead of sheer exposed voxel-water WALLS staircasing through the
    //   forest canopy at spawn ("disgusting sky-looking blocks / staircase edges right next to the
    //   player"). See the clamp in hydrology_column — it also stops the case-(b) cascade flag firing on
    //   gentle streams (water is never ≥cascade_drop proud after the clamp) ⇒ no phantom waterfall sheets.
  },
  lake: {
    period: 320,
    octaves: 2,
    threshold: 0.72, // basin field above this marks a candidate lake AREA (sparse)
    erosion_min: 0.5, // lowland/flat only (mountains drain, they don't pond)
    pv_max: 0.3,
    min_body_depth: 4, // a connected lake body must reach this depth at its deepest point, else it is
    //   a puddle and stays dry. Replaces the per-column min_depression 4 / max_depression 8 spill
    //   band (superseded 2026-07-03, pour-point containment fix): per-column depth gating dried the
    //   shallow shelves INSIDE real lakes (standing a water wall at the depth-4 contour) while the
    //   sloped spill (base_y − 2) stood un-enclosed "glass wedge" water on open slopes. The pour
    //   flood makes fill depth self-bounding (true enclosure), so only this body-quality gate remains.
  },
  waterfall: {
    min_drop: 6, // an uphill river neighbor this much higher spills onto us → fill the drop as a sheet
    fall_max: 28, // cap the sheet height so a deep canyon fall stays a fall, not a water wall
    cascade_drop: 2, // a river standing ≥ this above a neighbor's water/ground top is a cascade lip
    //   (flag-only: marks is_waterfall so the containment invariant's sanctioned vertical exception
    //   covers steep river steps; it never raises or adds water. 2026-07-03 containment fix.)
  },
}

/**
 * @typedef {object} HydrologyContext
 * @property {Pick<import('../config/world_gen_config.js').HydrologyConfig, 'river'|'lake'|'waterfall'> & {sea_level?: number}} cfg the world's hydrology recipe (world_gen_config `hydrology`) —
 *   every river/lake/waterfall read goes through this so a per-world recipe drives hydrology (§2.3)
 * @property {import('./noise/sampler.js').FbmSampler} lake_basin low-freq basin field for lakes
 * @property {import('./noise/ridged.js').RidgedSampler} river_crease thin river crest network
 * @property {import('./noise/warp.js').WarpSampler} river_warp meander for the river lines
 * @property {Map<string, Int16Array | null>} lake_tiles pour-point flood memo per 256-block lake
 *   tile (key "tx,tz"; null = no lakes in tile). Pure memo of a deterministic function — eviction
 *   (evict_lake_tiles_if_full) recomputes identically, never changing world output.
 */

/**
 * @typedef {object} NeighborWater a cardinal neighbor's land + river surface, for waterfall detection.
 * @property {number} land the neighbor's raw effective land surface (world-y)
 * @property {number} river_level the neighbor's river water surface, or -1 if it is not a river
 */

/**
 * @typedef {object} LakeProbeSample the per-column terrain/climate data the lake flood needs.
 * @property {number} land raw effective land surface world-y (spline + erosion-relief − canyon)
 * @property {number} erosion climate erosion at the column
 * @property {number} pv climate peaks-and-valleys at the column
 * @property {number} continentalness climate continentalness (folds the river carve into the flood)
 */

/**
 * @callback LakeProbe deterministic terrain probe for the lake flood (column_gen supplies raw_land +
 *   climate — same single source of truth the main fill uses).
 * @param {number} world_x
 * @param {number} world_z
 * @returns {LakeProbeSample}
 */

/**
 * @typedef {object} HydrologyColumn per-column hydrology result.
 * @property {number} carve blocks to subtract from the land surface (river channel; 0 elsewhere)
 * @property {number} water_level world-y water surface to fill up to (≥ SEA_LEVEL always)
 * @property {boolean} is_river the column is inside a river channel
 * @property {boolean} is_lake the column is inside a lake basin
 * @property {boolean} is_waterfall the column spills water down a face (a fall/cascade)
 */

/**
 * Builds the hydrology context (lake-basin + river samplers) from the `hydrology` sub-seed + the world's
 * `hydrology` recipe. Recipe defaults to the live/default world so context-free callers keep working. The
 * samplers + every downstream read go through `cfg`, so a per-world recipe drives rivers/lakes/waterfalls.
 * @param {Record<string, number>} seeds output of `derive_world_seeds`
 * @param {Pick<import('../config/world_gen_config.js').HydrologyConfig, 'river'|'lake'|'waterfall'> & {sea_level?: number}} [cfg] the world's hydrology recipe (world_gen_config `hydrology`)
 * @returns {HydrologyContext}
 */
export function create_hydrology_context(seeds, cfg = HYDROLOGY_CONFIG) {
  const h = seeds.hydrology >>> 0
  const rc = cfg.river
  return {
    cfg,
    lake_basin: create_fbm_sampler({
      seed: h ^ 0xb1a5_1eaf,
      base_period: cfg.lake.period,
      octaves: cfg.lake.octaves,
    }),
    river_crease: create_ridged_sampler({
      seed: h ^ 0x21be_e175,
      base_period: rc.crease.period,
      octaves: rc.crease.octaves,
      offset: 1,
      gain: 0.5,
    }),
    river_warp: create_warp_sampler({ seed: h ^ 0x5eaf_100d, base_period: rc.warp.period, octaves: rc.warp.octaves }),
    lake_tiles: new Map(),
  }
}

/** Reused warp scratch (single-threaded per worker). */
const RIVER_WARP = [0, 0, 0]

/**
 * River strength in [0,1] at a column — 1 at a river-line center, tapering to 0 across the thin
 * crest band, and 0 outside the inland/valley gate. The domain-warped ridged crest network gives
 * thin meandering rivers (region-local, pure function of (x,z)+climate).
 * @param {HydrologyContext} hctx
 * @param {number} world_x
 * @param {number} world_z
 * @param {number} continentalness
 * @param {number} pv
 * @returns {number}
 */
export function river_strength(hctx, world_x, world_z, continentalness, pv) {
  const rc = hctx.cfg.river
  if (continentalness < rc.continentalness_min) return 0
  if (pv > rc.pv_max) return 0
  hctx.river_warp.offset(world_x, 0, world_z, RIVER_WARP)
  const r = hctx.river_crease.sample(world_x + RIVER_WARP[0] * rc.warp.amp, 0, world_z + RIVER_WARP[2] * rc.warp.amp)
  const t = (r - (1 - rc.width)) / rc.width // 0 at the band edge, 1 at the crest (river center)
  if (t <= 0) return 0
  return t > 1 ? 1 : t
}

/**
 * The river water surface at a column (world-y), or -1 if the column is not a river. Used both for
 * this column's own water and (by column_gen) to fill the NeighborWater probes for waterfalls.
 * @param {HydrologyContext} hctx
 * @param {number} world_x
 * @param {number} world_z
 * @param {number} continentalness
 * @param {number} pv
 * @param {number} land the column's raw effective land surface
 * @returns {number} river water surface world-y, or -1
 */
export function river_water_level(hctx, world_x, world_z, continentalness, pv, land) {
  const s = river_strength(hctx, world_x, world_z, continentalness, pv)
  if (s <= 0) return -1
  return land - hctx.cfg.river.bank
}

// ── Lake pour-point flood (v3 containment fix, 2026-07-03) ──────────────────────────────────────
// A lake's water level is the TRUE POUR POINT of its terrain depression, computed once per
// 256-block LAKE TILE (aligned with the structure region grid) by standard depression-filling
// (priority-flood). Region-local bound: the flood NEVER reads outside its own tile — the tile's
// outer ring is an open drain, so a basin straddling a tile edge drains there and BOTH tiles agree
// the seam stays dry (cross-tile identity without any cross-tile read).

/** One lake tile edge, in blocks — one structure region (REGION_SIZE_CHUNKS × CHUNK_SIZE = 256). */
const LAKE_TILE_BLOCKS = REGION_SIZE_CHUNKS * CHUNK_SIZE
/** Tile memo cap (~128 KB per computed tile). Eviction is output-neutral: pure recompute. */
const LAKE_TILE_CAP = 16
/** Coarse pre-scan lattice step + margin — the basin field's lowest period is 320 (octave 2 → 160),
 *  far wider than the lattice, so a 16-step scan cannot miss a blob by more than the margin. */
const LAKE_COARSE_STEP = 16
const LAKE_COARSE_MARGIN = 0.05

/**
 * Clears the lake-tile memo when it hits the cap. Call at a column boundary (column_gen does, right
 * before priming) — never mid-fill, so a chunk always reads one coherent tile. World-neutral.
 * @param {HydrologyContext} hctx
 * @returns {void}
 */
export function evict_lake_tiles_if_full(hctx) {
  if (hctx.lake_tiles.size >= LAKE_TILE_CAP) hctx.lake_tiles.clear()
}

/**
 * Ensures the lake tile at (tile_x, tile_z) is computed and memoized. Idempotent.
 * @param {HydrologyContext} hctx
 * @param {number} tile_x tile coord = Math.floor(world_x / 256) = the structure-region coord
 * @param {number} tile_z
 * @param {LakeProbe} probe deterministic land/climate probe (column_gen's raw_land + climate)
 * @returns {void}
 */
export function prime_lake_tile(hctx, tile_x, tile_z, probe) {
  const key = `${tile_x},${tile_z}`
  if (!hctx.lake_tiles.has(key)) hctx.lake_tiles.set(key, compute_lake_tile(hctx, tile_x, tile_z, probe))
}

/**
 * The pour-point lake water SURFACE at a world column, or -1 when the column holds no lake water.
 * The tile must have been primed (prime_lake_tile) — throws loudly otherwise so an unprimed path can
 * never silently diverge from the primed one (determinism guard).
 * @param {HydrologyContext} hctx
 * @param {number} world_x
 * @param {number} world_z
 * @returns {number} water surface world-y (block_at fills world_y < this), or -1
 */
export function lake_level_at(hctx, world_x, world_z) {
  const T = LAKE_TILE_BLOCKS
  const tx = Math.floor(world_x / T)
  const tz = Math.floor(world_z / T)
  const tile = hctx.lake_tiles.get(`${tx},${tz}`)
  if (tile === undefined) throw new Error(`lake tile ${tx},${tz} not primed (call prime_lake_tile first)`)
  if (tile === null) return -1
  const lvl = tile[(world_z - tz * T) * T + (world_x - tx * T)]
  return lvl > 0 ? lvl : -1
}

/**
 * Computes one lake tile: per-column water surface (Int16Array T×T, 0 = dry), or null when the tile
 * holds no lake. Deterministic (integer arithmetic + the seeded basin field + the caller's
 * deterministic probe), bounded to the tile.
 *
 * CONTAINMENT PROOF (why a wet cell can never stand above lower open ground): the flood pops cells
 * lowest-level-first; a domain cell reached from a popped cell at level f fills to max(f, own land).
 * Suppose a wet cell W (fill F > land) had a 4-neighbor N that is dry/drain with land < F. N carries
 * fill = land < F, so N was popped BEFORE anything at level ≥ F could reach W — and popping N would
 * have relaxed W to max(land_N, land_W) < F. Contradiction: every neighbor of every wet cell is
 * ground ≥ F or water at exactly F, i.e. every horizontal escape path is blocked at ≥ the surface.
 * (Heightfield-level guarantee: the probe is the same carved-land oracle the main fill keys strata
 * on; 3D density overhangs/caves and the world_gen beach flatten are documented approximations —
 * the volume containment survey is the ground-truth gate.)
 * @param {HydrologyContext} hctx
 * @param {number} tile_x
 * @param {number} tile_z
 * @param {LakeProbe} probe
 * @returns {Int16Array | null}
 */
function compute_lake_tile(hctx, tile_x, tile_z, probe) {
  const cfg = hctx.cfg.lake
  const river_depth = hctx.cfg.river.depth
  const T = LAKE_TILE_BLOCKS
  const bx = tile_x * T
  const bz = tile_z * T

  // (1) Coarse rejection — most tiles carry no basin blob; skip the full scan for them.
  let coarse_max = 0
  for (let z = 0; z < T; z += LAKE_COARSE_STEP)
    for (let x = 0; x < T; x += LAKE_COARSE_STEP) {
      const b = hctx.lake_basin.sample(bx + x, bz + z)
      if (b > coarse_max) coarse_max = b
    }
  if (coarse_max <= cfg.threshold - LAKE_COARSE_MARGIN) return null

  // (2) Full-res blob mask, INTERIOR only ([1, T-2]) — border columns are permanent drains.
  const blob = new Uint8Array(T * T)
  let blob_cells = 0
  for (let z = 1; z < T - 1; z += 1)
    for (let x = 1; x < T - 1; x += 1)
      if (hctx.lake_basin.sample(bx + x, bz + z) > cfg.threshold) {
        blob[z * T + x] = 1
        blob_cells += 1
      }
  if (blob_cells === 0) return null

  // (3) Probe the EFFECTIVE land (raw land − the river channel carve, floored ≥ 2 exactly like
  // column_gen's fill) for blob cells; climate-gate blob cells into the flood DOMAIN. Every
  // non-domain cell adjacent to the domain is an open DRAIN at its own effective land height —
  // conservative: the flood can only underfill vs reality, never overfill.
  const land = new Int16Array(T * T) // 0 = unprobed (real land is always ≥ 2)
  const domain = new Uint8Array(T * T)
  const probe_cell = (/** @type {number} */ x, /** @type {number} */ z) => {
    const i = z * T + x
    if (land[i] !== 0) return land[i]
    const s = probe(bx + x, bz + z)
    const rs = river_strength(hctx, bx + x, bz + z, s.continentalness, s.pv)
    let eff = s.land - Math.floor(rs * rs * river_depth)
    if (eff < 2) eff = 2
    land[i] = eff
    if (blob[i] === 1 && s.erosion >= cfg.erosion_min && s.pv <= cfg.pv_max) domain[i] = 1
    return eff
  }
  for (let z = 1; z < T - 1; z += 1) for (let x = 1; x < T - 1; x += 1) if (blob[z * T + x] === 1) probe_cell(x, z)

  // (4) Priority-flood via Dial's bucket queue (levels are small ints; ascending sweep is exact
  // because a relaxed fill max(level, land) can never drop below the current sweep level). Seed all
  // drains; pop lowest-first; unvisited domain neighbors fill to max(level, own land).
  const fill = new Int16Array(T * T)
  const visited = new Uint8Array(T * T)
  /** @type {number[][]} sparse: bucket per integer level */
  const buckets = []
  for (let z = 1; z < T - 1; z += 1)
    for (let x = 1; x < T - 1; x += 1) {
      const i = z * T + x
      if (domain[i] !== 1) continue
      for (const n of [i + 1, i - 1, i + T, i - T]) {
        if (domain[n] === 1 || visited[n] === 1) continue
        const nx = n % T
        visited[n] = 1
        const lvl = probe_cell(nx, (n - nx) / T)
        fill[n] = lvl
        ;(buckets[lvl] ??= []).push(n)
      }
    }
  for (let lvl = 2; lvl < buckets.length; lvl += 1) {
    const bucket = buckets[lvl]
    if (!bucket) continue
    for (let bi = 0; bi < bucket.length; bi += 1) {
      // (bucket grows while sweeping when same-level cells are relaxed — length re-read each pass)
      const c = bucket[bi]
      for (const n of [c + 1, c - 1, c + T, c - T]) {
        if (domain[n] !== 1 || visited[n] === 1) continue
        visited[n] = 1
        const f = lvl > land[n] ? lvl : land[n]
        fill[n] = f
        ;(buckets[f] ??= []).push(n)
      }
    }
  }

  // (5) Basin-quality gate: label connected WET bodies (fill > land, 4-conn); a body must reach
  // min_body_depth at its deepest point or it stays dry (kills puddle spam). Depth gates the BODY —
  // real lakes keep their shallow shelves, so shores fill naturally to the flat surface.
  const seen = new Uint8Array(T * T)
  let wet_cells = 0
  for (let z = 1; z < T - 1; z += 1)
    for (let x = 1; x < T - 1; x += 1) {
      const i0 = z * T + x
      if (seen[i0] === 1 || domain[i0] !== 1 || fill[i0] <= land[i0]) continue
      const body = [i0]
      seen[i0] = 1
      let max_depth = 0
      for (let bi = 0; bi < body.length; bi += 1) {
        const c = body[bi]
        const depth = fill[c] - land[c]
        if (depth > max_depth) max_depth = depth
        for (const n of [c + 1, c - 1, c + T, c - T]) {
          if (seen[n] === 1 || domain[n] !== 1 || fill[n] <= land[n]) continue
          seen[n] = 1
          body.push(n)
        }
      }
      if (max_depth < cfg.min_body_depth) for (const c of body) fill[c] = 0
      else wet_cells += body.length
    }
  if (wet_cells === 0) return null

  // (6) Emit water-surface levels for WET cells only (drains/dry-domain hold fill == land → 0).
  for (let i = 0; i < fill.length; i += 1) if (fill[i] !== 0 && fill[i] <= land[i]) fill[i] = 0
  return fill
}

/**
 * Resolves the full hydrology for one column: river carve + water level, pour-point lake fill, and
 * waterfall/cascade detection (from the 4 cardinal neighbor probes, when supplied). Region-local +
 * deterministic.
 * @param {HydrologyContext} hctx
 * @param {number} world_x
 * @param {number} world_z
 * @param {number} continentalness
 * @param {number} pv
 * @param {number} land the column's raw effective land surface (shape + erosion − canyon)
 * @param {number} lake_level pour-point lake surface at the column (`lake_level_at`), or -1. Callers
 *   that only consume the river carve (surface anchors) pass -1 and skip lake-tile priming.
 * @param {NeighborWater[] | null} neighbors 4 cardinal neighbor probes, or null to skip waterfalls
 * @returns {HydrologyColumn}
 */
export function hydrology_column(hctx, world_x, world_z, continentalness, pv, land, lake_level, neighbors) {
  const { cfg } = hctx
  // Flood base is the world's configured sea level (S-24: threaded so a landlocked world can drop it
  // below its valley floors — Everest floors sit near y≈10). Defaults to the SEA_LEVEL const when a
  // recipe omits it (every shipped world sets hydrology.sea_level = 128 ⇒ byte-identical parity).
  let water_level = cfg.sea_level ?? SEA_LEVEL
  let carve = 0
  let is_river = false
  let is_lake = false
  let is_waterfall = false

  // ---- River: quadratic channel + banks --------------------------------------------------------
  // The river surface WAS `land - bank` per column, so on a slope it staircased with the terrain and
  // stood as exposed multi-block voxel-water faces among the forest canopy (a 2026-07-11 defect:
  // "disgusting sky-looking blocks below trees / staircase edges right next to spawn"; each step also
  // tripped the case-(b) cascade flag ⇒ phantom waterfall sheets over a shallow stream). A calm river
  // cannot pool more than one step over its lowest open neighbour, so CLAMP the raised surface to
  // `lowest_neighbour_top + max_step`: the river now forms gentle ≤max_step riffles down a grade instead
  // of sheer walls, and (a knock-on) never stands ≥cascade_drop proud of a neighbour ⇒ the case-(b)
  // phantom-fall flag stops firing on gentle streams. Real canyon-lip waterfalls (case (a), an uphill
  // river ≥min_drop higher) are UNTOUCHED — that raise is applied separately below off the un-clamped
  // neighbour probes. Region-local + deterministic (pure min over the 4 cardinal neighbour probes
  // column_gen already computed). null-neighbour surface-anchor callers keep the un-clamped level (they
  // only test "is water present", not wall geometry — anchor_surface documents that approximation).
  const rs = river_strength(hctx, world_x, world_z, continentalness, pv)
  if (rs > 0) {
    is_river = true
    carve = rs * rs * cfg.river.depth
    let lvl = land - cfg.river.bank
    if (neighbors) {
      let lowest_top = Infinity
      for (const n of neighbors) {
        const top = n.river_level >= 0 ? n.river_level : n.land
        if (top < lowest_top) lowest_top = top
      }
      const cap = lowest_top + (cfg.river.max_step ?? 1)
      if (cap < lvl) lvl = cap
    }
    if (lvl > water_level) water_level = lvl
  }

  // ---- Lake: pour-point flood fill (flat + enclosed by construction — see compute_lake_tile) ----
  if (lake_level > water_level) {
    water_level = lake_level
    is_lake = true
  }

  // ---- Waterfall / cascade: water crosses a steep gradient (canyon lip / terrace edge) -----------
  if (neighbors) {
    for (const n of neighbors) {
      // (a) an uphill RIVER neighbor overflows onto this (lower) column → fill the drop as a sheet.
      if (n.river_level >= 0 && n.river_level - land >= cfg.waterfall.min_drop) {
        let sheet = n.river_level
        const cap = land + cfg.waterfall.fall_max
        if (sheet > cap) sheet = cap // keep tall canyon falls a fall, not a full-height water wall
        if (sheet > water_level) {
          water_level = sheet
          is_waterfall = true
        }
      }
      // (b) THIS column is a river standing ≥ cascade_drop above a neighbor's occupied top: the
      //     water pours over that edge — a cascade/rapid lip (canyon lips included; case (a) fills
      //     the receiving sheet once the drop reaches min_drop). A RIVER neighbor's occupied top is
      //     its water surface `river_level` (its raw `land` is PRE-carve — comparing against it
      //     underestimated 2-3-block steps and left them unflagged); river_level is a lower bound of
      //     a dry band-edge's carved surface too, so this only ever over-flags, never under-flags.
      //     Flag-only: sanctions the vertical water face for the containment invariant, never
      //     raises or adds water. (2026-07-03 containment fix — was `water_level - n.land >=
      //     min_drop`, which missed river steps AND wrongly flagged contained deep channels.)
      if (is_river) {
        const n_top = n.river_level >= 0 ? n.river_level : n.land
        if (water_level - n_top >= cfg.waterfall.cascade_drop) is_waterfall = true
      }
    }
  }

  return { carve, water_level, is_river, is_lake, is_waterfall }
}

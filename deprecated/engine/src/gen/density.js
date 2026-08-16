// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unified 3D density field (§2.2 NG1-A) — the keystone. ONE analytic function whose zero-isosurface
// IS the world surface: `density(x,y,z) > 0` ⇒ solid, `<= 0` ⇒ air/void. Generalizes GPU Gems 3
// ch.1 so surface shaping + overhang/cliff lips + cave subtraction + Pandora floating islands all
// fall out of the same formula (the unified-generator design goal). Consumed by column_gen.block_at,
// this realizes the ±band overhang seam terrain_shaper only declared-but-never-consumed since M1
// (that dead rival band was removed — this module is now the SINGLE owner of band + overhang gate).
//
// COMPOSITION (solid where > 0; matches the shipped `density()` exactly):
//   d  = surface_y(x,z) − y                                  base heightfield gradient (spline shaper)
//   if gated (steep col) near surface:
//     p  = (x,y,z) + warp3(x,y,z) · WARP_AMP                 domain-warp the sample (organic contours)
//     d += (ridged3(p)·2 − 1) · overhang_gate(eros,pv) · DETAIL_AMP   overhang/cliff lips (Musgrave)
//   if in the near-surface cave crust:
//     d −= spaghetti_carve(x,y,z)                            single ridged-crest tunnel (raw coords)
//   d += hard_floor(y)                                       caves never punch the world bottom
//   if in the sky band:
//     d  = max(d, sky_islands(x,y,z))                        union with the region-gated Pandora islands
// (Perf tuning kept caves to ONE raw-coord ridged octave-cheap sampler and the sky field integer-hash/
//  no-warp — the warp, the costliest fetch, fires ONLY for the gated overhang term.)
//
// BANDED EVALUATION (perf, §2.2 "without paying full 3D density everywhere"): the base gradient is a
// cheap fast path — far below the surface is overwhelmingly solid, far above is air. The overhang +
// cave terms fire ONLY inside the column's active band `[cave_low, surface+lift]`; the sky-island
// field ONLY inside `[low_y±thickness]` AND (via its own region hash) inside sky-island regions.
// column_gen uses the heightfield outside those bands. Cost stays near baseline everywhere except the
// thin active shells + the rare archipelago columns (measured — see ng1d_report.json).
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/abs/max/min ONLY. All noise is seeded 3D simplex
// with an injected `alea` prng (never Math.random) + ipow amplitude tables (never Math.pow at sample
// time). Region-local: every term is a pure function of (x,y,z)+seed (+ the column's own surface_y).
// Changing any const here moves the golden hash = a WORLD FORK (§4) — bump GEN_VERSION + re-bless.

import { HARD_FLOOR_Y } from '../config/world_config.js'

import { create_ridged_sampler } from './noise/ridged.js'
import { create_warp_sampler } from './noise/warp.js'
import { create_cave_carver, cave_carve, cave_region_at, cave_band_low, CAVES_CONFIG } from './carvers/caves.js'
import { create_sky_islands_context, sky_islands_density, column_has_sky, SKY_ISLANDS_CONFIG } from './sky_islands.js'

/** @typedef {import('./noise/fields.js').ClimateSample} ClimateSample */

// ---- Density shaping constants (const world-recipe — moving these forks the world, §4) --------
// Config-first spirit (§2.3): one object = the density recipe. NG1-E promotes this into the full
// serializable world_gen_config schema; until then this const IS the single source of truth.
export const DENSITY_CONFIG = {
  /** Minimum half-height (blocks) of the active 3D band above the surface. Gated columns extend it
   *  further to cover the overhang lift (detail.amp·gate); this is the floor for all columns. */
  band_blocks: 10,
  /** Domain-warp period (blocks) + amplitude (blocks the sample point is displaced). */
  warp: { period: 240, octaves: 2, amp: 26 },
  /** Overhang detail: ridged 3D noise period + how many blocks it can push the surface in/out. */
  detail: { period: 132, octaves: 4, amp: 34 },
  /** Overhang gate — how far erosion/PV must relax before 3D detail turns on (steep, high cols). */
  overhang: { erosion_max: 0.46, pv_min: 0.46, strength: 1.35 },
  // Caves now live in carvers/caves.js (spaghetti near-surface + worley caverns + region-cached
  // worms) and subtract through the cave seam below. `caves` here is a COMPAT MIRROR of the live
  // near-surface spaghetti crust params (projected from CAVES_CONFIG.spaghetti) so the NG1-E config
  // guard (world_gen_config.test.js) keeps cross-checking the config against the live values until
  // that schema migrates to carry worley/worms too. Not read by density.js — mirror only.
  caves: {
    depth_min: CAVES_CONFIG.spaghetti.depth_min,
    depth_max: CAVES_CONFIG.spaghetti.depth_max,
    spaghetti_period: CAVES_CONFIG.spaghetti.period,
    spaghetti_threshold: CAVES_CONFIG.spaghetti.threshold,
    spaghetti_depth: CAVES_CONFIG.spaghetti.depth,
  },
  /** Pandora-style floating islands (§2.2 sky lane). The v4 placeholder shell (a ridged horizontal
   *  slab that produced fish-bone ribbons) was RETIRED at v5 for real hanging Hallelujah-Mountain
   *  masses — broad living tops tapering to stalactite roots, clustered into archipelagos, REGION-
   *  GATED to dedicated sky regions. The full grammar + shape live in gen/sky_islands.js
   *  (SKY_ISLANDS_CONFIG); density.js just cheap-rejects the altitude band + unions the field. This
   *  key is the band ENVELOPE the LOD far-shell + section_builder scan (stable low_y/high_y/thickness
   *  names) — it mirrors SKY_ISLANDS_CONFIG so callers keep one source of truth. */
  sky: SKY_ISLANDS_CONFIG,
}

/**
 * @typedef {object} DensityContext the seeded 3D samplers for the density field, built once per
 *   world alongside the climate FieldSet.
 * @property {Pick<import('../config/world_gen_config.js').DensityConfig, 'band_blocks'|'warp'|'detail'|'overhang'>} cfg the world's density recipe (world_gen_config `density`) — every
 *   band/warp/detail/overhang read goes through this so a per-world recipe drives the field (§2.3). The
 *   sky-band ENVELOPE (low_y/high_y/thickness) is read from `sky.cfg` (the SkyIslandsContext's recipe).
 * @property {import('./noise/warp.js').WarpSampler} warp
 * @property {import('./noise/ridged.js').RidgedSampler} detail
 * @property {import('./carvers/caves.js').CaveCarver} caves spaghetti + worley + worm cave family
 * @property {import('./sky_islands.js').SkyIslandsContext} sky Pandora floating-island generator
 */

/**
 * Builds the density sampler set from the named sub-seeds + the world's `density`/`sky` recipe. Reuses
 * the `carvers` sub-seed (already derived) plus fixed decorrelating offsets so no new sub-seed name is
 * needed. Recipes default to the live/default world so context-free callers keep working unchanged.
 * @param {Record<string, number>} seeds output of `derive_world_seeds`
 * @param {Pick<import('../config/world_gen_config.js').DensityConfig, 'band_blocks'|'warp'|'detail'|'overhang'>} [cfg] the world's density recipe (world_gen_config `density`)
 * @param {typeof SKY_ISLANDS_CONFIG} [sky_cfg] the world's sky recipe (world_gen_config `sky`)
 * @returns {DensityContext}
 */
export function create_density_context(seeds, cfg = DENSITY_CONFIG, sky_cfg = SKY_ISLANDS_CONFIG) {
  const carve = seeds.carvers >>> 0
  return {
    cfg,
    warp: create_warp_sampler({
      seed: carve ^ 0x1111_1111,
      base_period: cfg.warp.period,
      octaves: cfg.warp.octaves,
    }),
    detail: create_ridged_sampler({
      seed: carve ^ 0x2222_2222,
      base_period: cfg.detail.period,
      octaves: cfg.detail.octaves,
      offset: 1,
      gain: 0.5,
    }),
    caves: create_cave_carver(seeds),
    sky: create_sky_islands_context(carve, sky_cfg),
  }
}

/**
 * Overhang gate in [0,1] — how strongly 3D detail applies at a column. Opens (→1) only on steep,
 * high-relief terrain (low erosion AND high peaks-and-valleys); stays 0 on flat/eroded ground so
 * plains never grow overhangs and cost nothing (§2.1 squeeze). Smoothstep-shaped (polynomial).
 * @param {number} erosion climate erosion [0,1] (0 = mountainous)
 * @param {number} pv peaks-and-valleys [0,1] (1 = peak)
 * @param {typeof DENSITY_CONFIG.overhang} [o] the world's overhang gate recipe (defaults to live)
 * @returns {number} gate in [0,1]
 */
export function overhang_gate(erosion, pv, o = DENSITY_CONFIG.overhang) {
  // erosion factor: 1 at erosion 0, ramps to 0 by erosion_max.
  let e = (o.erosion_max - erosion) / o.erosion_max
  if (e < 0) e = 0
  if (e > 1) e = 1
  // pv factor: 0 below pv_min, ramps to 1 at pv 1.
  let v = (pv - o.pv_min) / (1 - o.pv_min)
  if (v < 0) v = 0
  if (v > 1) v = 1
  // Hermite-smooth both, multiply — a column needs BOTH steep and peaky to grow lips.
  const es = e * e * (3 - 2 * e)
  const vs = v * v * (3 - 2 * v)
  return es * vs * o.strength
}

/**
 * @typedef {object} DensityColumn per-column precomputed density inputs (built once per XZ column,
 *   shared across all Y in the column — matches ColumnProfile's per-column cadence). The active band
 *   `[band_low, band_high]` is the ONLY y-range where the per-voxel field is evaluated; outside it
 *   column_gen uses the cheap heightfield (plus the sky band, handled separately).
 * @property {number} surface_y effective surface world-y (the heightfield base gradient crossing —
 *   spline + mountain erosion − canyon/river carve; set by column_gen)
 * @property {number} gate overhang gate for this column (0 ⇒ no overhang detail)
 * @property {boolean} has_deep_caves the column is in a cave region (worley caverns + worm tunnels);
 *   deepens band_low so the deep carve is in-band and enables the worley/worm cave terms
 * @property {boolean} has_sky the column is under (or in edge-reach of) a sky-island archipelago; the
 *   tall sky band is scanned ONLY when this is set — the ~87% of columns not under an archipelago skip
 *   the whole sky band (one region hash per column instead of per voxel). The perf keystone.
 * @property {number} band_low inclusive lower world-y of the active 3D band (cave depth floor)
 * @property {number} band_high inclusive upper world-y of the active 3D band (surface + overhang lift)
 * @property {typeof DENSITY_CONFIG} [cfg] the world's density recipe (stamped at build so finalize/rekey
 *   size the band from the ACTIVE band_blocks/detail.amp without a context — set by build_density_column)
 */

/**
 * Precomputes the per-column density inputs from an effective surface + its climate. Cheap; called
 * once per XZ in build_column_profile so the per-voxel `density`/`is_solid` calls are branch-light.
 * The active band spans from the deepest cave up to the highest possible overhang lip.
 * @param {DensityContext} dctx the density samplers (for the cave-region gate)
 * @param {number} surface_y effective surface height (post shaper + erosion + carve)
 * @param {ClimateSample} climate the column's climate sample
 * @param {number} world_x column world x (for the cave-region gate)
 * @param {number} world_z column world z
 * @returns {DensityColumn}
 */
export function build_density_column(dctx, surface_y, climate, world_x, world_z) {
  const gate = overhang_gate(climate.erosion, climate.pv, dctx.cfg.overhang)
  const has_deep_caves = cave_region_at(dctx.caves, world_x, world_z)
  const has_sky = column_has_sky(dctx.sky, world_x, world_z)
  return finalize_density_column({ surface_y, gate, has_deep_caves, has_sky, cfg: dctx.cfg }, surface_y, gate)
}

/**
 * Computes the active-band bounds for a density column from its surface + gate. The upper band edge
 * MUST cover the maximum overhang lift (detail.amp·gate) so the is_solid fast path never truncates a
 * lip that the full field would place above surface_y — otherwise the heightfield fast path and the
 * full density would disagree above the band (a real terrain bug). Ungated columns get a tight band
 * ending at the surface (no lift possible). Shared by build + rekey.
 * @param {{surface_y:number, gate:number, has_deep_caves?:boolean, has_sky?:boolean, band_low?:number, band_high?:number, cfg?:Pick<import('../config/world_gen_config.js').DensityConfig, 'band_blocks'|'warp'|'detail'|'overhang'>}} col
 * @param {number} surface_y
 * @param {number} gate
 * @returns {DensityColumn}
 */
function finalize_density_column(col, surface_y, gate) {
  const cfg = col.cfg ?? DENSITY_CONFIG
  // Fast-path floor: deep to the cave bedrock on cave-region columns (so the worley/worm carves are
  // in-band and the fast path never claims a carved deep voxel solid), else just below the
  // near-surface spaghetti crust. caves.js owns this depth.
  col.surface_y = surface_y
  col.gate = gate
  col.band_low = cave_band_low(surface_y, col.has_deep_caves === true)
  // Max lift a gated column's ridged detail can add above the surface (+1 block guard for rounding).
  const overhang_lift = Math.floor(gate * cfg.detail.amp) + 1
  // Gated columns: the band MUST cover the overhang lift (detail.amp·gate) so the heightfield fast
  // path never truncates a lip above surface_y. Ungated: no lift is possible, so a fixed small
  // band_blocks margin is enough (and keeps a nonzero band above the surface for robustness).
  col.band_high = surface_y + Math.max(cfg.band_blocks, gate > 0 ? overhang_lift : 0)
  return /** @type {DensityColumn} */ (col)
}

/**
 * Re-keys an existing DensityColumn to a new surface height (in place), keeping its gate. Used by
 * the world_gen beach-flattening layer, which lifts a beach column's surface AFTER the profile is
 * built — the density band + cave bounds must move with it or the 3D solid test uses the stale
 * surface. Preserves the gate (beaches are ungated anyway) so no climate re-sample is needed.
 * @param {DensityColumn} col
 * @param {number} surface_y new surface height
 * @returns {void}
 */
export function rekey_density_column(col, surface_y) {
  finalize_density_column(col, surface_y, col.gate)
}

/** Scratch warp vector reused across is_solid calls (single-threaded per worker). */
const WARP_SCRATCH = [0, 0, 0]

/**
 * Evaluates the full signed density at one voxel. `> 0` ⇒ solid. Used INSIDE the active bands only
 * (column_gen fast-paths the heightfield elsewhere). Returns the composed field described in the
 * file header. Pure arithmetic (§3.7).
 * @param {DensityContext} dctx
 * @param {DensityColumn} col precomputed column density inputs
 * @param {number} x world x
 * @param {number} y world y
 * @param {number} z world z
 * @returns {number} signed density (blocks); solid iff > 0
 */
export function density(dctx, col, x, y, z) {
  const { cfg } = dctx

  // Base heightfield gradient — solid below the spline surface.
  let d = col.surface_y - y

  // Overhang / cliff lips (the expensive DOMAIN-WARPED ridged detail) fire ONLY on gated columns
  // inside the surface shell. The warp (the single costliest noise fetch) is computed HERE and
  // nowhere else on the hot path — cave/sky voxels never pay for it. This is what keeps ungated
  // columns near baseline: the cave crust below them takes only the cheap raw-coord carve below.
  if (col.gate > 0 && y >= col.surface_y - cfg.band_blocks) {
    dctx.warp.offset(x, y, z, WARP_SCRATCH)
    const r =
      dctx.detail.sample(
        x + WARP_SCRATCH[0] * cfg.warp.amp,
        y + WARP_SCRATCH[1] * cfg.warp.amp,
        z + WARP_SCRATCH[2] * cfg.warp.amp
      ) *
        2 -
      1
    d += r * col.gate * cfg.detail.amp
  }

  // Caves (the density "cave-subtract seam", §2.2): near-surface spaghetti everywhere + deep worley
  // caverns and region-cached worm tunnels on cave-region columns. carvers/caves.js owns the depth
  // bands + the region cache; it self-gates by depth/y and the column's has_deep_caves flag.
  d -= cave_carve(dctx.caves, x, y, z, col.surface_y, col.has_deep_caves)

  // Hard floor: below HARD_FLOOR_Y, add a strong solid bias so caves can't punch the world bottom
  // (GPU Gems f_hard_floor). Linear ramp over a few blocks, capped, so the very bottom is bedrock.
  if (y < HARD_FLOOR_Y) {
    let f = (HARD_FLOOR_Y - y) * 8
    if (f > 120) f = 120
    d += f
  }

  // Sky islands: union (max) with the Pandora floating-island field high above terrain — only on
  // columns under an archipelago (col.has_sky, precomputed once) AND inside the altitude band (both
  // cheap-rejected here with pure arithmetic before any island math). The field is a max over the
  // covering region's archipelago (gen/sky_islands.js). RAW coords: islands hang in empty air, no warp.
  // The band envelope (low_y/high_y/thickness) is the sky context's recipe (single home = sky.cfg).
  const sky = dctx.sky.cfg
  if (col.has_sky && y >= sky.low_y - sky.thickness && y <= sky.high_y + sky.thickness) {
    const sy = sky_islands_density(dctx.sky, x, y, z)
    if (sy > d) d = sy
  }

  return d
}

/**
 * Whether a voxel is solid under the density field. Fast-paths the pure heightfield outside the
 * active 3D band (the vast majority of voxels): far below surface = solid, far above = air, unless
 * the sky-island altitude band is in play. Only evaluates the full `density` inside the bands.
 * @param {DensityContext} dctx
 * @param {DensityColumn} col precomputed column density inputs
 * @param {number} x world x
 * @param {number} y world y
 * @param {number} z world z
 * @returns {boolean} true ⇒ solid block
 */
export function is_solid(dctx, col, x, y, z) {
  const in_surface_band = y >= col.band_low && y <= col.band_high
  const s = dctx.sky.cfg
  // The tall sky band is only "active" on columns under an archipelago (col.has_sky). On the ~87% of
  // columns that are NOT, the whole band fast-paths as empty air — without this gate every column
  // would pay a per-voxel region hash over ~200 blocks of empty sky (the v5 perf regression fix).
  const in_sky_band = col.has_sky && s.enabled && y >= s.low_y - s.thickness && y <= s.high_y + s.thickness

  if (!in_surface_band && !in_sky_band) {
    // Pure heightfield fast path — no noise fetches (the vast solid interior + empty air).
    return y < col.surface_y
  }
  return density(dctx, col, x, y, z) > 0
}

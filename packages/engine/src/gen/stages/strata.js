// STRATA BANDING stage (FIVE-WORLDS §P3 shared stage 1 — Riviera limestone terraces). Quantizes the
// exposed rock of STEEP columns into horizontal sedimentary BANDS: a solid voxel on a column whose slope
// is at/above `slope_gate` takes a band block hash-bucketed by its world-y (floor(y / band_height)), with
// a per-column ± y jitter so band boundaries waver across a cliff instead of ruler-straight. Flat ground
// (slope < gate) keeps its normal biome surface, so banding reads as sedimentary cliff strata, not painted
// terrain. Off by default (config.strata.enabled:false) ⇒ zero cost + byte-identical DEFAULT world.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor ONLY, integer hashing (u32 multiply/xor/shift). No
// Math.random/sin/cos/pow. Pure function of (world_x, world_y, world_z, slope) + the config → same band on
// every peer and every chunk that touches the voxel.

import { get_block_by_name } from '../../config/block_registry.js'
import { hash2 } from '../noise/integer_hash.js'

/** @typedef {import('../../config/world_gen_config.js').StrataConfig} StrataConfig */

/**
 * @typedef {object} StrataContext resolved strata stage (palette names → block ids, once per world).
 * @property {boolean} enabled banding on (config enabled AND at least one palette block resolved)
 * @property {number} band_height one band thickness, blocks (≥1)
 * @property {number} band_jitter per-column ± y offset, blocks (≥0)
 * @property {number} slope_gate slope (rise/run) at/above which a column bands
 * @property {number[]} palette resolved band block ids (hash-bucketed per band)
 */

// hash2 imported from ../noise/integer_hash.js (shared determinism-pinned home).

/** Hash → float in [0,1). @param {number} h @returns {number} */
function to_unit(h) {
  return (h >>> 0) * 2.3283064365386963e-10 // 2^-32
}

/**
 * Builds the strata stage context from a world's `strata` config. Resolves the palette names to ids once;
 * a palette entry that doesn't resolve is dropped (feature-detected). Disabled ⇒ enabled:false everywhere.
 * @param {StrataConfig} [cfg]
 * @returns {StrataContext}
 */
export function create_strata_context(cfg) {
  const palette = /** @type {number[]} */ (
    (cfg?.palette ?? []).map((name) => get_block_by_name(name)?.id).filter((id) => id !== undefined)
  )
  return {
    enabled: cfg?.enabled === true && palette.length > 0,
    band_height: Math.max(1, Math.floor(cfg?.band_height ?? 4)),
    band_jitter: Math.max(0, Math.floor(cfg?.band_jitter ?? 0)),
    slope_gate: cfg?.slope_gate ?? 0.55,
    palette,
  }
}

/**
 * The strata band block id for a solid voxel, or -1 for "no override" (banding disabled, or the column is
 * not steep enough). Band index = floor((world_y + column_jitter) / band_height), wrapped into the palette.
 * The jitter is a per-column integer offset in [-band_jitter, band_jitter] so a whole column shares one
 * offset (bands stay horizontal per column) but neighbours differ (the band boundary wavers across a face).
 * @param {StrataContext} sctx
 * @param {number} world_x @param {number} world_y @param {number} world_z
 * @param {number} slope column slope (rise/run)
 * @returns {number} band block id, or -1 for no override
 */
export function strata_band_block(sctx, world_x, world_y, world_z, slope) {
  if (!sctx.enabled || slope < sctx.slope_gate) return -1
  const jitter =
    sctx.band_jitter > 0
      ? Math.floor((to_unit(hash2(world_x, world_z, 0x5734_a1e5)) * 2 - 1) * (sctx.band_jitter + 1))
      : 0
  const n = sctx.palette.length
  let idx = Math.floor((world_y + jitter) / sctx.band_height) % n
  if (idx < 0) idx += n
  return sctx.palette[idx]
}

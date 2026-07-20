// Mountain erosion LOOK (§2.1 NG1-B, item 2) — the per-column relief that turns the smooth spline
// heightfield into eroded, jagged ridgelines with vertical gully channels (refs #2 alpine / #3
// canyon walls), WITHOUT any hydraulic/thermal simulation (DO-NOT #1) and WITHOUT touching the
// smooth `world_surface_y` probe (the jaggedness rides the density field's effective surface, exactly
// like overhang lips — so the frozen ≤20-blocks/column smoothness gate stays satisfied).
//
// TECHNIQUE (deterministic approximation of the erosion look, §4.4 / stealmap item 7 "PORT the LOOK"):
//   ridgelines  = domain-warped ridged-multifractal (iq warp ∘ Musgrave), lifts crest LINES  (+)
//   gullies     = a higher-frequency ridged crest network CARVED along its thin crests           (−)
//   mask        = mountain mask (low erosion, any real relief) so plains/oceans get exactly zero
// Both terms are pure per-(x,z) functions → a column's relief is a single scalar added to its
// effective surface (nearly free per voxel; the drama is coherent ridges, not per-block noise).
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/abs/min/max/sqrt ONLY. All noise is seeded 3D
// simplex (injected alea) sampled at y=0 for a 2D field + ipow amplitude tables. Region-local:
// relief(x,z) depends only on (x,z)+seed. Changing any const here moves the golden hash (§4).

import { create_ridged_sampler } from '../noise/ridged.js'
import { create_warp_sampler } from '../noise/warp.js'

/** Erosion-look recipe (const world-recipe — moving these forks the world, §4). */
export const EROSION_CONFIG = {
  /** Coherent ridgeline field: broad, mountain-scale crest lines lifted above the spline. */
  ridge: { period: 216, octaves: 4, amp: 30 },
  /** Gully field: high-frequency crest network carved as thin vertical channels down slopes. */
  gully: { period: 52, octaves: 3, depth: 15 },
  /** Domain warp bending straight ridges/gullies into organic, meandering erosion contours. */
  warp: { period: 300, octaves: 2, amp: 34 },
  /** Mountain mask: opens as erosion relaxes; full by `erosion_full`, zero past `erosion_max`.
   *  `pv_floor` keeps deep valley floors (river corridors) from growing ridgelines. */
  mask: { erosion_max: 0.62, erosion_full: 0.28, pv_floor: 0.06 },
}

/**
 * @typedef {object} ErosionCarver
 * @property {import('../noise/ridged.js').RidgedSampler} ridge
 * @property {import('../noise/ridged.js').RidgedSampler} gully
 * @property {import('../noise/warp.js').WarpSampler} warp
 */

/**
 * Builds the erosion-look sampler set. Uses the `carvers` sub-seed with fixed decorrelating salts
 * (distinct from density.js's) so the fields are independent yet reproducible.
 * @param {Record<string, number>} seeds output of `derive_world_seeds`
 * @returns {ErosionCarver}
 */
export function create_erosion_carver(seeds) {
  const carve = seeds.carvers >>> 0
  const c = EROSION_CONFIG
  return {
    ridge: create_ridged_sampler({
      seed: carve ^ 0x6666_6666,
      base_period: c.ridge.period,
      octaves: c.ridge.octaves,
      offset: 1,
      gain: 0.5,
    }),
    gully: create_ridged_sampler({
      seed: carve ^ 0x7777_7777,
      base_period: c.gully.period,
      octaves: c.gully.octaves,
      offset: 1,
      gain: 0.55,
    }),
    warp: create_warp_sampler({
      seed: carve ^ 0x8888_8888,
      base_period: c.warp.period,
      octaves: c.warp.octaves,
    }),
  }
}

/** Reused warp scratch (single-threaded per worker). */
const WARP_SCRATCH = [0, 0, 0]

/**
 * Mountain mask in [0,1] — 0 on flat/eroded ground and ocean, ramping to 1 on low-erosion relief.
 * Broader than density's overhang gate (mid-pv slopes count as mountain, not just peaks) so whole
 * mountain FACES get the eroded look, not only the summits. Smoothstep-shaped (polynomial, §3.7).
 * @param {number} erosion climate erosion [0,1] (0 = mountainous)
 * @param {number} pv peaks-and-valleys [0,1]
 * @returns {number} mask in [0,1]
 */
export function mountain_mask(erosion, pv) {
  const m = EROSION_CONFIG.mask
  if (pv <= m.pv_floor) return 0 // valley floors stay smooth (rivers live here)
  let e = (m.erosion_max - erosion) / (m.erosion_max - m.erosion_full)
  if (e <= 0) return 0
  if (e > 1) e = 1
  return e * e * (3 - 2 * e)
}

/**
 * Per-column mountain erosion relief (world blocks, SIGNED) to add to the effective surface: coherent
 * ridgeline lift minus a thin gully-channel carve, masked to mountains. Zero where the mask is zero
 * (a cheap early-out for the common flat/ocean case). The domain warp is sampled once and shared by
 * both fields so ridges and their gullies meander together.
 * @param {ErosionCarver} ec
 * @param {number} world_x
 * @param {number} world_z
 * @param {number} erosion climate erosion [0,1]
 * @param {number} pv climate peaks-and-valleys [0,1]
 * @returns {number} signed relief in blocks (0 when unmasked)
 */
export function mountain_relief(ec, world_x, world_z, erosion, pv) {
  const mask = mountain_mask(erosion, pv)
  if (mask <= 0) return 0
  const c = EROSION_CONFIG
  ec.warp.offset(world_x, 0, world_z, WARP_SCRATCH)
  const wx = world_x + WARP_SCRATCH[0] * c.warp.amp
  const wz = world_z + WARP_SCRATCH[2] * c.warp.amp

  // Ridgelines: crest (≈1) lifts, valley (≈0) doesn't — a network of raised erosion ridges.
  const lift = ec.ridge.sample(wx, 0, wz) * c.ridge.amp
  // Gullies: carve along the high-freq ridged crest LINES (thin channels down the faces). Squared
  // so only the sharp crest carves, leaving smooth slopes between the channels.
  const g = ec.gully.sample(wx * 1.7, 128.5, wz * 1.7)
  const carve = g * g * c.gully.depth

  return (lift - carve) * mask
}

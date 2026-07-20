// LEAVES-2X Rung 2 — the near→far canopy BAND. Single home for the distance rule + a pure JS mirror of
// the vertex-collapse crossfade so terrain_material.js (TSL) and the unit test read ONE source.
//
// THE MODEL (Option A): a leaf cell renders TWO ways in the mesh at once — an airy SPRITE cluster
// (cutout, alphaTest) for the near read, and an opaque CUBE shell (canopy class, discard-free →
// early-Z, no overdraw) for the far read. Neither is ever fragment-discarded (a fragment `Discard` kills
// early-Z globally); instead each collapses to a DEGENERATE quad in the VERTEX stage outside its range —
// all four corners fold to the shared voxel anchor, so the rasterizer emits ZERO fragments (the same
// free-cull the flora far-collapse already relies on, terrain_flora.js). Across the band the two
// crossfade by scaling, so fill stays bounded to (small near sprite radius) + (far opaque, early-Z).
//
//   dist ≤ NEAR : sprites full (keep 1), cubes gone (keep 0)  — the airy D164 near canopy
//   NEAR..FAR   : crossfade (both partially scaled)           — the seam, must be pop-free
//   dist ≥ FAR  : sprites gone (keep 0), cubes full (keep 1)  — the opaque early-Z far canopy
//
// [perf/look lane 2026-07-12 — leaves must never fade out to a visible block when very close to the
// camera] The band is TIER-DRIVEN off the voxel ring, not a fixed metre pair. The rule:
// SPRITES dress the NEAR HALF of the tier's voxel ring, opaque CUBES the FAR HALF, crossfading across a
// narrow band centred on the ring's HALF-radius. So the FIRST canopy the player sees is always sprite-
// dressed (his defect), the block fallback is the occluded far half + genuinely distant trees, and each
// tier spends sprites in proportion to how far it can even see: MEDIUM (r7 = 224 m ring) keeps sprites to
// ~96 m — well past "super close" — while LOW (r4 = 128 m ring) keeps its close ~55 m band so a weak GPU
// isn't drowned in sprite fill it can't afford. far_trees impostors (a separate lane) own everything past
// the ring edge, untouched. NEAR/FAR are computed per tier by pool_renderer via leaf_band_for(view_dist).

import { CHUNK_SIZE, TIER_LOAD_RADIUS } from '../config/world_config.js'

/** Sprite→cube crossfade window as a FRACTION of the tier's voxel view distance (ring radius in metres).
 *  Centred on the ring's HALF-radius (0.5) with a ±0.07 half-width: sprites own the near ~43%, cubes the
 *  far ~57%. One rule, derived from the ONE ring-radius source (world_config.TIER_LOAD_RADIUS × CHUNK_SIZE)
 *  — the band auto-follows any future ring change, and each tier's band scales with what it can see. */
export const LEAF_BAND_NEAR_FRAC = 0.43
export const LEAF_BAND_FAR_FRAC = 0.57

/** The tier's voxel view distance in metres = ring radius (chunks) × CHUNK_SIZE. @param {'low'|'medium'|'high'} tier */
export const tier_view_distance_m = (tier) => (TIER_LOAD_RADIUS[tier] ?? TIER_LOAD_RADIUS.medium) * CHUNK_SIZE

/**
 * The near→far band (metres) for a given voxel VIEW DISTANCE — sprites below `near`, opaque cubes above
 * `far`, crossfade between. Derived from the ring so it can never drift from the streamed radius.
 * @param {number} view_dist_m the tier's voxel ring radius in metres (tier_view_distance_m)
 * @returns {{ near: number, far: number }}
 */
export function leaf_band_for(view_dist_m) {
  return { near: view_dist_m * LEAF_BAND_NEAR_FRAC, far: view_dist_m * LEAF_BAND_FAR_FRAC }
}

/** MEDIUM-tier band (metres) — the DEFAULT used by isolated callers/tests that don't thread a tier band
 *  (terrain_material.js falls back to these; the live pool path passes the real per-tier band). MEDIUM
 *  r7 = 224 m ring ⇒ near ≈ 96 m / far ≈ 128 m: the reference tier, sprites well past "super close". */
export const { near: LEAF_BAND_NEAR_M, far: LEAF_BAND_FAR_M } = leaf_band_for(tier_view_distance_m('medium'))

/** Clamped Hermite smoothstep in [0,1] — the exact curve three/tsl's `smoothstep(edge0,edge1,x)` lowers to
 *  (3t²−2t³), so the JS mirror below matches the shader collapse. @param {number} edge0 @param {number}
 *  edge1 @param {number} x @returns {number} */
export function smoothstep01(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * The two per-quad collapse keeps at a camera distance — the tested twin of the TSL band factors the
 * canopy/cutout vertex stages apply. `cube_keep` scales the opaque leaf CUBE (0 near → 1 far);
 * `sprite_keep` scales the leaf SPRITE (1 near → 0 far). They sum to 1 everywhere (a strict crossfade),
 * so the canopy silhouette is continuous across the seam (no gap, no double-bright plateau). `near`/`far`
 * default to the MEDIUM band; the live path passes the tier's own band (leaf_band_for).
 * @param {number} dist camera→anchor distance in metres
 * @param {number} [near] band start (sprites full below)
 * @param {number} [far] band end (cubes full above)
 * @returns {{ cube_keep: number, sprite_keep: number }}
 */
export function leaf_band_factors(dist, near = LEAF_BAND_NEAR_M, far = LEAF_BAND_FAR_M) {
  const s = smoothstep01(near, far, dist)
  return { cube_keep: s, sprite_keep: 1 - s }
}

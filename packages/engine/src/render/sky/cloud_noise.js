// Pure cloud math — the GPU-free half of the clouds system. Holds the deterministic seeded noise (the
// CPU reference/fallback for the baked `mx_` weather/base fields, and the surface the "cloud noise
// determinism from seed" tests exercise), the shadow-transmittance extinction coefficient, and the
// tier knobs (bake resolutions + shadow footprint gate). clouds.js (the TSL/GPU module) imports the
// CONSTANTS + seed-offset helper from here so the shipped shader and the unit-tested math share one
// source.
//
// ENG-15 (2026-07-04): the per-pixel volumetric MARCH was deleted in favour of a FLAT cloud deck
// (clouds.js). With no view raymarch, the dual-lobe HG phase / Beer–powder / perlin-worley shading
// math and the march-tier knobs (march step counts, sun taps, detail-volume res, raymarch res_scale)
// were removed with it. What remains is what the FLAT deck + the SACRED top-down shadow map use.
//
// Portions adapted from fable5-world-demo (src/sky/Clouds.ts), MIT,
// Copyright (c) 2026 Remi Sebastian Kits.

import { lerp } from '../../core/math_utils.js'

/** shadow-map optical-depth → transmittance coefficient (the top-down cloud-shadow integral). */
export const SHADOW_EXTINCTION = 0.045

/** default field seed (any 32-bit int forks the cloudscape deterministically). */
export const DEFAULT_CLOUD_SEED = 0x9e3779b1

// --- tier knobs -----------------------------------------------------------------------------------
/**
 * @typedef {object} CloudTier
 * @property {number} march_steps CLOUDS-ENABLED gate: 0 ⇒ no clouds (LOW), >0 ⇒ the flat deck +
 *   shadow render. (Historically the view-raymarch step count; kept as the on/off gate — and monotone
 *   across tiers — after the march was replaced by the flat deck so `features.clouds` wiring is stable.)
 * @property {number} base_res baked base perlin-worley volume resolution (cubed) — feeds the top-down
 *   shadow optical-depth integral (the flat deck's own cauliflower is procedural in clouds.js).
 * @property {number} shadow_res top-down cloud-shadow map resolution (squared)
 * @property {number} weather_res coverage/weather field resolution (squared) — the deck's coverage source
 */
// keyed by the `TierName` from core/quality/tiers.js so wiring can index `CLOUD_TIERS[tier]`.
/** @type {Readonly<Record<'low'|'medium'|'high', CloudTier>>} */
export const CLOUD_TIERS = {
  // LOW: clouds OFF (march_steps 0) — the floor. MEDIUM: unchanged (the p99 baseline). HIGH merges
  // the old high⊕ultra ceiling (high's base_res 96 + ultra's finest 1024 shadow / 512 weather res).
  low: { march_steps: 0, base_res: 32, shadow_res: 256, weather_res: 128 },
  medium: { march_steps: 24, base_res: 64, shadow_res: 512, weather_res: 384 },
  high: { march_steps: 32, base_res: 96, shadow_res: 1024, weather_res: 512 },
}

// --- deterministic seeded value noise (arithmetic-only; portable, no transcendentals) ------------

/**
 * 32-bit integer avalanche hash (Chris Wellons' "lowbias32"). Bit-exact and portable.
 * @param {number} x @returns {number} uint32 in [0, 2³²)
 */
export function hash_u32(x) {
  let h = x >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h = (h ^ (h >>> 16)) >>> 0
  return h
}

/**
 * Hash an integer lattice cell (+ seed) to a unit float.
 * @param {number} seed @param {number} ix @param {number} iy @param {number} iz @returns {number} [0,1)
 */
export function hash_to_unit(seed, ix, iy, iz) {
  let h = hash_u32(seed)
  h = hash_u32(h ^ (ix | 0))
  h = hash_u32(h ^ (iy | 0))
  h = hash_u32(h ^ (iz | 0))
  return h / 4294967296
}

/** @param {number} t @returns {number} Hermite fade (smoothstep on [0,1]). */
const fade = (t) => t * t * (3 - 2 * t)
// lerp imported from ../../core/math_utils.js (canonical).

/**
 * Trilinear value noise in [0,1], deterministic from seed. The CPU reference for the baked cloud
 * volume — same seed + position always yields the same value on any machine.
 * @param {number} seed @param {number} x @param {number} y @param {number} z @returns {number} [0,1]
 */
export function value_noise_3d(seed, x, y, z) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const ux = fade(x - x0)
  const uy = fade(y - y0)
  const uz = fade(z - z0)
  /** @param {number} dx @param {number} dy @param {number} dz */
  const corner = (dx, dy, dz) => hash_to_unit(seed, x0 + dx, y0 + dy, z0 + dz)
  const c00 = lerp(corner(0, 0, 0), corner(1, 0, 0), ux)
  const c10 = lerp(corner(0, 1, 0), corner(1, 1, 0), ux)
  const c01 = lerp(corner(0, 0, 1), corner(1, 0, 1), ux)
  const c11 = lerp(corner(0, 1, 1), corner(1, 1, 1), ux)
  return lerp(lerp(c00, c10, uy), lerp(c01, c11, uy), uz)
}

/**
 * Fractal (fBm) value noise, normalized to [0,1].
 * @param {number} seed @param {number} x @param {number} y @param {number} z
 * @param {number} [octaves] @param {number} [lacunarity] @param {number} [gain] @returns {number}
 */
export function fbm_3d(seed, x, y, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * value_noise_3d(seed + o * 0x1000193, x * freq, y * freq, z * freq)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}

/**
 * Per-octave domain offsets derived from a seed — replaces the demo's hardcoded 19.7/47.3 magic
 * offsets so the whole cloudscape is seed-forkable. Deterministic.
 * @param {number} seed @param {number} [count] @returns {Array<[number, number, number]>}
 */
export function cloud_bake_offsets(seed, count = 3) {
  /** @type {Array<[number, number, number]>} */
  const out = []
  for (let o = 0; o < count; o++) {
    out.push([hash_to_unit(seed, o, 11, 0) * 64, hash_to_unit(seed, o, 22, 0) * 64, hash_to_unit(seed, o, 33, 0) * 64])
  }
  return out
}

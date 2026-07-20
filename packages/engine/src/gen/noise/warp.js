// 3D domain warp (§2.1 NG1-A) — iq's fbm-of-a-warped-domain trick. Instead of sampling detail at
// the raw point, we OFFSET the point by a low-frequency vector noise field first: straight ridges
// bend into meandering canyon walls, flat contours become organic (refs #1/#3 "meander"). Cheap:
// three decorrelated 3D fbm samplers (one per axis) build the offset vector `q`; the caller adds
// `q * amp` to the sample point. (iq: q = (fbm(p), fbm(p+o1), fbm(p+o2)); return fbm(p + 4q).)
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor ONLY. Each axis sampler is a seeded 3D simplex
// fbm with an INJECTED `alea` prng (never Math.random) and the ipow amplitude table (never
// Math.pow at sample time). The three axis seeds are derived by fixed small integer offsets from
// the base seed so the components are decorrelated but reproducible on every machine.

import { createNoise3D } from 'simplex-noise'

import { alea, ipow } from './sampler.js'

/**
 * @typedef {object} WarpParams
 * @property {number} seed numeric sub-seed (from `derive_world_seeds`)
 * @property {number} base_period wavelength (world blocks) of the warp field's first octave — large
 *   (whole-hillside) so the warp bends broad contours, not fine detail (§2.1)
 * @property {number} octaves harmonic count of each axis fbm (§2.1: 2)
 * @property {number} [spread] lacunarity. Default 2.
 * @property {number} [gain] persistence. Default 0.5.
 */

/**
 * @typedef {object} WarpSampler
 * @property {(x: number, y: number, z: number, out: number[]) => void} offset writes the signed
 *   warp vector (each component in ~[-1,1]) into `out` (length-3 scratch). Caller scales by amp and
 *   adds to the sample point.
 * @property {number} seed the base sub-seed used (for golden identity)
 */

/** Fixed integer seed offsets for the three decorrelated axis fields (reproducible, §3.7). */
const AXIS_SEED_OFFSET = [0, 0x2f9b_1a53, 0x5c1e_77d1]

/**
 * Builds one seeded 3D fbm returning signed [-1,1] (for a warp component). Amplitude table via
 * ipow (no Math.pow at sample time). Kept local — the warp only needs signed vector components,
 * not the [0,1] remap the climate fbm sampler does.
 * @param {number} seed
 * @param {number} base_period
 * @param {number} octaves
 * @param {number} spread
 * @param {number} gain
 * @returns {(x: number, y: number, z: number) => number}
 */
function make_signed_fbm3(seed, base_period, octaves, spread, gain) {
  const noise3d = createNoise3D(alea(seed >>> 0))
  /** @type {number[]} */
  const inv_period = new Array(octaves)
  /** @type {number[]} */
  const amplitude = new Array(octaves)
  let amplitude_sum = 0
  for (let i = 0; i < octaves; i += 1) {
    inv_period[i] = ipow(spread, i) / base_period
    amplitude[i] = ipow(gain, i)
    amplitude_sum += amplitude[i]
  }
  const inv_amplitude_sum = 1 / amplitude_sum
  return function (x, y, z) {
    let sum = 0
    for (let i = 0; i < octaves; i += 1) {
      const f = inv_period[i]
      sum += noise3d(x * f, y * f, z * f) * amplitude[i]
    }
    return sum * inv_amplitude_sum // stays in [-1,1]
  }
}

/**
 * Builds a seeded 3D domain-warp sampler (three decorrelated fbm axis fields).
 * @param {WarpParams} params
 * @returns {WarpSampler}
 */
export function create_warp_sampler(params) {
  const { seed, base_period, octaves } = params
  const spread = params.spread ?? 2
  const gain = params.gain ?? 0.5

  const fx = make_signed_fbm3(seed ^ AXIS_SEED_OFFSET[0], base_period, octaves, spread, gain)
  const fy = make_signed_fbm3(seed ^ AXIS_SEED_OFFSET[1], base_period, octaves, spread, gain)
  const fz = make_signed_fbm3(seed ^ AXIS_SEED_OFFSET[2], base_period, octaves, spread, gain)

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number[]} out length-3 scratch, receives the signed warp vector
   * @returns {void}
   */
  function offset(x, y, z, out) {
    out[0] = fx(x, y, z)
    out[1] = fy(x, y, z)
    out[2] = fz(x, y, z)
  }

  return { offset, seed }
}

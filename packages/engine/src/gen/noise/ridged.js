// Ridged-multifractal 3D noise (§2.1 NG1-A) — the sharp-crease detail that turns the smooth spline
// heightfield into jagged ridgelines + overhang lips (refs #2/#3). Musgrave ridged multifractal:
// each octave folds `1 − |noise|` into a hard crease, squares it for sharpness, and weights the
// next octave by the current signal so ridges stay coherent instead of dissolving into fbm mush.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/Math.abs ONLY. simplex `createNoise3D` uses only
// Math.floor/Math.sqrt (verified) and takes an INJECTED prng — we inject `alea` so it never touches
// the banned Math.random. The per-octave amplitude table (`gain^i`) is precomputed with `ipow`
// (integer-power multiply loop) at construction — NO Math.pow at sample time (§3.7 ban). The
// classic Musgrave `exponent array` uses `pow(freq, -H)`; we fold that into the same fixed `ipow`
// gain table since H and the octave count are const, so the transcendental never appears.

import { createNoise3D } from 'simplex-noise'

import { alea, ipow } from './sampler.js'

/**
 * @typedef {object} RidgedParams
 * @property {number} seed numeric sub-seed (from `derive_world_seeds`)
 * @property {number} base_period wavelength (world blocks) of the first (lowest-freq) octave
 * @property {number} octaves harmonic count (§2.1: 2 LOW → 4-6 HIGH)
 * @property {number} [spread] frequency multiplier between octaves (lacunarity). Default 2.
 * @property {number} [gain] amplitude multiplier between octaves (persistence). Default 0.5.
 * @property {number} [offset] ridge offset — the crease height `offset − |noise|`. Default 1.
 * @property {number} [sharpness] weight of the previous octave on the next (Musgrave gain). Default 2.
 */

/**
 * @typedef {object} RidgedSampler
 * @property {(x: number, y: number, z: number) => number} sample ridged value in [0,1] at (x,y,z),
 *   1 = ridge crest, 0 = valley floor
 * @property {number} seed the sub-seed used (for golden identity / debugging)
 */

/**
 * Builds a seeded 3D ridged-multifractal sampler. Precomputes per-octave inverse-period + amplitude
 * so `sample` is a tight multiply/add loop with no per-call transcendental (§3.7). The result is
 * normalized into [0,1] by the amplitude total; crests approach 1, valleys approach 0.
 * @param {RidgedParams} params
 * @returns {RidgedSampler}
 */
export function create_ridged_sampler(params) {
  const { seed, base_period, octaves } = params
  const spread = params.spread ?? 2
  const gain = params.gain ?? 0.5
  const offset = params.offset ?? 1
  const sharpness = params.sharpness ?? 2

  const noise3d = createNoise3D(alea(seed))

  /** @type {number[]} per-octave 1/period (frequency in world-block⁻¹) */
  const inv_period = new Array(octaves)
  /** @type {number[]} per-octave amplitude (gain^i) */
  const amplitude = new Array(octaves)
  let amplitude_sum = 0
  for (let i = 0; i < octaves; i += 1) {
    inv_period[i] = ipow(spread, i) / base_period
    amplitude[i] = ipow(gain, i)
    amplitude_sum += amplitude[i]
  }
  const inv_amplitude_sum = 1 / amplitude_sum

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number} ridged value in [0,1]
   */
  function sample(x, y, z) {
    let sum = 0
    let weight = 1 // Musgrave inter-octave weight — high signal boosts the next octave's crease.
    for (let i = 0; i < octaves; i += 1) {
      const f = inv_period[i]
      // Fold noise into a crease: offset − |n| peaks (=offset) where n≈0, squared for a sharp ridge.
      let signal = offset - Math.abs(noise3d(x * f, y * f, z * f))
      signal *= signal
      signal *= weight
      // Feed the crest forward (clamped to [0,1]) so crests carry into finer octaves.
      weight = signal * sharpness
      if (weight < 0) weight = 0
      if (weight > 1) weight = 1
      sum += signal * amplitude[i]
    }
    const out = sum * inv_amplitude_sum
    if (out < 0) return 0
    if (out > 1) return 1
    return out
  }

  return { sample, seed }
}

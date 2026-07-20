// Seeded simplex + fbm sampler (§4.1, ports the aresrpg-world Noise2dSampler CONCEPT).
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/Math.sqrt ONLY. NO Math.sin/cos/tan/pow/exp/
// log/random anywhere in this module or its callers. Verified: simplex-noise@4 uses only
// arithmetic + Math.floor (+ compile-time Math.sqrt constants — IEEE-754 correctly-rounded,
// engine-independent), and takes an INJECTED prng — we inject `alea` below so it never touches
// the non-portable Math.random default. Harmonic period/amplitude are computed by integer-power
// multiplication loops (NOT Math.pow, which the legacy sampler used and which is banned here).

import { createNoise2D } from 'simplex-noise'

/**
 * @typedef {object} AleaState 4-word alea PRNG state (Baagoe/Johannes Baagøe algorithm).
 * @property {number} s0
 * @property {number} s1
 * @property {number} s2
 * @property {number} c
 */

/**
 * @typedef {(() => number) & { uint32: () => number }} AleaFn seeded [0,1) generator.
 */

/**
 * Mash — the alea key-scheduler. Pure float arithmetic (multiply/subtract/add, `>>> 0`), no
 * transcendentals. Deterministic across engines (all ops are IEEE-754 correctly-rounded).
 * @returns {(data: string) => number}
 */
function make_mash() {
  let n = 0xefc8249d
  return function mash(data) {
    const str = String(data)
    for (let i = 0; i < str.length; i += 1) {
      n += str.charCodeAt(i)
      let h = 0.02519603282416938 * n
      n = h >>> 0
      h -= n
      h *= n
      n = h >>> 0
      h -= n
      n += h * 0x100000000 // 2^32
    }
    return (n >>> 0) * 2.3283064365386963e-10 // 2^-32
  }
}

/**
 * Alea PRNG (Johannes Baagøe) — ports aresrpg-world's `alea.ts`. Integer/float arithmetic only,
 * deterministic and portable (§3.7). Seeded from a numeric sub-seed (from `derive_world_seeds`).
 * @param {number | string} seed
 * @returns {AleaFn}
 */
export function alea(seed) {
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let c = 1

  const mash = make_mash()
  s0 = mash(' ')
  s1 = mash(' ')
  s2 = mash(' ')

  const key = String(seed)
  s0 -= mash(key)
  if (s0 < 0) s0 += 1
  s1 -= mash(key)
  if (s1 < 0) s1 += 1
  s2 -= mash(key)
  if (s2 < 0) s2 += 1

  const random = /** @type {AleaFn} */ (
    function () {
      const t = 2091639 * s0 + c * 2.3283064365386963e-10 // 2^-32
      s0 = s1
      s1 = s2
      c = t | 0
      s2 = t - c
      return s2
    }
  )
  random.uint32 = () => random() * 0x100000000 // 2^32
  return random
}

/**
 * Integer power via multiplication loop — replaces the banned `Math.pow(base, int_exp)`.
 * @param {number} base
 * @param {number} exp non-negative integer exponent
 * @returns {number}
 */
export function ipow(base, exp) {
  let result = 1
  for (let i = 0; i < exp; i += 1) result *= base
  return result
}

/**
 * @typedef {object} FbmParams
 * @property {number} seed numeric sub-seed (from `derive_world_seeds`)
 * @property {number} base_period wavelength (in world blocks) of the first (lowest-freq) octave
 * @property {number} octaves harmonic count (§4.1: 6 for climate maps)
 * @property {number} [spread] frequency multiplier between octaves (lacunarity). Default 2.
 * @property {number} [gain] amplitude multiplier between octaves (persistence). Default 0.5.
 */

/**
 * @typedef {object} FbmSampler
 * @property {(x: number, z: number) => number} sample fbm value in [0,1] at world (x,z)
 * @property {number} seed the sub-seed used (for debugging / golden identity)
 */

/**
 * Builds a seeded fractal-Brownian-motion 2D sampler (octave sum of injected-prng simplex),
 * porting Noise2dSampler.rawEval: each octave i has period = base_period / spread^i and amplitude
 * = gain^i; the sum is normalized by the amplitude total into [0,1]. Precomputes per-octave
 * inverse-period + amplitude so `sample` is a tight multiply/add loop (no Math.pow per call).
 * @param {FbmParams} params
 * @returns {FbmSampler}
 */
export function create_fbm_sampler(params) {
  const { seed, base_period, octaves } = params
  const spread = params.spread ?? 2
  const gain = params.gain ?? 0.5

  const noise2d = createNoise2D(alea(seed))

  /** @type {number[]} per-octave 1/period (frequency in world-block⁻¹) */
  const inv_period = new Array(octaves)
  /** @type {number[]} per-octave amplitude */
  const amplitude = new Array(octaves)
  let amplitude_sum = 0
  for (let i = 0; i < octaves; i += 1) {
    const period = base_period / ipow(spread, i)
    const amp = ipow(gain, i)
    inv_period[i] = 1 / period
    amplitude[i] = amp
    amplitude_sum += amp
  }
  const inv_amplitude_sum = 1 / amplitude_sum

  /**
   * @param {number} x world block x
   * @param {number} z world block z
   * @returns {number} fbm value in [0,1]
   */
  function sample(x, z) {
    let noise = 0
    for (let i = 0; i < octaves; i += 1) {
      const f = inv_period[i]
      // simplex returns [-1,1]; remap to [0,1] then weight by octave amplitude.
      const raw = noise2d(x * f, z * f)
      noise += (raw * 0.5 + 0.5) * amplitude[i]
    }
    noise *= inv_amplitude_sum
    // clamp defensively (fbm of [0,1] weighted octaves stays in [0,1], but guard rounding).
    if (noise < 0) return 0
    if (noise > 1) return 1
    return noise
  }

  return { sample, seed }
}

/**
 * Builds a seeded 3D-ish sampler by layering two decorrelated 2D fbm samplers along an offset —
 * cheap pseudo-3D bias for the ±8-block density band (§4.2) without paying full createNoise3D.
 * Kept 2D-based deliberately: the density bias only needs a y-varying perturbation, and 2D fbm
 * with a y-derived offset stays arithmetic-only and matches the "narrow band" scope.
 * @param {FbmParams} params
 * @returns {{ sample: (x: number, y: number, z: number) => number, seed: number }}
 */
export function create_density_bias_sampler(params) {
  const fbm = create_fbm_sampler(params)
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number} bias in [-1,1]
   */
  function sample(x, y, z) {
    // Fold y into the 2D domain via a large decorrelating offset so vertically stacked samples
    // differ — remaps the [0,1] fbm to [-1,1] for a signed density bias.
    const a = fbm.sample(x + y * 31.7, z - y * 17.3)
    return a * 2 - 1
  }
  return { sample, seed: params.seed }
}

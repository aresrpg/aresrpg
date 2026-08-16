// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Biome placement (§4.3) — nearest-fit lookup in the 6-parameter climate space with smoothstep
// transition weights. Generalizes the legacy 3×3 heat/rain BiomesMapping (Biome.ts) from 2 axes
// to 5 (temperature, humidity, continentalness, erosion, pv), keeping its influence-blending idea:
// instead of a single dominant biome, we compute a weighted influence set so column_gen can
// bilinear-blend heights/surface probabilities across the 4×4 meta grid (§4.3).
//
// Esoteric biomes (crystal_hollows, obsidian_spires, void_marsh) are ordinary biome defs gated on
// extreme weirdness — zero special-case code (§4.3): they simply join the candidate set only when
// |weirdness-0.5|*2 crosses WEIRDNESS_ESOTERIC_THRESHOLD.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.sqrt/Math.abs only. No transcendentals.

import { BIOME_REGISTRY, WEIRDNESS_ESOTERIC_THRESHOLD, get_biome_by_id } from '../config/biome_registry.js'
import { smoothstep } from '../core/math_utils.js'

/**
 * @typedef {import('../config/biome_registry.js').BiomeDef} BiomeDef
 * @typedef {import('./noise/fields.js').ClimateSample} ClimateSample
 */

/**
 * @typedef {object} BiomeInfluence one biome's normalized weight at a column.
 * @property {number} id biome id
 * @property {number} weight normalized influence in [0,1] (weights across the set sum to 1)
 */

// Per-axis weighting of the climate-space distance metric. Temperature/humidity dominate the
// legacy mapping; continentalness/erosion/pv refine land-shape biomes. DEFAULT shaping data (§4) —
// a world overrides these via config.biome_selection.axis_weights (see create_biome_context).
const AXIS_WEIGHTS = {
  temperature: 1.0,
  humidity: 1.0,
  continentalness: 0.6,
  erosion: 0.5,
  pv: 0.4,
}

// How many nearest biomes contribute to the blended influence set (§4.3 transition weights).
const BLEND_K = 3
// Softness of the smoothstep falloff over distance — larger = wider transition bands.
const TRANSITION_SOFTNESS = 0.6

/**
 * @typedef {object} BiomeContext resolved config-first placement context (§4.3). Built once per world
 *   from its biome table + selection metric; every placement read goes through it so a per-world recipe
 *   drives placement. The DEFAULT context = the live biome_registry + module constants (golden parity).
 * @property {BiomeDef[]} common non-esoteric biomes — the always-eligible candidate set
 * @property {BiomeDef[]} esoteric weirdness-gated biomes — added only at extreme weirdness
 * @property {Map<number, BiomeDef>} by_id id → the CONFIG biome def (so a world's retuned land/densities win)
 * @property {typeof AXIS_WEIGHTS} axis_weights climate-space distance-metric weights
 * @property {number} blend_k nearest biomes blended
 * @property {number} transition_softness smoothstep falloff width
 * @property {number} esoteric_threshold |w-0.5|*2 gate for esoteric biomes
 * @property {Partial<Record<'temperature'|'humidity'|'continentalness'|'erosion'|'pv', number>>|undefined}
 *   climate_bias PLACEMENT-ONLY additive climate offset (per axis, clamped to [0,1]) — the Phase-0 §3
 *   "constant temperature/humidity" pin lever: bias the placement climate toward the world's family so
 *   that family wins nearest-fit. Terrain SHAPING still reads the raw climate (unbiased). Undefined = none.
 */

/**
 * @typedef {object} BiomeSelection the config.biome_selection block (all fields optional; defaults live).
 * @property {typeof AXIS_WEIGHTS} [axis_weights]
 * @property {number} [blend_k]
 * @property {number} [transition_softness]
 * @property {number} [weirdness_esoteric_threshold]
 * @property {Partial<Record<string, number>>} [climate_bias] placement-only additive climate offset (§4.3)
 */

/**
 * Builds a placement context from a world's biome table + selection block (config-first §4.3). Defaults =
 * the live biome_registry + module constants, so the DEFAULT world places byte-identically (golden parity).
 * A world with a TRIMMED `biomes` table (Phase-0 §3 single-family pin — e.g. rainforest's tropical family)
 * restricts the candidate set to that family, so every column nearest-fits within it: "one world = one
 * biome family". Splitting by `weirdness_gate` matches the registry's COMMON/ESOTERIC partition exactly.
 * @param {BiomeDef[]} [biomes] the world's biome table (config.biomes); default = the full live registry
 * @param {BiomeSelection} [selection] the world's config.biome_selection; default = the live metric constants
 * @returns {BiomeContext}
 */
export function create_biome_context(biomes = BIOME_REGISTRY, selection = {}) {
  return {
    common: biomes.filter((b) => !b.weirdness_gate),
    esoteric: biomes.filter((b) => b.weirdness_gate),
    by_id: new Map(biomes.map((b) => [b.id, b])),
    axis_weights: selection.axis_weights ?? AXIS_WEIGHTS,
    blend_k: selection.blend_k ?? BLEND_K,
    transition_softness: selection.transition_softness ?? TRANSITION_SOFTNESS,
    esoteric_threshold: selection.weirdness_esoteric_threshold ?? WEIRDNESS_ESOTERIC_THRESHOLD,
    climate_bias: selection.climate_bias,
  }
}

/** The 5 placement climate axes a bias may offset. */
const BIAS_AXES = /** @type {const} */ (['temperature', 'humidity', 'continentalness', 'erosion', 'pv'])

/**
 * Applies a PLACEMENT-ONLY additive climate bias, clamped to [0,1] per axis (the Phase-0 §3 pin lever).
 * Returns the biased climate for nearest-fit; the raw climate is untouched (terrain shaping still reads it).
 * @param {ClimateSample} climate @param {Partial<Record<string, number>>} bias @returns {ClimateSample}
 */
function bias_climate(climate, bias) {
  const out = { ...climate }
  for (const axis of BIAS_AXES) {
    const b = bias[axis]
    if (typeof b === 'number') {
      let v = climate[axis] + b
      if (v < 0) v = 0
      if (v > 1) v = 1
      out[axis] = v
    }
  }
  return out
}

/** The DEFAULT placement context — the live registry + metric constants. Context-free callers (tools,
 *  far-field, tests) use this, so they behave exactly as before adoption. */
const DEFAULT_PLACER = create_biome_context()

/**
 * Smoothstep (Hermite) in [0,1] between edges e0<e1. Ken Perlin's classic — polynomial only.
 * @param {number} e0
 * @param {number} e1
 * @param {number} x
 * @returns {number}
 */
export { smoothstep } // impl moved to core/math_utils.js (imported above); re-exported for gen consumers

/**
 * Weighted squared distance from a climate sample to a biome's target point in the 5-axis space.
 * Squared (no sqrt) — monotonic, so nearest-fit ordering is preserved and it's cheaper.
 * @param {ClimateSample} climate
 * @param {BiomeDef} biome
 * @param {typeof AXIS_WEIGHTS} [axis_weights] per-axis metric weights (default = the live constants)
 * @returns {number}
 */
export function climate_distance_sq(climate, biome, axis_weights = AXIS_WEIGHTS) {
  const c = biome.climate
  let d = 0
  let t

  t = (climate.temperature - c.temperature) * axis_weights.temperature
  d += t * t
  t = (climate.humidity - c.humidity) * axis_weights.humidity
  d += t * t
  t = (climate.continentalness - c.continentalness) * axis_weights.continentalness
  d += t * t
  t = (climate.erosion - c.erosion) * axis_weights.erosion
  d += t * t
  t = (climate.pv - c.pv) * axis_weights.pv
  d += t * t

  return d
}

/**
 * Returns the candidate biome set for a column: always the context's common biomes, plus its esoteric
 * ones when weirdness is extreme (§4.3). Deterministic, allocation-light (concat only when gated in).
 * @param {number} weirdness01 raw weirdness [0,1]
 * @param {BiomeContext} [placer] the world's placement context (default = the live registry context)
 * @returns {BiomeDef[]}
 */
export function candidate_biomes(weirdness01, placer = DEFAULT_PLACER) {
  const extremity = Math.abs(weirdness01 - 0.5) * 2
  if (placer.esoteric.length > 0 && extremity >= placer.esoteric_threshold) {
    return placer.common.concat(placer.esoteric)
  }
  return placer.common
}

/**
 * Computes the blended biome influence set at a column: the blend_k nearest biomes in climate space,
 * weighted by a smoothstep falloff of distance and each biome's `weight`, normalized to sum 1.
 * @param {ClimateSample} climate
 * @param {BiomeContext} [placer] the world's placement context (default = the live registry context)
 * @returns {BiomeInfluence[]} sorted descending by weight, length 1..blend_k
 */
export function biome_influences(climate, placer = DEFAULT_PLACER) {
  // PLACEMENT-ONLY climate bias (Phase-0 §3 pin): shift the sample toward the world's family before
  // nearest-fit. Undefined ⇒ the raw sample ⇒ byte-identical DEFAULT. weirdness (the esoteric gate) is
  // never biased. Terrain shaping elsewhere reads the raw climate, so the bias moves biomes, not heights.
  const pc = placer.climate_bias ? bias_climate(climate, placer.climate_bias) : climate
  const candidates = candidate_biomes(pc.weirdness, placer)

  // Rank by climate distance (ascending). Small K → a partial selection sort beats a full sort.
  /** @type {{ biome: BiomeDef, dist_sq: number }[]} */
  const scored = candidates.map((biome) => ({
    biome,
    dist_sq: climate_distance_sq(pc, biome, placer.axis_weights),
  }))
  scored.sort((a, b) => a.dist_sq - b.dist_sq)

  const k = Math.min(placer.blend_k, scored.length)
  // Reference distance = the K-th nearest, defines the smoothstep transition scale.
  const far = Math.sqrt(scored[Math.min(k, scored.length - 1)].dist_sq) + 1e-6

  /** @type {BiomeInfluence[]} */
  const influences = []
  let total = 0
  for (let i = 0; i < k; i += 1) {
    const { biome, dist_sq } = scored[i]
    const dist = Math.sqrt(dist_sq)
    // Nearer = heavier: smoothstep from the far edge back to 0, scaled by biome priority weight.
    const falloff = smoothstep(far * (1 + placer.transition_softness), 0, dist)
    const w = falloff * biome.weight
    influences.push({ id: biome.id, weight: w })
    total += w
  }

  // Normalize; guard the degenerate all-zero case (identical distances) by uniform split.
  if (total <= 0) {
    const uniform = 1 / k
    for (const inf of influences) inf.weight = uniform
  } else {
    for (const inf of influences) inf.weight /= total
  }

  influences.sort((a, b) => b.weight - a.weight)
  return influences
}

/**
 * The dominant (highest-influence) biome id at a column — the value written into ChunkRecord
 * `biome` meta cells. Convenience over `biome_influences(...)[0].id`.
 * @param {ClimateSample} climate
 * @param {BiomeContext} [placer] the world's placement context (default = the live registry context)
 * @returns {number}
 */
export function place_biome(climate, placer = DEFAULT_PLACER) {
  return biome_influences(climate, placer)[0].id
}

/**
 * Resolves the dominant biome def for a column (for strata/decorator lookup in column_gen). Returns the
 * CONFIG biome def from the context (so a world's retuned land/density wins), falling back to the registry.
 * @param {ClimateSample} climate
 * @param {BiomeContext} [placer] the world's placement context (default = the live registry context)
 * @returns {BiomeDef}
 */
export function place_biome_def(climate, placer = DEFAULT_PLACER) {
  const id = place_biome(climate, placer)
  return /** @type {BiomeDef} */ (placer.by_id.get(id) ?? get_biome_by_id(id))
}

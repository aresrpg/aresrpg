// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The 6 Minecraft-1.18 climate/shape parameters (§4.1) — a superset of the legacy heat/rain pair.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/Math.sqrt only. PV (peaks-and-valleys) is
// DERIVED from weirdness via a folded-ridge formula, NOT a 7th noise; `depth` is derived per
// voxel from y vs the target surface (computed in column_gen, not here). Every sampler is seeded
// from a distinct named sub-seed (derive_world_seeds) so the fields are decorrelated but stable.
//
// Sampling cadence (§4.1): Minecraft samples climate per quarter-chunk (every 4 blocks). We build
// a field-set once per world (the samplers) and evaluate on demand; column_gen samples the 8×8
// meta grid (one point per 4×4 column cell) and bilinearly reuses within cells.

import { DEFAULT_WORLD_GEN_CONFIG } from '../../config/world_gen_config.js'

import { create_fbm_sampler } from './sampler.js'

/**
 * @typedef {import('../../config/world_config.js').SubSeedName} SubSeedName
 * @typedef {import('../../config/world_gen_config.js').NoiseConfig} NoiseConfig
 */

/**
 * The five sampled climate/shape parameters at a world column (all normalized [0,1]). `pv` is
 * derived from weirdness; `depth` is per-voxel and lives in the shaper/column_gen, not here.
 * @typedef {object} ClimateSample
 * @property {number} temperature 0 cold → 1 hot (§4.1 biome axis)
 * @property {number} humidity 0 dry → 1 wet (§4.1 biome axis)
 * @property {number} continentalness 0 ocean → 1 far-inland (§4.1 base elevation)
 * @property {number} erosion 0 mountainous → 1 flat (§4.1 amplitude modulation)
 * @property {number} weirdness 0..1 raw ridge noise (§4.1; 0.5 = neutral)
 * @property {number} pv peaks-and-valleys in [0,1], derived from weirdness (§4.1)
 */

/**
 * @typedef {object} FieldSet the six seeded samplers, built once per world from sub-seeds.
 * @property {import('./sampler.js').FbmSampler} temperature
 * @property {import('./sampler.js').FbmSampler} humidity
 * @property {import('./sampler.js').FbmSampler} continentalness
 * @property {import('./sampler.js').FbmSampler} erosion
 * @property {import('./sampler.js').FbmSampler} weirdness
 */

// Per-parameter base periods (world blocks) + octave counts are CONFIG-DRIVEN (§2.3): the recipe
// lives in world_gen_config.js `noise` (byte-faithful to the historical constants — continentalness
// the lowest frequency, weirdness mid, climate octaves 6, weirdness 4). create_field_set reads the
// world's `noise` sub-block; the DEFAULT recipe is the fallback for context-free callers (tests).

/**
 * Derives peaks-and-valleys (PV) from weirdness by the canonical folded-ridge formula (§4.1):
 * `PV = 1 − |3·|W| − 2|`, with W the signed weirdness in [-1,1]. Rivers live where PV ≈ 0
 * (folds cross zero), peaks where PV ≈ 1. Input `weirdness01` is the [0,1] fbm value; we remap to
 * signed W = 2·weirdness01 − 1 first. Result is clamped to [0,1]. Arithmetic + Math.abs only.
 * @param {number} weirdness01 raw weirdness in [0,1]
 * @returns {number} PV in [0,1]
 */
export function derive_pv(weirdness01) {
  const w = weirdness01 * 2 - 1
  const folded = 1 - Math.abs(3 * Math.abs(w) - 2)
  if (folded < 0) return 0
  if (folded > 1) return 1
  return folded
}

/**
 * Builds one climate field's fbm sampler from its config + sub-seed (period/octaves/spread/gain).
 * @param {number} seed
 * @param {import('../../config/world_gen_config.js').NoiseFieldConfig} field
 * @returns {import('./sampler.js').FbmSampler}
 */
function field_sampler(seed, field) {
  return create_fbm_sampler({
    seed,
    base_period: field.period,
    octaves: field.octaves,
    spread: field.spread,
    gain: field.gain,
  })
}

/**
 * Builds the six-parameter field-set from a named sub-seed map + the world's `noise` recipe. Call
 * once at gen-worker boot. The recipe defaults to the live/default world so context-free callers
 * (tests) keep working unchanged.
 * @param {Record<SubSeedName, number>} seeds output of `derive_world_seeds`
 * @param {NoiseConfig} [noise] the world's climate-field recipe (world_gen_config `noise`)
 * @returns {FieldSet}
 */
export function create_field_set(seeds, noise = DEFAULT_WORLD_GEN_CONFIG.noise) {
  return {
    temperature: field_sampler(seeds.heat, noise.temperature),
    humidity: field_sampler(seeds.rain, noise.humidity),
    continentalness: field_sampler(seeds.continentalness, noise.continentalness),
    erosion: field_sampler(seeds.erosion, noise.erosion),
    weirdness: field_sampler(seeds.weirdness, noise.weirdness),
  }
}

/**
 * Samples all six parameters at one world column (x,z). PV is derived from the sampled weirdness.
 * @param {FieldSet} fields
 * @param {number} world_x
 * @param {number} world_z
 * @returns {ClimateSample}
 */
export function sample_climate(fields, world_x, world_z) {
  const temperature = fields.temperature.sample(world_x, world_z)
  const humidity = fields.humidity.sample(world_x, world_z)
  const continentalness = fields.continentalness.sample(world_x, world_z)
  const erosion = fields.erosion.sample(world_x, world_z)
  const weirdness = fields.weirdness.sample(world_x, world_z)
  return {
    temperature,
    humidity,
    continentalness,
    erosion,
    weirdness,
    pv: derive_pv(weirdness),
  }
}

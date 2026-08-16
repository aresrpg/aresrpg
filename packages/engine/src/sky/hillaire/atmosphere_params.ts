// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// C9 — Hillaire EGSR 2020 sky/atmosphere: the ATMOSPHERE PARAMETER STRUCT (the R2 per-world tie-in).
// ONE physical parameter set drives Earth, Mars-class, and tiny-planet skies (paper fig. 1/10) — the
// S-72 "20 worlds = 20 atmosphere parameter SETS, not 20 hand-tuned gradients" goal. The B5 mood
// crossfader lerps these fields; set_atmosphere_params(...) (engine api) writes them live.
//
// ALL LENGTHS ARE IN KILOMETRES and all scattering/absorption coefficients are PER-KILOMETRE. The
// paper's Earth coefficients are quoted per-metre (×1e-6); converted to per-km here (×1e-3) so the
// ray-march runs in km — float32 has ~7 significant digits, and a 6360 km planet radius keeps metre-
// scale steps well inside precision (6 360 000 m would sit at the float32 precision floor → banding).
// Reference: sebh.github.io/publications/egsr2020.pdf Table 1/§4; matches Hillaire's own sample code.

/**
 * @typedef {[number, number, number]} Rgb
 *
 * @typedef {object} AtmosphereParams
 * @property {number} ground_radius_km    planet surface radius (Earth 6360).
 * @property {number} top_radius_km       top-of-atmosphere radius (Earth 6460 — a 100 km shell).
 * @property {Rgb}    rayleigh_scattering per-km Rayleigh scattering σs at sea level (the sky-blue term).
 * @property {number} rayleigh_density_h  Rayleigh exponential density scale height, km (Earth 8).
 * @property {number} mie_scattering      per-km Mie scattering σs at sea level (the white forward haze).
 * @property {number} mie_absorption      per-km Mie absorption σa at sea level.
 * @property {number} mie_g               Mie Henyey-Greenstein anisotropy (Earth 0.8 — forward lobe).
 * @property {number} mie_density_h       Mie exponential density scale height, km (Earth 1.2).
 * @property {Rgb}    ozone_absorption    per-km ozone absorption at the layer peak (the horizon-blue term).
 * @property {number} ozone_center_km     ozone tent centre altitude, km (Earth 25).
 * @property {number} ozone_width_km      ozone tent half-width, km (Earth 15 → density 0 at 10 & 40 km).
 * @property {Rgb}    ground_albedo       diffuse ground reflectance feeding the multiple-scattering LUT.
 * @property {Rgb}    sun_illuminance     the sun's spectral illuminance at the top of atmosphere (globalL).
 * @property {number} exposure            physical-luminance → scene-radiance scale (the fig-3 taste dial).
 * @property {number} length_unit_m       WORLD units per metre — the scene↔atmosphere scale (default 1).
 * @property {number} aerial_range_km     how far the aerial-perspective froxel volume reaches (paper 32).
 * @property {number} aerial_depth_power  froxel slice distance distribution exponent (2 = near-dense).
 */

/**
 * The paper's Earth atmosphere — the DEFAULT parameter set. Every field is physical; a lush world
 * denser Rayleigh, Emberfall's bruised-ochre sky the paper's Mars sunset, etc. are alternate sets fed
 * through set_atmosphere_params later (the mood system). Frozen so callers cannot mutate the canon.
 * @type {Readonly<AtmosphereParams>}
 */
export type Rgb = readonly [number, number, number]
export type AtmosphereParams = Readonly<{
  ground_radius_km: number
  top_radius_km: number
  rayleigh_scattering: Rgb
  rayleigh_density_h: number
  mie_scattering: number
  mie_absorption: number
  mie_g: number
  mie_density_h: number
  ozone_absorption: Rgb
  ozone_center_km: number
  ozone_width_km: number
  ground_albedo: Rgb
  sun_illuminance: Rgb
  exposure: number
  length_unit_m: number
  aerial_range_km: number
  aerial_depth_power: number
}>

export const EARTH_ATMOSPHERE: AtmosphereParams = Object.freeze({
  ground_radius_km: 6360.0,
  top_radius_km: 6460.0,
  // per-km (paper per-metre 5.802/13.558/33.1e-6 × 1e3):
  rayleigh_scattering: [5.802e-3, 13.558e-3, 33.1e-3] as const,
  rayleigh_density_h: 8.0,
  mie_scattering: 3.996e-3, // per-km (paper 3.996e-6/m)
  mie_absorption: 4.4e-3, // per-km (paper 4.4e-6/m)
  mie_g: 0.8,
  mie_density_h: 1.2,
  ozone_absorption: [0.65e-3, 1.881e-3, 0.085e-3] as const, // per-km (paper 0.650/1.881/0.085e-6/m)
  ozone_center_km: 25.0,
  ozone_width_km: 15.0,
  ground_albedo: [0.3, 0.3, 0.3] as const,
  sun_illuminance: [1.0, 1.0, 1.0] as const,
  // exposure maps the physical sky luminance (sun_illuminance = 1) into the engine's linear-radiance
  // range. Tuned from the noon exposure sweep: at 3.0 the flag-on noon zenith sRGB≈(77,131,201) matches
  // the analytic SKY_DAY zenith [0.10,0.24,0.52], with a luminous pale-blue horizon. A per-world dial.
  exposure: 3.0,
  length_unit_m: 1.0,
  aerial_range_km: 32.0,
  aerial_depth_power: 2.0,
})

/**
 * Merge a partial override onto a base parameter set (set_atmosphere_params / mood crossfade). Shallow
 * per-field; arrays replaced wholesale. Returns a fresh plain object (never mutates the base).
 * @param {AtmosphereParams} base
 * @param {Partial<AtmosphereParams>} [over]
 * @returns {AtmosphereParams}
 */
export function merge_atmosphere_params(
  base: AtmosphereParams,
  over: Partial<AtmosphereParams> = {}
): AtmosphereParams {
  return { ...base, ...over }
}

/**
 * @typedef {object} SkyTier
 * @property {number} transmittance_w  transmittance LUT width (view-zenith axis).
 * @property {number} transmittance_h  transmittance LUT height (altitude axis).
 * @property {number} transmittance_steps  optical-depth ray-march steps.
 * @property {number} multiscatter_res  multiple-scattering LUT edge (square).
 * @property {number} multiscatter_steps  ray-march steps per sphere direction.
 * @property {number} multiscatter_sqrt_samples  √(sphere direction count) (8 → 64 dirs).
 * @property {number} skyview_w  sky-view LUT width (azimuth axis).
 * @property {number} skyview_h  sky-view LUT height (non-linear latitude axis).
 * @property {number} skyview_steps  in-scatter ray-march steps along the view ray.
 * @property {number} aerial_res  aerial froxel volume edge (x = y).
 * @property {number} aerial_slices  aerial froxel depth slices.
 * @property {number} aerial_steps  ray-march steps accumulated across the whole volume.
 * @property {boolean} rebuild_on_sun_only  LOW: rebuild sky-view/aerial only on a sun-angle change.
 */

/**
 * The C9 tier ladder (R2 "our tier ladder inherits the same degrade dials"):
 *  HIGH   = the paper's resolutions (256×64 / 32² / 200×100 / 32³).
 *  MEDIUM = the Fortnite-mobile ship config (sky-view 96×50 @ 8 steps, aerial 32²×16) — the paper
 *           proves it "not noticeable to the naked eye".
 *  LOW    = MEDIUM geometry but sky-view/aerial rebuild ONLY on a sun-angle change (per-frame-skippable).
 * @type {Record<'low'|'medium'|'high', SkyTier>}
 */
export type SkyTier = Readonly<{
  transmittance_w: number
  transmittance_h: number
  transmittance_steps: number
  multiscatter_res: number
  multiscatter_steps: number
  multiscatter_sqrt_samples: number
  skyview_w: number
  skyview_h: number
  skyview_steps: number
  aerial_res: number
  aerial_slices: number
  aerial_steps: number
  rebuild_on_sun_only: boolean
}>

export const SKY_TIERS: Readonly<Record<'low' | 'medium' | 'high', SkyTier>> = {
  high: {
    transmittance_w: 256,
    transmittance_h: 64,
    transmittance_steps: 40,
    multiscatter_res: 32,
    multiscatter_steps: 20,
    multiscatter_sqrt_samples: 8, // 64 directions
    skyview_w: 200,
    skyview_h: 100,
    skyview_steps: 30,
    aerial_res: 32,
    aerial_slices: 32,
    aerial_steps: 30,
    rebuild_on_sun_only: false,
  },
  medium: {
    transmittance_w: 256,
    transmittance_h: 64,
    transmittance_steps: 40,
    multiscatter_res: 32,
    multiscatter_steps: 20,
    multiscatter_sqrt_samples: 4, // 16 directions — cheaper feedback factor, visually identical
    skyview_w: 96,
    skyview_h: 50,
    skyview_steps: 8,
    aerial_res: 32,
    aerial_slices: 16,
    aerial_steps: 16,
    rebuild_on_sun_only: false,
  },
  low: {
    transmittance_w: 256,
    transmittance_h: 64,
    transmittance_steps: 40,
    multiscatter_res: 32,
    multiscatter_steps: 20,
    multiscatter_sqrt_samples: 4,
    skyview_w: 96,
    skyview_h: 50,
    skyview_steps: 8,
    aerial_res: 32,
    aerial_slices: 16,
    aerial_steps: 16,
    rebuild_on_sun_only: true, // per-frame-skippable: rebuild the view LUTs only when the sun moves
  },
}

/**
 * Resolve a tier name (or an explicit SkyTier object) to a SkyTier. Defaults to HIGH.
 * @param {'low'|'medium'|'high'|SkyTier} [tier]
 * @returns {SkyTier}
 */
export function resolve_sky_tier(tier: 'low' | 'medium' | 'high' | SkyTier = 'high'): SkyTier {
  if (tier && typeof tier === 'object') return tier
  return SKY_TIERS[/** @type {'low'|'medium'|'high'} */ tier] ?? SKY_TIERS.high
}

/**
 * Ozone tent density at altitude h (km) — the cheap, load-bearing horizon-blue term: a linear tent
 * peaking at ozone_center_km, reaching 0 at ±ozone_width_km. Pure JS twin of the TSL expression
 * (physics.js) so the shape is unit-testable.
 * @param {number} h_km @param {number} center_km @param {number} width_km @returns {number}
 */
export function ozone_density(h_km: number, center_km: number, width_km: number): number {
  return Math.max(0, 1 - Math.abs(h_km - center_km) / width_km)
}

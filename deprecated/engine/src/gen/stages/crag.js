// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RELIEF LADDER stage (TERRAIN REALISM BASELINE — docs/TERRAIN_REALISM_BASELINE.md). Grew out of the
// GLACIAL §A crag/gully spectrum repair into the DEFAULT multi-scale realism ladder: FOUR additive
// height terms composed into raw_land alongside mountain_relief/canyon (one height home):
//   band  — relief-SCALED ridged (~40-320 band): sharp crag/gully texture on high-relief ridges, calm
//           in valleys (smoothstep of the shaper's relief above relief_floor — no circular slope read).
//   base  — UNSCALED ridged (~250): the CONNECTED RIDGE NETWORK + enclosed valleys across the whole
//           zone. This is what kills "one boulder on a smooth gradient" (v3/v4 reject root cause): a
//           relief-damped band vanishes exactly where terrain is flat, so the network must be unscaled.
//   roll  — UNSCALED mid fbm (~60): drumlin/moraine rolling mounds.
//   micro — UNSCALED fine fbm (~8-30): the ANTI-FLAT GUARANTEE — rides everywhere so voxel terrace
//           stripes ("plowed furrows") and dead-flat shelves never survive by omission.
// base/roll default to amp 0 ⇒ any recipe not setting them is byte-identical to the pre-ladder stage.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/abs + seeded simplex (alea) only. No sin/cos/pow/random.

import { create_ridged_sampler } from '../noise/ridged.js'
import { create_fbm_sampler } from '../noise/sampler.js'

/** @typedef {import('../../config/world_gen_config.js').CragConfig} CragConfig */

/**
 * @typedef {object} CragContext resolved relief-ladder stage (samplers built once per world).
 * @property {boolean} enabled stage on
 * @property {import('../noise/ridged.js').RidgedSampler} band ridged crag/gully sampler (relief-scaled)
 * @property {import('../noise/ridged.js').RidgedSampler} base unscaled ridge-network sampler
 * @property {import('../noise/sampler.js').FbmSampler} roll unscaled drumlin/moraine roll sampler
 * @property {import('../noise/sampler.js').FbmSampler} micro fine anti-flat roughness sampler
 * @property {number} band_amp crag half-amplitude (blocks) at full relief
 * @property {number} base_amp ridge-network half-amplitude (blocks), applied everywhere (0 = off)
 * @property {number} roll_amp drumlin roll half-amplitude (blocks), applied everywhere (0 = off)
 * @property {number} micro_amp micro roughness half-amplitude (blocks), applied everywhere
 * @property {number} relief_floor relief below which the crag band is fully damped (valley calm)
 * @property {number} relief_gain relief span (>0) over which crag ramps 0→1 above the floor
 * @property {number} flat_lo FLAT-SMOOTH: relief at/below which the fine roll+micro
 *   jitter is FULLY attenuated (walkable plains read as clean runs). flat_hi ≤ flat_lo ⇒ no damping (off).
 * @property {number} flat_hi relief at/above which roll+micro ride at FULL amplitude (steep/high-relief
 *   terrain — cliffs, badlands, peaks — is untouched); smoothstep across [flat_lo, flat_hi]
 */

/**
 * Builds the relief-ladder context from a world's `crag` recipe + the carvers sub-seed (distinct XOR
 * salts from every other stage). Samplers allocate once per world (never per column). Disabled ⇒
 * enabled:false. base/roll amps default 0 (pre-ladder recipes stay byte-identical).
 * @param {Partial<CragConfig>} [cfg]
 * @param {Record<string, number>} [seeds] output of derive_world_seeds
 * @returns {CragContext}
 */
export function create_crag_context(cfg, seeds) {
  const carve = (seeds?.carvers ?? 0) >>> 0
  const rg = cfg?.relief_gain
  return {
    enabled: cfg?.enabled === true,
    band: create_ridged_sampler({
      seed: (carve ^ 0xc2a9_0001) >>> 0,
      base_period: cfg?.band_period ?? 320,
      octaves: cfg?.band_octaves ?? 4,
      gain: 0.5,
      offset: 1,
      sharpness: 2,
    }),
    base: create_ridged_sampler({
      seed: (carve ^ 0xc2a9_0004) >>> 0,
      base_period: cfg?.base_period ?? 250,
      octaves: cfg?.base_octaves ?? 4,
      gain: 0.5,
      offset: 1,
      sharpness: 2,
    }),
    roll: create_fbm_sampler({
      seed: (carve ^ 0xc2a9_0005) >>> 0,
      base_period: cfg?.roll_period ?? 60,
      octaves: cfg?.roll_octaves ?? 3,
    }),
    micro: create_fbm_sampler({
      seed: (carve ^ 0xc2a9_0002) >>> 0,
      base_period: cfg?.micro_period ?? 20,
      octaves: cfg?.micro_octaves ?? 2,
    }),
    band_amp: cfg?.band_amp ?? 26,
    base_amp: cfg?.base_amp ?? 0,
    roll_amp: cfg?.roll_amp ?? 0,
    micro_amp: cfg?.micro_amp ?? 2.5,
    relief_floor: cfg?.relief_floor ?? 0.12,
    relief_gain: rg !== undefined && rg > 0 ? rg : 0.5,
    // FLAT-SMOOTH default OFF (flat_hi ≤ flat_lo ⇒ hf 1 everywhere ⇒ byte-identical to the pre-knob stage).
    flat_lo: cfg?.flat_lo ?? 0,
    flat_hi: cfg?.flat_hi ?? 0,
  }
}

/**
 * Additive relief-ladder height delta (blocks) for a column. `relief` is the shaper's PV-derived
 * relief factor (0 valley floor → 1 peak); only the crag band is scaled by a smoothstep of relief
 * above relief_floor — base/roll/micro ride EVERYWHERE unscaled (the ridge network + anti-flat
 * guarantee). Zero-amp terms skip their sample (identical output, cheaper). Signed (can raise or
 * lower the surface). Zero when disabled.
 * @param {CragContext} cctx
 * @param {number} world_x @param {number} world_z
 * @param {number} relief shaper relief factor [0,1]
 * @returns {number} height delta in blocks (0 when disabled)
 */
export function crag_height_delta(cctx, world_x, world_z, relief) {
  if (!cctx.enabled) return 0
  // Crag band (relief-damped): ridged [0,1] → signed [-1,1] × band_amp × smoothstep(relief ramp).
  let rr = (relief - cctx.relief_floor) / cctx.relief_gain
  if (rr < 0) rr = 0
  if (rr > 1) rr = 1
  const relief_scale = rr * rr * (3 - 2 * rr)
  const band =
    relief_scale !== 0 && cctx.band_amp !== 0
      ? (cctx.band.sample(world_x, 0, world_z) * 2 - 1) * cctx.band_amp * relief_scale
      : 0
  // Unscaled ridge network: connected crests + enclosed valleys threading the whole zone.
  const base = cctx.base_amp !== 0 ? (cctx.base.sample(world_x, 0, world_z) * 2 - 1) * cctx.base_amp : 0
  // Unscaled drumlin/moraine roll.
  const roll = cctx.roll_amp !== 0 ? (cctx.roll.sample(world_x, world_z) * 2 - 1) * cctx.roll_amp : 0
  // Micro roughness: fbm [0,1] → signed, small amplitude, EVERYWHERE (breaks quantization furrows).
  const micro = (cctx.micro.sample(world_x, world_z) * 2 - 1) * cctx.micro_amp
  // FLAT-SMOOTH ("softly smooth the plains, keep the variety"): the fine roll+micro jitter
  // is what makes low-relief WALKABLE plains read as rubble. Attenuate it by a smoothstep of `relief` (the
  // flatness signal — surface = base + relief×amplitude, so relief≈0 IS a plain) across [flat_lo, flat_hi]:
  // flats → 0 (clean runs), steep/high-relief (cliffs/badlands/peaks) → 1 (untouched). base (the macro
  // ridge network) + band (already relief-scaled) are NOT damped, so plains keep a soft broad undulation —
  // never dead-flat. flat_hi ≤ flat_lo ⇒ hf 1 ⇒ byte-identical (the off default).
  let hf = 1
  if (cctx.flat_hi > cctx.flat_lo) {
    let t = (relief - cctx.flat_lo) / (cctx.flat_hi - cctx.flat_lo)
    t = t < 0 ? 0 : t > 1 ? 1 : t
    hf = t * t * (3 - 2 * t)
  }
  return band + base + (roll + micro) * hf
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GLACIER RIBBON + MORAINES stage (GLACIAL GENERATION §B.3). A SURFACE-MATERIAL stage that paints the flat
// trough floors of the ice-altitude band as a glacier ribbon (ref R3): ICE/firn surface, a dark MEDIAL
// moraine stripe down the valley centreline, dark LATERAL moraines hugging the walls, periodic CREVASSE
// banding across the flow, and a hummocky TERMINAL RUBBLE patch at the ribbon's low end. Every feature is a
// 2D field over (world_x, world_z) that resolves to ONE block id per column — the moraine/crevasse pattern
// curves with the valley because it is keyed on PV (the folded-ridge valley field) + altitude, so it reads
// exactly like the aerial ref without a height carve (the trough §B.1 supplies the flat floor; the moraine
// RELIEF ridgelets are a deferred refinement — the stated oracle is "stripes curve with the valley in the
// topdown", a material pattern). Column-resolved in build_column_profile, applied at the top voxel in
// block_at. Off by default (enabled:false) or with unresolved ice ⇒ -1 everywhere ⇒ byte-identical DEFAULT.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor + integer compare only. No sin/cos/pow/random, no hashing.

import { get_block_by_name } from '../../config/block_registry.js'

/** @typedef {import('../../config/world_gen_config.js').GlacierConfig} GlacierConfig */

/**
 * @typedef {object} GlacierContext resolved glacier stage (palette names → ids, once per world).
 * @property {boolean} enabled stage on (config enabled AND the ice block resolved)
 * @property {number} sea_level land-ice only above this waterline
 * @property {number} ice_low bottom of the glacier ice altitude band (world-y)
 * @property {number} ice_high top of the ice band (above = snow/rock via the surface stage)
 * @property {number} flat_gate slope (rise/run) at/below which a column is a flat floor (glacier-eligible)
 * @property {number} valley_pv pv at/below which a column is a valley/trough floor
 * @property {number} medial_pv pv at/below which the centreline reads as dark medial moraine
 * @property {number} lateral_band pv within this of valley_pv reads as lateral moraine (wall-hugging)
 * @property {number} crevasse_period altitude period of the crevasse banding, blocks (≥1)
 * @property {number} terminal_band blocks above ice_low that read as terminal rubble
 * @property {number} firn_band blocks below ice_high that read as granular firn (snow)
 * @property {number} ice_id main glacier-ice block id @property {number} firn_id upper granular firn id
 * @property {number} moraine_id dark debris (medial + lateral) id @property {number} crevasse_id crevasse groove id
 * @property {number} rubble_id terminal rubble id
 */

/** Resolve a block name → id, falling back to `fallback` (name) when absent. @param {string} name @param {number} fallback @returns {number} */
function id_or(name, fallback) {
  const id = get_block_by_name(name)?.id
  return id === undefined ? fallback : id
}

/**
 * Builds the glacier stage context from a world's `glacier` recipe + sea level. Ice ids are resolved by name
 * (feature-detected — a bundle without `ice` disables the stage). Disabled ⇒ enabled:false everywhere.
 * @param {Partial<GlacierConfig>} [cfg]
 * @param {number} [sea_level]
 * @returns {GlacierContext}
 */
export function create_glacier_context(cfg, sea_level = 128) {
  const ice_id = get_block_by_name(cfg?.ice_block ?? 'ice')?.id
  const stone_id = /** @type {number} */ (get_block_by_name('stone')?.id ?? 0)
  return {
    enabled: cfg?.enabled === true && ice_id !== undefined,
    sea_level,
    ice_low: cfg?.ice_low ?? 150,
    ice_high: cfg?.ice_high ?? 260,
    flat_gate: cfg?.flat_gate ?? 0.35,
    valley_pv: cfg?.valley_pv ?? 0.28,
    medial_pv: cfg?.medial_pv ?? 0.05,
    lateral_band: cfg?.lateral_band ?? 0.06,
    crevasse_period: Math.max(1, Math.floor(cfg?.crevasse_period ?? 9)),
    terminal_band: cfg?.terminal_band ?? 12,
    firn_band: cfg?.firn_band ?? 24,
    ice_id: /** @type {number} */ (ice_id ?? stone_id),
    firn_id: id_or(cfg?.firn_block ?? 'snow', /** @type {number} */ (ice_id ?? stone_id)),
    moraine_id: id_or(cfg?.moraine_block ?? 'stone', stone_id),
    crevasse_id: id_or(cfg?.crevasse_block ?? 'packed_ice', /** @type {number} */ (ice_id ?? stone_id)),
    rubble_id: id_or(cfg?.rubble_block ?? 'stone', stone_id),
  }
}

/**
 * The glacier surface block id for a column's TOP voxel, or -1 for "not a glacier floor" (keep the biome /
 * snow-slope surface). Gate: land ice above the waterline, inside [ice_low, ice_high], flat (slope ≤
 * flat_gate), in a valley (pv ≤ valley_pv). Within that: terminal rubble at the low end, dark medial moraine
 * at the centre, lateral moraine near the wall, crevasse banding across the flow, firn near the top, else ice.
 * Pure per-column classifier.
 * @param {GlacierContext} gc
 * @param {number} surface_y effective surface world-y at the column
 * @param {number} slope column slope (rise/run) @param {number} pv peaks-and-valleys [0,1]
 * @returns {number} block id, or -1 for no override
 */
export function glacier_surface_block(gc, surface_y, slope, pv) {
  if (!gc.enabled) return -1
  if (surface_y <= gc.sea_level) return -1
  if (surface_y < gc.ice_low || surface_y > gc.ice_high) return -1
  if (slope > gc.flat_gate) return -1
  if (pv > gc.valley_pv) return -1
  if (surface_y <= gc.ice_low + gc.terminal_band) return gc.rubble_id // hummocky terminal rubble
  // Moraine stripes are 0-DISABLED (realism baseline, 2026-07-07): the folded-ridge pv field CLAMPS to
  // exactly 0 across a trough floor (measured: 92% of everest valley columns pv === 0), so `pv <= medial_pv`
  // with ANY medial_pv ≥ 0 claims the ENTIRE ribbon as moraine — the v4 "25% of the massif painted dark"
  // failure class. A recipe that wants no stripe sets the band to 0; positive bands behave as before.
  if (gc.medial_pv > 0 && pv <= gc.medial_pv) return gc.moraine_id // dark medial debris down the centreline
  if (gc.lateral_band > 0 && pv >= gc.valley_pv - gc.lateral_band) return gc.moraine_id // lateral moraine hugging the wall
  if ((Math.floor(surface_y / gc.crevasse_period) & 1) === 0) return gc.crevasse_id // crevasse banding across flow
  if (surface_y >= gc.ice_high - gc.firn_band) return gc.firn_id // granular firn near the top
  return gc.ice_id
}

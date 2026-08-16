// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SLOPE/SNOW SURFACE stage (FIVE-WORLDS §P3 shared stage 3 — Everest). Overrides a column's SURFACE
// (top-of-column) block by (altitude, slope):
//   • high + flat   (world_y ≥ snow_line AND slope ≤ grass_slope) → SNOW cap;
//   • steep         (slope ≥ steep_slope)                          → bare ROCK;
//   • moderate      (grass_slope ≤ slope < steep_slope, scree on)  → SCREE / talus apron at cliff feet.
// Below the waterline and on gentle low ground the column keeps its biome surface. Altitude bands also
// carry a TREELINE the surface decorator reads (no trees anchored above it) — resolved here for one home.
// Off by default (slope_enabled + snow_enabled false) ⇒ byte-identical DEFAULT world.
//
// GLACIAL §C SNOW-SCORE DRESSING v2: when `snow_score.enabled`, the hard snow threshold is replaced by a
// probability FIELD f(altitude_band, slope, speckle noise) → per-column snow/rock pick, so the snow↔rock
// transition is a SPECKLE (salt-and-pepper melt patches, ref R5) instead of a paint-bucket band. The speckle
// influence FADES with altitude so mid-slopes salt-and-pepper while summit caps stay clean white. Legacy
// (snow_score off) keeps the exact hard-threshold behaviour ⇒ byte-identical DEFAULT.
//
// DETERMINISM LAW (§3.7): arithmetic + seeded simplex (alea) only; no sin/cos/pow/random.

import { get_block_by_name } from '../../config/block_registry.js'
import { create_fbm_sampler } from '../noise/sampler.js'

/** @typedef {import('../../config/world_gen_config.js').SurfaceConfig} SurfaceConfig */
/** @typedef {import('../../config/world_gen_config.js').SnowScoreConfig} SnowScoreConfig */

/**
 * @typedef {object} SnowScoreContext resolved GLACIAL §C snow-score field.
 * @property {boolean} enabled score field on (config enabled AND the speckle sampler built)
 * @property {number} band_low world-y below which the score never applies (biome cover kept)
 * @property {number} band_high world-y at/above which the altitude term saturates (full eligibility)
 * @property {number} slope_max slope at/above which snow probability → 0 (too steep to hold snow)
 * @property {number} speckle_amp how strongly the speckle noise perturbs the score (bigger = more salt/pepper)
 * @property {number} threshold score ≥ this → snow, else bare rock
 * @property {import('../noise/sampler.js').FbmSampler | null} speckle melt/salt-and-pepper noise sampler
 */

/**
 * @typedef {object} SurfaceContext resolved slope/snow surface stage.
 * @property {boolean} active any override gate on (snow OR slope) — the block_at cheap-reject
 * @property {boolean} slope_enabled steep→rock (+scree) override on
 * @property {boolean} snow_enabled altitude snow-cap override on
 * @property {boolean} scree_enabled moderate-slope talus apron on
 * @property {number} snow_line world-y above which flat columns snow-cap
 * @property {number} steep_slope slope at/above which a face is bare rock
 * @property {number} grass_slope slope below which the biome cover shows (snow-eligible)
 * @property {number} treeline world-y above which the decorator anchors no trees
 * @property {number} snow_id snow-cap block id
 * @property {number} rock_id bare-rock block id
 * @property {number} scree_id talus/scree block id
 * @property {number} scree_relief GLACIAL §B.4 talus-apron mound height (blocks) at the foot of steep faces;
 *   0 ⇒ no height change (material-only scree, the legacy behaviour)
 * @property {SnowScoreContext} snow_score GLACIAL §C snow-score field (off ⇒ legacy hard threshold)
 * @property {AlpineContext} alpine S-24 alpine painter (snow-default / rock-on-steep / ice-high); off ⇒ legacy
 * @property {number} slope_window ± neighbourhood (blocks) the profile computes the painting slope over
 *   (1 ⇒ the legacy ±1 central difference; the alpine painter widens it so rock follows coherent faces)
 */

/**
 * @typedef {object} AlpineContext resolved S-24 ALPINE SURFACE PAINTER (rule: "snowless patches of rocks
 *   ONLY on very steep slopes, and ice higher — never just check the topmost block to paint it snowy").
 *   SNOW is the DEFAULT across the alpine zone; ROCK exposes only where the neighbourhood slope clears a
 *   HIGH threshold (couloirs/cliffs), coherently banded by a low-freq geology mask; ICE takes over above
 *   `ice_line` (pure near summits, a coherent snow/ice mix in the blend). Off ⇒ enabled:false ⇒ the legacy
 *   snow_score / hard-threshold path runs (byte-identical for every non-alpine world).
 * @property {boolean} enabled painter on (config enabled AND masks built)
 * @property {number} snow_floor world-y below which the painter keeps the biome cover (snow is default above)
 * @property {number} rock_slope neighbourhood slope at/above which rock exposes (high ⇒ couloirs/cliffs only)
 * @property {number} rock_coherence low-freq mask fraction that LOWERS rock_slope (coherent geology bands), 0..1
 * @property {number} ice_line world-y at/above which ice appears (within the blend band)
 * @property {number} ice_blend blend-band height: [ice_line, ice_line+ice_blend] mixes snow/ice, above ⇒ pure ice
 * @property {number} sun_aspect fraction (0..~0.6) a fully SUN-FACING slope LOWERS rock_slope (snow is
 *   less present on the sun-facing side; 0 ⇒ no aspect term, byte-identical). Coherent with the face
 *   orientation, so it never makes alternating snow/rock bands.
 * @property {number} sun_dx @property {number} sun_dz precomputed unit horizontal sun direction (world x/z)
 * @property {number} slope_window ± neighbourhood (blocks) for the painting slope (surfaced on SurfaceContext)
 * @property {number} snow_id @property {number} rock_id @property {number} ice_id resolved surface block ids
 * @property {import('../noise/sampler.js').FbmSampler | null} rock_mask low-freq geology mask (rock coherence)
 * @property {import('../noise/sampler.js').FbmSampler | null} ice_mask low-freq snow↔ice transition mask
 */

/** Resolve a block name → id, falling back to `fallback` (name) when absent.
 * @param {string} name @param {string} fallback @returns {number} */
function id_of(name, fallback) {
  return /** @type {number} */ (get_block_by_name(name)?.id ?? get_block_by_name(fallback)?.id ?? 0)
}

/**
 * Builds the GLACIAL §C snow-score context from a `surface.snow_score` sub-config + the decorrelated seed.
 * The speckle sampler is built once (fbm with broad + fine octaves → melt patches AND salt-and-pepper). No
 * seed / disabled config ⇒ enabled:false ⇒ the legacy hard threshold runs (parity).
 * @param {SnowScoreConfig} [cfg] @param {number} [seed] @returns {SnowScoreContext}
 */
function create_snow_score(cfg, seed) {
  const enabled = cfg?.enabled === true && seed !== undefined
  return {
    enabled,
    band_low: cfg?.band_low ?? 170,
    band_high: cfg?.band_high ?? 240,
    slope_max: cfg?.slope_max ?? 0.9,
    speckle_amp: cfg?.speckle_amp ?? 0.7,
    threshold: cfg?.threshold ?? 0.5,
    speckle: enabled
      ? create_fbm_sampler({
          seed: ((seed ?? 0) ^ 0x5_0000_01) >>> 0,
          base_period: cfg?.speckle_period ?? 40,
          octaves: cfg?.speckle_octaves ?? 4,
        })
      : null,
  }
}

/**
 * Builds the S-24 ALPINE PAINTER context from a `surface.alpine` sub-config + the decorrelated seed. The
 * two low-frequency masks (rock geology + snow↔ice transition) are built once (salts decorrelated from the
 * massif samplers 0x5124_000n and the snow-score speckle). No seed / disabled ⇒ enabled:false ⇒ the legacy
 * snow_score / hard-threshold path runs (parity). Pure.
 * @param {import('../../config/world_gen_config.js').AlpineConfig} [cfg] @param {number} [seed]
 * @returns {AlpineContext}
 */
function create_alpine_context(cfg, seed) {
  const enabled = cfg?.enabled === true && seed !== undefined
  return {
    enabled,
    snow_floor: cfg?.snow_floor ?? 0,
    rock_slope: cfg?.rock_slope ?? 3.4,
    rock_coherence: cfg?.rock_coherence ?? 0.3,
    ice_line: cfg?.ice_line ?? 384,
    ice_blend: cfg?.ice_blend ?? 1,
    sun_aspect: cfg?.sun_aspect ?? 0,
    // Unit horizontal sun direction (world x/z), carried as PRECOMPUTED literals by the config (no cos/sin in
    // gen/ — the §3.7 determinism gate bans transcendentals here, and literals are ULP-exact besides). A slope
    // is "sun-facing" when its downhill direction points toward this vector (see column_gen sun-dot).
    sun_dx: cfg?.sun_dx ?? 1,
    sun_dz: cfg?.sun_dz ?? 0,
    slope_window: cfg?.slope_window ?? 1,
    snow_id: id_of(cfg?.snow_block ?? 'snow', 'snow'),
    rock_id: id_of(cfg?.rock_block ?? 'stone', 'stone'),
    ice_id: id_of(cfg?.ice_block ?? 'ice', 'stone'),
    rock_mask: enabled
      ? create_fbm_sampler({
          seed: ((seed ?? 0) ^ 0x5124_0101) >>> 0,
          base_period: cfg?.rock_mask_period ?? 220,
          octaves: cfg?.rock_mask_octaves ?? 3,
        })
      : null,
    ice_mask: enabled
      ? create_fbm_sampler({
          seed: ((seed ?? 0) ^ 0x5124_0102) >>> 0,
          base_period: cfg?.ice_mask_period ?? 130,
          octaves: cfg?.ice_mask_octaves ?? 3,
        })
      : null,
  }
}

/**
 * Builds the slope/snow surface stage context from a world's `surface` config. Pure; resolves block
 * names once. Disabled config ⇒ active:false (block_at skips the whole stage). `seeds.decorators` (when
 * supplied) seeds the §C snow-score speckle sampler.
 * @param {Partial<SurfaceConfig>} [cfg]
 * @param {number} [world_height] used to default an unset treeline to "off" (no blocking)
 * @param {Record<string, number>} [seeds] world sub-seeds (for the snow-score speckle sampler)
 * @returns {SurfaceContext}
 */
export function create_surface_context(cfg, world_height = 384, seeds) {
  const slope_enabled = cfg?.slope_enabled === true
  const snow_enabled = cfg?.snow_enabled === true
  const scree_enabled = cfg?.scree_enabled === true
  const snow_score = create_snow_score(cfg?.snow_score, seeds?.decorators)
  const alpine = create_alpine_context(cfg?.alpine, seeds?.decorators)
  return {
    // `active` gates the whole stage in block_at AND drives needs_slope (so the profile computes slope for
    // the scree material + §B.4 apron + §C snow-score + the S-24 alpine painter). Any one on ⇒ slope built.
    active: slope_enabled || snow_enabled || scree_enabled || snow_score.enabled || alpine.enabled,
    slope_enabled,
    snow_enabled,
    scree_enabled,
    snow_line: cfg?.snow_line ?? world_height,
    steep_slope: cfg?.steep_slope ?? 0.7,
    grass_slope: cfg?.grass_slope ?? 0.2,
    treeline: cfg?.treeline ?? world_height,
    snow_id: id_of(cfg?.snow_block ?? 'snow', 'snow'),
    rock_id: id_of(cfg?.rock_block ?? 'stone', 'stone'),
    scree_id: id_of(cfg?.scree_block ?? 'stone', 'stone'),
    scree_relief: cfg?.scree_relief ?? 0,
    snow_score,
    alpine,
    // The alpine painter widens the painting slope window (reads coherent faces, not micro spikes); every
    // other world keeps the legacy ±1 central difference ⇒ byte-identical slope for strata/scree/glacier.
    slope_window: alpine.enabled ? alpine.slope_window : 1,
  }
}

/**
 * GLACIAL §B.4 talus-apron mound height (blocks ≥0) to ADD to a column's surface — a slope-gated deposit of
 * accumulated scree/talus. Zero outside the scree band [grass_slope, steep_slope) and when scree_relief is 0
 * (legacy material-only). Peaks toward the steep end of the band (near the foot of cliffs, where debris
 * piles) via a smoothstep, so gentle ground stays flat. Deterministic; pure function of slope + config.
 * @param {SurfaceContext} sctx
 * @param {number} slope column slope (rise/run)
 * @returns {number} apron height in blocks (0 when off or outside the scree band)
 */
export function scree_apron_delta(sctx, slope) {
  if (sctx.scree_relief <= 0 || !sctx.scree_enabled) return 0
  if (slope < sctx.grass_slope || slope >= sctx.steep_slope) return 0
  const span = sctx.steep_slope - sctx.grass_slope
  if (span <= 0) return 0
  const t = (slope - sctx.grass_slope) / span // 0 at grass edge → 1 at steep edge (cliff foot)
  return sctx.scree_relief * (t * t * (3 - 2 * t))
}

/**
 * GLACIAL §C snow-score in ~[-.., ..] — snow probability as f(altitude band, slope, speckle). Altitude ramps
 * 0→1 across [band_low, band_high] (smoothstep); slope multiplies it down (steep holds no snow); the speckle
 * noise perturbs the score with amplitude that FADES as altitude rises (salt-and-pepper mid-slopes, clean
 * summit caps). ≥ threshold ⇒ snow. Pure.
 * @param {SnowScoreContext} ss @param {number} world_y @param {number} slope @param {number} speckle01 [0,1]
 * @returns {number} snow score
 */
function snow_score_value(ss, world_y, slope, speckle01) {
  const span = ss.band_high - ss.band_low
  let a = span > 0 ? (world_y - ss.band_low) / span : 1
  if (a < 0) a = 0
  if (a > 1) a = 1
  a = a * a * (3 - 2 * a) // smoothstep altitude ramp
  let sl = 1 - slope / ss.slope_max // 1 flat → 0 at slope_max
  if (sl < 0) sl = 0
  if (sl > 1) sl = 1
  const p = a * sl
  // Speckle influence fades with altitude (1 - 0.7·a): speckly transition zone, clean high caps.
  return p + (speckle01 - 0.5) * ss.speckle_amp * (1 - a * 0.7)
}

/**
 * S-24 ALPINE PAINTER classifier — SNOW is the default; ROCK only where the (wide-window) slope clears a
 * coherently-modulated HIGH threshold (couloirs/cliffs, banded by the low-freq geology mask); ICE above
 * `ice_line` (pure near the summit, a low-freq snow/ice mix in the blend). Rock is tested BEFORE ice so a
 * steep high face still reads rock, never ice. Below `snow_floor` ⇒ -1 (keep the biome cover). Pure.
 * @param {AlpineContext} al
 * @param {number} world_y surface voxel world-y
 * @param {number} slope neighbourhood slope (rise/run)
 * @param {number} rock01 low-freq geology mask sample [0,1] (lowers rock_slope where high)
 * @param {number} ice01 low-freq snow↔ice transition mask sample [0,1]
 * @param {number} sun_dot downhill·sun in [-1,1]; +1 = fully sun-facing (hot, less snow), ≤0 = shade (kept snowy)
 * @param {number} ice_line_delta S-25 per-region ice-line shift, blocks (− lowers ice into low glacier basins;
 *   + raises ice to the summit caps only). 0 for a non-region world ⇒ the config `ice_line` unchanged.
 * @returns {number} snow/rock/ice block id, or -1 to keep the biome cover
 */
function alpine_paint_block(al, world_y, slope, rock01, ice01, sun_dot, ice_line_delta) {
  if (world_y < al.snow_floor) return -1
  // ROCK on genuinely steep faces; the low-freq mask lowers the threshold in "rocky" regions so the
  // exposed rock reads as COHERENT geology bands following the faces, not per-column salt-and-pepper.
  // SUN-ASPECT: a sun-facing slope (sun_dot>0) LOWERS the threshold further (snow melts off the hot side,
  // rock shows at a lower slope) — coherent with the face orientation, so still no alternating bands.
  const sun_bias = sun_dot > 0 ? al.sun_aspect * sun_dot : 0
  const rock_thr = al.rock_slope * (1 - al.rock_coherence * rock01 - sun_bias)
  if (slope >= rock_thr) return al.rock_id
  // ICE band: coherent snow/ice mix growing with altitude across the blend, pure ice at/above the top. The
  // S-25 per-region delta shifts the whole band (a glacier region lowers it so its low flats read as an ice
  // sheet; a peaks region raises it so ice caps only the summits).
  const ice_line = al.ice_line + ice_line_delta
  if (world_y >= ice_line) {
    let t = al.ice_blend > 0 ? (world_y - ice_line) / al.ice_blend : 1
    if (t < 0) t = 0
    if (t > 1) t = 1
    return ice01 <= t ? al.ice_id : al.snow_id
  }
  return al.snow_id // SNOW is the alpine default
}

/**
 * The surface-block override for a TOP-of-column voxel, or -1 for "keep the biome surface".
 * S-24: when the alpine painter is on it OWNS the decision (snow-default / rock-on-steep / ice-high) using
 * the two low-freq masks in `sample0` (rock geology) + `sample1` (snow↔ice). Otherwise GLACIAL §C snow_score
 * (a speckle probability field in `sample0`), then the legacy hard threshold (snow / steep-rock / scree).
 * Pure classifier.
 * @param {SurfaceContext} sctx
 * @param {number} world_y the surface voxel's world-y
 * @param {number} slope column slope (rise/run)
 * @param {number} [sample0] alpine: rock geology mask; snow_score: speckle sample (ignored by the legacy path)
 * @param {number} [sample1] alpine: snow↔ice mask (ignored otherwise)
 * @param {number} [sample2] alpine: downhill·sun aspect in [-1,1] (ignored otherwise)
 * @param {number} [ice_line_delta] alpine: S-25 per-region ice-line shift, blocks (0 ⇒ config ice_line)
 * @returns {number} override block id, or -1
 */
export function surface_by_slope_block(
  sctx,
  world_y,
  slope,
  sample0 = 0,
  sample1 = 0,
  sample2 = 0,
  ice_line_delta = 0
) {
  if (sctx.alpine.enabled)
    return alpine_paint_block(sctx.alpine, world_y, slope, sample0, sample1, sample2, ice_line_delta)
  const ss = sctx.snow_score
  if (ss.enabled && world_y >= ss.band_low) {
    return snow_score_value(ss, world_y, slope, sample0) >= ss.threshold ? sctx.snow_id : sctx.rock_id
  }
  if (sctx.snow_enabled && world_y >= sctx.snow_line && slope <= sctx.grass_slope) return sctx.snow_id
  if (sctx.slope_enabled && slope >= sctx.steep_slope) return sctx.rock_id
  if (sctx.scree_enabled && slope >= sctx.grass_slope) return sctx.scree_id
  return -1
}

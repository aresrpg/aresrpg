// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Canyon / ravine carving (§2.1 NG1-B, item 3) — steep-walled erosion channels cut into inland
// plateaus (ref #3). Uses the INVERTED-RIDGE-CREASE technique, NOT Minecraft's stateful ravine
// walker (DO-NOT #11 — that walk is not region-local): a domain-warped ridged-multifractal crest
// network defines the canyon AXES (thin high-value lines), and a quadratic depth curve across a
// narrow band around each axis carves a deep channel with STEEP walls (t² → near-vertical near the
// axis). Pure per-(x,z) function → region-local + deterministic; the carve simply lowers the
// column's effective surface, so exposed walls read as deep filler (strata banding = NG1-C's job)
// and the canyon FLOOR gets river/lake treatment from the hydrology lane.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/abs/min/max ONLY. Seeded 3D simplex (injected
// alea) sampled at y=0 for a 2D field. Region-local: depth(x,z) depends only on (x,z)+seed.

import { create_ridged_sampler } from '../noise/ridged.js'
import { create_warp_sampler } from '../noise/warp.js'

/** Canyon recipe (const world-recipe — moving these forks the world, §4). */
export const CANYON_CONFIG = {
  /** Crest network whose thin high-value lines become the canyon axes. */
  crease: { period: 372, octaves: 3 },
  /** Strong domain warp → meandering canyons (refs' organic river-valley bends). */
  warp: { period: 440, octaves: 2, amp: 58 },
  /** Half-width of the carve band in ridged-value units (small ⇒ narrow, steep canyons). */
  width: 0.17,
  /** Max carve depth at the axis (blocks) — the wall height. */
  depth: 48,
  /** Where canyons form: inland (high continentalness), mid-erosion plateau/badlands (not sheer
   *  mountains, not flat plains), and off the very highest peaks. Smoothstep-gated (§3.7). */
  gate: {
    continentalness_min: 0.5,
    erosion_min: 0.34,
    erosion_max: 0.74,
    pv_max: 0.7,
  },
}

/**
 * @typedef {object} CanyonCarver
 * @property {import('../noise/ridged.js').RidgedSampler} crease
 * @property {import('../noise/warp.js').WarpSampler} warp
 */

/**
 * Builds the canyon sampler set from the `carvers` sub-seed (distinct salts from density/erosion).
 * @param {Record<string, number>} seeds output of `derive_world_seeds`
 * @returns {CanyonCarver}
 */
export function create_canyon_carver(seeds) {
  const carve = seeds.carvers >>> 0
  const c = CANYON_CONFIG
  return {
    crease: create_ridged_sampler({
      seed: carve ^ 0x9999_9999,
      base_period: c.crease.period,
      octaves: c.crease.octaves,
      offset: 1,
      gain: 0.5,
    }),
    warp: create_warp_sampler({
      seed: carve ^ 0xa5a5_a5a5,
      base_period: c.warp.period,
      octaves: c.warp.octaves,
    }),
  }
}

/**
 * Smoothstep gate helper — 1 inside [lo,hi] with hermite shoulders of width `edge`, 0 outside.
 * @param {number} v @param {number} lo @param {number} hi @param {number} edge
 * @returns {number}
 */
function band_gate(v, lo, hi, edge) {
  let t = 0
  if (v <= lo || v >= hi) return 0
  const dl = (v - lo) / edge
  const dh = (hi - v) / edge
  t = dl < dh ? dl : dh
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}

/** Reused warp scratch (single-threaded per worker). */
const WARP_SCRATCH = [0, 0, 0]

/**
 * Climate gate in [0,1] — how strongly canyons carve at this column's climate (inland mid-erosion
 * plateau, off-peak). Zero elsewhere so oceans/plains/summits are never touched.
 * @param {number} continentalness
 * @param {number} erosion
 * @param {number} pv
 * @returns {number}
 */
export function canyon_gate(continentalness, erosion, pv) {
  const g = CANYON_CONFIG.gate
  if (continentalness < g.continentalness_min) return 0
  if (pv > g.pv_max) return 0
  let cont = (continentalness - g.continentalness_min) / 0.12
  if (cont > 1) cont = 1
  const ero = band_gate(erosion, g.erosion_min, g.erosion_max, 0.1)
  let peak = (g.pv_max - pv) / 0.15
  if (peak > 1) peak = 1
  return cont * ero * peak
}

/**
 * Canyon carve depth (blocks, ≥0) to subtract from a column's effective surface. Zero outside the
 * climate gate and outside the crest band. The `t²` depth curve makes walls steep near the axis.
 * @param {CanyonCarver} cc
 * @param {number} world_x
 * @param {number} world_z
 * @param {number} continentalness
 * @param {number} erosion
 * @param {number} pv
 * @returns {number} carve depth in blocks (0 = no canyon here)
 */
export function canyon_depth(cc, world_x, world_z, continentalness, erosion, pv) {
  const gate = canyon_gate(continentalness, erosion, pv)
  if (gate <= 0) return 0
  const c = CANYON_CONFIG
  cc.warp.offset(world_x, 0, world_z, WARP_SCRATCH)
  const wx = world_x + WARP_SCRATCH[0] * c.warp.amp
  const wz = world_z + WARP_SCRATCH[2] * c.warp.amp
  const r = cc.crease.sample(wx, 0, wz) // [0,1], ≈1 along thin crest lines = canyon axes
  // Distance INTO the carve band: 0 at the band edge (r = 1-width), 1 at the axis (r = 1).
  let t = (r - (1 - c.width)) / c.width
  if (t <= 0) return 0
  if (t > 1) t = 1
  return t * t * c.depth * gate
}

/**
 * Integer power t^k (k a small non-negative integer) — the determinism-legal replacement for Math.pow
 * (transcendental, banned §3.7). @param {number} t @param {number} k @returns {number}
 */
function ipow(t, k) {
  let out = 1
  for (let i = 0; i < k; i += 1) out *= t
  return out
}

/**
 * FIVE-WORLDS config-gated ADDITIVE canyon stage (§P3 shared stage 2 — Riviera dramatic ravines). Carves
 * a SECOND, deeper channel ON TOP of the always-on NG1-B baseline `canyon_depth` (which is left untouched
 * — gating IT off would fork the golden, since it materially carves the shipped world). Reuses the same
 * warp + crest samplers but reads WIDTH / DEPTH / WALL_STEEPNESS from the world's `carvers.canyon` config,
 * and applies a `t^wall_steepness` depth curve (higher exponent = steeper, more vertical walls). Gated by
 * the SAME inland-plateau climate gate so it deepens the same canyon network. Returns 0 when the stage is
 * disabled ⇒ zero additional carve ⇒ byte-identical DEFAULT. Pure per-(x,z), integer-power (no Math.pow).
 * @param {CanyonCarver} cc
 * @param {import('../../config/world_gen_config.js').CanyonConfig} cfg the world's `carvers.canyon`
 * @param {number} world_x @param {number} world_z
 * @param {number} continentalness @param {number} erosion @param {number} pv
 * @returns {number} additional carve depth in blocks (0 = no stage carve here)
 */
export function canyon_stage_depth(cc, cfg, world_x, world_z, continentalness, erosion, pv) {
  if (!cfg || cfg.enabled !== true) return 0
  const gate = canyon_gate(continentalness, erosion, pv)
  if (gate <= 0) return 0
  const c = CANYON_CONFIG
  let wx = world_x
  let wz = world_z
  if (cfg.warp) {
    cc.warp.offset(world_x, 0, world_z, WARP_SCRATCH)
    wx = world_x + WARP_SCRATCH[0] * c.warp.amp
    wz = world_z + WARP_SCRATCH[2] * c.warp.amp
  }
  const r = cc.crease.sample(wx, 0, wz)
  const width = cfg.width > 0 ? cfg.width : c.width
  let t = (r - (1 - width)) / width
  if (t <= 0) return 0
  if (t > 1) t = 1
  const k = Math.max(1, Math.floor(cfg.wall_steepness ?? 2))
  return ipow(t, k) * cfg.depth * gate
}

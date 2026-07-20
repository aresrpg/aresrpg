// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Terrain height shaping via piecewise Catmull-Rom splines (§4.2). Generalizes the legacy 1-D
// BiomeLands `threshold → elevation` tables to the multi-dimensional Minecraft-1.18 approach:
//   continentalness → base_height   (ocean floor ↔ inland plateau)
//   erosion         → amplitude     (flat plains ↔ jagged mountains)
//   (PV × amplitude)→ relief        (valleys/rivers ↔ peaks)
// composed into a target surface height. The 3D density band (overhangs/cliffs/caves/sky) that
// consumes this surface lives in gen/density.js, which owns the SINGLE band definition + overhang
// gate (DENSITY_CONFIG.band_blocks / overhang_gate). This shaper used to also declare a rival
// ±DENSITY_BAND_BLOCKS band (+ density_low/high + has_overhang_potential) that nothing consumed —
// removed in NG1-A so there is exactly one band home (density.js) and no divergence.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor only. Catmull-Rom is pure polynomial arithmetic
// (no Math.pow — powers are inlined as t*t, t*t*t). Spline control points are const shaping data;
// changing them moves the golden hashes = a world fork (§4).

import { WORLD_HEIGHT } from '../config/world_config.js'
import { DEFAULT_WORLD_GEN_CONFIG } from '../config/world_gen_config.js'

/**
 * @typedef {import('./noise/fields.js').ClimateSample} ClimateSample
 */

/**
 * @typedef {object} SplinePoint a single (input, output) control knot.
 * @property {number} x normalized input in [0,1]
 * @property {number} y output value (world blocks for height splines)
 */

/**
 * @typedef {object} ShaperSplines the three compiled Catmull-Rom control tables a column shaper reads.
 * @property {SplinePoint[]} continentalness_to_base continentalness → base surface height (world y)
 * @property {SplinePoint[]} erosion_to_amplitude erosion → relief amplitude (blocks)
 * @property {SplinePoint[]} pv_to_relief peaks-and-valleys → relief factor
 */

// ---- Config-first spline adoption (§2.3) -----------------------------------------------------
// The control tables USED to live here as `const` shaping data. They are now the SINGLE SOURCE OF
// TRUTH in world_gen_config.js `splines` (byte-faithful to the NG1-B retune); this module COMPILES
// the config's [x,y] tuple form into the {x,y} SplinePoint form catmull_rom evaluates. Each world's
// gen context precompiles its own recipe once (create_gen_context → ctx.shaper); the default below is
// the fallback for context-free callers (tests, world_surface_y before a config is set).

/**
 * Compiles a config `splines` sub-block ([x,y] tuple tables) into the {x,y} SplinePoint tables the
 * Catmull-Rom evaluator reads. Pure, allocation-once-per-world (never per column). Determinism-safe
 * (array reshuffle only, no float ops).
 * @param {import('../config/world_gen_config.js').SplinesConfig} splines
 * @returns {ShaperSplines}
 */
export function compile_splines(splines) {
  const to_points = (/** @type {[number, number][]} */ table) => table.map(([x, y]) => ({ x, y }))
  return {
    continentalness_to_base: to_points(splines.continentalness_to_base),
    erosion_to_amplitude: to_points(splines.erosion_to_amplitude),
    pv_to_relief: to_points(splines.pv_to_relief),
  }
}

/**
 * The compiled DEFAULT shaper tables (today's live world). The fallback for context-free `shape_column`
 * callers, and the SSOT the config-completeness test round-trips against. NG1-B relief-amplitude retune
 * (GEN_VERSION 3): low-erosion amplitude ~148 (mountain belts ~100-160 blocks), valley floor -0.2 — all
 * carried in world_gen_config.js `splines`. The jagged erosion LOOK is added off-surface in the density
 * field, not here, so world_surface_y stays a smooth ≤20-blocks/column probe.
 * @type {ShaperSplines}
 */
export const SPLINE_SOURCE = compile_splines(DEFAULT_WORLD_GEN_CONFIG.splines)

/**
 * Evaluates a piecewise Catmull-Rom spline at input `t` over a sorted control-point table.
 * Uses the standard 4-point Catmull-Rom basis on the segment containing `t`, clamping endpoint
 * tangents by duplicating boundary points. Pure polynomial arithmetic (no Math.pow) → §3.7-safe.
 * @param {SplinePoint[]} points sorted ascending by `x`, length >= 2
 * @param {number} t input, clamped to [points[0].x, points[last].x]
 * @returns {number} interpolated output
 */
export function catmull_rom(points, t) {
  const n = points.length
  if (t <= points[0].x) return points[0].y
  if (t >= points[n - 1].x) return points[n - 1].y

  // Find the segment [i, i+1] containing t.
  let i = 0
  while (i < n - 1 && t > points[i + 1].x) i += 1

  const p1 = points[i]
  const p2 = points[i + 1]
  const p0 = i > 0 ? points[i - 1] : p1
  const p3 = i + 2 < n ? points[i + 2] : p2

  // Local parameter u in [0,1] across the segment (uniform Catmull-Rom).
  const span = p2.x - p1.x
  const u = span > 0 ? (t - p1.x) / span : 0
  const u2 = u * u
  const u3 = u2 * u

  // Catmull-Rom basis (tension 0.5) on the y control values.
  return (
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * u +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3)
  )
}

/**
 * @typedef {object} ShapedColumn per-column shaping result (pure heightfield inputs; the 3D density
 *   band + overhang gate that consume this live in gen/density.js).
 * @property {number} surface_y integer target surface world-y (nominal first-air from the top; the
 *   density field can lift solid above it or carve below it — matches column_gen's fill convention)
 * @property {number} base_y the continentalness base height before relief (for strata banding, NG1-C)
 * @property {number} amplitude the erosion-derived amplitude (blocks)
 * @property {number} relief the PV-derived relief factor
 */

/**
 * Composes the three splines into a target surface height for a column. Result is deterministic and
 * integer-valued. The 3D density band that turns this into overhangs/caves/sky is density.js's job.
 * @param {ClimateSample} climate sampled 6-param values at the column
 * @param {ShaperSplines} [shaper] the world's compiled spline tables (create_gen_context supplies
 *   `ctx.shaper`); defaults to the live/default recipe for context-free callers (tests, tools).
 * @returns {ShapedColumn}
 */
export function shape_column(climate, shaper = SPLINE_SOURCE) {
  const base_y = catmull_rom(shaper.continentalness_to_base, climate.continentalness)
  const amplitude = catmull_rom(shaper.erosion_to_amplitude, climate.erosion)
  const relief = catmull_rom(shaper.pv_to_relief, climate.pv)

  let surface = base_y + relief * amplitude
  // Clamp into the world box with a small ceiling/floor margin.
  if (surface < 2) surface = 2
  if (surface > WORLD_HEIGHT - 2) surface = WORLD_HEIGHT - 2
  const surface_y = Math.floor(surface)

  return {
    surface_y,
    base_y: Math.floor(base_y),
    amplitude,
    relief,
  }
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-20 — WEBGL-FALLBACK HEIGHTMAP EXTRACTION. 2026-07-05.
// ============================================================================================
// The cheapest possible SURFACE probe for the WebGL fallback renderer (render/webgl_fallback.js):
// one SURFACE-y + one SURFACE-BLOCK-id per world column, with NO 3D density fill, NO caves, NO
// decorators, NO meshing. It reuses gen/column_gen.js's `anchor_surface` — the SINGLE SOURCE OF
// TRUTH for "where does the ground surface sit and what covers it" (spline + mountain erosion −
// canyon − river carve; the exact per-column math build_column_profile uses) — so the fallback's
// blocky world lines up with the real WebGPU terrain instead of inventing a rival heightfield.
//
// WHY A SEPARATE MODULE (not just calling anchor_surface inline): the fallback needs a RECTANGULAR
// GRID of columns (a tile of the world) plus a COARSE downsample for the horizon ring beyond the
// zone, and it needs it as flat typed arrays the mesh builder can walk without per-cell object
// churn. That grid+stride shaping is this module's job; the per-column surface math stays in
// column_gen. Pure + deterministic (anchor_surface is arithmetic + Math.floor) → unit-testable
// with zero GPU (heightmap.test.js).

import { get_block_by_id } from '../config/block_registry.js'

import { create_gen_context, anchor_surface } from './column_gen.js'

/** @typedef {import('./column_gen.js').GenContext} GenContext */

/**
 * @typedef {object} HeightmapGrid a rectangular block of per-column surface data (flat arrays, row-
 *   major z-outer/x-inner). One entry per CELL; a cell spans `cell_size × cell_size` world blocks
 *   (cell_size 1 = full resolution, >1 = a coarse downsample sampled at the cell's SW corner).
 * @property {number} origin_x world-space block X of cell (0,0)'s SW corner (grid min X).
 * @property {number} origin_z world-space block Z of cell (0,0)'s SW corner (grid min Z).
 * @property {number} cell_size world blocks per cell edge (the box footprint the fallback extrudes).
 * @property {number} cols number of cells along X.
 * @property {number} rows number of cells along Z.
 * @property {Int16Array} surface_y EFFECTIVE surface world-y per cell (index = row*cols + col).
 * @property {Uint8Array} block_id surface-cover block id per cell (grass/sand/snow/… — the strata
 *   surface block, or `water` for a cell whose surface sits at/below sea level). Index = row*cols+col.
 */

/** Water block id, resolved once — a submerged surface cell (surface_y ≤ sea level) is coloured as
 *  water so oceans/lakes read as blue in the fallback instead of a sandy/grassy sea floor. */
const WATER_BLOCK_ID = /** @type {number} */ (get_block_by_id(5)?.id ?? 5)

/**
 * Extracts a rectangular grid of per-column surface data for the WebGL fallback.
 *
 * The grid covers `[origin_x, origin_x + cols*cell_size)` × `[origin_z, origin_z + rows*cell_size)`
 * in world blocks. Each cell samples ONE column (its SW corner) — at cell_size 1 that is every block
 * column (the resident-zone full-res field); at cell_size 4 it is a 4:1 coarse field for the cheap
 * static horizon ring. A cell whose surface sits at or below sea level is tagged `water` so the flat
 * ocean band reads blue.
 *
 * Deterministic: `anchor_surface` is pure arithmetic + Math.floor, so the same (seed, region) yields
 * a bit-identical grid on every machine — the fallback's blocky world is stable and matches the real
 * terrain's surface.
 *
 * @param {object} opts
 * @param {GenContext | string} opts.gen the gen context (from create_gen_context) OR a seed string —
 *   a seed builds a context internally (convenience for one-shot callers / tests).
 * @param {number} opts.origin_x world-space block X of the grid's SW corner.
 * @param {number} opts.origin_z world-space block Z of the grid's SW corner.
 * @param {number} opts.cols number of cells along X (≥ 0).
 * @param {number} opts.rows number of cells along Z (≥ 0).
 * @param {number} [opts.cell_size] world blocks per cell edge (default 1 = full resolution).
 * @returns {HeightmapGrid}
 */
export function extract_heightmap({ gen, origin_x, origin_z, cols, rows, cell_size = 1 }) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 0 || rows < 0) {
    throw new RangeError(`extract_heightmap: cols/rows must be non-negative integers (got ${cols}, ${rows})`)
  }
  if (!Number.isInteger(cell_size) || cell_size < 1) {
    throw new RangeError(`extract_heightmap: cell_size must be a positive integer (got ${cell_size})`)
  }
  const ctx = typeof gen === 'string' ? create_gen_context(gen) : gen

  const surface_y = new Int16Array(cols * rows)
  const block_id = new Uint8Array(cols * rows)

  for (let row = 0; row < rows; row += 1) {
    const world_z = origin_z + row * cell_size
    for (let col = 0; col < cols; col += 1) {
      const world_x = origin_x + col * cell_size
      const a = anchor_surface(ctx, world_x, world_z)
      const i = row * cols + col
      surface_y[i] = a.surface_y
      // Ocean/lake floor reads as water: a surface at/below the world's waterline is under water (the
      // density fill would flood it), so colour it water rather than its dry strata block. Uses the
      // per-world sea level (Everest: 6 ⇒ its y≈10 valley floors render as DRY land in the far shell).
      block_id[i] = a.surface_y <= ctx.sea_level ? WATER_BLOCK_ID : a.surface_block
    }
  }

  return { origin_x, origin_z, cell_size, cols, rows, surface_y, block_id }
}

/**
 * Surface data for a SINGLE world column — the fallback's collision/spawn probe (stand-on-surface).
 * Thin convenience over anchor_surface so the fallback never imports column_gen directly.
 * @param {GenContext} ctx
 * @param {number} world_x
 * @param {number} world_z
 * @returns {{ surface_y: number, block_id: number, ground_block_id: number }}
 */
export function surface_column(ctx, world_x, world_z) {
  const a = anchor_surface(ctx, world_x, world_z)
  return {
    surface_y: a.surface_y,
    block_id: a.surface_y <= ctx.sea_level ? WATER_BLOCK_ID : a.surface_block,
    // `block_id` is the VISUAL cover (water below sea level). Collision needs the actual solid
    // substrate; repeating the water cover down to y=0 creates an all-liquid column with no floor.
    ground_block_id: a.surface_block,
  }
}

// Pure data + geometry helpers for the world map (MapDrawer.jsx). No React, no I/O — the seed-terrain
// sampler and the world<->bitmap<->screen coordinate transform. Kept here (SSOT) so MapDrawer stays a
// thin view and the transform can never drift between the terrain blit and the player marker.

import { CELL, world_biome, world_cell } from '@aresrpg/sim'

import { biome_rgb, shade_obstacle } from './biome-colors.js'

// World bounds in CELLS (the 2000x2000 bounds), centered on the spawn origin (0,0). The
// low-res sample edge: MAP_PX samples across the whole WORLD_CELLS span, ~5.6 cells/px (coarse on
// purpose).
export const WORLD_CELLS = 2000
export const MAP_PX = 360
export const HALF_WORLD = WORLD_CELLS / 2

// The terrain canvas' INTERNAL pixel resolution. The overlay (% markers) shares these so it stretches
// identically to the CSS-scaled canvas.
export const CANVAS_W = 900
export const CANVAS_H = 760

// Deterministic value jitter per world cell (no Math.random -> a re-sample is identical): hash the
// coords to a small +/- brightness so floor/forest fields read as textured terrain, not one flat block.
const cell_jitter = (/** @type {number} */ wx, /** @type {number} */ wy) => {
  let h = (wx * 374761393 + wy * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return (((h >>> 0) % 32) - 16) * 0.6 // ~[-10, +9]
}

/**
 * Sample the whole world into a MAP_PX x MAP_PX ImageData by calling world_cell on a coarse grid.
 * One pass; the result is cached and reused for every pan/zoom blit. Same biome SSOT as the minimap.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} seed
 * @returns {ImageData}
 */
export const sample_world = (ctx, seed) => {
  const img = ctx.createImageData(MAP_PX, MAP_PX)
  const { data } = img
  const step = WORLD_CELLS / MAP_PX
  for (let py = 0; py < MAP_PX; py++) {
    const wy = Math.round(py * step - HALF_WORLD)
    for (let px = 0; px < MAP_PX; px++) {
      const wx = Math.round(px * step - HALF_WORLD)
      const cell = world_cell(seed, wx, wy)
      const base = biome_rgb(world_biome(seed, wx, wy))
      const rgb = cell === CELL.OBSTACLE ? shade_obstacle(base) : base
      const j = cell === CELL.WATER ? 0 : cell_jitter(wx, wy)
      const i = (py * MAP_PX + px) * 4
      data[i] = Math.max(0, Math.min(255, rgb[0] + j))
      data[i + 1] = Math.max(0, Math.min(255, rgb[1] + j))
      data[i + 2] = Math.max(0, Math.min(255, rgb[2] + j))
      data[i + 3] = 255
    }
  }
  return img
}

/** @typedef {{ zoom: number, ox: number, oy: number }} MapView pan offset (display px) + zoom */

/**
 * World cell (x, z) -> screen px in the canvas-internal CANVAS_W x CANVAS_H space at the current view.
 * The ONE transform shared by the terrain blit and the player marker.
 * @param {number} x @param {number} z @param {MapView} view
 * @returns {{ sx: number, sy: number }}
 */
export const world_to_screen = (x, z, view) => ({
  sx: view.ox + ((x + HALF_WORLD) / WORLD_CELLS) * MAP_PX * view.zoom,
  sy: view.oy + ((z + HALF_WORLD) / WORLD_CELLS) * MAP_PX * view.zoom,
})

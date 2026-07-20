// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SSOT for the world TERRAIN palette — keyed by `world_biome` (@aresrpg/sim). Both the HUD Minimap (canvas
// fillStyle, hex strings) and the big MapDrawer (ImageData bytes, rgb tuples) paint terrain from THIS one
// table, so the two readouts can never drift. The roam scene tints ground from roam.js BIOME_TINT; `water`
// here is a top-down-only cool pond blue (the roam value is #ffffff there, hidden under the water plane).

/**
 * Biome -> hex swatch. Vivid sage plains, deeper saturated forest canopy, lushest meadow, pale green-biased
 * rocky, warm sand beach, packed-dirt road, desaturated cool pond blue water. The keys cover every
 * `WorldBiome` literal, so an indexed read never misses.
 * @type {Record<import('@aresrpg/sim').WorldBiome, string>}
 */
export const BIOME_FILL = {
  plains: '#c1d58a', // vivid sage-green earth
  forest: '#afc484', // deeper saturated canopy green
  meadow: '#bcd67c', // lushest vivid meadow green
  rocky: '#d2e8c6', // dry, pale, green-biased
  beach: '#eadfbf', // pale warm sand
  road: '#cda982', // packed dirt road
  water: '#2f4a63', // desaturated cool pond blue (top-down map only — see above)
}

// Obstacle (trees / LoS blockers) darken overlay — ONE source as [r,g,b,a]: the Minimap paints it as a
// canvas overlay string; the MapDrawer alpha-blends the same factor into the biome rgb (ImageData has no
// compositing), so a forest reads as denser tree clusters over the lighter forest floor on both.
const SHADE = /** @type {[number, number, number, number]} */ ([
  8, 12, 18, 0.32,
])

/** The obstacle overlay as a canvas rgba string (Minimap fillStyle). */
export const OBSTACLE_SHADE = `rgba(${SHADE[0]}, ${SHADE[1]}, ${SHADE[2]}, ${SHADE[3]})`

/**
 * Parse a #rrggbb swatch to an [r,g,b] tuple.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
const hex_rgb = hex => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Biome -> [r,g,b] terrain tuple (the MapDrawer writes raw ImageData bytes, not fillStyle strings). Every
 * `WorldBiome` is a key of BIOME_FILL, so the read is total.
 * @param {import('@aresrpg/sim').WorldBiome} biome
 * @returns {[number, number, number]}
 */
export const biome_rgb = biome => hex_rgb(BIOME_FILL[biome])

/**
 * Darken a biome rgb tuple by the obstacle overlay — the MapDrawer's ImageData match for the Minimap's
 * OBSTACLE_SHADE canvas overlay (same [r,g,b,a] factor, alpha-blended).
 * @param {[number, number, number]} rgb
 * @returns {[number, number, number]}
 */
export const shade_obstacle = ([r, g, b]) => {
  const a = SHADE[3]
  return [
    Math.round(r * (1 - a) + SHADE[0] * a),
    Math.round(g * (1 - a) + SHADE[1] * a),
    Math.round(b * (1 - a) + SHADE[2] * a),
  ]
}

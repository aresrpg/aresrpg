// GATHERABLE base BLOCKS (ENGINE_AAA_PLAN §5.2) — the in-world voxel nodes for the 33 BASE gatherables
// (11 wheats · 11 ores · 11 herbs). All shape:'cross' foliage, 1:1 by NAME with the base recipes in
// texture_recipes_gather.js (the baker auto-wires block.id → recipe base layer via the default `blocks:
// [name]`). Per §5.2 the sway is per family: wheats sway strongest, herbs mild, ores static. Spread onto
// BLOCK_REGISTRY at the END (one wire-in line) — APPEND-ONLY so pre-existing ids never renumber (ids 40-61
// flora, 62+ here). PLACEMENT deferred (like flora): registered but not emitted by surface_flora() yet —
// the frontend gather-node prop (B8) consumes the atlas layers directly. RARES are atlas layers + the
// GATHER_RARE_EMISSION table (no speculative block ids — node-state rarity glow is a B8/placement concern).
// ID FENCE (lane A3): 62-72 wheats · 73-83 ores · 84-94 herbs. Never renumber — persisted in chunk `ids`.

import { WHEAT_RAMP, ORE_RAMP, HERB_RAMP } from '../render/texture_recipes_gather.js'

/** @typedef {import('./block_registry.js').BlockDef} BlockDef */
/** @typedef {import('./block_registry.js').WindStrength} WindStrength */

const hex = (/** @type {number[]} */ c) =>
  '#' +
  c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')

/** Cross-foliage gather-node block factory (no occupancy, walk-through, grass sounds, no emission on base).
 *  @param {number} id @param {string} name @param {number} h cross_height @param {number} pairs cross_pairs
 *  @param {WindStrength} wind @param {number[]} rgb dominant identity colour @returns {BlockDef} */
function gather(id, name, h, pairs, wind, rgb) {
  return {
    id,
    name,
    class: 'foliage',
    shape: 'cross',
    cross_height: h,
    cross_pairs: pairs,
    texture_recipe: {
      base_color_rgb: /** @type {[number,number,number]} */ (rgb),
      layers: [{ op: 'speckle', params: { density: 0.16, darken: 0.18 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: hex(rgb),
  }
}

// wheats sway strongest (wind 2, waist-high sheaves) · ores static on a low rock (wind 0) · herbs mild (wind 1).
/** @type {BlockDef[]} */
export const GATHER_BLOCKS = [
  ...WHEAT_RAMP.map((e, i) => gather(62 + i, e.id, 1.4, 2, /** @type {WindStrength} */ (2), e.rgb)),
  ...ORE_RAMP.map((e, i) => gather(73 + i, e.id, 0.8, 1, /** @type {WindStrength} */ (0), e.rgb)),
  ...HERB_RAMP.map((e, i) => gather(84 + i, e.id, 0.8, 2, /** @type {WindStrength} */ (1), e.rgb)),
]

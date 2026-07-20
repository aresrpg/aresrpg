// VIVID-WORLD flora sprite BLOCKS (2026-07-07) — the registry entries for the new clutter-sprite roster
// (many more sprites, for a vivid world). All shape:'cross' foliage (class 'foliage', no occupancy,
// walk-through), 1:1 by NAME with the recipes in texture_recipes_flora.js (the baker auto-wires block.id →
// recipe base layer via the recipe's default `blocks: [name]`). Spread onto BLOCK_REGISTRY at the END (one
// wire-in line) — APPEND-ONLY so pre-existing ids are never renumbered (ids 0-33 base, 34-36 coral, 37+ here).
//
// PLACEMENT deferred: these are registered but NOT emitted by surface_flora() yet (eng-stages owns that
// seam). Opt-in per world via config.decoration.sprites, absent-by-default ⇒ byte-identical DEFAULT world.
// The `texture_recipe` field is the frozen-schema far-field fallback (the real sprite is the baked recipe);
// `map_color` (dominant hue hex) feeds the LOD far-shell average. See PLACEMENT_HANDOFF.md.
// ID FENCE (lead 2026-07-07): ids 0-33 base · 34-36 coral SPRITES (eng-stages) · 37-39 matte coral CUBES
// (eng-stages, reserved) · 40-61 flora (here). Never renumber — persisted in chunk `ids`.

/** @typedef {import('./block_registry.js').BlockDef} BlockDef */
/** @typedef {import('./block_registry.js').WindStrength} WindStrength */

/** Compact cross-foliage block factory (all share the sprite defaults: no occupancy, no emission, grass
 *  sounds). @param {number} id @param {string} name @param {number} h cross_height (blocks) @param {number}
 *  pairs cross_pairs (K) @param {WindStrength} wind 0-3 @param {[number,number,number]} base dominant rgb (far
 *  fallback) @param {string} map map_color hex @returns {BlockDef} */
function foliage(id, name, h, pairs, wind, base, map) {
  return {
    id,
    name,
    class: 'foliage',
    shape: 'cross',
    cross_height: h,
    cross_pairs: pairs,
    texture_recipe: { base_color_rgb: base, layers: [{ op: 'speckle', params: { density: 0.16, darken: 0.18 } }] },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: map,
  }
}

/** @type {BlockDef[]} */
export const FLORA_BLOCKS = [
  // universal
  foliage(40, 'bush', 1.3, 2, 1, [70, 104, 52], '#466834'),
  foliage(41, 'dead_branch', 1.0, 1, 0, [96, 70, 46], '#60462e'),
  foliage(42, 'pebbles', 0.5, 1, 0, [130, 128, 122], '#82807a'),
  foliage(43, 'toadstool', 0.7, 2, 0, [178, 66, 56], '#b24238'),
  // rainforest
  foliage(44, 'jungle_plant', 1.6, 2, 1, [64, 116, 54], '#407436'),
  foliage(45, 'orchid', 1.0, 2, 1, [196, 96, 168], '#c460a8'),
  foliage(46, 'young_shoot', 0.7, 2, 1, [96, 158, 74], '#609e4a'),
  // paradise (dry sand)
  foliage(47, 'dune_grass', 1.5, 2, 2, [150, 158, 104], '#969e68'),
  foliage(48, 'seashell', 0.5, 1, 0, [234, 208, 196], '#ead0c4'),
  foliage(49, 'starfish', 0.5, 1, 0, [222, 148, 82], '#de9452'),
  foliage(50, 'driftwood', 0.8, 1, 0, [168, 158, 142], '#a89e8e'),
  // everglades
  foliage(51, 'cattail', 2.4, 2, 2, [92, 128, 66], '#5c8042'),
  foliage(52, 'swamp_weed', 1.1, 2, 1, [76, 100, 52], '#4c6434'),
  foliage(53, 'moss_tuft', 0.5, 3, 0, [58, 92, 50], '#3a5c32'),
  // everest
  foliage(54, 'frozen_shrub', 1.1, 1, 1, [74, 62, 54], '#4a3e36'),
  foliage(55, 'alpine_flower', 0.7, 2, 1, [126, 152, 210], '#7e98d2'),
  foliage(56, 'lichen', 0.4, 3, 0, [120, 138, 96], '#788a60'),
  // riviera
  foliage(57, 'thistle', 1.2, 2, 1, [104, 122, 82], '#687a52'),
  foliage(58, 'lavender', 1.1, 2, 2, [128, 146, 110], '#80926e'),
  foliage(59, 'garrigue', 1.2, 2, 1, [110, 124, 88], '#6e7c58'),
  // underwater / floating — ART-ONLY (placement deferred)
  foliage(60, 'seaweed', 2.0, 2, 3, [52, 104, 78], '#34684e'),
  foliage(61, 'lily_pad', 0.3, 1, 0, [86, 138, 66], '#568a42'),
]

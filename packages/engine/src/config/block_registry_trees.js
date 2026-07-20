// PROCEDURAL-TREE species BLOCKS (ENGINE_AAA_PLAN §3.3/§3.7, lane B1 — the A1 art wave's block handoff).
// Registry rows for the per-species LEAF blocks and the NEW twig-card foliage blocks, 1:1 by NAME with the
// A1 recipes in texture_recipes_trees.js (the baker auto-wires block.id → recipe base layer via the recipe's
// default `blocks: [name]` — texture_baker.js:579). Spread onto BLOCK_REGISTRY at the END (one wire-in line),
// APPEND-ONLY so pre-existing ids never renumber and the atlas layer order is untouched (layers come from
// RECIPES order alone — registering blocks moves ZERO albedo bytes; guarded by the A1 parity-hash pin).
//
// PLACEMENT deferred (the A3 gather-blocks precedent): registered but referenced by NO species yet — the
// tree_species roster (gen/trees/species.js) deliberately ships on the pre-existing log/leaves/dead_branch
// blocks. B2 (giant pines + scale identity) swaps a species' bark/leaf/twig names onto these rows and adds
// the leaf names to pool_renderer's NAME-keyed cutout set (render fence — not this lane) when it makes them
// live. Until then the rows are inert: nothing places these ids ⇒ byte-identical DEFAULT world.
// ID FENCE (lane B1): 95-101 species leaves (solid) · 102-103 twig cards (cross foliage). Never renumber —
// persisted in chunk `ids`. Prior fences: 0-39 base+coral · 40-61 flora · 62-94 gather.

/** @typedef {import('./block_registry.js').BlockDef} BlockDef */

/** Solid species-leaf block (the leaves/leaves_conifer idiom): opacity-2 canopy skylight SEMI-OCCLUDER
 *  (light-only — see block id 7), leaf sounds. `texture_recipe` is the frozen-schema vestigial fallback
 *  (the real bake binds the same-named A1 recipe); `map_color` feeds the LOD far-shell average.
 *  @param {number} id @param {string} name @param {[number,number,number]} base dominant rgb
 *  @param {string} map map_color hex @returns {BlockDef} */
function species_leaf(id, name, base, map) {
  return {
    id,
    name,
    class: 'solid',
    texture_recipe: { base_color_rgb: base, layers: [] },
    emission_rgb: [0, 0, 0],
    opacity: 2,
    wind: 0,
    sounds: { step: 'leaves', place: 'leaves', break: 'leaves' },
    map_color: map,
  }
}

/** Twig branch-card block (§3.3 "new foliage-class blocks, shape 'cross'" — the dead_branch idiom with a
 *  mild in-crown sway). No occupancy, walk-through: the mesher's cross pass emits the billboard pair and
 *  the EXISTING cross-billboard pipeline renders the baked A1 branch-card texture — sprite branches with
 *  zero renderer changes (§3.7). @param {number} id @param {string} name
 *  @param {[number,number,number]} base @param {string} map @returns {BlockDef} */
function twig(id, name, base, map) {
  return {
    id,
    name,
    class: 'foliage',
    shape: 'cross',
    cross_height: 1.0,
    cross_pairs: 1,
    texture_recipe: { base_color_rgb: base, layers: [] },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: /** @type {1} */ (1),
    sounds: { step: 'wood', place: 'wood', break: 'wood' },
    map_color: map,
  }
}

/** @type {BlockDef[]} */
export const TREE_BLOCKS = [
  // Per-species crowns (§3.7 per-species leaf textures; colours = each A1 recipe's dominant rgb).
  species_leaf(95, 'tree_leaf_broadleaf', [74, 104, 52], '#4a6834'), // oak_broadleaf + jungle_giant
  species_leaf(96, 'tree_leaf_birch', [120, 150, 78], '#78964e'), // birch_slim (pale airy crown)
  species_leaf(97, 'tree_needle_bunch', [42, 74, 58], '#2a4a3a'), // pine_cathedral + spruce_mid
  species_leaf(98, 'tree_leaf_dry', [140, 128, 64], '#8c8040'), // acacia_umbrella (savanna straw)
  species_leaf(99, 'tree_moss_drape', [72, 86, 56], '#485638'), // swamp_buttress (hanging moss)
  species_leaf(100, 'tree_palm_frond', [112, 124, 40], '#707c28'), // palm_curve (frond rosette)
  {
    // GIANT MUSHROOM CAP — structural cap voxels (stamped 'overwrite'), a full occluder like the cave
    // mushroom_cap_* family, but NON-emissive (A1: a surface giant, not the cave glow-mushrooms).
    id: 101,
    name: 'tree_mushroom_cap',
    class: 'solid',
    texture_recipe: { base_color_rgb: [150, 72, 54], layers: [] },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#964836',
  },
  // Twig branch cards (§3.7 "the biggest single 'not a lollipop' read") — mid-crown branch structure.
  twig(102, 'tree_twig_bare', [92, 68, 46], '#5c442e'), // broadleaf/dead species
  twig(103, 'tree_twig_conifer', [58, 66, 48], '#3a4230'), // needled conifer branch
]

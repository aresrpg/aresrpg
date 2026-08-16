// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Block registry v0 (§3.6) — FROZEN SCHEMA. WS2 (gen/decorators) and WS4 (texture_baker,
// terrain_material) both code against this exact shape. Adding blocks later is additive-only;
// do not change field names/types without a version bump.

/** @typedef {'solid'|'foliage'|'liquid'|'air'} BlockClass */
/** @typedef {0|1|2|3} WindStrength none / weak / medium / strong */

/**
 * @typedef {object} BlockSounds
 * @property {string} step footstep sound set id
 * @property {string} place placement sound set id
 * @property {string} break break sound set id
 */

/**
 * @typedef {object} TextureRecipeLayer
 * @property {string} op recipe op name (color_ramp | fbm_grain | worley_veins | speckle |
 *   border_darken | height_to_normal — texture_baker.js interprets these; contract is the
 *   op name + params bag, not the implementation)
 * @property {Record<string, number|string>} params op-specific parameters
 */

/**
 * @typedef {object} TextureRecipe
 * @property {[number, number, number]} base_color_rgb 0-255 per channel, ramp anchor
 * @property {TextureRecipeLayer[]} layers ordered recipe ops applied over the base
 */

/**
 * @typedef {object} BlockDef
 * @property {number} id stable numeric id — persisted in chunk `ids` arrays, never reused
 * @property {string} name snake_case identifier, e.g. "log"
 * @property {BlockClass} class solid|foliage|liquid|air — drives mesher face-culling class
 * @property {'cube'|'cross'} [shape] block geometry — 'cube' (default when omitted) meshes via
 *   greedy face-culling; 'cross' emits two crossed billboard quads (foliage class), never
 *   greedy-merged and never face-culled (§3.6). Cross blocks carry no occupancy bit and are
 *   non-solid, so they never occlude neighbors or contribute AO — they behave like air for
 *   culling/AO while their ids still live in the chunk `ids` array.
 * @property {number} [cross_height] shape:'cross' ONLY — billboard height in blocks, MAY BE FRACTIONAL
 *   (default 1). The wire quad_h is a 5-bit INTEGER, so the mesher writes Math.ceil(cross_height) as the
 *   quad_h ENVELOPE (the sprite-UV bound + sway envelope), and the flora vertex scales the true fractional
 *   height by height_frac = cross_height/ceil (terrain_flora.js). So grass_tuft 1.4 → wire h 2, rendered
 *   1.4 blocks; reed 3 → wire h 3, frac 1.0 (byte-identical). One voxel = one plant per column. Omitting
 *   it (every pre-existing block) is height 1, frac 1.0 — byte-identical to before. Ignored for cube shapes.
 * @property {number} [cross_pairs] shape:'cross' ONLY — the number K of INDEPENDENT billboard PAIRS
 *   the mesher stamps for ONE flora cell (default 1). Each pair is a fresh crossed-diagonal (faces
 *   6/7 = 2 quads), tagged with an ORDINAL 0..K-1 in its freed AO byte (quad_buffer.js: crosses carry
 *   flat AO, so bits 20-22 encode the ordinal instead). The material hashes (cell, ordinal) into a
 *   PER-PLANE yaw / XZ jitter / scale / base-height / wind-phase / variant, so K stamps read as a
 *   scattered TANGLE, not one repeated X-cross (FLORA-CHAOS fix). K>1 multiplies this cell's foliage
 *   quads by K (2K per cell) — the pool budget (pool_renderer.js POOL_CONFIG.foliage) is sized for the
 *   dense grass max (K=3 ⇒ 32·32·6 = 6144 q/chunk ≤ one 8192-slot). Clamped to ≤8 (3-bit ordinal).
 *   Grass carpet 3, tall accents / reeds / flowers 2. Ignored for cube shapes.
 * @property {TextureRecipe} texture_recipe procedural texture bake recipe (§3.6)
 * @property {[number, number, number]} emission_rgb 0-255 per channel; [0,0,0] = non-emissive
 * @property {number} opacity 0 (fully transparent, e.g. air/glass) to 15 (fully opaque) —
 *   light-BFS attenuation unit, matches the 4-bit light nibble range (§3.4)
 * @property {WindStrength} wind 0=none 1=weak 2=medium 3=strong — foliage-class sway amount
 * @property {BlockSounds} sounds step/place/break sound set ids
 * @property {string} map_color CSS hex color — far-field per-block average color (§3.6)
 */

import { FLORA_BLOCKS } from './block_registry_flora.js'
import { GATHER_BLOCKS } from './block_registry_gather.js'
import { TREE_BLOCKS } from './block_registry_trees.js'

/** @type {BlockDef[]} */
export const BLOCK_REGISTRY = [
  {
    id: 0,
    name: 'air',
    class: 'air',
    texture_recipe: { base_color_rgb: [0, 0, 0], layers: [] },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 0,
    sounds: { step: 'none', place: 'none', break: 'none' },
    map_color: '#000000',
  },
  {
    id: 1,
    name: 'stone',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [120, 120, 124],
      layers: [
        { op: 'fbm_grain', params: { scale: 8, strength: 0.12 } },
        { op: 'speckle', params: { density: 0.05, darken: 0.2 } },
      ],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#787878',
  },
  {
    id: 2,
    name: 'dirt',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [110, 79, 56],
      layers: [{ op: 'fbm_grain', params: { scale: 6, strength: 0.15 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'dirt', place: 'dirt', break: 'dirt' },
    map_color: '#6e4f38',
  },
  {
    id: 3,
    name: 'grass',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [92, 140, 60],
      layers: [
        { op: 'fbm_grain', params: { scale: 5, strength: 0.18 } },
        { op: 'border_darken', params: { width: 1, amount: 0.25 } },
      ],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#5c8c3c',
  },
  {
    id: 4,
    name: 'sand',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [214, 199, 148],
      layers: [{ op: 'speckle', params: { density: 0.1, darken: 0.1 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'sand', place: 'sand', break: 'sand' },
    map_color: '#d6c794',
  },
  {
    id: 5,
    name: 'water',
    class: 'liquid',
    texture_recipe: {
      base_color_rgb: [46, 96, 158],
      layers: [{ op: 'fbm_grain', params: { scale: 4, strength: 0.08 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 2,
    wind: 0,
    sounds: { step: 'water', place: 'water', break: 'water' },
    map_color: '#2e609e',
  },
  {
    id: 6,
    name: 'log',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [90, 64, 40],
      layers: [{ op: 'fbm_grain', params: { scale: 10, strength: 0.2 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'wood', place: 'wood', break: 'wood' },
    map_color: '#5a4028',
  },
  {
    id: 7,
    name: 'leaves',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [70, 110, 48],
      layers: [{ op: 'fbm_grain', params: { scale: 6, strength: 0.22 } }],
    },
    emission_rgb: [0, 0, 0],
    // SEMI-OCCLUDER (2026-07-03 canopy skylight): leaves attenuate the light BFS by 2 levels/cell
    // instead of blocking it fully (opacity is read ONLY by light_engine.js — the mesher culls faces
    // by occupancy, so this is light-only). Gives soft dappled canopy falloff: a thin canopy filters
    // light, a thick one drives the floor dark; it's pure DATA — the light engine stays universal (no
    // "if leaf"). Meshing/occupancy/render unchanged (leaves are still a solid opaque cube).
    opacity: 2,
    wind: 0,
    sounds: { step: 'leaves', place: 'leaves', break: 'leaves' },
    map_color: '#466e30',
  },
  {
    id: 8,
    name: 'snow',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [235, 240, 245],
      layers: [{ op: 'speckle', params: { density: 0.04, darken: 0.05 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'snow', place: 'snow', break: 'snow' },
    map_color: '#ebf0f5',
  },
  {
    id: 9,
    name: 'glowstone',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [235, 200, 120],
      layers: [{ op: 'worley_veins', params: { scale: 5, strength: 0.3 } }],
    },
    emission_rgb: [255, 210, 130],
    opacity: 15,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#ebc878',
  },
  {
    id: 10,
    name: 'grass_tuft',
    class: 'foliage',
    shape: 'cross',
    cross_height: 1.4, // WAIST-HIGH carpet — the meadow BULK. Owner round-3 ("grass feels a bit too tall"):
    // dropped 2→1.4 so the 1.5-block avatar reads clearly ABOVE the carpet (was drowning). FRACTIONAL: the
    // mesher writes ceil (2) to the integer wire h (the sprite-UV envelope + the tests' asserted h), and the
    // flora vertex scales the true 1.4/2 fraction (terrain_flora.js height_frac). tall_grass (2.2) still rises
    // above it as the accent. Height is quad_h × height_frac (no extra quads).
    cross_pairs: 2, // [D182 density] 2 pairs (was 3) — with the thinning the carpet reads airy, not turf
    // bulk, so it gets the densest tangle (6 planes at scattered yaws) to kill the "one repeated X" read.
    texture_recipe: {
      base_color_rgb: [96, 150, 70],
      layers: [{ op: 'fbm_grain', params: { scale: 6, strength: 0.22 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 1,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#5a9646',
  },
  {
    id: 11,
    name: 'flower_red',
    class: 'foliage',
    shape: 'cross',
    cross_pairs: 2, // FLORA-CHAOS: 2 offset/rotated blooms per cell → a small clump, not a lone flat cross.
    texture_recipe: {
      base_color_rgb: [176, 62, 48],
      layers: [{ op: 'speckle', params: { density: 0.15, darken: 0.15 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 1,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#b03e30',
  },
  {
    id: 12,
    name: 'flower_yellow',
    class: 'foliage',
    shape: 'cross',
    cross_pairs: 2, // FLORA-CHAOS: 2 offset/rotated blooms per cell → a small clump, not a lone flat cross.
    texture_recipe: {
      base_color_rgb: [214, 190, 74],
      layers: [{ op: 'speckle', params: { density: 0.15, darken: 0.15 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 1,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#d6be4a',
  },
  // ── DIVERGENCE WAVE cross-flora (2026-07-03): the waist-high grass OCEAN, marsh reeds, meadow
  // flowers, and forest-floor undergrowth. All shape:'cross' foliage (class 'foliage', no occupancy).
  // `cross_height` makes tall_grass/reed a SINGLE tall voxel (one plant per column) — see the field doc.
  {
    id: 13,
    name: 'tall_grass',
    class: 'foliage',
    shape: 'cross',
    cross_height: 2.2, // CHEST-HIGH accent — the tall silhouette above the waist-high tuft carpet. Owner round-3
    // ("grass too tall"): dropped 3→2.2. FRACTIONAL like grass_tuft: mesher writes ceil (3) to the wire h, the
    // flora vertex scales the true 2.2/3 fraction. Reeds keep their full 3 at the shores.
    cross_pairs: 2, // FLORA-CHAOS: 2 scattered blades per accent stand (fewer than the carpet — these are tall silhouettes).
    texture_recipe: {
      base_color_rgb: [96, 150, 70],
      layers: [{ op: 'fbm_grain', params: { scale: 6, strength: 0.22 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 2, // medium — sways more than short tufts
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#506e38',
  },
  {
    id: 14,
    name: 'reed',
    class: 'foliage',
    shape: 'cross',
    cross_height: 3, // marsh reed — tallest, water-adjacent shores
    cross_pairs: 2, // FLORA-CHAOS: 2 scattered reeds per cell → a marsh clump, not a lone flat cross.
    texture_recipe: {
      base_color_rgb: [120, 130, 74],
      layers: [{ op: 'fbm_grain', params: { scale: 6, strength: 0.2 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 2,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#78824a',
  },
  {
    id: 15,
    name: 'flower_white',
    class: 'foliage',
    shape: 'cross',
    cross_pairs: 2, // FLORA-CHAOS: 2 offset/rotated blooms per cell → a small clump, not a lone flat cross.
    texture_recipe: {
      base_color_rgb: [216, 216, 200],
      layers: [{ op: 'speckle', params: { density: 0.15, darken: 0.15 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 1,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#c0c0a8',
  },
  {
    id: 16,
    name: 'flower_purple',
    class: 'foliage',
    shape: 'cross',
    cross_pairs: 2, // FLORA-CHAOS: 2 offset/rotated blooms per cell → a small clump, not a lone flat cross.
    texture_recipe: {
      base_color_rgb: [138, 96, 176],
      layers: [{ op: 'speckle', params: { density: 0.15, darken: 0.15 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 1,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#8a6ab0',
  },
  {
    id: 17,
    name: 'fern',
    class: 'foliage',
    shape: 'cross',
    cross_pairs: 3, // FLORA-CHAOS: forest-floor carpet, like grass — 3 scattered fronds per cell for a full undergrowth tangle.
    texture_recipe: {
      base_color_rgb: [58, 92, 48],
      layers: [{ op: 'fbm_grain', params: { scale: 5, strength: 0.2 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 1, // subtle under-canopy shimmer
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#3a5230',
  },

  // ── D141 CAVE-ROOM blocks (2026-07-04). The dungeon cave-room generator (gen/cave_room.js) builds
  // its walls/ceiling/floor + décor from these. APPENDED (never inserted) so every pre-existing id +
  // atlas layer index stays byte-stable (the golden world hash + baker layer order are position-keyed).
  // No texture_recipe on most: a block absent from the baker's recipe set falls through to its flat
  // map_color (layer_index_from_registry → −1 → fragment uses map_color), which is the ship-minimum path
  // for a dark cave interior. Emissive blocks self-illuminate their own faces via terrain_material's
  // emissiveNode = emission_from_registry(block_id) — INDEPENDENT of the (unimplemented) block-light BFS,
  // so glow mushrooms + lava glow without any light-propagation workstream (glowstone precedent, id 9).
  {
    id: 18,
    name: 'cave_stone',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [58, 56, 62],
      layers: [
        { op: 'fbm_grain', params: { scale: 8, strength: 0.14 } },
        { op: 'speckle', params: { density: 0.06, darken: 0.28 } },
      ],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#3a383e', // dark damp cavern rock — the room shell (walls/ceiling)
  },
  {
    id: 19,
    name: 'mossy_stone',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [56, 66, 50],
      layers: [{ op: 'fbm_grain', params: { scale: 6, strength: 0.2 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#414d3a', // moss-crusted rock — floor accents + debris
  },
  {
    id: 20,
    name: 'mushroom_stem',
    class: 'solid',
    // texture_recipe is the FROZEN-schema field (currently vestigial — the real bake reads
    // texture_recipes.js RECIPES, and a block absent there falls back to map_color). Carry a minimal
    // one (base = map_color, no layers) so the schema stays frozen; add a real recipe later if wanted.
    texture_recipe: { base_color_rgb: [216, 205, 180], layers: [] },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'wood', place: 'wood', break: 'wood' },
    map_color: '#d8cdb4', // pale fibrous stalk — the giant glow-mushroom trunk
  },
  {
    id: 21,
    name: 'mushroom_cap_azure',
    class: 'solid',
    texture_recipe: { base_color_rgb: [47, 107, 208], layers: [] },
    emission_rgb: [70, 150, 255], // cool blue bioluminescence — the primary glow cluster color
    opacity: 15,
    wind: 0,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#2f6bd0',
  },
  {
    id: 22,
    name: 'mushroom_cap_teal',
    class: 'solid',
    texture_recipe: { base_color_rgb: [47, 174, 152], layers: [] },
    emission_rgb: [60, 220, 190], // teal bioluminescence — secondary cluster color
    opacity: 15,
    wind: 0,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#2fae98',
  },
  {
    id: 23,
    name: 'mushroom_cap_amber',
    class: 'solid',
    texture_recipe: { base_color_rgb: [208, 138, 47], layers: [] },
    emission_rgb: [255, 180, 70], // warm amber bioluminescence — accent cluster color
    opacity: 15,
    wind: 0,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#d08a2f',
  },
  {
    id: 24,
    name: 'lava',
    class: 'solid', // HONEST NOTE: emissive SOLID, not a real liquid. A liquid class would route through
    // the water surface material (LIQUID_BLOCK_IDS → apply_water_to_material) and render lava with water
    // ripples/reflection — wrong, and reusing water_material for a lava variant is out of MVP scope. As a
    // solid it glows via emissiveNode with zero material changes (ship-minimum). Recipe knob toggles it.
    texture_recipe: { base_color_rgb: [122, 44, 14], layers: [] },
    emission_rgb: [255, 96, 20], // molten orange glow — ravine/chasm floor when the recipe enables lava
    opacity: 15,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#7a2c0e', // dark cooled-crust base under the emissive glow
  },
  {
    id: 25,
    name: 'cobweb',
    class: 'foliage',
    shape: 'cross', // crossed billboards, non-solid (walk through) — draped in corners/ceiling
    cross_pairs: 2,
    texture_recipe: { base_color_rgb: [200, 200, 204], layers: [] },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 1, // faint drift
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#c8c8cc', // pale grey silk
  },
  {
    id: 26,
    name: 'bones',
    class: 'foliage',
    shape: 'cross', // scattered skulls/ribs as billboards on the floor — atmospheric debris, walk-through
    cross_pairs: 2,
    texture_recipe: { base_color_rgb: [214, 207, 190], layers: [] },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#d6cfbe', // bleached bone
  },
  {
    id: 27,
    name: 'cave_shroom',
    class: 'foliage',
    shape: 'cross', // small emissive ground mushrooms carpeting the cluster bases — soft floor glow
    cross_pairs: 3,
    cross_height: 0.6,
    texture_recipe: { base_color_rgb: [63, 134, 192], layers: [] },
    emission_rgb: [40, 120, 180], // dim azure ground glow
    opacity: 0,
    wind: 0,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#3f86c0',
  },

  // ── D164 SPECIES-AWARE LEAVES (2026-07-05). Two leaf VARIANT blocks beside the broadleaf default
  // (id 7 'leaves'), so the schematic stamper can place species-honest canopy: conifer (spruce/pine —
  // darker, needled, denser cutout mask) and dry (acacia/savanna/desert — straw-tinted, sparser mask).
  // APPENDED (never inserted) so every pre-existing id + atlas layer index stays byte-stable. These are
  // the CUTOUT render class (block_registry `class` stays 'solid' for gen/light/collision — the render
  // class is a SEPARATE render-side partition in pool_renderer.js CUTOUT_BLOCK_IDS, exactly like liquid;
  // §D164). Same opacity-2 semi-occluder skylight falloff as broadleaf leaves (light-only; see id 7).
  // The registry_map species ruleset (registry_map.js) + the loader set-level fallback resolve which
  // schematic leaf palette maps to which of the 3 — documented mapping table there.
  {
    id: 28,
    name: 'leaves_conifer',
    class: 'solid', // gen/light/collision treat it as the broadleaf leaf cube; render class = cutout
    texture_recipe: {
      base_color_rgb: [48, 78, 52], // darker needled evergreen (vs broadleaf [70,110,48])
      layers: [{ op: 'fbm_grain', params: { scale: 6, strength: 0.22 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 2, // canopy skylight semi-occluder (light-only), matching id 7 leaves
    wind: 0,
    sounds: { step: 'leaves', place: 'leaves', break: 'leaves' },
    map_color: '#304e34', // dark evergreen — far-field average
  },
  {
    id: 29,
    name: 'leaves_dry',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [120, 118, 70], // sun-bleached savanna/acacia straw-green
      layers: [{ op: 'fbm_grain', params: { scale: 6, strength: 0.22 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 2,
    wind: 0,
    sounds: { step: 'leaves', place: 'leaves', break: 'leaves' },
    map_color: '#787646', // dry olive-straw — far-field average
  },

  // ── FIVE-WORLDS shared-stage blocks (2026-07-06). APPENDED (never inserted) so every pre-existing id +
  // atlas layer index stays byte-stable (the golden world hash + baker layer order are position-keyed).
  // ICE/PACKED_ICE back the EVEREST iceberg placer (gen/stages/icebergs.js) — real ice replaces P2's lossy
  // ice→snow schematic mapping (registry_map.js re-pointed). PALM_LOG/PALM_LEAVES back the PARADISE palm
  // schematics (pool_palms), palette sampled from the reference corpus's palm wood + texture assets.
  {
    id: 30,
    name: 'ice',
    class: 'solid', // opaque solid so iceberg masses mesh watertight (no liquid/translucent MVP scope)
    texture_recipe: {
      base_color_rgb: [200, 224, 240], // pale blue-white glacier ice
      layers: [{ op: 'worley_veins', params: { scale: 5, strength: 0.22 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#c8e0f0', // pale blue-white — far-field average
  },
  {
    id: 31,
    name: 'packed_ice',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [176, 206, 230], // denser, bluer glacier core
      layers: [{ op: 'worley_veins', params: { scale: 6, strength: 0.18 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#b0cee6', // deep glacier blue — far-field average
  },
  {
    id: 32,
    name: 'palm_log',
    class: 'solid',
    texture_recipe: {
      // The reference corpus's Wood_Trunk_Palm_Side avg (138,97,51), dominant (144,96,48) — warm fibrous tan-brown.
      base_color_rgb: [146, 102, 54],
      layers: [{ op: 'fbm_grain', params: { scale: 9, strength: 0.2 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'wood', place: 'wood', break: 'wood' },
    map_color: '#926636', // warm palm-trunk tan — far-field average
  },
  {
    id: 33,
    name: 'palm_leaves',
    class: 'solid', // gen/light/collision treat it as a leaf cube; render class = cutout (pool_renderer)
    texture_recipe: {
      // The reference corpus's Palm_Texture avg (120,117,22), dominant (96,96,0)→(144,144,24) — saturated yellow-green fronds.
      base_color_rgb: [112, 120, 32],
      layers: [{ op: 'fbm_grain', params: { scale: 6, strength: 0.22 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 2, // canopy skylight semi-occluder (light-only), matching id 7 leaves
    wind: 0,
    sounds: { step: 'leaves', place: 'leaves', break: 'leaves' },
    map_color: '#70781f', // yellow-green frond — far-field average
  },
  // ── FIVE-WORLDS Paradise CORAL SPRITES (2026-07-07): cross-flora reef fans placed on the SUBMERGED
  // lagoon sand (surface_decorator submerged path, gated on config.decoration.sprites.coral). shape:'cross'
  // foliage (no occupancy, sway in the current via wind). Vivid pink/purple/teal so the reef reads through
  // clear turquoise water. APPENDED (ids never renumbered; atlas layers append after palm_leaves).
  {
    id: 34,
    name: 'coral_pink',
    class: 'foliage',
    shape: 'cross',
    cross_height: 1.3,
    cross_pairs: 2,
    texture_recipe: {
      base_color_rgb: [214, 92, 128],
      layers: [{ op: 'speckle', params: { density: 0.18, darken: 0.18 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 1,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#d65c80',
  },
  {
    id: 35,
    name: 'coral_purple',
    class: 'foliage',
    shape: 'cross',
    cross_height: 1.4,
    cross_pairs: 2,
    texture_recipe: {
      base_color_rgb: [150, 84, 200],
      layers: [{ op: 'speckle', params: { density: 0.18, darken: 0.18 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 1,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#9654c8',
  },
  {
    id: 36,
    name: 'coral_teal',
    class: 'foliage',
    shape: 'cross',
    cross_height: 1.2,
    cross_pairs: 3,
    texture_recipe: {
      base_color_rgb: [46, 178, 164],
      layers: [{ op: 'speckle', params: { density: 0.18, darken: 0.18 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 0,
    wind: 1,
    sounds: { step: 'grass', place: 'grass', break: 'grass' },
    map_color: '#2eb2a4',
  },
  // ── FIVE-WORLDS Paradise CORAL REEF CUBES (2026-07-07): the pool_coral SCHEMATIC reef, remapped off the
  // authored wools onto MATTE full-cube blocks (coral schematics are fine, but they need a proper texture, not
  // emissive nothingness). Solid opaque cubes (class 'solid') — mottled reef stone, vivid but MATTE (zero
  // emission, full opacity). Rose covers magenta/purple/red wools, cyan covers cyan/lime, gold covers yellow.
  {
    id: 37,
    name: 'coral_rock_rose',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [196, 74, 110],
      layers: [{ op: 'fbm_grain', params: { scale: 5, strength: 0.24 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#c44a6e',
  },
  {
    id: 38,
    name: 'coral_rock_cyan',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [48, 168, 158],
      layers: [{ op: 'fbm_grain', params: { scale: 5, strength: 0.24 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#30a89e',
  },
  {
    id: 39,
    name: 'coral_rock_gold',
    class: 'solid',
    texture_recipe: {
      base_color_rgb: [216, 162, 58],
      layers: [{ op: 'fbm_grain', params: { scale: 5, strength: 0.24 } }],
    },
    emission_rgb: [0, 0, 0],
    opacity: 15,
    wind: 0,
    sounds: { step: 'stone', place: 'stone', break: 'stone' },
    map_color: '#d8a23a',
  },
  ...FLORA_BLOCKS, // VIVID-WORLD flora sprite blocks (ids 40-61, append-only ⇒ existing ids never renumber)
  ...GATHER_BLOCKS, // A3 gatherable base blocks (ids 62-94: 11 wheats/11 ores/11 herbs, append-only)
  ...TREE_BLOCKS, // B1 procedural-tree species leaves + twig cards (ids 95-103, append-only; A1 art handoff)
]

/** Lookup: block id → BlockDef. Built once at module load. */
const BY_ID = new Map(BLOCK_REGISTRY.map((def) => [def.id, def]))
/** Lookup: block name → BlockDef. Built once at module load. */
const BY_NAME = new Map(BLOCK_REGISTRY.map((def) => [def.name, def]))

/**
 * Looks up a block definition by numeric id.
 * @param {number} id
 * @returns {BlockDef | undefined}
 */
export function get_block_by_id(id) {
  return BY_ID.get(id)
}

/**
 * Looks up a block definition by snake_case name.
 * @param {string} name
 * @returns {BlockDef | undefined}
 */
export function get_block_by_name(name) {
  return BY_NAME.get(name)
}

/**
 * True if a block renders as reference-corpus-style leaf SPRITE clusters — airy cutout billboards NEAR + an opaque
 * canopy cube shell FAR (the LEAVES-2X dual-emit) — instead of a plain opaque cube. THE SINGLE HOME for
 * leaf-render-ness: the mesher (mesh/leaf_sprites.js sprite emit + solid-pass cube suppression), the pool
 * partition (render/pool_renderer.js cutout/canopy routing) and the sprite height-frac (render/registry_nodes.js)
 * all derive their id sets from THIS predicate, so a new leaf block is wired in exactly ONE place. Was
 * triplicated as `name.startsWith('leaves')`, which silently EXCLUDED `palm_leaves` (added 2026-07-07, after
 * the predicate landed) — so palm beaches (First Shore) rendered opaque BLOCK leaves + naked frond-stem twigs.
 * Mushroom CAPS are deliberately NOT leaves: they are structural 'overwrite' solid occluders, not airy canopy.
 * @param {BlockDef} block @returns {boolean} */
export const is_leaf_sprite_block = (block) => block.name.startsWith('leaves') || block.name === 'palm_leaves'

export const AIR_BLOCK_ID = /** @type {number} */ (get_block_by_name('air')?.id)

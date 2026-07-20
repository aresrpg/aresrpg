// PER-BIOME TEXTURE IDENTITY (FIVE-WORLDS — each biome must have its own texture identity: grass,
// sand, sprites, leaves, wood, water take on the style/atmosphere and colors of the biome). A world's
// `config.textures` carries per-block-FAMILY colour transforms (HSV hue/sat/val) that the baker applies to
// a COPY of the recipe set BEFORE baking — shifting every colour in a family's recipes uniformly, so the
// tonal STRUCTURE (grain/clumps/veins) is preserved while the palette moves to the biome's mood.
//
// PARITY LAW: the bake is seed-deterministic and the atlas LAYER INDICES are a frozen material contract —
// this only moves TEXEL COLOURS, never the layer order/count. An IDENTITY family transform ({hue:0,sat:1,
// val:1}) is SKIPPED entirely (the original rgb arrays pass through untouched — no rgb→hsv→rgb rounding),
// so an absent/all-identity `config.textures` produces a BYTE-IDENTICAL atlas (guarded by a bake-hash test).
//
// The HSV math is pure arithmetic (min/max/abs/mod/mul only — no transcendentals), so a per-world palette
// is deterministic across machines and propagates to the LOD far-shell for free (lod/colors averages the
// same world bake).

import { clamp } from '../core/math_utils.js'

/** @typedef {import('./texture_baker.js').Recipe} Recipe */
/** @typedef {import('./texture_baker.js').RecipeOp} RecipeOp */

/**
 * @typedef {object} FamilyTransform an HSV colour transform for one texture family. Identity = no change.
 * @property {number} [hue] hue rotation in DEGREES (-360..360; wraps)
 * @property {number} [sat] saturation multiplier (0 = greyscale, 1 = identity, >1 = more vivid)
 * @property {number} [val] value/brightness multiplier (1 = identity)
 */

/**
 * The texture FAMILIES → the recipe names they group (texture_recipes.js RECIPES). Every colour-bearing
 * recipe belongs to exactly one family; a family's transform applies to all of them so e.g. "grass" moves
 * the top, side, tufts, tall grass, fern AND reeds together (one coherent biome grass palette).
 * @type {Record<string, string[]>}
 */
export const TEXTURE_FAMILIES = {
  grass: [
    'grass',
    'grass_side',
    'grass_tuft',
    'tall_grass',
    'fern',
    'reed',
    'bush',
    'jungle_plant',
    'young_shoot',
    'dune_grass',
    'cattail',
    'swamp_weed',
    'moss_tuft',
    'lichen',
    'thistle',
    'lavender',
    'garrigue',
    'seaweed',
  ],
  // B1 wire-in of the A1 tree-art atoms (the deferred per-world tinting handoff): parity-safe because an
  // absent `config.textures.families` returns the ORIGINAL recipe array untouched (apply_texture_config
  // early-out) and a transform only rewrites its OWN recipe's texels — pre-existing layer bytes never move.
  foliage: [
    'leaves',
    'leaves_conifer',
    'leaves_dry',
    'palm_leaves',
    'tree_leaf_broadleaf',
    'tree_leaf_birch',
    'tree_needle_bunch',
    'tree_leaf_dry',
    'tree_moss_drape',
    'tree_palm_frond',
  ],
  wood: [
    'log',
    'palm_log',
    'tree_bark_birch',
    'tree_bark_pine',
    'tree_bark_acacia',
    'tree_bark_swamp',
    'tree_bark_dead',
  ],
  sand: ['sand'],
  dirt: ['dirt'],
  stone: ['stone', 'cave_stone', 'mossy_stone'],
  snow_ice: ['snow', 'ice', 'packed_ice'],
  flower: ['flower_red', 'flower_yellow', 'flower_white', 'flower_purple', 'orchid', 'alpine_flower'],
  water: ['water'],
}

/** The op params that carry an [r,g,b] colour (transformed per family). */
const RGB_KEYS = [
  'rgb',
  'rgb_dark',
  'rgb_light',
  'vein_rgb',
  'top_white',
  'head_rgb',
  'stem_rgb',
  'rim_rgb',
  'tip_rgb',
  'tip_rgb2',
]

/** Whether a family transform is a no-op (skip ⇒ byte-identical passthrough). @param {FamilyTransform} t */
function is_identity(t) {
  return (t.hue ?? 0) === 0 && (t.sat ?? 1) === 1 && (t.val ?? 1) === 1
}

// clamp imported from ../core/math_utils.js (canonical).

/**
 * RGB (0..255) → HSV (h 0..360, s 0..1, v 0..1). Pure arithmetic (no transcendentals). @param {number[]} rgb
 * @returns {[number, number, number]} */
function rgb_to_hsv(rgb) {
  const r = rgb[0] / 255,
    g = rgb[1] / 255,
    b = rgb[2] / 255
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}

/**
 * HSV (h 0..360, s 0..1, v 0..1) → RGB (0..255, rounded). Pure arithmetic. @param {number} h @param {number} s @param {number} v
 * @returns {[number, number, number]} */
function hsv_to_rgb(h, s, v) {
  const c = v * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = v - c
  let r = 0,
    g = 0,
    b = 0
  if (hp < 1) {
    r = c
    g = x
  } else if (hp < 2) {
    r = x
    g = c
  } else if (hp < 3) {
    g = c
    b = x
  } else if (hp < 4) {
    g = x
    b = c
  } else if (hp < 5) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

/**
 * Applies a family transform to one [r,g,b] colour (hue rotate + sat/val scale). @param {number[]} rgb
 * @param {FamilyTransform} t @returns {[number, number, number]} */
function transform_rgb(rgb, t) {
  const [h, s, v] = rgb_to_hsv(rgb)
  return hsv_to_rgb(h + (t.hue ?? 0), clamp(s * (t.sat ?? 1), 0, 1), clamp(v * (t.val ?? 1), 0, 1))
}

/** Clones a recipe op with every colour param + ramp stop transformed. @param {RecipeOp} op @param {FamilyTransform} t @returns {RecipeOp} */
function transform_op(op, t) {
  const out = /** @type {any} */ ({ ...op })
  for (const k of RGB_KEYS)
    if (Array.isArray(/** @type {any} */ (op)[k])) out[k] = transform_rgb(/** @type {any} */ (op)[k], t)
  if (Array.isArray(op.stops)) out.stops = op.stops.map((s) => ({ ...s, rgb: transform_rgb(s.rgb, t) }))
  return out
}

/**
 * @typedef {object} TexturesConfig per-world texture identity (config.textures).
 * @property {number} [size] atlas edge px (default 64; minimum 32 — already exceeded)
 * @property {Record<string, FamilyTransform>} [families] family name → HSV transform (see TEXTURE_FAMILIES)
 */

/**
 * Returns a recipe set with each family's colour transform applied (a shallow copy — untransformed recipes
 * pass through by reference). Absent/all-identity config ⇒ the ORIGINAL array (byte-identical bake). Pure.
 * @param {Recipe[]} recipes the base RECIPES
 * @param {TexturesConfig} [textures] the world's texture config
 * @returns {Recipe[]}
 */
export function apply_texture_config(recipes, textures) {
  const families = textures?.families
  if (!families) return recipes
  /** @type {Map<string, FamilyTransform>} */
  const xform_of = new Map()
  for (const [family, names] of Object.entries(TEXTURE_FAMILIES)) {
    const t = families[family]
    if (t && !is_identity(t)) for (const name of names) xform_of.set(name, t)
  }
  if (xform_of.size === 0) return recipes // all identity ⇒ byte-identical
  return recipes.map((r) => {
    const t = xform_of.get(r.name)
    return t ? { ...r, ops: r.ops.map((op) => transform_op(op, t)) } : r
  })
}

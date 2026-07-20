// Far-field block → map color (§11 NG-LOD). The quadtree far-shell (far_mesher.js) renders
// flat-shaded colored box-columns — DH-style "colored boxes, no textures by design" (survey S4).
// Each far column needs ONE representative RGB per dominant block: its map color.
//
// SINGLE SOURCE OF TRUTH: the map color is DERIVED from the near-field texture the player sees up
// close — the alpha-weighted average of the baked atlas layer for that block. So the far field reads
// as the honest mean of the near textures (grass averages green, water blue, stone grey), and any
// recipe retune propagates to the far field for free. We call the texture baker's PUBLIC api
// (bake_block_textures) and average the pixels — never importing its private RECIPES/ramp helpers,
// never modifying it. Blocks with no baked recipe (snow, glowstone, air) fall back to the registry's
// hand-authored `map_color` hex (block_registry.js), the only other declared source.
//
// Determinism: the bake is deterministic (same seed ⇒ byte-identical), and the average is
// bake-seed/size stable (grain/speckle are ~zero-mean), so the color table is stable across machines.

import { bake_block_textures } from '../render/texture_baker.js'
import { BLOCK_REGISTRY, get_block_by_id, get_block_by_name } from '../config/block_registry.js'

/**
 * Far-shell WATER colour override — the deep body colour, NOT the baked "water texture" average.
 * The NEAR water material (water_material.js) never paints water from its atlas layer; it paints the
 * dark deep-body colour `WATER_BODY_COLOR` (a reflection/depth composite on top). The far shell's
 * texture-average default is instead a pale mid-blue (the atlas water tile), so the far ocean read as a
 * featureless PALE SKY sheet — indistinguishable from the horizon/void (reported), and the near→far
 * seam jumped from dark body to pale blue. We override the water map colour to the deep body colour so
 * the far ocean is a continuous DARK blue-green surface that only dissolves toward the sky at the far
 * haze horizon (far_field.js). The far shell treats its vertex colours as LINEAR (its
 * MeshStandardNodeMaterial output-encodes to sRGB — verified: the old pale mid-band = byte[44,85,134]
 * shown ≈[140,165,190]), so this is `WATER_BODY_COLOR` written as LINEAR bytes.
 * SINGLE SOURCE: keep in sync with water_material.js `WATER_BODY_COLOR = [0.03, 0.105, 0.15]` (imported
 * here would drag three/tsl + a DepthTexture into the pure far-section worker — kept as a mirrored
 * constant instead; the JSDoc is the linkage).
 * @type {[number, number, number]}
 */
const FAR_WATER_COLOR = [8, 27, 38] // round([0.03, 0.105, 0.15] · 255)

/** Bake size for the color derivation — averages are size-independent, so a small atlas is plenty. */
const COLOR_BAKE_SIZE = 16
/** Bake seed for the color derivation (any fixed value — averages are seed-stable). */
const COLOR_BAKE_SEED = 0

/**
 * Parses a CSS hex color (`#rrggbb`) into an [r,g,b] byte triple. Falls back to black on a malformed
 * value. Used only for the registry `map_color` fallback path.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function parse_hex_color(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/**
 * Alpha-weighted mean RGB of one atlas layer's pixels. Alpha weighting makes alpha-clip recipes
 * (foliage tufts/flowers over a transparent background) average only their painted pixels instead of
 * washing toward black; opaque blocks (uniform alpha 255) reduce to a plain mean.
 * @param {Uint8Array} albedo flat RGBA bytes, layout [layer][row][col][rgba]
 * @param {number} layer layer index
 * @param {number} stride bytes per layer (size*size*4)
 * @returns {[number, number, number]}
 */
function average_layer(albedo, layer, stride) {
  const base = layer * stride
  let sr = 0
  let sg = 0
  let sb = 0
  let sa = 0
  for (let i = 0; i < stride; i += 4) {
    const a = albedo[base + i + 3]
    sr += albedo[base + i] * a
    sg += albedo[base + i + 1] * a
    sb += albedo[base + i + 2] * a
    sa += a
  }
  if (sa === 0) return [0, 0, 0]
  return [Math.round(sr / sa), Math.round(sg / sa), Math.round(sb / sa)]
}

/** @type {Map<number, [number, number, number]> | null} */
let color_table = null
/** FIVE-WORLDS: the active world's `config.textures`, so the far-shell colour average is derived from the
 *  SAME per-biome bake as the near atlas (per-world palettes reach the horizon for free). Absent ⇒ default. */
let active_textures = /** @type {import('../render/texture_palette.js').TexturesConfig | undefined} */ (undefined)

/**
 * Sets the world's texture palette for the far-shell colour derivation and invalidates the memo. Called by
 * engine.js on world selection (alongside the near-atlas bake) so near + far read one palette. Idempotent.
 * @param {import('../render/texture_palette.js').TexturesConfig} [textures]
 * @returns {void}
 */
export function set_far_textures(textures) {
  active_textures = textures
  color_table = null
}

/**
 * Builds (once, memoized) the block id → map color table. Baked blocks get the alpha-weighted mean
 * of their atlas layer; every other registry block falls back to its declared `map_color` hex.
 * @returns {Map<number, [number, number, number]>}
 */
function build_color_table() {
  if (color_table) return color_table
  const bake = bake_block_textures({ size: COLOR_BAKE_SIZE, seed: COLOR_BAKE_SEED, textures: active_textures })
  const stride = bake.size * bake.size * 4
  /** @type {Map<number, [number, number, number]>} */
  const table = new Map()
  // Registry fallback first, then override with the derived bake average where a layer exists.
  for (const def of BLOCK_REGISTRY) table.set(def.id, parse_hex_color(def.map_color))
  for (const [block_id, layer] of bake.layer_of) {
    table.set(block_id, average_layer(bake.albedo, layer, stride))
  }
  // WATER is not drawn from its atlas texture in the near field — override its far colour to the deep
  // body colour so the far ocean matches the near water body, not a pale sky sheet (see FAR_WATER_COLOR).
  const water = get_block_by_name('water')
  if (water) table.set(water.id, [...FAR_WATER_COLOR])
  color_table = table
  return table
}

/**
 * The far-field map color for a block id, as an [r,g,b] byte triple. Unknown ids return the air
 * color (black). The returned array is shared/owned by the table — treat it as read-only.
 * @param {number} block_id
 * @returns {[number, number, number]}
 */
export function get_map_color(block_id) {
  const table = build_color_table()
  return table.get(block_id) ?? table.get(0) ?? [0, 0, 0]
}

/**
 * Packs the whole block id → map color table into a flat Uint8Array LUT (`[id*3 + {0,1,2}]` = r,g,b),
 * sized to the highest registry id. Phase B uploads this as a small GPU uniform/texture so the far
 * shader resolves a quad's flat color from its dominant block id (see quadtree.js phase-B spec).
 * @returns {Uint8Array}
 */
export function build_map_color_lut() {
  const table = build_color_table()
  let max_id = 0
  for (const id of table.keys()) if (id > max_id) max_id = id
  const lut = new Uint8Array((max_id + 1) * 3)
  for (const [id, rgb] of table) {
    const [r, g, b] = rgb
    lut[id * 3] = r
    lut[id * 3 + 1] = g
    lut[id * 3 + 2] = b
  }
  return lut
}

/** Block ids present in the registry (for LUT sizing / tests). @returns {number[]} */
export function registry_block_ids() {
  return BLOCK_REGISTRY.map((d) => d.id)
}

/** Re-exported for callers deriving a color for an id they already resolved to a def. */
export { get_block_by_id }

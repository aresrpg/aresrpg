// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure registry→TSL select-ladder + hash/color helper nodes, extracted VERBATIM from
// terrain_material.js (2026-07-03, ≤600-LoC law split — the material file had accreted four lanes'
// landings). No behavior change: these are the same module-private helpers, now shared via import.
// See terrain_material.js for the consuming shading chain; docs travel with each function.

import { floor, hash, int, uint, uniformArray, vec3 } from 'three/tsl'
import { Vector3 } from 'three'

import { BLOCK_REGISTRY, get_block_by_name, is_leaf_sprite_block } from '../config/block_registry.js'

// Highest block id in the registry — the length basis for the id-indexed uniform arrays below. Every
// per-block map here is an O(1) `uniformArray(...).element(block_id)` LOOKUP, NOT a `.select()` ladder:
// each ladder step nested TWO WGSL ops (`.equal(id).select(v, chain)`), so a full-registry ladder's shader
// nesting depth was ≈2× the block count. At 62 blocks that is ≈124, one block-add from naga's HARD 127
// nesting limit that already killed the FRAGMENT-side tint ladders (2026-07-07, terrain went invisible).
// These ladders run VERTEX-side (wrapped in varying() by terrain_material.js) so they weren't the fragment
// break, but they sat at the same cliff — the lookup form is O(1) nesting regardless of registry growth.
const MAX_BLOCK_ID = BLOCK_REGISTRY.reduce((m, b) => Math.max(m, b.id), 0)

/**
 * Resolves the CPU-side atlas + block-family metadata the terrain material needs ONCE at build time (pure
 * Maps/ids, no TSL nodes) — the painterly repetition-break setup (fixes #3/#4) + the grass/log families +
 * the moss/stone-top family, extracted so build_terrain_material stays under the ≤600-LoC law. The
 * baker stashes name→base-layer / name→variant-count on `block_texture.userData` (build_data_array_texture).
 * @param {import('three').DataArrayTexture} block_texture painterly atlas (carries the name→layer maps)
 * @param {Map<number, number>} layer_of block id → base atlas layer
 * @returns {{
 *   variants_by_id: Map<number, number>, grass_id: number, log_id: number, moss_layer: number,
 *   stone_top_ids: number[], grass_base: number, grass_vn: number, grass_rot: number, dirt_base: number,
 *   dirt_vn: number, side_base: number, side_vn: number
 * }}
 */
export function resolve_material_atlas(block_texture, layer_of) {
  /** @type {Map<string, number>} */
  const layer_of_name = block_texture.userData?.layer_of_name ?? new Map()
  /** @type {Map<string, number>} */
  const variants_of_name = block_texture.userData?.variants_of_name ?? new Map()
  /** @type {Map<string, number>} */
  const rotations_of_name = block_texture.userData?.rotations_of_name ?? new Map()
  // block id → variant count, for the generic (non-grass) per-cell variant offset.
  /** @type {Map<number, number>} */
  const variants_by_id = new Map()
  for (const block of BLOCK_REGISTRY) {
    const count = variants_of_name.get(block.name)
    if (count && count > 1 && layer_of.has(block.id)) variants_by_id.set(block.id, count)
  }
  // Grass-block face family (fix #4): SIDES → grass_side (dirt + grass rim), TOP → grass, BOTTOM → dirt.
  const grass_id = /** @type {number} */ (get_block_by_name('grass')?.id ?? -1)
  // LOG family: side faces key their per-cell variant on the world (x,z) COLUMN only (drop y) so a whole
  // trunk shares ONE bark variant top-to-bottom = continuous bark, while neighbouring columns differ.
  const log_id = /** @type {number} */ (get_block_by_name('log')?.id ?? -1)
  // D164 MOSS OVERLAY: stone-family TOP faces grow moss where moisture is high. The moss
  // green is the D159 mossy_stone recipe's base layer (single source). Stone-family = stone + cave_stone.
  const moss_layer = /** @type {number} */ (layer_of_name.get('mossy_stone') ?? -1)
  const stone_top_ids = /** @type {number[]} */ (
    ['stone', 'cave_stone'].map((n) => get_block_by_name(n)?.id).filter((id) => id !== undefined)
  )
  const span = /** @param {string} name @returns {[number, number]} */ (name) => [
    layer_of_name.get(name) ?? -1,
    variants_of_name.get(name) ?? 1,
  ]
  const [grass_base, grass_vn] = span('grass')
  const [dirt_base, dirt_vn] = span('dirt')
  const [side_base, side_vn] = span('grass_side')
  // Grass's baked ROTATION count (texture_recipes.js `rotations`) — lets the material split the flattened
  // grass_vn (phase×rotation) back into an independent phase pick (coherent world-XZ patch) and rotation
  // pick (fine per-block hash); see terrain_texture_variant.js. Defaults to 1 (no split) if the atlas
  // predates this metadata, degrading gracefully to a phase-only offset.
  const grass_rot = rotations_of_name.get('grass') ?? 1
  return {
    variants_by_id,
    grass_id,
    log_id,
    moss_layer,
    stone_top_ids,
    grass_base,
    grass_vn,
    grass_rot,
    dirt_base,
    dirt_vn,
    side_base,
    side_vn,
  }
}

/**
 * Parses a CSS hex color ("#rrggbb") into a [0,1] float RGB triple, for baking the registry's
 * `map_color` into the TSL flat-color select chain at material-build time (CPU-side, once).
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hex_to_unit_rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255]
}

/**
 * O(1) block_id → flat map_color (vec3) uniform-array lookup (see MAX_BLOCK_ID for why this is a lookup,
 * not a `.select()` ladder). Gaps / ids absent from the registry read debug magenta (visible signal, not
 * silent black) — but the registry is dense so valid ids always hit a real colour.
 *
 * Cast to `*`: `uniformArray(...).element()` returns `Node<any>` and the downstream shading chain wants the
 * fluent math surface — the file's `*` convention, unchanged from the old ladder.
 * @param {*} block_id_node
 */
export function flat_color_from_registry(block_id_node) {
  const colors = /** @type {Vector3[]} */ (new Array(MAX_BLOCK_ID + 1))
  for (let i = 0; i < colors.length; i++) colors[i] = new Vector3(1, 0, 1) // debug magenta for gaps
  for (const block of BLOCK_REGISTRY) {
    const [r, g, b] = hex_to_unit_rgb(block.map_color)
    colors[block.id] = new Vector3(r, g, b)
  }
  return /** @type {*} */ (uniformArray(colors).element(int(block_id_node)))
}

/**
 * O(1) block_id → emissive RGB (0-1, vec3) uniform-array lookup (cf. `flat_color_from_registry`).
 * Non-emissive blocks read black. @param {*} block_id_node
 */
export function emission_from_registry(block_id_node) {
  const emis = /** @type {Vector3[]} */ (new Array(MAX_BLOCK_ID + 1))
  for (let i = 0; i < emis.length; i++) emis[i] = new Vector3(0, 0, 0)
  for (const block of BLOCK_REGISTRY) {
    const [er, eg, eb] = block.emission_rgb
    if (er === 0 && eg === 0 && eb === 0) continue
    emis[block.id] = new Vector3(er / 255, eg / 255, eb / 255)
  }
  return /** @type {*} */ (uniformArray(emis).element(int(block_id_node)))
}

/**
 * O(1) block_id → painterly-atlas LAYER INDEX (float) uniform-array lookup (cf. `flat_color_from_registry`).
 * `layer_of` is the baker's block-id→layer map — blocks absent from it (e.g. snow/glowstone, which have no
 * baked recipe) read −1, the sentinel the fragment shader reads as "sample nothing, use the flat map_color
 * fallback". @param {*} block_id_node @param {Map<number, number>} layer_of
 */
export function layer_index_from_registry(block_id_node, layer_of) {
  const layers = /** @type {number[]} */ (new Array(MAX_BLOCK_ID + 1).fill(-1))
  for (const [id, layer] of layer_of) if (id <= MAX_BLOCK_ID) layers[id] = layer
  return /** @type {*} */ (uniformArray(layers).element(int(block_id_node)))
}

/**
 * O(1) block_id → atlas VARIANT COUNT (float ≥1) uniform-array lookup, so the fragment shader can offset the
 * base layer by `hash(cell) % count` (cf. `flat_color_from_registry`). Blocks with no baked recipe read 1
 * (the base-layer offset is then always 0). @param {*} block_id_node @param {Map<number, number>} variants_by_id
 */
export function variant_count_from_registry(block_id_node, variants_by_id) {
  const counts = /** @type {number[]} */ (new Array(MAX_BLOCK_ID + 1).fill(1))
  for (const [id, count] of variants_by_id) if (id <= MAX_BLOCK_ID) counts[id] = count
  return /** @type {*} */ (uniformArray(counts).element(int(block_id_node)))
}

/** D164 leaf SPRITE height fraction. Leaf clusters render at ~1.3 blocks tall (a cell-filling puff
 *  overlapping neighbours) but the mesher writes the wire quad_h ceil envelope (2), so the material scales
 *  by LEAF_SPRITE_FRAC = 1.3/2. Kept beside the flora height-frac since both feed the same cross_billboard
 *  vertex. (D164-B: snow deposits removed — canopy snow is a baked white-top texture.) @type {number} */
export const LEAF_SPRITE_FRAC = 1.65 / 2 // [D177 fill-rate: fps is overdraw-bound — smaller area, still square-ish vs the 1.8 width] // [D175-B — leaves read too flat; grow all directions] taller ≈ square planes = volumetric puffs, not pancakes

/**
 * Builds a TSL select-ladder mapping a cross block_id to its FRACTIONAL height factor
 * height_frac = cross_height / ceil(cross_height) ∈ (0,1], so the flora vertex can render a fractional
 * `cross_height` (e.g. grass_tuft 1.4) while the integer wire quad_h carries ceil (the sprite/sway
 * envelope). D164: LEAF ids + snow render as sprite clusters at LEAF_SPRITE_FRAC (they aren't shape:'cross'
 * so they'd otherwise fall through to 1.0 = full wire h=2, too tall). Non-cross non-leaf blocks and integer
 * heights fall through to 1.0 (byte-identical). Untyped for the same reason as the other ladders.
 * @param {*} block_id_node */
export function cross_height_frac_from_registry(block_id_node) {
  const fracs = /** @type {number[]} */ (new Array(MAX_BLOCK_ID + 1).fill(1))
  for (const block of BLOCK_REGISTRY) {
    // Leaf sprite clusters + snow (its on-leaf deposit) scale to the ~1.3 m puff.
    if (is_leaf_sprite_block(block) || block.name === 'snow') {
      fracs[block.id] = LEAF_SPRITE_FRAC
      continue
    }
    const h = block.cross_height
    if (block.shape !== 'cross' || h == null) continue
    const frac = h / Math.ceil(h)
    if (frac === 1) continue // integer height ⇒ stays 1 (no scale needed)
    fracs[block.id] = frac
  }
  return /** @type {*} */ (uniformArray(fracs).element(int(block_id_node)))
}

/**
 * Deterministic per-cell hash in [0,1) from an integer 2-D cell + a salt, via three's built-in PCG
 * `hash` node. The two cell axes are folded on large odd primes so neighbouring cells decorrelate
 * (a raw `x + y` would band diagonally). Mirrors the baker's `Math.imul(...) >>> 0` discipline.
 *
 * 2026-07-04 FLORA-GRID FIX — the fold MUST run in UINT space, not float. The old code did
 * `cell_x.mul(float(374761393))` in float32 THEN let three's `hash` do `seed.toUint()`. But
 * `374761393 · x` for a world cell (x in the hundreds→thousands) is ≈1e11 — WAY past float32's
 * 2^24 integer-exact range (and combined, past float64's too), so the seed's low bits were already
 * garbage and whole neighbourhoods of cells rounded to the SAME representable float ⇒ the SAME uint
 * ⇒ the SAME hash. Flora yaw (this hash × 2π) collapsed to 1-2 distinct angles across a meadow: the
 * top-down "rigid lattice of identically-angled X tufts" visual defect (all cross_billboard
 * scatter — yaw/jitter/scale — degenerated with it). FIX: `floor→int→uint`, multiply as uint (WGSL
 * u32 `*` wraps mod 2^32, exact — the GPU twin of Math.imul), add, hash. Now world-position-
 * independent: measured circular-mean R≈0.01-0.05 with ~1500/1728 distinct yaws at every offset
 * (origin, 2k, 123k). `floor` (not a bare int-cast, which WGSL truncates toward zero) so a NEGATIVE
 * world cell folds to the same integer on the vertex AND the fragment (dispersion) side — both call
 * this with the plane cell, and the yaws must agree or the sun-glint plane wouldn't match the geometry.
 * @param {*} cell_x integer cell coord as a float node (floored here) @param {*} cell_y @param {number} salt
 */
export function cell_hash(cell_x, cell_y, salt) {
  const xi = uint(int(floor(cell_x)))
  const yi = uint(int(floor(cell_y)))
  return hash(
    xi
      .mul(uint(374761393))
      .add(yi.mul(uint(668265263)))
      .add(uint(salt >>> 0))
  )
}

/**
 * Rotates an RGB triple's hue by `a` radians (small ±) with the canonical Rec.601 luma-preserving
 * hue-rotation matrix (c=cos a, s=sin a) — a tiny hue jitter shifts colour without touching brightness,
 * the painterly variation for organic layers (fix #3). Each row's constant+cos terms sum to 1 so a
 * grey input is unchanged. @param {*} rgb vec3 node @param {*} a float node (radians)
 */
export function rotate_hue(rgb, a) {
  const c = a.cos()
  const s = a.sin()
  const r = rgb.x
  const g = rgb.y
  const b = rgb.z
  const nr = r
    .mul(c.mul(0.701).add(0.299).add(s.mul(0.168)))
    .add(g.mul(c.mul(-0.587).add(0.587).add(s.mul(0.33))))
    .add(b.mul(c.mul(-0.114).add(0.114).sub(s.mul(0.497))))
  const ng = r
    .mul(c.mul(-0.299).add(0.299).sub(s.mul(0.328)))
    .add(g.mul(c.mul(0.413).add(0.587).add(s.mul(0.035))))
    .add(b.mul(c.mul(-0.114).add(0.114).add(s.mul(0.292))))
  const nb = r
    .mul(c.mul(-0.3).add(0.3).add(s.mul(1.25)))
    .add(g.mul(c.mul(-0.588).add(0.587).sub(s.mul(1.05))))
    .add(b.mul(c.mul(0.886).add(0.114).sub(s.mul(0.203))))
  return vec3(nr, ng, nb)
}

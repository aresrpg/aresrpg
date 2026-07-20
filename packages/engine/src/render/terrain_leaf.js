// D164 terrain APPEARANCE nodes — the cutout-leaf backlight + moisture-driven moss overlay, extracted
// so terrain_material.js stays under the ≤600-LoC law (same split discipline as terrain_flora.js /
// terrain_tint.js / registry_nodes.js). Pure TSL node builders consumed ONLY by build_terrain_material;
// no determinism/p2p surface (render class), so sin/cos and world-position hashing are legal here.
//
// TWO consumers of the SAME moisture sampler (macro_moisture_node, terrain_tint.js — already a fragment
// node in the material): leaves lean their tint dry/green (in-material), and stone TOPS grow moss where
// humid (moss_overlay_node here). One field, N ecosystem responses (D163 will add more).

import { abs, float, int, length, max, mix, positionWorld, smoothstep, texture, vec2, vec3 } from 'three/tsl'

import { cell_hash, rotate_hue } from './registry_nodes.js'
import { YAW_SALT } from './terrain_flora.js'

/** [D164-B GREEN VARIETY]: everything read the same greens — not enough
 *  variation, all grass the same, all leaves the same. A COARSE world-XZ bucket hash gives each
 *  ~tree canopy (cutout) / grass patch (foliage) a COHERENT hue rotation + value lift, so neighbouring
 *  trees/patches read as DIFFERENT INDIVIDUALS while a single tree stays one hue across its cells. Composes
 *  WITH (multiplies) the material's per-plane micro-jitter + straw/moisture bias — never replaces them. Zero
 *  new data (positionWorld world-hash). TREE_SCALE ≈ one canopy; PATCH_SCALE ≈ a grass patch; HUE_AMP in
 *  radians (rotate_hue), VAL_AMP a ± multiply.
 *  @type {Readonly<{TREE_SCALE:number,PATCH_SCALE:number,HUE_AMP:number,VAL_AMP:number,HUE_SALT:number,VAL_SALT:number}>} */
export const CANOPY_VARIETY = {
  TREE_SCALE: 8,
  PATCH_SCALE: 5,
  HUE_AMP: 0.13,
  VAL_AMP: 0.16,
  HUE_SALT: 31,
  VAL_SALT: 32,
} // [D176 owner round-3: 'no variation in color'] amps up

/**
 * Per-TREE / per-PATCH GREEN VARIETY for a cross-billboard fragment (D164-B). Buckets the fragment's world
 * XZ at `scale` (one canopy or one grass patch — cell_hash floors the divided coord), hashes the bucket to a
 * coherent HUE rotation (±HUE_AMP rad) + VALUE multiply (1±VAL_AMP), and applies BOTH to the albedo. So
 * neighbouring individuals read apart while one tree stays a single hue over its cells; the caller keeps its
 * per-plane jitter (this multiplies on top). Pure appearance (no determinism/p2p surface — world-hash + a
 * luma-preserving hue rotate). @param {object} p
 * @param {*} p.albedo the (already micro-jittered) cross albedo vec3 @param {*} p.position_world vec3 world pos
 * @param {number} p.scale world-XZ bucket size (CANOPY_VARIETY.TREE_SCALE for leaves, PATCH_SCALE for grass)
 * @param {*} [p.tuft_cell] D182: per-plant plane-cell vec2 node (foliage only) — adds the per-TUFT hue layer
 * @returns {*} the hue+value-shifted albedo vec3 */
export function canopy_variety_node({ albedo, position_world, scale, tuft_cell = null }) {
  const bx = position_world.x.div(float(scale))
  const bz = position_world.z.div(float(scale))
  const hue = cell_hash(bx, bz, CANOPY_VARIETY.HUE_SALT)
    .sub(float(0.5))
    .mul(float(2 * CANOPY_VARIETY.HUE_AMP))
  const value_mul = float(1).add(
    cell_hash(bx, bz, CANOPY_VARIETY.VAL_SALT)
      .sub(float(0.5))
      .mul(float(2 * CANOPY_VARIETY.VAL_AMP))
  )
  let out = rotate_hue(albedo, hue).mul(value_mul)
  // [D182 owner ×5: grass "no variation in colors"] PER-TUFT layer on top of the patch: each plant
  // rotates its own hue ±0.07 + value ±12% off its plane cell — adjacent tufts read as individuals.
  if (tuft_cell) {
    const t_hue = cell_hash(tuft_cell.x, tuft_cell.y, 41).sub(float(0.5)).mul(float(0.14))
    const t_val = float(1).add(cell_hash(tuft_cell.x, tuft_cell.y, 42).sub(float(0.5)).mul(float(0.24)))
    out = rotate_hue(out, t_hue).mul(t_val)
  }
  return out
}

/** Pure JS mirror of canopy_variety_node's hue/value offsets from two [0,1) hashes — the tested twin of the
 *  TSL (range + neutral-centre: h=0.5 ⇒ hue 0, value_mul 1). @param {number} h_hue @param {number} h_val
 *  @param {number} [hue_amp] @param {number} [val_amp] @returns {{hue:number, value_mul:number}} */
export function canopy_variety_offsets(
  h_hue,
  h_val,
  hue_amp = CANOPY_VARIETY.HUE_AMP,
  val_amp = CANOPY_VARIETY.VAL_AMP
) {
  return { hue: (h_hue - 0.5) * 2 * hue_amp, value_mul: 1 + (h_val - 0.5) * 2 * val_amp }
}

/** Backlight spread (sun-through-canopy reads luminous). Additive, keyed on how BACK-lit the leaf
 *  is (−N·L clamped ⇒ the face pointing away from the sun, i.e. the camera-side of a sunlit canopy), sun-
 *  tinted, MODEST so it lifts shaded leaves toward glow without blowing to white / feeding bloom. */
const BACKLIGHT_GAIN = 0.28
/** Warm sun tint for the transmitted light (slightly yellow-green — light filtered THROUGH a leaf). */
const BACKLIGHT_RGB = /** @type {const} */ ([1.0, 0.94, 0.72])

/**
 * Soft wrap/backlight additive term for a CUTOUT leaf fragment — the sun-through-canopy glow. `-N·L`
 * clamped isolates the hemisphere facing AWAY from the sun (a canopy lit from behind), scaled by the leaf's
 * own sky exposure `v_sun` (deep-shade interior leaves don't glow — nothing reaches them to transmit) and a
 * modest gain, tinted warm. Returned as an ADDITIVE vec3 the caller adds to the lit colour (rides on top of
 * the FoliageLightingModel diffuse). Direction-only sun; a near-zenith sun still back-lights the underside.
 * @param {object} p
 * @param {*} p.normal_view view-space unit normal node (transformNormalToView(normal))
 * @param {*} p.sun_view view-space unit sun DIRECTION node (the foliage_sun uniform, view-transformed)
 * @param {*} p.v_sun BFS sun exposure [0,1] node (gates interior leaves out)
 * @param {*} p.albedo the leaf albedo vec3 (backlight is modulated by leaf colour so it reads as leaf-glow)
 * @returns {*} additive vec3 backlight term
 */
export function leaf_backlight_node({ normal_view, sun_view, v_sun, albedo }) {
  // −N·L clamped: 1 when the surface faces fully away from the sun (max transmission), 0 when it faces it.
  const back = normal_view.dot(sun_view).mul(float(-1)).clamp()
  const glow = back.mul(v_sun).mul(float(BACKLIGHT_GAIN))
  return albedo.mul(vec3(BACKLIGHT_RGB[0], BACKLIGHT_RGB[1], BACKLIGHT_RGB[2])).mul(glow)
}

/** Per-plane sun-dispersion range — each yaw-rotated grass plane catches the sun at its own
 *  brightness in [DISP_LO, DISP_HI] so a sunward field SPARKLES instead of flashing as one sheet. */
const DISP_LO = 0.75
const DISP_HI = 1.15

/**
 * PER-PLANE SUN DISPERSION for the FOLIAGE (cross-billboard) fragment — fixes light reflecting
 * uniformly, a single pane shining the sun back with no dispersion. Recomputes THIS plane's yaw from the
 * SAME hash the flora vertex used (the ordinal-folded plane cell + YAW_SALT), derives its HORIZONTAL face
 * normal (plane A/face 6 ⇒ (−sinY,cosY); plane B/face 7 ⇒ (−cosY,−sinY) — 90° apart so the two halves of one
 * X aren't a mini single-pane), dots with the NORMALIZED horizontal sun heading (|dot|, double-sided), maps
 * to [DISP_LO,DISP_HI]. Centre ≈1 (mean |dot|≈0.64) so exposure is ~unchanged; it's the SPREAD that kills the
 * flash. Returns a multiplier the caller applies to the cross albedo. Normalizing (eps-guarded) gives full
 * spread at any azimuth; a near-zenith sun (tiny xz) collapses it (the field flattens as the sun rises).
 * @param {object} p
 * @param {*} p.cross_cell vec2 node — the ordinal-folded plane cell (v_cross_cell), the yaw hash key
 * @param {*} p.v_face float node — the quad face id (6 = plane A, 7 = plane B)
 * @param {*} p.foliage_sun the world-space sun-direction uniform (xz heading is the dispersion axis)
 * @returns {*} float dispersion multiplier
 */
export function foliage_dispersion_node({ cross_cell, v_face, foliage_sun }) {
  const disp_yaw = cell_hash(cross_cell.x, cross_cell.y, YAW_SALT).mul(float(Math.PI * 2))
  const dcos = disp_yaw.cos()
  const dsin = disp_yaw.sin()
  const is_plane_a = v_face.equal(float(6))
  const nrm_h = is_plane_a.select(vec2(dsin.mul(float(-1)), dcos), vec2(dcos.mul(float(-1)), dsin.mul(float(-1))))
  const sun_h = vec2(foliage_sun.x, foliage_sun.z)
  const sun_h_n = sun_h.div(max(length(sun_h), float(1e-3)))
  return mix(float(DISP_LO), float(DISP_HI), abs(nrm_h.dot(sun_h_n)))
}

/** Moss coverage ramp vs macro moisture: bare below LO, full moss cap above HI, a mossy RIM between —
 *  continuous. */
const MOSS_LO = 0.52
const MOSS_HI = 0.82

/**
 * Moisture-driven MOSS OVERLAY for a stone-family TOP face (humid stone
 * grows moss on top). Render-side only — NO gen/block change, no world fork. Blends the block's albedo
 * toward a sampled MOSS layer (the D159 mossy_stone recipe — single moss-green home, never a second invented
 * green) by a coverage factor = smoothstep(LO,HI, moisture)·is_stone_top. So a humid plateau grows a mossy
 * cap while an arid one stays bare rock, continuous across the moisture field (seamless — moisture is a
 * world-XZ octave with no chunk term). The moss layer is sampled at the SAME world-planar UV as the stone
 * (both are the +y top face) so the moss grain aligns with the rock. Caller gates to stone-family top faces.
 * @param {object} p
 * @param {*} p.albedo the stone albedo vec3 (returned unchanged where coverage is 0)
 * @param {*} p.moisture macro moisture [0,1] node (macro_moisture_node — the SHARED sampler)
 * @param {*} p.is_stone_top float {0,1} node — 1 on a stone-family +y top face, else 0 (gates the whole overlay)
 * @param {import('three').DataArrayTexture} p.block_texture the painterly atlas
 * @param {*} p.uv the world-planar UV node (same as the stone top samples)
 * @param {number} p.moss_layer atlas layer index of the mossy_stone base (−1 ⇒ overlay disabled)
 * @returns {*} moss-blended albedo vec3
 */
export function moss_overlay_node({ albedo, moisture, is_stone_top, block_texture, uv, moss_layer }) {
  if (moss_layer < 0) return albedo // mossy_stone recipe absent (shouldn't happen) → no overlay
  // [tsc] texture().depth(node) typings reject a plain-number layer; wrap as a float node then int, cast to
  // `*` (the file's standing TSL-typing escape — cf. terrain_material's `.select()` ladders).
  const moss = /** @type {*} */ (texture)(/** @type {*} */ (block_texture), uv).depth(int(float(moss_layer))).rgb
  const coverage = smoothstep(float(MOSS_LO), float(MOSS_HI), moisture).mul(is_stone_top)
  // `*` cast: the three-arg mix overload mis-resolves on the loose node args — the standing TSL escape.
  return /** @type {*} */ (mix)(albedo, moss, coverage)
}

/** Re-export so the material can build the moss UV without re-deriving positionWorld swizzles. The moss
 *  overlay samples the +y top-face planar UV = (worldX, 1−worldZ) — identical to the stone top's own UV. */
export function stone_top_uv() {
  return vec2(positionWorld.x, float(1).sub(positionWorld.z))
}

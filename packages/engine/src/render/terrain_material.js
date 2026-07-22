// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TSL terrain material (§3.6) — decodes the frozen 8-byte quad instance (quad_buffer.js) on the
// GPU and expands it into a unit quad, entirely inside positionNode/colorNode. Extends
// MeshStandardNodeMaterial to keep the full PBR lighting model (§3.6). M0 scope: FLAT colors from
// block_registry.js `map_color` + per-corner vertex AO darkening — NO texture arrays yet
// (texture_baker.js is a stub until M1's real procedural bake, §3.6/§8).
//
// BIT LAYOUT — mirrors src/mesh/quad_buffer.js EXACTLY (frozen contract, do not drift):
//   word A: x:6 y:6 z:6 w:5(-1) h:5(-1) face:3
//   word B (SMOOTH-LIGHTING v2): block_id:12 sun0:3@12 sun1:3@15 sun3LOW:2@18 ao 4×2b@20 sun2:3@28
//           sun3HIGH:1@31 — four per-corner sun values (0-7) replace the old single sun:4 + block_light:4.
//   CROSS OVERLAY (FLORA-CHAOS, face≥6 only): flora carries no AO, so word_b bits 20-22 instead hold the
//           billboard PLANE ORDINAL 0..K-1; the foliage material reads it and forces AO=3. face<6 = AO.
// IMPORTANT: w/h are stored as (value-1) in the wire format — this file adds 1 back after
// masking, exactly like quad_buffer.js's own decode_quad() does on the CPU side.

import { DoubleSide, Vector3 } from 'three'
import {
  Discard,
  Fn,
  If,
  abs,
  attribute,
  cameraPosition,
  float,
  floor,
  instanceIndex,
  int,
  length,
  mix,
  positionWorld,
  smoothstep,
  storage,
  texture,
  transformNormalToView,
  uint,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

import { occlusion_dither_discard, occlusion_fade_node } from '../tactical/board_occlusion.js'

import { ao_fraction_node } from './terrain_ao.js'
// D167-B: the tactical fight-board feathered occlusion — a pure screen-space fade node + a screen-door
// dither discard. Applied per class at the color/alpha output below (rides the output graph so it
// actually compiles — bare build-scope discards are dead code in TSL, the 2026-07-04 far_field lesson).
import {
  FACE_BRIGHTNESS,
  SUN_LEAK_GATE,
  FoliageLightingModel,
  WaterLightingModel,
  SimpleTerrainLightingModel,
} from './terrain_lighting.js'
import { cross_billboard_nodes, LEAF_CROSS_JITTER, LEAF_TILT_MAX, LEAF_WIDTH_MUL } from './terrain_flora.js'
import {
  CANOPY_VARIETY,
  canopy_variety_node,
  foliage_dispersion_node,
  leaf_backlight_node,
  moss_overlay_node,
  stone_top_uv,
} from './terrain_leaf.js'
import { LEAF_BAND_NEAR_M, LEAF_BAND_FAR_M } from './leaf_band.js'
import { macro_tint_nodes, macro_moisture_node, STRAW_TIP } from './terrain_tint.js'
import { coherent_variant_offset_node } from './terrain_texture_variant.js'
import { apply_water_to_material } from './water_material.js'
import { ambient_depth_scale, ambient_tint } from './atmosphere.js'
import {
  cell_hash,
  cross_height_frac_from_registry,
  emission_from_registry,
  flat_color_from_registry,
  layer_index_from_registry,
  resolve_material_atlas,
  rotate_hue,
  variant_count_from_registry,
} from './registry_nodes.js'

const MASK_6 = 0x3f
const MASK_5 = 0x1f
const MASK_3 = 0x7
const MASK_12 = 0xfff
const MASK_2 = 0x3

// [LEAF-VOLUME]: the reference corpus has nice leaves without the lags… something without showing
// rectangles"] Blend factor of the BENT (spherical) foliage normal toward the baked canopy-outward
// gradient (leaf_sprites.js leaf_normal_index → cross-AO bits 23-27) vs the flat sky-lit up normal. 0.8
// = the BotW/GoT-class band (0.7-0.85): enough to shade the crown as one puffy volume (edge-on cards stop
// reading as paper because their lighting now matches the mass), a little up kept so the sprite art detail
// + sky-lit read survive. Zero runtime cost — the normal is baked once at mesh build. CUTOUT sprites +
// [LEAF-SEAM fix] the 'canopy' far cube shell (the mesher bakes the same bucket on its dual-emit quads),
// so the near→far band shades as ONE volume — the cube up-normals no longer catch the full hemisphere
// sky irradiance the sprites escape (the pixel-proven washed/blue far-canopy seam).
const LEAF_NORMAL_BEND = 0.8

// [LEAVES-2X Rung 2 · CANOPY TONE IMPOSTOR — 2026-07-14] The opaque far-canopy CUBE is a stand-in IMPOSTOR
// for the airy animated leaf SPRITES it replaces past the crossfade band: a solid shell can reproduce
// neither the sprites' see-through gaps nor their per-blade base→tip darkening, so at matched framing
// (default biome, tier=medium, load_radius=8, camera 140 m east of the -107,175,0 crown looking west,
// measured INSIDE the 96-128 m fog band) the cube reads BRIGHT / WASHED / BLUER — rgb(80,104,124) over the
// canopy pixel mask — against the sprites' dark saturated rgb(63,83,72). This baked per-channel LINEAR
// multiply on the canopy's final lit colour darkens + de-blues the cube toward the sprite tone it
// impersonates; the blue channel takes the deepest cut (the cube's biggest error is its sky-blue wash).
// Derived by on-screen measurement, 2-point power-calibrated at the band WITH fog in place (residual
// fog-distance confound accepted, prior lane). CANOPY ONLY (variant gate below) — zero effect on the
// sprites themselves or on any solid / cutout / foliage / liquid class. No uniform, no flag: one constant.
const CANOPY_TONE_BIAS = /** @type {[number, number, number]} */ ([0.65, 0.5, 0.32])

// [FIRST-LOAD] radial reveal-front tuning. RISE: metres the un-revealed surface sits below true height
// (eases up as the front sweeps past). GOLD: the ?reveal=scan shimmer line colour (#c8963c, additive). */
const REVEAL_RISE_M = 8
const REVEAL_GOLD = /** @type {[number, number, number]} */ ([0.78, 0.59, 0.235])

// WINDING DERIVATION RECORD (AXIS_FACE_TABLE / WINDING_FLIP_FACES / AO_VMIRROR_REMAP) → terrain_winding.js.

// PER-FACE BRIGHTNESS TABLE + BFS SUN-LEAK GATE live in terrain_lighting.js (2026-07-03 ≤600-LoC split —
// extracted verbatim, no behavior change). RE-EXPORTED here so terrain_material.test.js's import from this
// module is unchanged; build_terrain_material builds its select-ladder / receivedShadowNode gate from them.
export { FACE_BRIGHTNESS, SUN_LEAK_GATE, sun_direct_factor } from './terrain_lighting.js'

// Registry select-ladders + hash/hue helpers live in registry_nodes.js (2026-07-03 ≤600-LoC split —
// extracted verbatim, no behavior change).

/**
 * Creates the NG-MEGA terrain node material for one render class — ONE material per class, built once
 * at boot, never rebuilt (zero per-frame material-graph hashing, so the F8 shadow-pass hash-storm is
 * structurally impossible, and zero per-chunk pipeline compiles). The instance words come from the
 * shared mega pool (quad_pool.js), indexed by the GLOBAL `instanceIndex` = firstInstance + local
 * (spanning every resident chunk's quads), and the chunk world origin is added IN-SHADER from the
 * per-slot meta buffer (the pool mesh sits at identity). `slot_quads` (S, power of two) makes
 * `slot = instanceIndex >> log2(S)` the meta row for this quad's chunk origin. Decode + shading are
 * delegated to `build_terrain_material` (the single source of truth, pixel-guarded by the cube/hole
 * gates). `variant` selects the render class — pool_renderer.js builds one Mesh per class:
 *   • 'solid'   — opaque terrain.
 *   • 'foliage' — cross/flower billboards (faces 6/7): FLORA-CHAOS stamps K per-cell PAIRS (mesher.js
 *                 `cross_pairs`), each a yaw-rotated + per-plane-jittered/scaled crossed X, with
 *                 alphaTest cutting the atlas silhouettes. Every plane in a cell is independently
 *                 randomized off its ordinal — a scattered tangle, never one repeated stamp.
 *   • 'liquid'  — translucent water surface: transparent, depthWrite off. Flat translucent only.
 * @param {object} options
 * @param {import('three/webgpu').StorageBufferAttribute} options.pool_attr the mega quad buffer (uvec2/quad)
 * @param {import('three/webgpu').StorageBufferAttribute} options.meta_attr per-slot [ox,oy,oz,count] (vec4)
 * @param {number} options.slot_quads S — pool slot size (power of two)
 * @param {import('three').DataArrayTexture} options.block_texture painterly atlas (texture_baker.js).
 *   The name→base-layer and name→variant-count maps ride on `block_texture.userData` (set by the
 *   baker's `build_data_array_texture`) so this material resolves the grass face family + per-cell
 *   variants without a renderer plumbing change.
 * @param {Map<number, number>} options.layer_of block id → base atlas layer
 * @param {'solid'|'foliage'|'cutout'|'canopy'|'liquid'} [options.variant] render class (default 'solid')
 * @param {import('../tactical/board_occlusion.js').BoardOcclusionUniforms} [options.board_occlusion]
 *   D167-B: tactical fight-board feathered occlusion (inert until a board is mounted). Optional.
 * @param {boolean} [options.grass_sway] [S-85] tier flora-wind gate (false at LOW = static grass).
 * @param {boolean} [options.simple_shaders] [SHADER DIET] build-time gate — TRUE at LOW builds the MINIMAL
 *   terrain fragment (no leaf backlight / hue variety / climate pick / atlas-variant hashing / macro tint /
 *   moss / specular / shadow receive; flat ambient; sun-leak gate folded into the direct term). Default
 *   false ⇒ the full graph (MEDIUM/HIGH + isolated callers/tests are byte-identical).
 * @param {import('./reveal_front.js').RevealFront} [options.reveal_front] [FIRST-LOAD] radial reveal-front
 *   uniforms (inert until driven); folds to a no-op once the front completes.
 * @param {'dissolve'|'rise'|'scan'} [options.reveal_variant] which reveal effect compiles (default dissolve).
 * @param {{ near: number, far: number }} [options.leaf_band] [Rung 2] tier sprite→cube crossfade window
 *   (metres); omitted ⇒ the MEDIUM default (leaf_band.js). The live pool path threads the tier's own band.
 */
export function create_terrain_material({
  pool_attr,
  meta_attr,
  slot_quads,
  block_texture,
  layer_of,
  variant = 'solid',
  board_occlusion,
  grass_sway = true,
  simple_shaders = false,
  reveal_front,
  reveal_variant = 'dissolve',
  leaf_band,
}) {
  const slot_shift = Math.log2(slot_quads)
  if (!Number.isInteger(slot_shift))
    throw new Error(`create_terrain_material: slot_quads must be a power of two (got ${slot_quads})`)
  // Read-only storage views of the pool + meta buffers (counts derived from the attributes).
  const pool_storage = storage(pool_attr, 'uvec2', pool_attr.count).toReadOnly()
  const meta_storage = storage(meta_attr, 'vec4', meta_attr.count).toReadOnly()
  const slot = instanceIndex.shiftRight(uint(slot_shift))
  return build_terrain_material({
    words: pool_storage.element(instanceIndex),
    chunk_origin: meta_storage.element(slot).xyz,
    block_texture,
    layer_of,
    variant,
    board_occlusion,
    grass_sway,
    simple_shaders,
    reveal_front,
    reveal_variant,
    leaf_band,
  })
}

/**
 * Shared terrain material builder (single source of truth for the decode + shading chain, so the
 * per-chunk and pool paths can never drift — the pixel-exact cube/hole gates guard both). `words` is
 * the per-instance uvec2 (word_a, word_b); `chunk_origin`, when non-null, is a vec3 world-space origin
 * added to the LOCAL decoded position (pool mode) — null means the caller's model matrix supplies it.
 * @param {object} options
 * @param {*} options.words per-instance uvec2 node (quad_storage.element(instanceIndex) or pool.element(...))
 * @param {*} options.chunk_origin vec3 world origin node, or null (model matrix handles world placement)
 * @param {import('three').DataArrayTexture} options.block_texture
 * @param {Map<number, number>} options.layer_of
 * @param {'solid'|'foliage'|'cutout'|'canopy'|'liquid'} options.variant
 * @param {import('../tactical/board_occlusion.js').BoardOcclusionUniforms} [options.board_occlusion]
 *   D167-B: when a fight board is mounted, world geometry between the camera and the arena dissolves
 *   with a soft feather (dither on opaque solid/cutout, alpha on foliage/liquid). Inert until armed.
 * @param {boolean} [options.grass_sway] [S-85] tier flora-wind gate (false at LOW = static grass).
 * @param {boolean} [options.simple_shaders] [SHADER DIET] build-time gate — TRUE at LOW builds the MINIMAL
 *   terrain fragment (see create_terrain_material). Default false ⇒ the full graph (byte-identical).
 * @param {import('./reveal_front.js').RevealFront} [options.reveal_front] [FIRST-LOAD] radial reveal-front
 *   uniforms (never on liquid); folds to a no-op once the front completes.
 * @param {'dissolve'|'rise'|'scan'} [options.reveal_variant] which reveal effect compiles (default dissolve).
 * @param {{ near: number, far: number }} [options.leaf_band] [Rung 2] tier sprite→cube crossfade window
 *   (metres); omitted ⇒ the MEDIUM default (leaf_band.js). The live pool path threads the tier's own band.
 */
function build_terrain_material({
  words,
  chunk_origin,
  block_texture,
  layer_of,
  variant,
  board_occlusion,
  grass_sway = true,
  simple_shaders = false,
  reveal_front,
  reveal_variant = 'dissolve',
  leaf_band,
}) {
  // [MOBILE SHADER DIET] the ONE build-time switch (tiers.low.simple_shaders). At LOW the expensive
  // terrain-fragment sub-graphs below are simply NOT EMITTED (like reveal_variant), not uniform-branched.
  const simple = simple_shaders
  // [LEAVES-2X Rung 2 · tier band] the sprite→cube crossfade window (metres). TIER-DRIVEN: the live pool
  // path threads the tier's own band (leaf_band_for(view_dist) — sprites over the near half of THAT tier's
  // voxel ring); isolated callers/tests fall back to the MEDIUM default so the near-canopy read is stable.
  const band_near = leaf_band?.near ?? LEAF_BAND_NEAR_M
  const band_far = leaf_band?.far ?? LEAF_BAND_FAR_M
  // side = DoubleSide — SETTLED BY MEASUREMENT (DO-NOT list; don't relitigate without new numbers).
  // A correctly-wound FrontSide candidate (v-mirror on terrain_winding.WINDING_FLIP_FACES {1,2,5}) was
  // built + measured head-to-head 2026-07-02 (headed Metal) and LOST on BOTH: HOLES (risers still
  // shredded at steep poses) AND PERF (~2× slower: p75 16.57 vs 8.34 ms — this material is fragment-
  // bound, so drawing both faces fills depth and maximizes early-Z; back-culling leaves depth gaps that
  // raise overdraw). KEEP DoubleSide; FrontSide deleted. Report: /tmp/aresrpg-engine-artifacts/winding_report.json.
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 1, side: DoubleSide })
  // World-space unit sun-DIRECTION uniform, shared by the two lit-foliage classes. FOLIAGE uses it for the
  // per-plane sun-dispersion (round-3 — the flora vertex/fragment dot each plane's yaw normal with it);
  // D164 CUTOUT (leaves) uses it for the sun-through-canopy BACKLIGHT (leaf_backlight_node). Default = the
  // sky's boot-tod sun guess (same as water_material); pool_renderer captures `set_foliage_sun` and engine.js
  // drives it every tod tick + at boot, so both effects track dusk/noon instead of freezing at build time.
  const is_lit_foliage = variant === 'foliage' || variant === 'cutout'
  // [LEAVES-2X Rung 2] the opaque far-canopy 'canopy' class is a LEAF variant too, so it shares the sun
  // uniform (leaf backlight) + the diffuse leaf lighting model + the per-tree hue — but it is OPAQUE, so it
  // must NOT take alphaTest (that would keep a fragment discard → kill its early-Z). Two split concerns:
  //   is_leaf          = cutout | canopy  → leaf albedo treatment (backlight, canopy variety)
  //   uses_foliage_sun = foliage | cutout | canopy → the shared tod sun uniform (dispersion / backlight)
  //   is_lit_foliage   = foliage | cutout → alphaTest (the airy cross/sprite cutouts only)
  const is_leaf = variant === 'cutout' || variant === 'canopy'
  const uses_foliage_sun = is_lit_foliage || variant === 'canopy'
  const foliage_sun = uses_foliage_sun ? uniform(new Vector3(0.3, 0.85, 0.4).normalize()) : null
  if (uses_foliage_sun) {
    // foliage_sun is non-null in this branch (built iff uses_foliage_sun); tsc can't narrow across the ternary.
    material.userData.set_foliage_sun = (/** @type {Vector3} */ sun) => /** @type {*} */ (foliage_sun).value.copy(sun)
  }
  if (is_lit_foliage) {
    // alphaTest cuts the transparent background: the cross-quad billboards (foliage) AND the cutout-leaf
    // holes (cutout — the D164 lacework) both carry per-texel alpha the material clips against. The opaque
    // canopy cubes deliberately skip this (they fill the leaf-texture holes with the flat leaf tone below).
    material.alphaTest = 0.5
  }
  if (variant === 'foliage') {
    // Water samples the opaque depth buffer as its bed. Keep submerged cross-flora out of that buffer so
    // coral/algae silhouettes cannot make the later water pass resolve a false shallow patch above them.
    material.depthWrite = false
  }
  if (variant === 'liquid') {
    material.transparent = true
    // opacity=1: the water shader's `alpha_node` is the SOLE opacity source (shore see-through 0.42 →
    // deep opaque 1.0). three MULTIPLIES material.opacity into that alpha, so a stale 0.82 capped even
    // 47-block-deep ocean at 82% → ~18% of the bright seabed leaked through as bed contours (
    // "I still see the ocean floor too much"; live-diagnosed — the depth tap already saturates opaque).
    material.opacity = 1
    material.depthWrite = false
  }

  // PAINTERLY REPETITION-BREAK + block-family metadata (fixes #3/#4 + grass/log families + D164 moss/stone-
  // top), resolved ONCE at build time by registry_nodes.resolve_material_atlas (≤600-LoC split; pure CPU).
  const {
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
  } = resolve_material_atlas(block_texture, layer_of)

  const corner = attribute('corner', /** @type {'float'} */ ('float'))

  const word_a = uint(words.x).toVar('quad_word_a')
  const word_b = uint(words.y).toVar('quad_word_b')

  const local_x = word_a.bitAnd(uint(MASK_6))
  const local_y = word_a.shiftRight(uint(6)).bitAnd(uint(MASK_6))
  const local_z = word_a.shiftRight(uint(12)).bitAnd(uint(MASK_6))
  const quad_w = word_a.shiftRight(uint(18)).bitAnd(uint(MASK_5)).add(uint(1))
  const quad_h = word_a.shiftRight(uint(23)).bitAnd(uint(MASK_5)).add(uint(1))
  const face = word_a.shiftRight(uint(28)).bitAnd(uint(MASK_3))

  const block_id = int(word_b.bitAnd(uint(MASK_12)))
  // SMOOTH LIGHTING (ENG-10 phase 1): FOUR per-corner sun values (3-bit, 0-7) replace the old single
  // `sun`:4 + always-zero `block_light`:4. Layout (quad_buffer.js word-B v2): s0@12-14, s1@15-17,
  // s3 LOW@18-19, s2@28-30, s3 HIGH@31 (s3 straddles the AO block). Order matches the AO corner order
  // [(0,0),(1,0),(0,1),(1,1)], so the same `corner` index selects a vertex's sun AND its AO; the GPU
  // then bilinear-interpolates the picked corner sun across the quad exactly like AO — the smooth dapple.
  const sun_corners = [
    word_b.shiftRight(uint(12)).bitAnd(uint(MASK_3)),
    word_b.shiftRight(uint(15)).bitAnd(uint(MASK_3)),
    word_b.shiftRight(uint(28)).bitAnd(uint(MASK_3)),
    // s3 straddles the AO block: LOW 2 bits @18-19, HIGH bit @31. The two parts are disjoint (low 0-3,
    // high contributes 0 or 4), so `.add` reconstructs the 0-7 value exactly (== bitwise-or here).
    word_b
      .shiftRight(uint(18))
      .bitAnd(uint(MASK_2))
      .add(word_b.shiftRight(uint(31)).bitAnd(uint(1)).mul(uint(4))),
  ]
  const ao_packed = [
    word_b.shiftRight(uint(20)).bitAnd(uint(MASK_2)),
    word_b.shiftRight(uint(22)).bitAnd(uint(MASK_2)),
    word_b.shiftRight(uint(24)).bitAnd(uint(MASK_2)),
    word_b.shiftRight(uint(26)).bitAnd(uint(MASK_2)),
  ]

  // corner (0-3) → (u, v) in {0,1}, matching CORNER order [(0,0),(1,0),(0,1),(1,1)].
  const corner_u = corner
    .equal(float(1))
    .or(corner.equal(float(3)))
    .select(float(1), float(0))
  const corner_v = corner
    .equal(float(2))
    .or(corner.equal(float(3)))
    .select(float(1), float(0))

  const is_px = face.equal(uint(0))
  const is_nx = face.equal(uint(1))
  const is_py = face.equal(uint(2))
  const is_ny = face.equal(uint(3))
  const is_pz = face.equal(uint(4))
  // face === 5 (-z) is the final fallthrough branch below.
  // Cross-shape foliage: face 6 = billboard plane A, face 7 = its +90° perpendicular — a rigid crossed
  // pair, yaw-rotated + per-plane scattered by terrain_flora.js (FLORA-CHAOS). The AO byte carries the
  // plane ORDINAL, not occlusion (flora is unshaded).
  const is_cross_a = face.equal(uint(6))
  const is_cross_b = face.equal(uint(7))

  // NO PER-FACE WINDING FIX — solids/liquids render DoubleSide, so winding never gates visibility. A
  // correctly-wound FrontSide candidate was measured against DoubleSide (see the `side=` verdict) and
  // lost on both holes and perf → deleted. `corner` maps straight to the mesher's ao0..ao3 order.
  const ao_corner = uint(corner)

  // u_axis/v_axis per face — §3.5 face table: 0=+x 1=-x 2=+y 3=-y 4=+z 5=-z, matching mesher.js's
  // binary_greedy plane convention (axis 0→(u=y,v=z), axis 1→(u=x,v=z), axis 2→(u=x,v=y)). SOLID/LIQUID
  // only: cross faces build their vertex from a rotated h_dir in terrain_flora.js and never read u/v_axis.
  // `normal` below IS shared — cross uses up (0,1,0) so the sprite reads sky-lit (Y-rotation leaves it).
  const u_axis = is_px.or(is_nx).select(vec3(0, 1, 0), vec3(1, 0, 0))
  const v_axis = is_px.or(is_nx).select(vec3(0, 0, 1), is_py.or(is_ny).select(vec3(0, 0, 1), vec3(0, 1, 0)))
  let normal = is_px.select(
    vec3(1, 0, 0),
    is_nx.select(
      vec3(-1, 0, 0),
      is_py.select(
        vec3(0, 1, 0),
        is_ny.select(
          vec3(0, -1, 0),
          // cross/foliage (6,7) read best sky-lit → up normal; face 5 (-z) is the final fallthrough.
          is_pz.select(vec3(0, 0, 1), is_cross_a.or(is_cross_b).select(vec3(0, 1, 0), vec3(0, 0, -1)))
        )
      )
    )
  )

  // [LEAF-VOLUME] BENT (spherical) CANOPY NORMAL — the two LEAF classes. The mesher baked a per-cell
  // OUTWARD gradient bucket (0..26 = {−1,0,1}³) in cross-AO bits 23-27 (sprite pass leaf_sprites.js AND
  // [LEAF-SEAM fix] the dual-emit canopy cube pass — same bucket, same bits); decode it (gx=idx%3−1,
  // gy=⌊idx/3⌋%3−1, gz=⌊idx/9⌋%3−1 — via floor/sub, no mod node) and blend LEAF_NORMAL_BEND toward it
  // from the flat up normal, then renormalize. Top cells → up, sides → sideways, undersides → down, so
  // N·L (and the leaf backlight at line ~850, which reads this same `normal`) shade the whole crown as
  // one puffy VOLUME regardless of card/face orientation — edge-on cards stop reading as paper, and the
  // far cube shell stops reading brighter/bluer than its sprites (up-faces no longer take the full
  // hemisphere sky term the sprites escape). The up term is always present ⇒ the buried/zero bucket
  // (idx=13) and any pure-up cell fall back to up, never a zero-length normal. CUTOUT applies it on its
  // cross faces (6/7 — the sprites); CANOPY on ALL faces (its quads are cube faces 0-5, every one baked).
  // Grass (variant 'foliage') and solids skip this ⇒ their normal graph stays byte-identical. Shallow
  // node graph (~11 deep, well under the naga 127 cliff).
  // [SHADER DIET D2] LOW drops the bent volume normal — leaves shade flat sky-lit up (no per-cell decode).
  if (is_leaf && !simple) {
    const g_idx = float(word_b.shiftRight(uint(23)).bitAnd(uint(MASK_5)))
    const g_a = g_idx.div(float(3)).floor() // ⌊idx/3⌋
    const g_b = g_a.div(float(3)).floor() // ⌊idx/9⌋
    const outward = vec3(
      g_idx.sub(g_a.mul(float(3))).sub(float(1)), // idx%3 − 1
      g_a.sub(g_b.mul(float(3))).sub(float(1)), // ⌊idx/3⌋%3 − 1
      g_b.sub(float(1)) // ⌊idx/9⌋ − 1
    )
    const bent = outward
      .mul(float(LEAF_NORMAL_BEND))
      .add(vec3(0, 1, 0).mul(float(1 - LEAF_NORMAL_BEND)))
      .normalize()
    normal = variant === 'canopy' ? bent : is_cross_a.or(is_cross_b).select(bent, normal)
  }

  // ── SOLID / LIQUID vertex offset — FROZEN (byte-identical result to the pre-FLORA-CHAOS non-cross
  // math; the old u_scale/v_scale/u_shift were exactly 1/1/0 on axis faces). Cross vertices are built
  // ONLY in the foliage block below, so this hot path carries ZERO flora hashing.
  const solid_offset = u_axis.mul(corner_u.mul(float(quad_w))).add(v_axis.mul(corner_v.mul(float(quad_h))))

  // ── POSITIVE-FACE +1 PLANE CORRECTION (root cure for terrace-edge notches / "sky holes") ─────────
  // binary_greedy.js emits every visible face carrying its BLOCK coordinate (cull_faces: face_id =
  // axis*2 + (positive?0:1); faces.push({x,y,z}) at the block coord — binary_greedy.js:105/114/126).
  // For NEGATIVE faces (1=−x 3=−y 5=−z) the face plane IS the block coord, so origin is already right.
  // But POSITIVE faces (0=+x 2=+y 4=+z) physically live on the block's FAR plane = coord+1 — so a top
  // (+y) quad rendered at `local_y` sits 1 m BELOW the real surface, sunk into the terrain, and every
  // +x/+z wall is 1 m too deep. Uniformly sunk surfaces still look solid from straight above, but at
  // every terrace step the correctly-placed riser stands 1 m proud of the sunken top behind it → a
  // 1 m slit at every edge that reads as a sky/fog "hole" (fog on) or a dark interior gap (fog off),
  // and exposes DoubleSide backfaces. Push positive-axis faces +1 along their outward normal to land
  // them on the correct far plane. This is a pure translation ALONG the normal, so winding, the AO
  // corner order, and the world-planar UV (whose axes are the two IN-plane axes, never the normal
  // axis) are all unchanged; the shadow depth pass reuses this positionNode so cast shadows track it.
  // Crosses (6/7) are billboards with their own vertex path (the FLORA-CHAOS foliage block below) and are
  // deliberately excluded — is_px/is_py/is_pz are all false for them, so positive_push is zero.
  const positive_push = is_px.select(
    vec3(1, 0, 0),
    is_py.select(vec3(0, 1, 0), is_pz.select(vec3(0, 0, 1), vec3(0, 0, 0)))
  )

  // SOLID / LIQUID vertex (frozen). The rotated cross vertex is built ONLY for the foliage material.
  const solid_local = vec3(float(local_x), float(local_y), float(local_z)).add(solid_offset).add(positive_push)

  // ── [LEAVES-2X Rung 2] NEAR→FAR CANOPY BAND — per-QUAD collapse factors. A leaf cell lives in the mesh
  // twice: airy SPRITES (cutout) for near, an opaque CUBE shell (canopy) for far. Each collapses to a
  // DEGENERATE quad (all corners → the shared voxel anchor ⇒ zero fragments — no fragment discard, so the
  // opaque cube keeps early-Z) outside its range, crossfading across the band. Distance is per-QUAD from
  // the anchor (all 4 corners share local_x/y/z ⇒ one keep ⇒ they fold to one point at keep 0), matching
  // how terrain_flora computes its own far-collapse. leaf_band.js is the JS-tested single source.
  const leaf_anchor = is_leaf ? vec3(float(local_x), float(local_y), float(local_z)) : null
  let leaf_keep_cube = /** @type {*} */ (null) // 0 near → 1 far (opaque cubes appear far)
  let leaf_keep_sprite = /** @type {*} */ (null) // 1 near → 0 far (sprites fade out far)
  if (is_leaf) {
    const anchor_world = chunk_origin ? /** @type {*} */ (leaf_anchor).add(chunk_origin) : leaf_anchor
    const band_s = smoothstep(
      float(band_near),
      float(band_far),
      length(/** @type {*} */ (anchor_world).sub(cameraPosition))
    )
    leaf_keep_cube = band_s
    leaf_keep_sprite = band_s.oneMinus()
  }

  // ── FLORA-CHAOS billboard vertex — foliage material (all faces 6/7) AND D164 CUTOUT leaf SPRITES (the
  // cutout material's faces 6/7). Built by terrain_flora.js; solid/liquid keep the frozen `solid_local`
  // (position/AO/light byte-untouched). The helper also returns the ordinal-folded PLANE CELL keying the
  // per-plane fragment variant/hue. CANOPY (Rung 2) is the opaque leaf CUBE shell — pure solid_local, no
  // billboard — collapsed to degenerate when NEAR so the near canopy is the airy sprites instead.
  let local_position = /** @type {*} */ (solid_local)
  let plane_cell = /** @type {*} */ (vec2(float(local_x), float(local_z)))
  if (variant === 'foliage' || variant === 'cutout') {
    // Fractional cross_height: the wire quad_h is the ceil ENVELOPE; height_frac (block_id ladder, 1.0 for
    // integer heights + leaf fins) scales the true height so a 1.4-block grass_tuft renders waist-high.
    const height_frac = cross_height_frac_from_registry(block_id)
    // [D164/D164-B — vary in scale / grow + rotate ALL leaves] cutout leaf clusters get a wider
    // per-plane scale band + a fatter billboard + a random pitch tilt; grass keeps its frozen tuning.
    const cut = variant === 'cutout'
    const flora = cross_billboard_nodes({
      word_b,
      local_x,
      local_y,
      local_z,
      corner_u,
      corner_v,
      quad_h,
      height_frac,
      is_cross_a,
      chunk_origin,
      // [D182 — repeated "not variant enough in height, rotation, scale" feedback] the grass carpet gets
      // BIMODAL height, a light lean (±0.14 rad — alive, not tumbling), and a wider width band.
      // [SHADER DIET D2/D3] LOW collapses every flora plane to the CHEAP path: no bimodal-height pow, no
      // per-plane tilt (skips the Rodrigues axis-angle rot, built twice), no crossing-angle jitter, no
      // width/scale spread. The far-collapse + billboard silhouette survive; only the per-plane variety
      // vertex ALU is gone (terrain_flora build-time-gates tilt/jitter on !==0, so this stops emitting them).
      grass_variance: simple ? false : !cut,
      scale_spread: simple ? 1 : cut ? 1.7 : 1.75,
      tilt: simple ? 0 : cut ? LEAF_TILT_MAX : 0.14,
      width_mul: simple ? 1 : cut ? LEAF_WIDTH_MUL : 1,
      // [S-85] tier grass-sway gate — false at LOW freezes the wind wave ("no grass moving").
      sway_enabled: grass_sway,
      // [round-2 — crossed-planes symptom] leaf pairs cross at 90°±34° with per-face independent tilt —
      // the rigid X-construction dissolves. Grass passes 0 (its vertex graph stays byte-identical).
      cross_angle_jitter: simple ? 0 : cut ? LEAF_CROSS_JITTER : 0,
    })
    ;({ plane_cell } = flora)
    // [LEAVES-2X Rung 2] cutout SPRITES collapse to degenerate FAR (the canopy cubes take over there);
    // grass foliage never band-collapses (leaf_keep_sprite is null for it → full billboard always).
    const sprite_pos = cut ? mix(/** @type {*} */ (leaf_anchor), flora.position, leaf_keep_sprite) : flora.position
    // Foliage is ALL billboards; cutout is sprite-only (leaf cube faces route to the 'canopy' pool now).
    local_position = cut ? is_cross_a.or(is_cross_b).select(sprite_pos, solid_local) : sprite_pos
  } else if (variant === 'canopy') {
    // opaque leaf CUBE faces (0-5) collapse to degenerate NEAR (< band) so the near canopy stays sprites.
    local_position = mix(/** @type {*} */ (leaf_anchor), solid_local, leaf_keep_cube)
  }

  // ── [FIRST-LOAD] RADIAL REVEAL FRONT ─────────────────────────────────────────────────────────────
  // Terrain beyond an expanding front (reveal_front: one global centre+radius uniform) is hidden so the
  // world "weaves in" as chunks stream. NEVER on liquid (water keeps its own path). ONE variant compiles
  // (?reveal=): 'rise' offsets the vertex Y; 'dissolve'/'scan' discard the fragment (computed below). reveal
  // ∈ [0,1] = 1 inside the front, 0 beyond (~band-m smoothstep). Radius defaults to SENTINEL ⇒ inert until
  // engine.js drives it, and folds back to a no-op (reveal≈1 everywhere) once the front completes.
  const reveal_on = !!reveal_front && variant !== 'liquid'
  if (reveal_on && reveal_variant === 'rise') {
    // RISE (vertex): a positionWorld read here would cycle through positionNode, so derive world-xz from the
    // decoded local position. Beyond the front the surface sits REVEAL_RISE_M low and eases up as it passes.
    const world_xz = (chunk_origin ? local_position.add(chunk_origin) : local_position).xz
    const dv = length(world_xz.sub(reveal_front.center))
    const reveal_v = smoothstep(reveal_front.radius.sub(reveal_front.band), reveal_front.radius, dv).oneMinus()
    local_position = /** @type {*} */ (
      local_position.add(vec3(float(0), reveal_v.oneMinus().mul(float(REVEAL_RISE_M)).negate(), float(0)))
    )
  }

  // Pool mode adds the chunk world origin IN-SHADER (the pool mesh is at identity); per-chunk mode
  // passes chunk_origin=null and lets the InstancedMesh model matrix place the chunk (unchanged).
  material.positionNode = chunk_origin ? local_position.add(chunk_origin) : local_position

  // Fragment-stage reveal distance/factor for the dissolve/scan discard (positionWorld is per-fragment).
  const reveal_frag_on = reveal_on && reveal_variant !== 'rise'
  const reveal_df = reveal_frag_on ? length(positionWorld.xz.sub(reveal_front.center)) : null
  const reveal_frag = reveal_frag_on
    ? smoothstep(
        reveal_front.radius.sub(reveal_front.band),
        reveal_front.radius,
        /** @type {*} */ (reveal_df)
      ).oneMinus()
    : null
  // VIEW-SPACE NORMAL (defect A — camera-dependent lighting + black seams): NodeMaterial.setupNormal
  // consumes `normalNode` RAW as a VIEW-space normal, but the per-face table above is OBJECT-space.
  // Feeding object-space normals makes N·L slide with camera pitch (faces brighten/darken as you
  // orbit, seams go black). transformNormalToView applies the normal matrix so lighting is stable.
  material.normalNode = transformNormalToView(normal)

  // AO corner pick. FLORA-CHAOS overloads the cross AO byte with the plane ORDINAL (quad_buffer.js), so
  // flora has NO occlusion: the foliage material forces AO = 3 (→ v_ao = 1.0, unshaded sprite). Solid/liquid
  // keep the exact per-corner ladder. D164 CUTOUT is a MIX: leaf CUBE faces (0-5) decode real AO, leaf FIN
  // faces (6/7) carry the ordinal not AO → force 3 there (per-face select on is_cross_a/b). [LEAF-SEAM fix]
  // CANOPY forces 3 UNCONDITIONALLY (even at LOW): the mesher repurposed its AO byte for the bent-normal
  // bucket (tier-independent bake), and the AO-less read matches the sprites the cube impersonates anyway.
  const ao_ladder = /** @type {*} */ (
    ao_corner
      .equal(uint(0))
      .select(
        float(ao_packed[0]),
        ao_corner
          .equal(uint(1))
          .select(float(ao_packed[1]), ao_corner.equal(uint(2)).select(float(ao_packed[2]), float(ao_packed[3])))
      )
  )
  const ao_value =
    variant === 'foliage' || variant === 'canopy'
      ? /** @type {*} */ (float(3))
      : variant === 'cutout'
        ? is_cross_a.or(is_cross_b).select(float(3), ao_ladder)
        : ao_ladder

  // AO/light/emission are per-vertex/per-instance and carried to the fragment stage via varying().
  // The albedo, by contrast, is sampled PER-FRAGMENT below (the atlas UV varies across each face), so
  // only the fragment INPUTS are prepared here — the texture read itself lives in the color expr.
  // AO FLOOR: the AO_LEVELS fraction is remapped [0,1]→[AO_FLOOR,1] so even the darkest level reads as
  // deep shade, not a PURE-BLACK hole (tree-trunk sides, deep inner corners; real contact shadows come
  // from the sun shadow map). PER-FACE AO FLOOR (W11 T5 — terrace-riser readability). Vertical faces
  // (±x/±z terrace risers) stack occlusion from the step above AND their own greedy inner corners, so a
  // uniform 0.45 floor crushed them near-black under low sun ("risers read as black stripes").
  // Tops (±y, faces 2/3) keep 0.45 (they catch skylight); sides + crosses get a higher 0.58 floor so
  // risers stay legible painterly shade. Crosses carry flat ao=3 (→1.0), so the floor is inert there.
  const AO_FLOOR_TOP = float(0.45)
  const AO_FLOOR_SIDE = float(0.58)
  const is_top_ao_face = face.equal(uint(2)).or(face.equal(uint(3)))
  const ao_floor = is_top_ao_face.select(AO_FLOOR_TOP, AO_FLOOR_SIDE)
  // AO fraction via the flattened AO_LEVELS curve (terrain_ao.js, terrace-stripe cure), floored into [ao_floor,1].
  const v_ao = varying(ao_floor.add(float(1).sub(ao_floor).mul(ao_fraction_node(ao_value))))
  // SMOOTH LIGHTING: pick THIS vertex's corner sun with the same corner index that drove ao_value,
  // then map 0-7 → [0,1] (÷7: open sky 7→1.0, brightness-identical to the old sun=15→1.0). varying()
  // makes the GPU bilinear-interpolate it across the quad → the per-cell light patch dissolves into a
  // smooth gradient. block_light is retired (light_engine never emitted it) — a constant 0 the shading
  // chain below folds away (light_level == v_sun, lit_tint == white, warm-tint inert).
  const sun_value = ao_corner
    .equal(uint(0))
    .select(
      float(sun_corners[0]),
      ao_corner
        .equal(uint(1))
        .select(float(sun_corners[1]), ao_corner.equal(uint(2)).select(float(sun_corners[2]), float(sun_corners[3])))
    )
  const v_sun = varying(sun_value.div(float(7)))
  // block_light is RETIRED (light_engine never emitted it — see quad_buffer.js v2). It is a compile-time
  // 0, NOT a varying: keeping it as `varying(float(0))` burned a scarce vertex-output slot (the material
  // sits at the WebGPU 16-location ceiling) for zero information. Inlined as `float(0)` below so the
  // graph folds it away — light_level collapses to v_sun, warm block-light tint to neutral white.
  const v_block_light = float(0)
  const v_emission = varying(emission_from_registry(block_id))
  // Per-instance fragment inputs: the flat-color fallback (blocks with no baked layer), the atlas
  // layer index (−1 ⇒ no layer ⇒ use the fallback), the face id (picks the planar UV family), and
  // the raw quad corner coords (the cross-billboard UV, which is NOT world-planar).
  const v_flat_color = varying(flat_color_from_registry(block_id))
  const v_layer = varying(layer_index_from_registry(block_id, layer_of))
  // Registry ladders computed ONCE (not re-emitted per use). is_grass drives the face family (fix #4);
  // the generic variant count drives the per-cell layer offset (fix #3) for non-grass blocks.
  const is_grass_node = block_id.equal(int(grass_id))
  const variant_count_node = variant_count_from_registry(block_id, variants_by_id)
  const v_variant_count = varying(variant_count_node)
  const v_face = varying(float(face))
  // Cross plants are ONE block, but their billboard's positionWorld sweeps the whole cell (incl. up the
  // blade in Y), so a fragment-side floor(planar_uv) would change the variant UP the plant AND key on X+Y
  // (two plants at the same X, different Z → identical). Carry the plant's ROOTED integer cell as a flat-
  // ish varying so the fragment stage keys variant/jitter/species on ONE stable (x,z) per plant. FLORA-
  // CHAOS uses the ORDINAL-FOLDED plane cell, so each of the K stamps picks its OWN variant/species/hue
  // (the two faces of a pair share the ordinal ⇒ a single plant stays one sprite).
  const v_cross_cell = varying(plane_cell)
  const v_corner_u = varying(corner_u)
  const v_corner_v = varying(corner_v)
  const v_is_grass = varying(is_grass_node.select(float(1), float(0)))
  // ORGANIC flag drives the painterly value/hue jitter (fix #3): only earthy/leafy layers jitter —
  // stone/water/glow stay put. Organic iff >1 baked variant (grass/dirt/sand/grass_side/leaves do;
  // stone/water/log don't) OR the grass block (its grass_side/dirt faces are organic).
  const v_is_organic = varying(is_grass_node.or(variant_count_node.greaterThan(float(1))).select(float(1), float(0)))

  // WORLD-PLANAR UV (fragment stage). positionWorld reflects the custom positionNode above —
  // NodeMaterial.setupPosition assigns positionNode→positionLocal and positionWorld =
  // modelWorldMatrix·positionLocal — interpolated per-fragment. Face families (§3.5 face table):
  //   +y/−y (2,3) → (x,z) | ±x (0,1) → (z,y) | ±z (4,5) → (x,y).
  // fix #2: NO fract() on planar UV — the atlas is hardware Repeat-wrapped (texture_baker.js sets
  // wrapS/wrapT = RepeatWrapping → GPUAddressMode.Repeat), so the GPU sampler wraps with CONTINUOUS
  // mip derivatives across the tile edge. fract()'s 1→0 sawtooth created a huge derivative there →
  // the coarse-mip BRIGHT FRINGE that read as "seam sparkle". Cross billboards (6,7) are diagonal,
  // carry 0..1 corner UVs directly (no wrap — fract there wrapped the far edge to 0).
  const is_top_face = v_face.equal(float(2)).or(v_face.equal(float(3)))
  const is_x_face = v_face.equal(float(0)).or(v_face.equal(float(1)))
  const is_cross_face = v_face.greaterThanEqual(float(6))
  const planar_uv = is_top_face.select(
    vec2(positionWorld.x, positionWorld.z),
    is_x_face.select(vec2(positionWorld.z, positionWorld.y), vec2(positionWorld.x, positionWorld.y))
  )
  // The baker authors each layer top-row-first but a DataArrayTexture samples v=0 at its first row —
  // flip v so painted tops point up. Under Repeat, (1−v) wraps identically to (1−fract v), so raw
  // world coords sample the same texel a per-tile fract would, minus the derivative discontinuity.
  const uv_planar = vec2(planar_uv.x, float(1).sub(planar_uv.y))
  const uv = is_cross_face.select(vec2(v_corner_u, float(1).sub(v_corner_v)), uv_planar)

  // PER-CELL VARIANT + JITTER (fix #3). The tile cell = floor(planar_uv) — integer per 1m tile, so it
  // varies across a greedy-merged quad (per-BLOCK variation, not per-quad). Two independent hashes:
  // one selects the atlas variant layer, the other drives the painterly value/hue jitter.
  const cell = floor(planar_uv)
  // LOG SIDE faces (wood, non-top, non-cross): key the variant/jitter cell on the world (x,z) COLUMN so
  // a trunk shares one bark variant top-to-bottom (continuous bark) while neighbouring columns differ.
  // CROSS faces: key on the plant's ROOTED (x,z) cell (v_cross_cell) — ONE variant per plant, unique per
  // (x,z). Every other block/face keeps floor(planar_uv). Surgical: only the two hash inputs change here.
  const is_log_side = block_id.equal(int(log_id)).and(is_top_face.not()).and(is_cross_face.not())
  // [2026-07-03 tsc] VaryingNode lacks swizzle typings; runtime proxy supports .x/.y (TSL).
  const cross_cell = /** @type {any} */ (v_cross_cell)
  const vcell_x = is_cross_face.select(cross_cell.x, is_log_side.select(floor(positionWorld.x), cell.x))
  const vcell_y = is_cross_face.select(cross_cell.y, is_log_side.select(floor(positionWorld.z), cell.y))
  const h_variant = cell_hash(vcell_x, vcell_y, 1)
  const h_jitter = cell_hash(vcell_x, vcell_y, 2)

  // Base layer + variant count per fragment. GRASS block (fix #4): side faces → grass_side, top →
  // grass, bottom → dirt; each with its own baked variant count. Non-grass → the generic ladders.
  const is_bottom_face = v_face.equal(float(3))
  const grass_face_base = is_top_face.select(
    is_bottom_face.select(float(dirt_base), float(grass_base)),
    float(side_base)
  )
  const grass_face_vn = is_top_face.select(is_bottom_face.select(float(dirt_vn), float(grass_vn)), float(side_vn))
  const is_grass = v_is_grass.equal(float(1))
  // Cast to `*`: `.select()` returns the general Node<"float">, whose TS surface drops the fluent math
  // extensions (`.add`/`.mul`/`.sub`/`.greaterThanEqual`…) — the same standing TSL-typing escape as
  // `flat_color_from_registry`/`face_brightness` above. Both are consumed below via `.add()`/`.sub()`/
  // `.greaterThanEqual()` (this file) and by the coherent grass-top offset (terrain_texture_variant.js).
  const base_layer = /** @type {*} */ (is_grass.select(grass_face_base, v_layer))
  const variant_count = /** @type {*} */ (is_grass.select(grass_face_vn, v_variant_count))
  // CROSS CLIMATE-BIASED VARIANT PICK ("yellow tips… unless very humid"). Grass variants are
  // baked green→dry across the variant index (op_blades dryness ramp); the low half is green, the top half
  // straw. Bias the per-plant hash toward the DRY (high) variants on arid cells, GREEN on humid ones.
  // ROUND-3 FIX (dry zones read as "saturated into ALL-straw = uniform pale forest"): make the dry bias shift a
  // RATIO, NEVER saturate. With h_biased = 0.5·h + 0.5·push, the STRAW FRACTION (h_biased ≥ 0.5) equals
  // `push` exactly (h uniform), so push IS the straw share: it ramps clamp(BASE humid → BASE+SPAN arid),
  // capped at CAP, i.e. a dry meadow is ~60% straw / 40% GREEN interleaved (never 100%), a humid one stays
  // ~85% deep green. Half the weight stays on the raw hash so neighbours still vary within a zone (not a
  // hard band). Non-cross: unbiased. STRAW_TIP (terrain_tint.js) is the single source — its tested pure
  // mirror `straw_tip_ratio` pins this exact ramp so the shader and the law can't drift.
  // [SHADER DIET D3] LOW collapses the whole per-block atlas-variant chain — generic hash offset, the
  // climate straw-tip bias, AND the grass-top coherent PATCH+rotation pick — to a SINGLE base-layer
  // sample (textures are already 32 px at LOW, so per-block variety barely reads); AO is untouched. This
  // is one of the biggest solid/canopy fragment cuts. MEDIUM/HIGH build the full chain below (unchanged).
  let final_layer = /** @type {*} */ (base_layer)
  let moisture_here = /** @type {*} */ (null)
  if (!simple) {
    moisture_here = macro_moisture_node(positionWorld.x, positionWorld.z)
    const dry_target = float(1).sub(moisture_here) // arid → ~1, humid → ~0
    const straw_push = float(STRAW_TIP.BASE)
      .add(dry_target.mul(float(STRAW_TIP.SPAN)))
      .clamp(float(0), float(STRAW_TIP.CAP))
    const h_variant_biased = is_cross_face.select(h_variant.mul(float(0.5)).add(straw_push.mul(float(0.5))), h_variant)
    // variant_offset = floor(h·count), clamped to count−1 (h can be exactly ~1). final layer = base+offset.
    const variant_offset = h_variant_biased
      .mul(variant_count)
      .floor()
      .min(variant_count.sub(float(1)))
      .max(float(0))
    // GRASS-TOP SPATIALLY-COHERENT VARIANT (fixes "lack of connected textures… ground gradients
    // instead of repeating the same block"). The generic per-block hash above (h_variant) picks a fresh
    // atlas variant on EVERY block — decorrelated confetti, not "connected ground". The grass TOP face only
    // (not sides, not the dirt bottom) swaps to a low-freq world-XZ PATCH pick (terrain_texture_variant.js —
    // same "coarse bucket hash" technique as terrain_leaf.js's CANOPY_VARIETY) plus an independent per-block
    // ROTATION (the baked `rotations` texture_recipes.js's grass recipe now carries), so blocks WITHIN one
    // patch still decorrelate at the tile level. Every other block/face (dirt, stone, sand, grass_side,
    // log, leaves…) is completely untouched — is_grass_top gates the swap; the mechanism itself is generic
    // (dirt/sand/snow can adopt it later) but only grass wires it up today.
    const is_grass_top = is_grass.and(is_top_face).and(is_bottom_face.not())
    const grass_phase_count = grass_vn / grass_rot
    const grass_coherent_offset = coherent_variant_offset_node({
      world_x: positionWorld.x,
      world_z: positionWorld.z,
      block_cell_x: cell.x,
      block_cell_z: cell.y,
      phase_count: grass_phase_count,
      rotation_count: grass_rot,
    })
    const final_variant_offset = is_grass_top.select(grass_coherent_offset, variant_offset)
    final_layer = base_layer.add(final_variant_offset)
  }

  // Sample the painterly atlas. Blocks without a layer (base < 0, e.g. snow/glowstone) fall back to
  // the flat map_color; max(0) keeps the array sampler in-bounds on that fallback branch.
  const sampled = texture(block_texture, uv).depth(int(final_layer.max(float(0))))
  const has_layer = base_layer.greaterThanEqual(float(0))
  let albedo = has_layer.select(sampled.rgb, v_flat_color)
  // [LEAVES-2X Rung 2] the OPAQUE canopy cube fills the leaf texture's alpha HOLES (baker leaves them alpha
  // 0) with the flat leaf tone (map_color) so it reads as a DENSE leaf mass — Minecraft "fast leaves", the
  // early-Z far representation. Its near counterpart (cutout sprites) keeps the holes see-through (airy).
  if (variant === 'canopy')
    albedo = /** @type {*} */ (
      has_layer.select(mix(/** @type {*} */ (v_flat_color), sampled.rgb, sampled.a), v_flat_color)
    )

  // Painterly per-cell jitter on ORGANIC layers only (fix #3). SOLIDS keep the frozen ±5% value / ±4°
  // hue (the ≤15% painterly grain bound). CROSS faces (meadow-ref pass: "bright sunlit tips, dark
  // green-shadow bases… our blades are uniform pale sage") swing ±28% value + ±8° hue PER PLANE —
  // h_jitter/h_variant already hash the ordinal-folded plane cell on crosses, so one cell's K planes span
  // dark-shadow → sunlit. Flowers (variant_count 1 ⇒ not organic) skip it: clean bright heads.
  const is_organic = v_is_organic.equal(float(1))
  // [SHADER DIET D2] LOW drops the painterly per-cell value/hue jitter — organic layers keep the flat sample.
  if (!simple) {
    const value_amp = is_cross_face.select(float(0.28), float(0.05))
    const hue_amp = is_cross_face.select(float(0.14), float(0.0698)) // radians: ±8° cross / ±4° solid
    const value_jitter = h_jitter.mul(value_amp).mul(float(2)).sub(value_amp)
    const hue_jitter = h_variant.mul(hue_amp).mul(float(2)).sub(hue_amp)
    const jittered = rotate_hue(albedo, hue_jitter).mul(float(1).add(value_jitter))
    albedo = is_organic.select(jittered, albedo)
  }
  // BLADE VERTICAL GRADIENT (ref depth cue): corner_v 0(base)→1(top) shades every cross plane dark base
  // → bright tip, so bases merge with the turf shadow and flower heads pop. All crosses; solids untouched.
  // (Kept at LOW — one mix+select, negligible bytes, and it stops grass/leaf cards reading as flat paper.)
  const blade_grad = mix(float(0.55), float(1.12), v_corner_v)
  albedo = is_cross_face.select(albedo.mul(blade_grad), albedo)
  // ── [D164-B GREEN VARIETY] per-TREE canopy hue (cutout) / per-PATCH grass hue (foliage) so neighbouring
  // trees + grass patches read as DISTINCT individuals; composes WITH the per-plane jitter above (a coherent
  // world-hash bucket at tree/patch scale — terrain_leaf.js). Cross LEAVES/GRASS only (flowers, not organic, skip).
  // [SHADER DIET D2] LOW drops the per-tree/per-patch hue+value variety (uniform species hue).
  if (!simple && (variant === 'cutout' || variant === 'foliage')) {
    const varied = canopy_variety_node({
      albedo,
      position_world: positionWorld,
      scale: variant === 'cutout' ? CANOPY_VARIETY.TREE_SCALE : CANOPY_VARIETY.PATCH_SCALE,
      tuft_cell: variant === 'foliage' ? cross_cell : null,
    }) // [D182] per-TUFT hue layer for grass
    albedo = /** @type {*} */ (is_cross_face.and(is_organic).select(varied, albedo))
  } else if (!simple && variant === 'canopy') {
    // [LEAVES-2X Rung 2] the opaque canopy cube is ALL leaf (every fragment) → apply the SAME per-TREE hue
    // as its cutout sprites UNCONDITIONALLY (no is_cross_face gate — canopy carries no cross faces), so a
    // tree's cube shell and sprite lacework share one hue and the near→far band stays colour-continuous.
    albedo = /** @type {*} */ (
      canopy_variety_node({ albedo, position_world: positionWorld, scale: CANOPY_VARIETY.TREE_SCALE, tuft_cell: null })
    )
  }
  // ── PER-PLANE SUN DISPERSION (round-3) — foliage_dispersion_node (terrain_leaf.js) recomputes this
  // plane's yaw off the ordinal-folded plane cell and spreads brightness per plane so a sunward grass field
  // SPARKLES instead of flashing as one sheet. FOLIAGE ONLY (foliage_sun null elsewhere; is_cross_face gates).
  // [SHADER DIET D3] LOW drops the per-plane sun-dispersion (grass catches sun as one flat sheet — fine at LOW).
  if (!simple && variant === 'foliage') {
    const disp = foliage_dispersion_node({ cross_cell, v_face, foliage_sun: /** @type {*} */ (foliage_sun) })
    albedo = is_cross_face.select(albedo.mul(disp), albedo)
  }

  // ── NG-TINT (ENG-1) — world-space MACRO ground-shade + PBR roughness (terrain_tint.js) ────────────
  // A low-frequency, world-XZ CONTINUOUS climate tint layered OVER the per-cell micro grain above so
  // the 1 m tiles dissolve into Veloren-style dry/lush/humid patches, plus a per-family PBR roughness
  // field (sand specular sheen, grass humid "dew" dip) from the SAME two octaves — zero extra noise
  // fetches. positionWorld reflects the custom positionNode (with positive_push), so a +x/+z rim
  // samples the identical XZ as its top edge → continuous across faces AND chunk borders (no chunk
  // term). Liquid returns identity albedo + null roughness (skipped). block_id/positionWorld are the
  // SAME nodes the shading chain above already uses; the frozen face/AO/light math is untouched.
  // [SHADER DIET D3/D4] LOW drops the world-space macro climate tint AND the per-family PBR roughness
  // field (both fed by the 2-octave noise) — the LOW tier is meant to be flat, and with the diffuse-only
  // simple lighting model (no specular) roughness has no consumer anyway. MEDIUM/HIGH build it (unchanged).
  let roughness_node = /** @type {*} */ (null)
  if (!simple) {
    const tint = macro_tint_nodes({ block_id, position_world: positionWorld, variant })
    albedo = tint.tint_albedo(albedo)
    ;({ roughness_node } = tint)
  }

  const light_level = v_sun.max(v_block_light)
  // Warm-tint block light vs. neutral sun light (§3.6 "block light warm-tinted"), then darken by
  // vertex AO. Ambient floor keeps unlit faces from crushing to pure black at M0 (no real GI yet).
  const warm_tint = vec3(1.0, 0.85, 0.65)
  const tint_amount = v_block_light.min(float(1))
  const lit_tint = mix(vec3(1, 1, 1), warm_tint, tint_amount)
  // VOXEL-LIGHT FLOOR (achromatic). `brightness` modulates the DIFFUSE ALBEDO fed to the PBR model,
  // so the final pixel is direct_sun·shadow·max(N·L,0)·[albedo·brightness·ao·face] +
  // hemisphere_indirect(N)·[albedo·brightness·ao·face] + EMISSIVE. This floor is a SCALAR (no chroma),
  // and only bites where the voxel `sun`/`block_light` byte is low (caves/overhangs) — open terrain
  // has sun=15 ⇒ brightness=1, so directional form there comes from the sun + the per-face table below.
  // NG2-ATMO §K ambient depth: the floor is scaled by the BFS-sun nibble (`ambient_depth_scale`,
  // atmosphere.js — interior 0.62× so crevices recede; v_sun=1 open terrain byte-identical; torch
  // light rides light_level's lane untouched — a LIT interior still reads lit).
  const AMBIENT_FLOOR = float(0.35)
  const ambient_floor_scaled = AMBIENT_FLOOR.mul(ambient_depth_scale(v_sun))
  const light_scalar = light_level.mul(float(1).sub(AMBIENT_FLOOR))
  const brightness = light_scalar.add(ambient_floor_scaled)

  // ── PER-FACE BRIGHTNESS TABLE (Minecraft-style directional face shading) ─────────────────────────
  // ROOT CURE for the "sun-shaded riser reads as sky/fog" disease, chosen over the albedo×hemisphere-
  // luminance emissive floor that preceded it (that one washed every side face pale — measured on
  // ambient_fix_alpine.png). A FIXED scalar per face DIRECTION (FACE_BRIGHTNESS), multiplied into the
  // albedo, so each face's chroma is 100% the block's own earth texture and NEVER the atmosphere: a
  // sun-occluded −z riser can't track the sky at ANY palette. This is the canonical voxel-engine model
  // — a per-face table combined MULTIPLICATIVELY with per-corner AO (v_ao) + per-voxel light
  // (brightness) — famously robust against exactly this defect (Minecraft `getShade`; see the
  // FACE_BRIGHTNESS doc + terrain_material.test.js for the values/refs). tops=1.0 keep the grass TOPS
  // byte-identical AND let cast shadows land at full contrast; sides darken BELOW fog luminance so
  // they read as solid earth, not a sky notch. Ladder built from the exported map (single source of
  // truth); crosses (face 6/7) are absent from the map → fall through to 1.0 (billboards fully lit).
  // Untyped for the same reason as the other TSL select-ladders (see flat_color_from_registry) —
  // `.select()` returns the general Node<"float">, which the concrete first-assignment type rejects.
  let face_brightness = /** @type {*} */ (float(1.0))
  for (const [id, mult] of Object.entries(FACE_BRIGHTNESS)) {
    face_brightness = v_face.equal(float(Number(id))).select(float(mult), face_brightness)
  }

  // LIQUID: real water shading (NG2-C) — all logic in water_material.js; bypasses the earth chain.
  if (variant === 'liquid') {
    // [SHADER DIET D5] `simple` builds the FLAT near-water (single tint + fresnel + depth alpha, no
    // caustics/foam/refraction/glint/detail) so near-water matches the flat far-shell water at LOW.
    apply_water_to_material(material, { face_node: float(face), brightness, emission_node: v_emission, simple })
    // D167-B: fade water that stands between the camera and a mounted board through its OPACITY (three
    // multiplies opacityNode into the surface alpha). fade=1 when no board is armed ⇒ zero change.
    if (board_occlusion) material.opacityNode = occlusion_fade_node(board_occlusion)
    // ZERO STOCK LIGHTING (2026-07-05 — the "sun mirror" root cause): the stock PhysicalLightingModel
    // ran the sun's GGX specular on the roughness-0.06 water REGARDLESS of our nodes (specular needs no
    // albedo) ⇒ the huge smooth spotlight ellipse at the sun's mirror point, immune to every water-
    // shader edit and every bloom cap. The custom emissive composite owns the water's entire look incl.
    // its own sun model (the glint road). Rationale on WaterLightingModel in terrain_lighting.js.
    material.setupLightingModel = () => new WaterLightingModel()
    return material
  }

  // ── D164 MOISTURE-DRIVEN MOSS OVERLAY — SOLID only, stone-family TOP faces. Where the
  // shared moisture field is high, the stone TOP blends toward the mossy_stone recipe (terrain_leaf.js) —
  // bare rock → mossy rim → full moss cap, continuous. Same `moisture_here` sampler the straw bias already
  // reads (zero extra fetches). Gated to +y faces of stone/cave_stone so a humid plateau greens on top while
  // its risers stay bare rock. Sourced from the D159 moss green (one home), no gen/block change, no world fork.
  if (!simple && variant === 'solid' && moss_layer >= 0 && stone_top_ids.length > 0) {
    let is_stone_block = /** @type {*} */ (float(0))
    for (const id of stone_top_ids)
      is_stone_block = block_id.equal(int(/** @type {number} */ (id))).select(float(1), is_stone_block)
    const is_stone_top = is_stone_block.mul(is_top_face.select(float(1), float(0)))
    albedo = moss_overlay_node({
      albedo,
      moisture: moisture_here,
      is_stone_top,
      block_texture,
      uv: stone_top_uv(),
      moss_layer,
    })
  }

  // Foliage + CUTOUT (leaves) carry the alpha-clipped texel alpha so alphaTest cuts out the transparent
  // background (cross billboards) / the D164 canopy HOLES (cutout); solid stays opaque.
  // [D169 P0, 2026-07-05 — the game read as fully dark] NEAR-CAMERA FOLIAGE FADE: the D164 canopy grew wide
  // enough to bury a camera standing at a tree (at spawn) — inside a dense crown everything clips to
  // leaf-interior black, deterministically across refresh. The classic MMO cure: cutout/foliage texels
  // within ~2.5 m of the CAMERA fade out (alpha falls below the alphaTest clip), so a buried camera
  // always sees through its own tree. Distance is per-fragment world-space.
  const cam_d = length(positionWorld.sub(cameraPosition))
  const near_fade = smoothstep(float(1.2), float(2.5), cam_d) // 0 at the lens → 1 past 2.5 m
  const out_alpha = is_lit_foliage ? sampled.a.mul(near_fade) : float(1.0)
  // NG2-ATMO ambient TINT (sky-lit shade reads COOL): recolor the AMBIENT-FLOOR term toward
  // cool sky-blue where the sky can't reach (v_sun→0 interior/cave), neutral in open ground (v_sun=1 ⇒
  // ambient_tint=white ⇒ brightness_rgb == scalar brightness, so sunlit risers stay warm — the de-cyan
  // guard). Only the ambient floor is tinted; the direct/torch light_scalar lane is untouched. `brightness`
  // (scalar) stays the water path's FROZEN input above; solid/foliage/cutout use the chromatic form here.
  // [SHADER DIET D4] LOW uses a FLAT scalar ambient (drops the cool sky-tint chroma AND the warm block-
  // light tint — block light is a constant 0). MEDIUM/HIGH build the chromatic ambient form (unchanged).
  let lit_rgb
  if (simple) {
    lit_rgb = albedo.mul(brightness).mul(v_ao).mul(face_brightness)
  } else {
    const brightness_rgb = ambient_tint(v_sun).mul(ambient_floor_scaled).add(light_scalar)
    lit_rgb = albedo.mul(lit_tint).mul(brightness_rgb).mul(v_ao).mul(face_brightness)
  }
  // D164 LEAF BACKLIGHT (sun-through-canopy reads luminous): an ADDITIVE leaf-glow on the leaves'
  // shaded (sun-facing-away) hemisphere, gated by sky exposure so interior leaves don't glow. Rides on top
  // of the FoliageLightingModel diffuse below. [LEAVES-2X Rung 2] applied to CANOPY cubes too (same sun
  // uniform) so the opaque far shell glows like its near sprites — keeping the band colour-continuous.
  // [SHADER DIET D2] LOW drops the leaf backlight (the biggest cutout albedo term) — leaves read flat-lit.
  if (is_leaf && !simple) {
    const sun_view = transformNormalToView(/** @type {*} */ (foliage_sun))
    lit_rgb = lit_rgb.add(leaf_backlight_node({ normal_view: transformNormalToView(normal), sun_view, v_sun, albedo }))
  }
  // [CANOPY TONE IMPOSTOR] darken + de-blue the opaque far cube toward the airy-sprite tone it stands in
  // for (rationale + measured pair on CANOPY_TONE_BIAS above). Applied AFTER the leaf backlight so the whole
  // composed cube colour (incl. its glow) shifts as one. CANOPY ONLY — solid/cutout/foliage/liquid untouched.
  if (variant === 'canopy')
    lit_rgb = /** @type {*} */ (lit_rgb.mul(vec3(CANOPY_TONE_BIAS[0], CANOPY_TONE_BIAS[1], CANOPY_TONE_BIAS[2])))
  // D167-B FEATHERED OCCLUSION (solid/foliage/cutout — the earth chain). When a fight board is mounted,
  // world geometry between the camera and the arena dissolves with a soft SCREEN-DOOR dither. The discard
  // MUST ride the color-output graph (Fn body), never a bare build-scope discard — bare discards are dead
  // code in three's TSL (2026-07-04 far_field post-mortem). fade=1 when no board is armed ⇒ never discards.
  // Emitted INSIDE the Fn colorNode stack (night-watch phantom-discard law — a build-scope If/Discard is
  // dead code AND throws currentStack null under headless tests).
  // [D178 REVERTED 2026-07-10 — the "FP look-down black veil" defect] A near-camera SOLID screen-door
  // dissolve used to live here too (dither out solid faces within ~2.6 m of the eye, to see out of an
  // entombed lens). It had NO fight gate, so it fired in world roam: first-person look-down stippled the
  // ground ~1.35 m below the eye (< its 1.4 m floor ⇒ FULL discard) into the unlit subsurface = the black
  // dithered mass on the lower screen. Deleted — entombment is now prevented at the SOURCE (S-76b
  // CAM_WALL_MARGIN wall-march + FP backoff keep the eye ≥0.3 m off every solid face) and the avatar's own
  // mesh is hidden by the app's distance>1 gate in FP. World/roam terrain NEVER dither-fades (by design).
  material.colorNode = Fn(() => {
    // D167-B feathered board occlusion (fade=1 when no board is armed ⇒ never discards).
    if (board_occlusion) occlusion_dither_discard(board_occlusion)
    let rgb = lit_rgb
    // [FIRST-LOAD] dissolve/scan reveal: blocky PER-VOXEL dither dissolve (on-theme — voxels materialize)
    // — discard fragments the front hasn't reached (reveal_frag < a per-block hash). Rides THIS outer Fn's
    // stack (the far_field/board law: a bare or nested-Fn Discard is dead code). Inert once the front
    // completes (reveal_frag≈1 ⇒ never < the [0,1] hash). scan ALSO adds a gold shimmer line at the edge.
    if (reveal_frag_on) {
      const dither = cell_hash(floor(positionWorld.x), floor(positionWorld.z), 0x5eed)
      If(/** @type {*} */ (reveal_frag).lessThan(dither), () => {
        Discard()
      })
      if (reveal_variant === 'scan') {
        const edge = smoothstep(reveal_front.band, float(0), abs(/** @type {*} */ (reveal_df).sub(reveal_front.radius)))
        rgb = /** @type {*} */ (rgb.add(vec3(REVEAL_GOLD[0], REVEAL_GOLD[1], REVEAL_GOLD[2]).mul(edge).mul(float(1.6))))
      }
    }
    return vec4(rgb, out_alpha)
  })()
  // Emissive = registry block emission only (glowstone etc.); the earth-ambient emissive that washed
  // the terraces is gone — shaded-face chroma now comes from the per-face table (albedo, never sky),
  // and the terrace-edge "sky notches" were a geometry defect fixed by the +1 plane correction above.
  material.emissiveNode = v_emission
  // PBR roughness from the macro field (metalness stays the ctor's LOCKED 0 — never a metalnessNode,
  // matching the flora zero-specular no-metal look). GROUND (solid) → per-family base ± humid-dew / sand-ripple;
  // D164: leaves/bark/mossy-stone carry per-family base roughness (satin/matte/sheen — TERRAIN_PBR).
  if (roughness_node) material.roughnessNode = roughness_node

  // ── SUN-LEAK GATE (see SUN_LEAK_GATE) ────────────────────────────────────────────────────────────
  // The BFS-sun gate kills the direct sun where the sky can't reach (canopy floors the shadow map misses
  // because foliage doesn't cast, cave glancing angles) while leaving open terrain (sun=15 ⇒ factor 1.0)
  // exactly as-is. v_sun is BFS sun/15 ∈[0,1]; edge = SUN_FULL/15.
  const direct_factor = smoothstep(float(0), float(SUN_LEAK_GATE.SUN_FULL / 15), v_sun)
  if (simple) {
    // [SHADER DIET D4/D8] every class shares ONE flat diffuse-only lighting model, and the sun-leak gate
    // is RELOCATED into its direct-sun term — because D8 drops the shadow map at LOW, receivedShadowNode
    // (below) would never fire, so the cave/canopy-floor darkening had to move here to survive. The BFS
    // ambient floor keeps caves readable-dark, never black; open terrain (direct_factor 1.0) is unchanged.
    material.setupLightingModel = () => new SimpleTerrainLightingModel(direct_factor)
  } else {
    // FLORA + LEAF (cutout + Rung-2 canopy) GET ZERO SPECULAR: the diffuse-only lighting model (rationale
    // on FoliageLightingModel in terrain_lighting.js) — no microfacet highlight on grass/leaves ⇒ no
    // low-sun metallic sheet, nothing for bloom. Leaves' satin READ comes from the roughness feeding the
    // diffuse/ambient, not a spec lobe. Canopy shares it so the far cubes match the near sprites' lighting.
    if (uses_foliage_sun) material.setupLightingModel = () => new FoliageLightingModel()
    // receivedShadowNode wraps the DIRECT sun's shadow term (three r0.185 ShadowNode.js:677 calls it on
    // the computed shadow, and AnalyticLightNode multiplies it into the light's direct contribution) — it
    // fires ONLY for shadow-casting lights the object receives, i.e. our single `sun`; the warm non-shadow
    // back-fill and all indirect/hemisphere are untouched (they keep shaded faces readable).
    material.receivedShadowNode = /** @type {*} */ (Fn(/** @param {*} args */ (args) => args[0].mul(direct_factor)))
  }

  return material
}

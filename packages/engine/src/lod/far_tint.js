// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [D162] Far-shell CPU MACRO TINT — the pure-JS twin of terrain_tint.js's shader tint, baked per-vertex
// into the near LOD rings (L0/L1) so the far shell reads as the SAME material family as the near voxel
// terrain across the seam (target: "same for the material, bright reflecting sand vs opaque yellow
// plane"). Single-sources the amplitudes + per-block tint class from terrain_tint_data.js (three-FREE),
// so a recipe/tint retune propagates here for free.
//
// NOISE BASIS (2026-07-05 architect note — the claim "three's hash isn't reproducible in JS" was FALSE
// and is corrected): three's PCG hash IS pure integer math and ports to JS exactly. This module uses a
// STAND-IN integer value-noise of the same period/structure (not the exact PCG port) — its patches have
// the same statistics but a DIFFERENT PHASE than the shader's, so they don't line up cell-for-cell with
// the near-terrain tint. That phase mismatch is acceptable ONLY because the D162 seam A/B proved no
// tint-patch step reads at the reference shoreline framing (the shell tint sits UNDER the same shading +
// distance haze as the near terrain, and the far rings that carry it are already hazed); if a future
// retune makes a seam patch-step appear, port the shader's PCG basis op-for-op (it is portable) instead
// of widening this. Applied only to the seam rings, blended to flat map colour at L2+ (haze-covered).
//
// PURE: integer hash only (no three, no Math.random) → safe in the far worker, deterministic.

import { NG_TINT, tint_class_of } from '../render/terrain_tint_data.js'
import { get_block_by_id } from '../config/block_registry.js'
import { clamp, lerp } from '../core/math_utils.js'

const U32 = 4294967296

/** Deterministic int-tuple → uint32 (FNV-1a + splitmix avalanche) — mirrors texture_baker.hash32 so the
 *  far tint noise is engine-stable. @param {number} a @param {number} b @param {number} salt @returns {number} */
function hash32(a, b, salt) {
  let h = 0x811c9dc5
  for (const v of [a, b, salt]) {
    h = (h ^ (v | 0)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
    h = (h ^ (h >>> 15)) >>> 0
    h = Math.imul(h, 0x2c1b3c6d) >>> 0
    h = (h ^ (h >>> 12)) >>> 0
    h = Math.imul(h, 0x297a2d39) >>> 0
    h = (h ^ (h >>> 15)) >>> 0
  }
  return h >>> 0
}
/** Hash → [0,1). @param {number} a @param {number} b @param {number} salt @returns {number} */
function hash01(a, b, salt) {
  return hash32(a, b, salt) / U32
}

// clamp + lerp imported from core/math_utils.js (canonical); smooth01/smoothstep below stay local.
/** Smootherstep-eased 0..1 (matches the shader tint's smoothstep interp). @param {number} t @returns {number} */
function smooth01(t) {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}
/** smoothstep(e0,e1,x) → [0,1]. LOCAL — not core/math_utils.smoothstep: this uses a `||1` divisor guard
 *  (LOD-tint edge case) instead of the canonical's e1<=e0 hard-step, so they differ when e1<=e0. Kept
 *  distinct on purpose. @param {number} e0 @param {number} e1 @param {number} x @returns {number} */
function smoothstep(e0, e1, x) {
  return smooth01((x - e0) / (e1 - e0 || 1))
}

/** Tileable-free 2-D value noise in [0,1) over the integer lattice, smootherstep-interpolated — same
 *  STRUCTURE as terrain_tint.js tint_noise (world coord pre-divided by the octave period). @param {number}
 *  px @param {number} pz world coord / period @param {number} salt octave salt @returns {number} */
function value_noise(px, pz, salt) {
  const x0 = Math.floor(px)
  const z0 = Math.floor(pz)
  const ux = smooth01(px - x0)
  const uz = smooth01(pz - z0)
  const h = (/** @type {number} */ ix, /** @type {number} */ iz) => hash01(ix, iz, salt)
  return lerp(lerp(h(x0, z0), h(x0 + 1, z0), ux), lerp(h(x0, z0 + 1), h(x0 + 1, z0 + 1), ux), uz)
}

/** @typedef {[number, number, number]} Rgb0to255 */

/**
 * Macro-tints one block's flat map colour at a world XZ — the pure twin of macro_tint_nodes. Mirrors the
 * shader op-for-op off the SAME NG_TINT constants + tint_class_of (via terrain_tint_data): value ×
 * climate × turf, then a dirty-patch blend toward dirt. Non-tinted classes (liquid/air/glow) return the
 * input unchanged. Colour is 0..255 bytes (as the far mesher stores corner colours).
 * @param {number} block_id
 * @param {number} world_x @param {number} world_z world coords (meters) of the vertex
 * @param {Rgb0to255} rgb the flat map colour (get_map_color) to tint, 0..255
 * @returns {Rgb0to255} tinted colour, 0..255
 */
export function far_tint_color(block_id, world_x, world_z, rgb) {
  const def = get_block_by_id(block_id)
  if (!def) return rgb
  const tint_class = tint_class_of(def)
  if (tint_class === 0) return rgb // liquid / air / glow — no macro tint (water blue is its own colour)

  const moisture = value_noise(world_x / NG_TINT.P_BIG, world_z / NG_TINT.P_BIG, 0)
  const detail = value_noise(world_x / NG_TINT.P_SMALL, world_z / NG_TINT.P_SMALL, 1)
  const m = moisture * 2 - 1 // [-1,1] +humid / -dry
  const d = detail * 2 - 1
  const is_grassy = tint_class >= 2
  const is_ground = tint_class === 3
  const is_wood = def.name === 'log'

  // (b) VALUE: dry brighter + detail; grassy 0.08 / wood 0.06 / mineral 0.04.
  const val_amp = is_grassy ? NG_TINT.VAL_GRASS : is_wood ? NG_TINT.VAL_WOOD : NG_TINT.VAL_MINERAL
  const value_mul = 1 + val_amp * clamp(m * -0.6 + d * 0.4, -1, 1)

  // (a) CLIMATE chroma: grassy → dry-yellow↔humid-dark; wood → subtle warm↔cool drift.
  const grassy_amt = is_grassy ? 1 : 0
  const wood_amt = is_wood ? 1 : 0
  /** @type {Rgb0to255} */
  const climate = [
    1 + NG_TINT.K[0] * m * grassy_amt + NG_TINT.K_WOOD[0] * m * wood_amt,
    1 + NG_TINT.K[1] * m * grassy_amt + NG_TINT.K_WOOD[1] * m * wood_amt,
    1 + NG_TINT.K[2] * m * grassy_amt + NG_TINT.K_WOOD[2] * m * wood_amt,
  ]

  // (d) HUMID TURF (grass-ground only): moisture-high patches pull grass toward TURF_RGB; gates dirt out.
  const turf = is_ground ? smoothstep(NG_TINT.TURF_LO, NG_TINT.TURF_HI, moisture) : 0
  // (c) DIRTY PATCH (grass-ground only): sparse blend toward dirt, gated out on humid turf.
  const dirt_blend = is_ground
    ? smoothstep(NG_TINT.DIRT_LO, NG_TINT.DIRT_HI, detail) * NG_TINT.DIRT_MAX * (1 - turf)
    : 0

  /** @type {Rgb0to255} */
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c += 1) {
    const turf_mul = lerp(1, NG_TINT.TURF_RGB[c], turf)
    const tinted = rgb[c] * value_mul * climate[c] * turf_mul
    out[c] = clamp(Math.round(lerp(tinted, NG_TINT.DIRT_RGB[c] * 255, dirt_blend)), 0, 255)
  }
  return out
}

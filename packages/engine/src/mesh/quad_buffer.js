// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Per-quad 8-byte instance packing (§3.5) — FROZEN CONTRACT. WS3 (binary_greedy.js /
// mesher.js) writes this exact bit layout; WS4 (terrain_material.js, TSL/GPU side) decodes
// the SAME layout on the GPU. Any change here is a wire-format break — bump a version and
// update terrain_material.js in lockstep.
//
// BIT LAYOUT (documented for the TSL/WGSL decode side — mirror exactly):
//
//   u32 A (word 0):
//     bits  0.. 5 (6b)  x        local voxel-space x, 0-63 (32-chunk range + headroom)
//     bits  6..11 (6b)  y        local voxel-space y, 0-63
//     bits 12..17 (6b)  z        local voxel-space z, 0-63
//     bits 18..22 (5b)  w        quad width  (merged run length) 1-32, stored as (w-1) → 0-31
//     bits 23..27 (5b)  h        quad height (merged run length) 1-32, stored as (h-1) → 0-31
//     bits 28..30 (3b)  face     0=+x 1=-x 2=+y 3=-y 4=+z 5=-z,
//                                 6=cross-diagonal-A 7=cross-diagonal-B — foliage billboard quads
//                                 (registry shape:'cross'). The renderer partitions on face>=6
//                                 and expands each as a crossed diagonal instead of an axis quad.
//                                 The face field was ALWAYS 3 bits (0-7); documenting 6/7 is not a
//                                 wire-format change — zero bits move, bit 31 stays reserved.
//     bit  31           unused (reserved)
//
//   u32 B (word 1) — SMOOTH-LIGHTING LAYOUT v2 (ENG-10 phase 1; was: single sun:4 + block_light:4):
//     bits  0..11 (12b) block_id     up to 4096 distinct blocks
//     bits 12..14 (3b)  sun0         corner-0 (u0,v0) smoothed sun light, 0-7 (half-res of the BFS 0-15)
//     bits 15..17 (3b)  sun1         corner-1 (u1,v0)
//     bits 18..19 (2b)  sun3 LOW     corner-3 (u1,v1) — LOW 2 bits (the field STRADDLES the AO block)
//     bits 20..21 (2b)  ao0          corner 0 ambient occlusion, 0-3
//     bits 22..23 (2b)  ao1          corner 1
//     bits 24..25 (2b)  ao2          corner 2
//     bits 26..27 (2b)  ao3          corner 3
//     bits 28..30 (3b)  sun2         corner-2 (u0,v1)
//     bit  31           sun3 HIGH    corner-3 high bit  ⇒ sun3 = (b>>18 & 0x3) | ((b>>31 & 0x1) << 2)
//
//   CROSS AO-BIT OVERLAY (FLORA-CHAOS, faces 6/7 ONLY): billboard flora has no ambient occlusion (it
//   carries flat AO ⇒ shader v_ao = 1.0), so the mesher repurposes the LOW 3 bits of the AO block
//   (bits 20..22) to carry a per-plane ORDINAL 0..K-1 (K = registry `cross_pairs`). It is written by
//   passing `ao_packed = ordinal` to encode_quad (ordinal ≤ 7 ⇒ only bits 20-22 set; 23-27 stay 0),
//   and terrain_material.js reads `(word_b >> 20) & 0x7` on cross faces and FORCES AO = 3 there. This
//   is a SEMANTIC overlay on the existing AO field for face≥6 only — ZERO bits move, no format change;
//   solid/liquid faces (0-5) still decode bits 20-27 as the four 2-bit AO corners exactly as before.
//
//   SMOOTH LIGHTING (ENG-10 phase 1): the light is now FOUR per-corner values (Minecraft "smooth
//   lighting"), matching the AO corner order [(0,0),(1,0),(0,1),(1,1)] so the GPU bilinear-interpolates
//   them across each quad exactly like AO — killing the flat per-cell light patches. The former single
//   per-quad `sun` and the always-zero `block_light` channel (light_engine never emits block light —
//   emissive is a later workstream) are reclaimed for the 12 bits. Corner values are 3-bit (0-7) =
//   BFS-sun>>1; the shader reconstructs [0,1] as sun_corner/7 (open terrain 7→1.0, byte-identical
//   brightness to the old sun=15→1.0). When emissive block light lands it rides a side channel, not
//   these bits. word A is byte-IDENTICAL to v1 (position/size/face untouched), so every position/face/
//   AO/block_id test stays valid; only the light-field goldens are re-blessed (visual domain).
//
// WGSL decode sketch (for terrain_material.js — do not literally import, TSL rebuilds this
// node-side): `let x = a & 0x3Fu; let y = (a >> 6u) & 0x3Fu; let face = (a >> 28u) & 0x7u;`
// etc. — identical shifts/masks to the JS below. IMPORTANT: w/h are stored as value-1, so the
// TSL side MUST add 1 after masking: `let w = ((a >> 18u) & 0x1Fu) + 1u;` (same for h).

/** @typedef {0|1|2|3|4|5} CubeFace axis-aligned cube faces: 0=+x 1=-x 2=+y 3=-y 4=+z 5=-z */
/** @typedef {CubeFace|6|7} QuadFace cube faces (0-5) + cross billboard diagonals: 6=A 7=B */

/**
 * @typedef {object} QuadFields
 * @property {number} x local voxel-space x, 0-63
 * @property {number} y local voxel-space y, 0-63
 * @property {number} z local voxel-space z, 0-63
 * @property {number} w merged quad width, 1-32
 * @property {number} h merged quad height, 1-32
 * @property {QuadFace} face 0-5 = axis-aligned cube faces, 6/7 = cross billboard diagonals
 * @property {number} block_id 0-4095
 * @property {[number, number, number, number]} sun_corners four 3-bit per-corner smoothed sun light
 *   values, 0-7 each (SMOOTH LIGHTING), in the AO corner order [(0,0),(1,0),(0,1),(1,1)]. Replaces the
 *   former single `sun` (0-15) + the always-zero `block_light` per-quad fields.
 * @property {[number, number, number, number]} ao four 2-bit corner AO values, 0-3 each
 */

const MASK_6 = 0x3f
const MASK_5 = 0x1f
const MASK_3 = 0x7
const MASK_12 = 0xfff
const MASK_2 = 0x3

/**
 * Encodes one quad's fields into the frozen 8-byte (two-u32) instance layout.
 * @param {QuadFields} fields
 * @returns {[number, number]} [word_a, word_b], both unsigned 32-bit
 */
export function encode_quad(fields) {
  const { x, y, z, w, h, face, block_id, sun_corners, ao } = fields
  const [s0, s1, s2, s3] = sun_corners

  const word_a =
    ((x & MASK_6) |
      ((y & MASK_6) << 6) |
      ((z & MASK_6) << 12) |
      (((w - 1) & MASK_5) << 18) |
      (((h - 1) & MASK_5) << 23) |
      ((face & MASK_3) << 28)) >>>
    0

  // sun3 STRADDLES the AO block: low 2 bits at 18-19, high bit at 31 (see the header layout).
  const word_b =
    ((block_id & MASK_12) |
      ((s0 & MASK_3) << 12) |
      ((s1 & MASK_3) << 15) |
      ((s3 & MASK_2) << 18) |
      ((ao[0] & MASK_2) << 20) |
      ((ao[1] & MASK_2) << 22) |
      ((ao[2] & MASK_2) << 24) |
      ((ao[3] & MASK_2) << 26) |
      ((s2 & MASK_3) << 28) |
      (((s3 >> 2) & 0x1) << 31)) >>>
    0

  return [word_a, word_b]
}

/**
 * Decodes a two-u32 quad instance back into named fields. Inverse of `encode_quad`.
 * @param {[number, number]} words [word_a, word_b]
 * @returns {QuadFields}
 */
export function decode_quad([word_a, word_b]) {
  return {
    x: word_a & MASK_6,
    y: (word_a >>> 6) & MASK_6,
    z: (word_a >>> 12) & MASK_6,
    w: ((word_a >>> 18) & MASK_5) + 1,
    h: ((word_a >>> 23) & MASK_5) + 1,
    face: /** @type {QuadFace} */ ((word_a >>> 28) & MASK_3),
    block_id: word_b & MASK_12,
    sun_corners: [
      (word_b >>> 12) & MASK_3,
      (word_b >>> 15) & MASK_3,
      (word_b >>> 28) & MASK_3,
      ((word_b >>> 18) & MASK_2) | (((word_b >>> 31) & 0x1) << 2),
    ],
    ao: [(word_b >>> 20) & MASK_2, (word_b >>> 22) & MASK_2, (word_b >>> 24) & MASK_2, (word_b >>> 26) & MASK_2],
  }
}

/** Bytes per quad instance (2× u32). */
export const BYTES_PER_QUAD = 8

/**
 * Allocates a quad buffer with capacity for `quad_count` quads.
 * @param {number} quad_count
 * @returns {Uint32Array} length = quad_count * 2
 */
export function allocate_quad_buffer(quad_count) {
  return new Uint32Array(quad_count * 2)
}

/**
 * Grows a quad buffer to at least `min_quad_count` capacity, copying existing data.
 * Doubling growth policy to amortize reallocation cost during incremental meshing.
 * @param {Uint32Array} buffer existing buffer (as from `allocate_quad_buffer`)
 * @param {number} min_quad_count required capacity, in quads
 * @returns {Uint32Array} same buffer if already large enough, otherwise a new, grown one
 */
export function grow_quad_buffer(buffer, min_quad_count) {
  const min_length = min_quad_count * 2
  if (buffer.length >= min_length) return buffer

  let new_length = buffer.length || 2
  while (new_length < min_length) new_length *= 2

  const grown = new Uint32Array(new_length)
  grown.set(buffer)
  return grown
}

/**
 * Writes one encoded quad into a buffer at the given quad slot index.
 * @param {Uint32Array} buffer
 * @param {number} quad_index
 * @param {[number, number]} encoded [word_a, word_b]
 */
export function write_quad(buffer, quad_index, encoded) {
  const offset = quad_index * 2
  const [word_a, word_b] = encoded
  buffer[offset] = word_a
  buffer[offset + 1] = word_b
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Canonical deterministic integer hashes — the ONE home for the splitmix-lineage hash2/hash3 that
// were copied byte-for-byte across gen stages (sky_islands, strata, icebergs, cirque, caves) with
// only cosmetic drift (`salt|0` vs `salt`, `& U32` vs none). Those variants are OUTPUT-IDENTICAL:
// JS `^` already ToInt32's its operands (so `salt|0` is redundant) and `(x & 0xffffffff) >>> 0`
// equals `x >>> 0`. integer_hash.test.js PINS this — it replays every former per-file impl against
// these and asserts bit-equality over a wide input grid, so consolidating cannot shift world seeds.
//
// DETERMINISM CONTRACT: these constants are FROZEN. Changing any multiplier/shift re-rolls every
// world that hashes through here. Files whose hash used DIFFERENT constants (lod/far_voxel_mesher.js
// FNV-1a, gen/cave_room.js 5-arg xxhash, tactical/board_surface.js float xxhash) correctly keep
// their own local impls — they are not this function.

/**
 * 32-bit integer hash of two coords + a salt → unsigned 32-bit. Math.imul (spec'd 32-bit multiply)
 * + xorshift mixing: all exact integer ops, portable across engines.
 * @param {number} a @param {number} b @param {number} salt @returns {number} uint32
 */
export function hash2(a, b, salt) {
  let h = (Math.imul(a | 0, 0x27d4_eb2d) ^ Math.imul(b | 0, 0x1656_67b1) ^ (salt | 0)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b_3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0x297a_2d39) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * 32-bit integer hash of three coords + a salt → unsigned 32-bit.
 * @param {number} a @param {number} b @param {number} c @param {number} salt @returns {number} uint32
 */
export function hash3(a, b, c, salt) {
  let h =
    (Math.imul(a | 0, 0x1656_67b1) ^ Math.imul(b | 0, 0x2f6d_9f4b) ^ Math.imul(c | 0, 0x5b83_2d19) ^ (salt | 0)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b_3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a_2d39) >>> 0
  return (h ^ (h >>> 15)) >>> 0
}

// BINDING — deterministic PRNG + anchor hashing (the portable twin surface).
//
// This is a VENDORED, byte-identical copy of the game's canonical mulberry32 PRNG + FNV-1a seed hash.
// The engine ships no dependency on the sim/Move packages, so the ~40 lines live here with the SSOT
// citations below — a dependency is a marriage; 40 vendored lines beat coupling the render engine to
// the combat sim for one function (craft law). The determinism test (prng.test.js) pins the SAME
// reference vectors the Move port asserts, so any drift from the twins is caught mechanically.
//
// SSOT (byte-identical to all three):
//   • packages/sim/src/prng.js                     (rng_seed / rng_next / rng_int / rng_range)
//   • packages/move/foundation/sources/prng.move   (u64-masked Move port, same low-32 arithmetic)
//   • packages/frontend/.../screens/dungeon-grid.js hashSeed (FNV-1a)
//
// WHY it matters: board_anchor.js derives a fight board from (world seed, anchor) through this PRNG;
// the on-chain FIGHT package will re-derive the identical board (SPEC §7 "the board IS the world").
// A one-bit divergence here desyncs every client's board from the chain, so this file is a CONTRACT.

/** Low-32-bit mask — the wrapping boundary replacing JS `>>> 0` in the u64 Move port. */
export const FNV_OFFSET = 2166136261 // FNV-1a 32-bit offset basis
export const FNV_PRIME = 16777619 // FNV-1a 32-bit prime

/**
 * @typedef {number} Rng uint32 PRNG state (opaque; thread it through, never mutate).
 */

/** Seed the PRNG from any 32-bit integer (`seed >>> 0`). @param {number} seed @returns {Rng} */
export const rng_seed = (seed) => seed >>> 0

/**
 * Advance the PRNG once. `value` is a uint32 in [0, 2^32); `state` advances to `a`.
 * @param {Rng} state @returns {{ state: Rng, value: number }}
 */
export const rng_next = (state) => {
  const a = (state + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const value = (t ^ (t >>> 14)) >>> 0
  return { state: a | 0, value }
}

/** Draw an integer in [0, n). `n` must be a positive integer. @param {Rng} state @param {number} n */
export const rng_int = (state, n) => {
  const next = rng_next(state)
  return { state: next.state, value: next.value % n }
}

/** Draw an integer in [min, max] inclusive. Requires `min <= max`. @param {Rng} state @param {number} min @param {number} max */
export const rng_range = (state, min, max) => {
  const span = max - min + 1
  const next = rng_int(state, span)
  return { state: next.state, value: min + next.value }
}

/**
 * Fold a byte sequence into a uint32 seed via FNV-1a. `Math.imul` + `>>> 0` reproduce the Move port's
 * `(h * PRIME) & MASK32` exactly. @param {ArrayLike<number>} bytes @returns {number} uint32
 */
export function hash_bytes(bytes) {
  let h = FNV_OFFSET
  for (let i = 0; i < bytes.length; i += 1) {
    h = (h ^ (bytes[i] & 0xff)) >>> 0
    h = Math.imul(h, FNV_PRIME) >>> 0
  }
  return h >>> 0
}

/**
 * The CANONICAL board-anchor seed derivation — the exact hash the on-chain FIGHT twin must mirror.
 * Folds, in this fixed order, via FNV-1a (the byte sequence IS the portable contract):
 *   1. the world seed string's UTF-8 bytes,
 *   2. anchor_x as a signed int32, 4 little-endian bytes,
 *   3. anchor_z as a signed int32, 4 little-endian bytes.
 * Returns a uint32 to seed `rng_seed`. Pure; identical (seed, x, z) → identical value on every machine.
 * @param {string} seed_string the world recipe seed (world_config.seed)
 * @param {number} anchor_x integer world-x of the mob-group anchor
 * @param {number} anchor_z integer world-z of the mob-group anchor
 * @returns {number} uint32 board seed
 */
export function hash_anchor(seed_string, anchor_x, anchor_z) {
  const seed_bytes = utf8_bytes(String(seed_string))
  const coord_bytes = [...int32_le(anchor_x), ...int32_le(anchor_z)]
  return hash_bytes([...seed_bytes, ...coord_bytes])
}

/** UTF-8 encode a string to a byte array (TextEncoder when present; ASCII fallback for node/tests).
 *  @param {string} s @returns {number[]} */
function utf8_bytes(s) {
  if (typeof TextEncoder !== 'undefined') return [...new TextEncoder().encode(s)]
  const out = []
  for (let i = 0; i < s.length; i += 1) out.push(s.charCodeAt(i) & 0xff)
  return out
}

/** The 4 little-endian bytes of a value reinterpreted as a signed int32 (`| 0`). @param {number} v @returns {number[]} */
function int32_le(v) {
  const n = v | 0
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
}

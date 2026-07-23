// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Deterministic seeded PRNG (mulberry32), threaded functionally through fight state.
//
// DETERMINISM IS LAW: state is a single uint32, advanced purely. Same seed -> same sequence on every
// machine. We return integer values only (never the canonical /2^32 float) so no float ever enters the
// sim. Math.random is banned by eslint here; this module is the ONLY source of randomness.

/**
 * @typedef {number} Rng  uint32 PRNG state (opaque; thread it through state, never mutate)
 */

/**
 * Seed the PRNG from any 32-bit integer.
 * @param {number} seed
 * @returns {Rng}
 */
export const rng_seed = seed => seed >>> 0

/**
 * Advance the PRNG once.
 * @param {Rng} state
 * @returns {{ state: Rng, value: number }}  value is a uint32 in [0, 2^32)
 */
export const rng_next = state => {
  const a = (state + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const value = (t ^ (t >>> 14)) >>> 0
  return { state: a | 0, value }
}

/**
 * Draw an integer in [0, n). `n` must be a positive integer.
 * @param {Rng} state
 * @param {number} n
 * @returns {{ state: Rng, value: number }}
 */
export const rng_int = (state, n) => {
  const next = rng_next(state)
  return { state: next.state, value: next.value % n }
}

/**
 * Draw an integer in [min, max] inclusive. Requires `min <= max`.
 * @param {Rng} state
 * @param {number} min
 * @param {number} max
 * @returns {{ state: Rng, value: number }}
 */
export const rng_range = (state, min, max) => {
  const span = max - min + 1
  const next = rng_int(state, span)
  return { state: next.state, value: min + next.value }
}

// ── Stateless derivation (turn-seed crit/damage slots) — byte-identical to aresrpg_foundation::prng ──

/**
 * Reduce any u64-ish value (Number or BigInt) to a uint32 Number — the `& MASK32` wrapping boundary each fold
 * applies in the Move port. World seed / spawn id can be a full 64-bit value (BigInt from the SDK), so the mask
 * runs in BigInt space to avoid float-precision loss above 2^53; the result (< 2^32) is an exact Number.
 * @param {number | bigint} v
 * @returns {number}
 */
const to_u32 = v => Number(BigInt(v) & 0xffffffffn)

/**
 * One-shot 32-bit avalanche of `seed` — mulberry32's scrambler used as a HASH, not a stream (prng.move
 * `scramble`). Byte-identical to `rng_next(seed >>> 0).value`. The building block for deriving DECORRELATED
 * sub-seeds (per-turn crit/damage stream picks) from combined inputs.
 * @param {number | bigint} seed
 * @returns {number}  uint32
 */
export const scramble = seed => rng_next(to_u32(seed)).value

/**
 * Fold `x` into a 32-bit accumulator: wrapping-add then `scramble` (prng.move `mix`). Order-sensitive input
 * combiner — build a seed from several values with `mix(mix(a, b), c)`. Byte-identical to Move's
 * `scramble(((acc & MASK32) + (x & MASK32)) & MASK32)`; each fold avalanches so distinct input tuples collide
 * only at the scrambler's 1-in-2^32 rate (no additive cancellation).
 * @param {number | bigint} acc
 * @param {number | bigint} x
 * @returns {number}  uint32
 */
export const mix = (acc, x) => scramble((to_u32(acc) + to_u32(x)) >>> 0)

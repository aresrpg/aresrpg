// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Stateless integer position-hash noise (SquirrelNoise5, Eiserloh 'Noise-Based RNG', GDC 2017).
//
// DETERMINISM IS LAW: this is a PURE FUNCTION of (x, y, seed) — no PRNG state threaded, no order
// dependence. hash(x, y, seed) returns the SAME uint32 regardless of when or on which machine it is
// called, which is exactly why the arena carve uses it for obstacle placement instead of the sequential
// mulberry32 (prng.js): a disc of obstacles must be reproducible by random access, not by walking a
// stream in a fixed order. All math is Math.imul + `>>> 0` (same discipline as prng.js).
//
// Constants + sequence are the canonical SquirrelNoise5 (5 odd-constant mix rounds). Math.random is
// banned by eslint in this package; this module introduces no new randomness source — it is a hash.

// SquirrelNoise5 mixing constants (large odd uint32s).
const SQ5_BIT_NOISE1 = 0xd2a80a3f
const SQ5_BIT_NOISE2 = 0xa884f197
const SQ5_BIT_NOISE3 = 0x6c736f4b
const SQ5_BIT_NOISE4 = 0xb79f3abb
const SQ5_BIT_NOISE5 = 0x1b56c4f5

// Large prime used to fold the 2D coordinate into the 1D hash input (decorrelates rows from columns).
const PRIME_Y = 198491317

/**
 * 1D position hash: deterministic uint32 from a position index and a seed.
 * Pure — no state, random-access, order-independent. Same (position, seed) -> same value everywhere.
 * @param {number} position  integer coordinate (any 32-bit int)
 * @param {number} seed      integer seed
 * @returns {number}         uint32 in [0, 2^32)
 */
export const squirrel_noise = (position, seed) => {
  let mangled = (position | 0) >>> 0
  mangled = Math.imul(mangled, SQ5_BIT_NOISE1) >>> 0
  mangled = (mangled + (seed | 0)) >>> 0
  mangled ^= mangled >>> 9
  mangled = (mangled + SQ5_BIT_NOISE2) >>> 0
  mangled ^= mangled >>> 11
  mangled = Math.imul(mangled, SQ5_BIT_NOISE3) >>> 0
  mangled ^= mangled >>> 13
  mangled = (mangled + SQ5_BIT_NOISE4) >>> 0
  mangled ^= mangled >>> 15
  mangled = Math.imul(mangled, SQ5_BIT_NOISE5) >>> 0
  mangled ^= mangled >>> 17
  return mangled >>> 0
}

/**
 * 2D position hash: folds (x, y) into the 1D hash via a large prime. Order-independent and stateless.
 * @param {number} x     integer cell x
 * @param {number} y     integer cell y
 * @param {number} seed  integer seed
 * @returns {number}     uint32 in [0, 2^32)
 */
export const squirrel_noise_2d = (x, y, seed) =>
  squirrel_noise((x | 0) + Math.imul(PRIME_Y, y | 0), seed)

// Obstacle density: a cell is an obstacle when its hash falls in the lowest `density/256` of the range.
// ~17% (44/256) — within the spec's 15-20% target — leaving an open, navigable arena after flood-fill.
const OBSTACLE_THRESHOLD_256 = 44

/**
 * Deterministic per-cell obstacle test. Pure function of (x, y, seed): the SAME arena obstacle layout is
 * produced regardless of generation order or machine — the determinism-is-law requirement for @aresrpg/sim.
 * @param {number} x     integer cell x
 * @param {number} y     integer cell y
 * @param {number} seed  integer seed
 * @returns {boolean}    true when the cell is an obstacle
 */
export const obstacle_at = (x, y, seed) =>
  squirrel_noise_2d(x, y, seed) % 256 < OBSTACLE_THRESHOLD_256

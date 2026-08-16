// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign -- The cursor is a reduction-local mirror of Move's &mut PRNG state. */
// Hand twin of aresrpg_math::prng. Every operation masks at the same Move boundary.

import type { PrngCursor, PrngResult } from './types.ts'

const MASK_32 = 0xffff_ffffn

export const rng_seed = (seed: bigint): bigint => BigInt(seed) & MASK_32

export const rng_next = (state: bigint): PrngResult => {
  const a = (BigInt(state) + 0x6d2b79f5n) & MASK_32
  const t_0 = (a ^ (a >> 15n)) & MASK_32
  let t = (t_0 * (1n | a)) & MASK_32
  const mixed = (((t ^ (t >> 7n)) & MASK_32) * (61n | t)) & MASK_32
  t = ((t + mixed) & MASK_32) ^ t
  return { state: a, value: (t ^ (t >> 14n)) & MASK_32 }
}

export const draw = (cursor: PrngCursor): bigint => {
  const next = rng_next(cursor.state)
  cursor.state = next.state
  return next.value
}

export const rng_int = (state: bigint, count: bigint): PrngResult => {
  const next = rng_next(state)
  return { state: next.state, value: next.value % BigInt(count) }
}

export const rng_range = (state: bigint, minimum: bigint, maximum: bigint): PrngResult => {
  const min = BigInt(minimum)
  const max = BigInt(maximum)
  const next = rng_int(state, max - min + 1n)
  return { state: next.state, value: min + next.value }
}

export const scramble = (seed: bigint): bigint => rng_next(BigInt(seed) & MASK_32).value

export const mix = (accumulator: bigint, value: bigint): bigint =>
  scramble(((BigInt(accumulator) & MASK_32) + (BigInt(value) & MASK_32)) & MASK_32)

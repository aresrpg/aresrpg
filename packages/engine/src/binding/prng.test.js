// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Determinism contract for the vendored PRNG + anchor hash. The reference vectors are captured LIVE
// from packages/sim/src/prng.js and asserted verbatim in packages/move/foundation/sources/prng.move —
// if these drift, the engine's board derivation has desynced from the sim + chain twins.

import { test, expect, describe } from 'bun:test'

import { rng_seed, rng_next, rng_int, rng_range, hash_bytes, hash_anchor } from './prng.js'

describe('binding/prng — mulberry32 byte-identity with the sim + Move twins', () => {
  test('rng_seed(0) → next ×4 matches the Move reference vectors', () => {
    let s = rng_seed(0)
    const seq = []
    for (let i = 0; i < 4; i += 1) {
      const r = rng_next(s)
      s = r.state
      seq.push([r.state >>> 0, r.value])
    }
    expect(seq).toEqual([
      [1831565813, 1144304738],
      [3663131626, 1416247],
      [1199730143, 958946056],
      [3031295956, 627933444],
    ])
  })

  test('rng_range(seed 12345, 1, 100) === 70 (Move vector)', () => {
    expect(rng_range(rng_seed(12345), 1, 100).value).toBe(70)
  })

  test('rng_int(seed 999, 6) === 1 (Move vector)', () => {
    expect(rng_int(rng_seed(999), 6).value).toBe(1)
  })
})

describe('binding/prng — FNV-1a hash', () => {
  test('hash_bytes empty === the FNV offset basis', () => {
    expect(hash_bytes([])).toBe(2166136261)
  })

  test('hash_bytes is order-sensitive and deterministic', () => {
    expect(hash_bytes([1, 2, 3])).toBe(hash_bytes([1, 2, 3]))
    expect(hash_bytes([1, 2, 3])).not.toBe(hash_bytes([3, 2, 1]))
  })
})

describe('binding/prng — hash_anchor', () => {
  test('same (seed, x, z) → identical uint32', () => {
    expect(hash_anchor('ares', 100, -200)).toBe(hash_anchor('ares', 100, -200))
    const h = hash_anchor('ares', 100, -200)
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
  })

  test('anchor sensitivity — a 1-block move changes the seed', () => {
    expect(hash_anchor('ares', 100, 200)).not.toBe(hash_anchor('ares', 101, 200))
    expect(hash_anchor('ares', 100, 200)).not.toBe(hash_anchor('ares', 100, 201))
  })

  test('seed sensitivity — a different world seed changes the hash at the same anchor', () => {
    expect(hash_anchor('world-a', 0, 0)).not.toBe(hash_anchor('world-b', 0, 0))
  })

  test('negative coordinates fold cleanly (signed int32 LE)', () => {
    expect(hash_anchor('ares', -1, -1)).toBe(hash_anchor('ares', -1, -1))
    expect(hash_anchor('ares', -1, -1)).not.toBe(hash_anchor('ares', 1, 1))
  })
})

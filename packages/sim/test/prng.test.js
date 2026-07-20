import { describe, test, expect } from 'bun:test'

import { rng_seed, rng_next, rng_int, rng_range } from '../src/prng.js'

const sequence = (seed, n) => {
  let rng = rng_seed(seed)
  const out = []
  for (let i = 0; i < n; i++) {
    const { state, value } = rng_next(rng)
    rng = state
    out.push(value)
  }
  return out
}

describe('prng determinism', () => {
  test('same seed -> identical sequence', () => {
    expect(sequence(12345, 64)).toEqual(sequence(12345, 64))
  })

  test('different seeds -> different sequences', () => {
    expect(sequence(1, 32)).not.toEqual(sequence(2, 32))
  })

  test('values are uint32 integers', () => {
    for (const v of sequence(999, 200)) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(2 ** 32)
    }
  })

  test('rng_int stays in [0, n) and is reproducible', () => {
    const roll = seed => {
      let rng = rng_seed(seed)
      const out = []
      for (let i = 0; i < 50; i++) {
        const { state, value } = rng_int(rng, 6)
        rng = state
        out.push(value)
      }
      return out
    }
    const a = roll(7)
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(6)
    }
    expect(a).toEqual(roll(7))
  })

  test('rng_range is inclusive and in bounds', () => {
    let rng = rng_seed(42)
    for (let i = 0; i < 100; i++) {
      const { state, value } = rng_range(rng, 3, 8)
      rng = state
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThanOrEqual(8)
    }
  })

  test('no floats escape (values and state are integers)', () => {
    let rng = rng_seed(2024)
    for (let i = 0; i < 200; i++) {
      const { state, value } = rng_next(rng)
      rng = state
      expect(value % 1).toBe(0)
      expect(Number.isInteger(state)).toBe(true)
    }
  })
})

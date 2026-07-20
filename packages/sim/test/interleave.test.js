import { describe, test, expect } from 'bun:test'

import {
  order,
  new_player_actor,
  new_mob_actor,
  actor_is_mob,
  actor_idx,
} from '../src/interleave.js'

// PARITY FIXTURES — every expectation is copied VERBATIM from packages/move/fight/tests/pure_tests.move
// (the §17.28 global-interleave suite). Each test cites its Move source test by name.

// Move helpers `players(n)` / `mobs(n)` / `pattern(q)`.
const players = n => Array.from({ length: n }, (_, i) => new_player_actor(i))
const mobs = n => Array.from({ length: n }, (_, i) => new_mob_actor(i))
const pattern = q => q.map(actor_is_mob)

describe('interleave §17.28 — parity with pure_tests.move', () => {
  test('interleave_3v3_strict_alternation: 3v3 → A,B,A,B,A,B (players first on ties)', () => {
    const q = order(players(3), mobs(3))
    expect(q.length).toBe(6)
    expect(pattern(q)).toEqual([false, true, false, true, false, true])
  })

  test('interleave_1v3_minority_centered: 1v3 → B,A,B,B (lone player centered)', () => {
    const q = order(players(1), mobs(3))
    expect(q.length).toBe(4)
    expect(pattern(q)).toEqual([true, false, true, true])
  })

  test('interleave_2v6_evenly_spread: 2v6 → B,A,B,B,B,A,B,B; player slots carry seats 0 then 1', () => {
    const q = order(players(2), mobs(6))
    expect(q.length).toBe(8)
    expect(pattern(q)).toEqual([
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      true,
    ])
    expect(actor_idx(q[1])).toBe(0)
    expect(actor_idx(q[5])).toBe(1)
  })

  test('interleave_is_deterministic: same inputs → byte-identical queue', () => {
    const a = order(players(2), mobs(6))
    const b = order(players(2), mobs(6))
    expect(pattern(a)).toEqual(pattern(b))
  })

  test('interleave_one_sided: all players, no mobs → drains in order', () => {
    const q = order(players(4), mobs(0))
    expect(pattern(q)).toEqual([false, false, false, false])
  })
})

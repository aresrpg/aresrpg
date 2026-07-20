// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPAWN COMPOSITION — cross-language determinism proof. The oracle is the CHAIN's own FROZEN vector
// (packages/move/engine/tests/pure_tests.move `spawn_seeded_pinned_vector_freezes_stream`, derived by hand
// from the prng.move reference vectors and pinned "forever"): seed 0, band [10,20], archimob_bp 0 →
// level 15, archimob false, advanced state 1199730143. The prng chain itself is double-anchored against the
// SAME reference vectors prng.move's `prng_matches_js_reference` pins — so a drift on EITHER side (Move or
// sim) breaks a test here before the card ever lies to a player about a mob's level.
import { test, expect } from 'bun:test'
import { rng_seed, rng_next } from '@aresrpg/sim/prng'

import { derive_group_members, DEFAULT_ARCHIMOB_BP, DEFAULT_TEAM_BOUND } from './spawn_compose.js'

test('prng reference chain matches the Move-side pinned vectors (prng.move)', () => {
  // prng.move `prng_matches_js_reference`: rng_seed(0) → (state, value) ×4:
  //   1831565813,1144304738 | 3663131626,1416247 | 1199730143,958946056 | _,627933444
  let r = rng_next(rng_seed(0))
  expect(r.state >>> 0).toBe(1831565813)
  expect(r.value).toBe(1144304738)
  r = rng_next(r.state)
  expect(r.state >>> 0).toBe(3663131626)
  expect(r.value).toBe(1416247)
  r = rng_next(r.state)
  expect(r.state >>> 0).toBe(1199730143)
  expect(r.value).toBe(958946056)
  r = rng_next(r.state)
  expect(r.value).toBe(627933444)
})

test('FROZEN Move vector: seed 0, band [10,20], bp 0 → level 15, no archi, state 1199730143', () => {
  // pure_tests.move `spawn_seeded_pinned_vector_freezes_stream` (the chain's own frozen anchor):
  // level draw 1144304738 % 11 = 5 → 15; archi draw 1416247 % 10000 = 6247 (bp 0 → false); one cell draw.
  const { members, state } = derive_group_members('0', {
    min_level: 10,
    max_level: 20,
    size: 1,
    archimob_bp: 0,
    team_bound: 6,
  })
  expect(members).toEqual([{ level: 15, archi: false }])
  expect(state).toBe(1199730143)
})

test('archimob certain at bp 10000 across 100 seeds (pure_tests.move mirror)', () => {
  // The roll is rng_int(_, 10000) ∈ [0, 10000) — always < 10000, so the flag must fire on every seed.
  for (let seed = 0; seed < 100; seed += 1) {
    const { members } = derive_group_members(String(seed), {
      min_level: 10,
      max_level: 20,
      size: 1,
      archimob_bp: 10_000,
    })
    expect(members[0].archi).toBe(true)
  }
})

test('degenerate band consumes NO level draw (mob.move: min == max skips rng_range)', () => {
  // Hand-threaded off the reference chain, seed 0, min=max=7: archi draw = rng_next(0) → value 1144304738
  // (% 10000 = 4738, bp 50 → false), cell draw advances 1831565813 → 3663131626. Final state pins the
  // "no level draw" branch — a mirror that (wrongly) drew a level here would land on 1199730143 instead.
  const { members, state } = derive_group_members('0', { min_level: 7, max_level: 7, size: 1 })
  expect(members).toEqual([{ level: 7, archi: false }])
  expect(state).toBe(3663131626)
})

test('levels stay in band + threading advances per member (200 seeds, 6 members)', () => {
  // pure_tests.move `spawn_seeded_level_in_band_over_seeds` widened to full groups: every member's level in
  // [10, 20] whatever the seed, and the advanced state differs per member count (the stream really threads).
  for (let seed = 0; seed < 200; seed += 1) {
    const spec = { min_level: 10, max_level: 20, size: 6, archimob_bp: DEFAULT_ARCHIMOB_BP }
    const { members } = derive_group_members(String(seed), spec)
    expect(members.length).toBe(6)
    for (const m of members) {
      expect(m.level).toBeGreaterThanOrEqual(10)
      expect(m.level).toBeLessThanOrEqual(20)
    }
    const one = derive_group_members(String(seed), { ...spec, size: 1 })
    const two = derive_group_members(String(seed), { ...spec, size: 2 })
    expect(one.members[0]).toEqual(two.members[0]) // prefix-stable: member i never depends on later members
    expect(one.state).not.toBe(two.state) // …but the stream advanced past member 1
  }
})

test('member count mirrors fight.move clamp_group (cap at team_bound, floor at 1)', () => {
  const spec = { min_level: 1, max_level: 3, archimob_bp: 0 }
  expect(derive_group_members('9', { ...spec, size: 9, team_bound: 6 }).members.length).toBe(6)
  expect(derive_group_members('9', { ...spec, size: 4, team_bound: 3 }).members.length).toBe(3)
  expect(derive_group_members('9', { ...spec, size: 0 }).members.length).toBe(1)
  expect(DEFAULT_TEAM_BOUND).toBe(6) // §17.8 — the fallback the card uses when /v1/config carries no dial
})

test('u64 seeds fold to their low 32 bits exactly like prng.move rng_seed', () => {
  // group_seed is a full u64 (`gen.generate_u64()`); rng_seed keeps seed & 0xFFFFFFFF. 2^32 + 5 ≡ 5.
  const big = (2n ** 32n + 5n).toString()
  const folded = derive_group_members(big, { min_level: 10, max_level: 20, size: 3 })
  const small = derive_group_members('5', { min_level: 10, max_level: 20, size: 3 })
  expect(folded).toEqual(small)
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Player-action crit provenance parity. The oracle below is deliberately reconstructed from the Move source
// instead of importing sim/prng: prng.move's wrapping mulberry scramble + mix, fight.move's public turn-seed
// fold, and spell_formula.move's DOMAIN_CRIT/CRIT_SCALE fold. The mixed spell/weapon sequence mirrors
// action_envelope_tests.move::spell_and_weapon_actions_are_lossless_and_ordinal_grouped: both action families
// consume the same pre-action ordinal and expose crit_roll of CRIT_BOUND in ActionResolved.

import { describe, expect, test } from 'bun:test'

import { crit_at, slot_crit_roll, turn_seed } from '../src/turn_seed.js'

import fixture from './vectors/crit_turn_parity.json' with { type: 'json' }

const MASK32 = 0xffffffffn
const DOMAIN_CRIT = 0n

const u32 = value => BigInt(value) & MASK32

// packages/move/foundation/sources/prng.move::scramble (the value half of rng_next).
const move_scramble = state => {
  const a = (u32(state) + 0x6d2b79f5n) & MASK32
  let t = (((a ^ (a >> 15n)) & MASK32) * (1n | a)) & MASK32
  const m = (((t ^ (t >> 7n)) & MASK32) * (61n | t)) & MASK32
  t = (((t + m) & MASK32) ^ t) & MASK32
  return Number((t ^ (t >> 14n)) & MASK32)
}

// packages/move/foundation/sources/prng.move::mix.
const move_mix = (acc, value) => move_scramble((u32(acc) + u32(value)) & MASK32)

const move_turn_seed = ({ world_seed, spawn_id, turn_deadline_ms, seat }) =>
  move_mix(move_mix(move_mix(world_seed, spawn_id), turn_deadline_ms), seat)

const move_crit_roll = (seed, action_ordinal) =>
  move_mix(move_mix(seed, action_ordinal), DOMAIN_CRIT) % fixture.crit_bound

describe('player crit rolls — sim parity with the Move action-envelope fold', () => {
  test('a fixed spell/weapon action sequence emits the chain roll at every shared ordinal', () => {
    const chain_seed = move_turn_seed(fixture.fight)
    const sim_seed = turn_seed(fixture.fight)

    expect(chain_seed).toBe(fixture.turn_seed)
    expect(sim_seed).toBe(chain_seed)

    const chain_actions = fixture.actions.map(action => ({
      ...action,
      crit_roll: move_crit_roll(chain_seed, action.action_ordinal),
    }))
    const sim_actions = fixture.actions.map(action => {
      const crit_roll = slot_crit_roll(sim_seed, action.action_ordinal)
      return {
        ...action,
        crit_roll,
        critical: crit_at(crit_roll, fixture.crit_rate, 0),
      }
    })

    expect(chain_actions.map(({ crit_roll }) => crit_roll)).toEqual(
      fixture.actions.map(({ crit_roll }) => crit_roll),
    )
    expect(sim_actions).toEqual(chain_actions)
  })
})

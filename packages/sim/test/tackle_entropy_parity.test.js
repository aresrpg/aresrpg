// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1207 — the simulator resolves a player tackle from the exact public turn clock the Move action consumes.
import { describe, expect, test } from 'bun:test'

import { apply_move } from '../src/fight_actions.js'
import { find_entity } from '../src/fight_state.js'
import { rng_next, rng_seed } from '../src/prng.js'
import { tackle_seed, turn_seed } from '../src/turn_seed.js'

import { tackle_entropy_parity as fixture } from './fixtures/tackle_entropy_parity.js'

const RNG_SENTINEL = rng_seed(42)

const entity = (id, cell, agility, is_player) => ({
  id,
  name: id,
  cell,
  health: 30,
  health_max: 30,
  ap: fixture.contest.ap,
  ap_max: fixture.contest.ap,
  mp: fixture.contest.mp,
  mp_max: fixture.contest.mp,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'tackle-parity',
  level: 1,
  stats: { agility },
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

const state_of = () => ({
  fight_id: 'tackle-entropy-parity',
  started: true,
  rng: RNG_SENTINEL,
  turn_rng: RNG_SENTINEL,
  next_id: 1,
  team0: [
    entity('mover', { x: 5, y: 5 }, fixture.contest.runner_agility, true),
  ],
  team1: [
    entity('locker', { x: 4, y: 5 }, fixture.contest.locker_agility, false),
  ],
  turn_order: ['mover'],
  current_turn_idx: 0,
  turn_number: 1,
  traps: [],
  glyphs: [],
  winner: -1,
})

const path = [
  { x: 5, y: 5 },
  { x: 6, y: 5 },
]

describe('tackle entropy parity — Move turn clock versus sim resolution', () => {
  for (const vector of fixture.cases) {
    test(vector.id, () => {
      const clock = {
        ...fixture.fight,
        turn_entropy: vector.turn_entropy,
        turn_ordinal: vector.turn_ordinal,
        slot: fixture.contest.slot,
      }
      const seed = turn_seed(clock)
      expect(seed).toBe(vector.turn_seed)
      const scratch = tackle_seed(seed, clock.slot, fixture.contest.mp)
      expect(scratch).toBe(vector.tackle_state)
      const draw = rng_next(rng_seed(scratch)).value
      expect(draw).toBe(vector.draw)
      expect(draw % fixture.contest.den).toBe(vector.roll)

      const result = apply_move(state_of(), 'mover', path, clock)
      expect(result.success, vector.id).toBe(vector.escaped)
      expect(result.tackled === true, vector.id).toBe(!vector.escaped)
      const mover = find_entity(result.state, 'mover')
      expect(mover?.ap, vector.id).toBe(vector.ap_after)
      expect(mover?.mp, vector.id).toBe(vector.mp_after)
      // A clocked contest is a scratch draw: neither the legacy capsule field nor the crank thread moves, so a
      // mob's later draws are identical whether or not a player was tackled on the way there.
      expect(
        result.state.turn_rng,
        `${vector.id}: a clocked tackle must not advance the crank thread`,
      ).toBe(RNG_SENTINEL)
      expect(result.state.rng, `${vector.id}: state.rng is legacy`).toBe(
        RNG_SENTINEL,
      )
    })
  }
})

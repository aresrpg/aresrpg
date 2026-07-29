// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1743 parity instrument: fold one multi-cell attempt through the real sim reducer, then compare it with the
// verdict derived symbolically from the Move sources. This test never executes chain code.
import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { rng_next, rng_seed } from '../src/prng.js'
import { create_fight_state, reduce } from '../src/reduce.js'
import { tackle_seed, turn_seed } from '../src/turn_seed.js'

import { tackle_rollback_parity as fixture } from './fixtures/tackle_rollback_parity.js'

const entity_of = ({ id, cell, agility, ap = 6, mp = 3, is_player }) => ({
  id,
  name: id,
  cell,
  health: 30,
  health_max: 30,
  ap,
  ap_max: ap,
  mp,
  mp_max: mp,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'tackle-rollback-parity',
  level: 1,
  stats: { agility },
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

const arena = {
  width: 7,
  height: 7,
  cells: new Uint8Array(49),
  spawns_a: [],
  spawns_b: [],
}

const state_of = () => {
  const runner = entity_of({ ...fixture.runner, is_player: true })
  const state = create_fight_state({
    fight_id: 'tackle-rollback-parity',
    arena_seed: 1743,
    arena_radius: 0,
    arena,
    team0: [runner],
    team1: fixture.lockers.map(locker =>
      entity_of({ ...locker, is_player: false }),
    ),
  })
  return {
    ...state,
    started: true,
    turn_order: [runner.id],
    current_turn_idx: 0,
  }
}

const derive_move_verdict = () => {
  // spell_formula.move: dodge = agility/10 + 2; every locker contributes
  // min(2 * (locker_agility/10 + 2), dodge) / (2 * (locker_agility/10 + 2)).
  const dodge = Math.floor(fixture.runner.agility / 10) + 2
  const fraction = fixture.lockers.reduce(
    ({ num, den, locker_denominators }, locker) => {
      const locker_den = 2 * (Math.floor(locker.agility / 10) + 2)
      return {
        num: num * Math.min(locker_den, dodge),
        den: den * locker_den,
        locker_denominators: [...locker_denominators, locker_den],
      }
    },
    { num: 1, den: 1, locker_denominators: [] },
  )
  const public_turn_seed = turn_seed(fixture.clock)
  const scratch = tackle_seed(
    public_turn_seed,
    fixture.clock.slot,
    fixture.runner.mp,
  )
  const draw = rng_next(rng_seed(scratch)).value
  const roll = draw % fraction.den
  const escaped = roll < fraction.num
  const mp_lost = escaped
    ? 0
    : Math.ceil(
        (fixture.runner.mp * (fraction.den - fraction.num)) / fraction.den,
      )
  return {
    path_cost: fixture.attempted_path.length,
    dodge,
    locker_denominators: fraction.locker_denominators,
    num: fraction.num,
    den: fraction.den,
    turn_seed: public_turn_seed,
    tackle_seed: scratch,
    draw,
    roll,
    escaped,
    allowed_cells: escaped ? fixture.attempted_path : [fixture.runner.cell],
    mp_after: fixture.runner.mp - mp_lost,
    mp_spent: mp_lost,
    attempted_movement_rolled_back: !escaped,
  }
}

describe('#1743 tackled movement rollback parity instrument', () => {
  test('sim reducer and symbolically derived Move verdict agree', () => {
    const move_verdict = derive_move_verdict()
    expect(move_verdict).toEqual(fixture.move_verdict)

    const result = reduce(
      state_of(),
      {
        type: 'move',
        entity_id: fixture.runner.id,
        path: fixture.attempted_path,
        turn_context: fixture.clock,
      },
      { arena, spell_templates: new Map() },
    )
    const moved = result.events.find(event => event.type === 'fight_moved')
    const runner = find_entity(result.state, fixture.runner.id)
    const sim_verdict = {
      escaped: moved?.tackled === false,
      allowed_cells: moved?.path,
      mp_after: runner?.mp,
      mp_spent: fixture.runner.mp - (runner?.mp ?? fixture.runner.mp),
      attempted_movement_rolled_back:
        runner?.cell.x === fixture.runner.cell.x &&
        runner?.cell.y === fixture.runner.cell.y,
    }

    expect(sim_verdict).toEqual({
      escaped: move_verdict.escaped,
      allowed_cells: move_verdict.allowed_cells,
      mp_after: move_verdict.mp_after,
      mp_spent: move_verdict.mp_spent,
      attempted_movement_rolled_back:
        move_verdict.attempted_movement_rolled_back,
    })
  })
})

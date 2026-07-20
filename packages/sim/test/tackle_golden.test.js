// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TACKLE golden parity — Move↔sim contract over test/vectors/tackle_golden.json (ids twin
// aresrpg_foundation::spell_formula t_tackle_* + aresrpg_fight::tackle_tests, where the SAME numbers are
// asserted through the real on-chain act_move/crank doors). Three layers:
//   1. pure contest/loss math (fight_tackle.js — the exact fraction the reduce path applies)
//   2. the chain roll derivation mirror (turn_seed.js tackle_seed → prng rng_next → roll) — the client's
//      preview of a chain fight's tackle outcome, byte-for-byte
//   3. the reduce-level behavior on the sim's own rng thread (apply_move: denial + pool loss + event fields)
import { describe, expect, test } from 'bun:test'

import { apply_move } from '../src/fight_actions.js'
import { tackle_contest, tackle_losses } from '../src/fight_tackle.js'
import { find_entity } from '../src/fight_state.js'
import { mix, rng_next, rng_seed } from '../src/prng.js'
import { tackle_seed, turn_seed } from '../src/turn_seed.js'

import golden from './vectors/tackle_golden.json' with { type: 'json' }

describe('tackle golden — pure contest math (Move twin: spell_formula t_tackle_*)', () => {
  test('contest fractions match the vectors', () => {
    for (const c of golden.contest_cases) {
      expect(
        tackle_contest(c.runner_agility, c.locker_agilities),
        c.id,
      ).toEqual({ num: c.num, den: c.den })
    }
  })

  test('failed-escape losses match the vectors (ceil law)', () => {
    for (const c of golden.loss_cases) {
      expect(tackle_losses(c.ap, c.mp, c.num, c.den), c.id).toEqual({
        ap_lost: c.ap_lost,
        mp_lost: c.mp_lost,
      })
    }
  })
})

describe('tackle golden — chain roll derivation (turn_seed.js mirror)', () => {
  test('tackle_seed states + first draws match the vectors', () => {
    for (const c of golden.derivation_cases) {
      const state = tackle_seed(c.turn_seed, c.slot, c.mp)
      expect(state, c.id).toBe(c.state)
      expect(rng_next(rng_seed(state)).value, c.id).toBe(c.draw)
    }
  })

  test('the engine scaffold turn seed re-derives from public fight state', () => {
    const e = golden.engine_cases
    expect(
      turn_seed({
        world_seed: e.world_seed,
        spawn_id: e.spawn_id,
        turn_deadline_ms: e.turn_deadline_ms,
        seat: e.seat,
      }),
    ).toBe(e.turn_seed)
  })

  test('every engine case replays the chain outcome from the client mirror', () => {
    // These exact numbers passed on-chain through the REAL act_move door (tackle_tests) — the client
    // preview must land on the identical escaped/loss verdicts from nothing but public fight state.
    const root = golden.engine_cases.turn_seed
    for (const c of golden.engine_cases.cases) {
      const state = tackle_seed(root, c.slot, c.mp)
      expect(state, c.id).toBe(c.state)
      const draw = rng_next(rng_seed(state)).value
      expect(draw, c.id).toBe(c.draw)
      const { num, den } = tackle_contest(c.runner_agility, c.locker_agilities)
      expect({ num, den }, c.id).toEqual({ num: c.num, den: c.den })
      const roll = draw % den
      expect(roll, c.id).toBe(c.roll)
      expect(roll < num, c.id).toBe(c.escaped)
      if (!c.escaped) {
        expect(tackle_losses(c.ap, c.mp, num, den), c.id).toEqual({
          ap_lost: c.ap_lost,
          mp_lost: c.mp_lost,
        })
      }
    }
  })

  test('the mob orientation pins its thread-independent contest surface', () => {
    const m = golden.engine_cases.mob_case
    const { num, den } = tackle_contest(m.runner_agility, m.locker_agilities)
    expect({ num, den }).toEqual({ num: m.num, den: m.den })
    expect(tackle_losses(m.ap, m.mp, num, den)).toEqual({
      ap_lost: m.ap_lost,
      mp_lost: m.mp_lost,
    })
  })

  test('DOMAIN_TACKLE is pinned (tackle_seed folds it last)', () => {
    // tackle_seed(seed, slot, mp) == mix(mix(mix(seed, slot), mp), DOMAIN) — re-derive with the JSON tag.
    expect(tackle_seed(1, 2, 3)).toBe(
      mix(mix(mix(1, 2), 3), golden.domain_tackle),
    )
  })
})

describe('tackle golden — reduce-level behavior (the sim rng thread)', () => {
  const entity = (id, cell, agility, is_player) => ({
    id,
    name: id,
    cell,
    health: 30,
    health_max: 30,
    ap: 6,
    ap_max: 6,
    mp: 3,
    mp_max: 3,
    ap_used: 0,
    mp_used: 0,
    is_player,
    template_id: 'senshi',
    level: 1,
    stats: { strength: 0, intelligence: 0, chance: 0, agility },
    effects: [],
    deck: [],
    hand: [],
    discard: [],
    spell_levels: {},
    ap_reserve: 0,
  })
  const state_of = (seed, mover_agi, enemy_agi) => ({
    fight_id: 'tackle-golden',
    started: true,
    rng: rng_seed(seed),
    next_id: 1,
    team0: [entity('mover', { x: 5, y: 5 }, mover_agi, true)],
    team1: [entity('locker', { x: 4, y: 5 }, enemy_agi, false)],
    turn_order: [],
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

  test('seed42_den4_escapes: roll 0 < num 2 — the move completes', () => {
    const [c] = golden.sim_thread_cases
    const res = apply_move(state_of(c.rng_seed, 0, 0), 'mover', path)
    expect(res.success).toBe(true)
    expect(res.tackled).toBeUndefined()
    expect(find_entity(res.state, 'mover')?.cell).toEqual({ x: 6, y: 5 })
  })

  test('seed42_den24_boundary_tackles: roll 12 ≥ num 12 — denied at the exact boundary, pools bitten', () => {
    const [, c] = golden.sim_thread_cases
    const res = apply_move(state_of(c.rng_seed, 100, 100), 'mover', path)
    expect(res.success).toBe(false)
    expect(res.tackled).toBe(true)
    expect(res.error).toBe('TACKLED')
    const caught = find_entity(res.state, 'mover')
    expect(caught?.cell).toEqual({ x: 5, y: 5 })
    // lost fraction 12/24 of (ap 6, mp 3) → ceil 3 AP + ceil 1.5 = 2 MP (the exact_half_rounds_up vector).
    expect(caught?.ap).toBe(3)
    expect(caught?.mp).toBe(1)
  })
})

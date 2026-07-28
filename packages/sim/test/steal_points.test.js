// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { find_entity } from '../src/fight_state.js'
import { K_STEAL_POINTS, TF_NOT_TEAM } from '../src/spell_effect.js'

import { single_effect_spell } from './spell_effect_conformance_matrix.js'

// #1477 RED — an MP STEAL debits the target but its CASTER-CREDIT half never reaches the client.
//
// LIVE REPRO (owner, hack-mode fight vs a Talokan Tidelord): the target renders −1 MP · 1 turn, NO +MP ever
// renders on the caster's row, and a base+1 walk funded by the stolen point is accepted by the board and then
// ROLLED BACK at turn end.
//
// THE TWIN, ADJUDICATED. The chain credits the caster (cast.move:1200/1328 `give_caster_points` → :1925 →
// `participant::give_points` / `mob::give_points`, uncapped) and its own walk validation spends that credited
// pool (actions.move:45 reads `participant::mp`, :62 hands it to `movement::walk`), so a base+1 walk after a
// landed steal IS legal on chain. Two sim-side deviations break the client on top of that truth:
//
//   ① THE CONTEST POOL. `cast::resolve_drain` contests the removal against the target's REFILL BASE — it feeds
//      `remove_points_with_rolls(.., current: base, max: base)` where base is `participant::base_mp` /
//      `mob::kit_base_mp` (cast.move:1880-1895): "`removed` is what the drain denies the target's NEXT refill,
//      independent of how spent the pool happens to be right now". The sim fed the LIVE residual instead, so
//      every drain on an already-spent target (the ordinary mid-fight case — a mob refills only on its own turn)
//      removed LESS than the chain removed, and the caster was credited less than the chain credited.
//   ② THE RECEIPT. The steal's caster credit was applied to sim STATE but never STATED on the receipt, so every
//      event-sourced surface was blind to it: `sim_chain_events.js` mints the fold's `Granted` from a pool
//      STAT_BUFF row (there was none), `inputs.js` folds `Granted` (never arrived), and the HUD chip + the
//      projected movement budget both read that fold. Prediction rebasing onto canonical truth therefore ATE the
//      stolen point — the #952 class, same shape, the GIVE_POINTS twin already fixed.

const flat_arena = (width = 21) => ({
  width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [{ x: 5, y: 5 }],
  spawns_b: [{ x: 7, y: 5 }],
})

const steal_spell = value =>
  single_effect_spell(
    'steal_mp',
    {
      kind: K_STEAL_POINTS,
      stat: 1, // spell_effect::POINT_MP
      value,
      turns: 1,
      target_filter: TF_NOT_TEAM,
    },
    3,
    false,
  )

const make_entity = (id, cell, is_player, overrides = {}) => ({
  id,
  name: id,
  cell,
  health: 100,
  health_max: 100,
  ap: 10,
  ap_max: 10,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'steal',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0, strength: 0 },
  effects: [],
  spell_levels: { steal_mp: 1 },
  ap_reserve: 0,
  ...overrides,
})

/** A started fight whose only spell is the steal under test. */
const started = (value, target_overrides = {}) => {
  const arena = flat_arena()
  const ctx = {
    spell_templates: new Map([['steal_mp', steal_spell(value)]]),
    arena,
  }
  const state = create_fight_state({
    fight_id: 'steal',
    arena_seed: 1,
    arena_radius: arena.radius,
    arena,
    team0: [make_entity('p0', { x: 5, y: 5 }, true)],
    team1: [make_entity('m0', { x: 7, y: 5 }, false, target_overrides)],
  })
  return { state: reduce(state, { type: 'start' }, ctx).state, ctx }
}

const cast_steal = (state, ctx) =>
  reduce(
    state,
    {
      type: 'cast',
      entity_id: 'p0',
      spell_id: 'steal_mp',
      target: { x: 7, y: 5 },
    },
    ctx,
  )

describe('#1477 — MP steal: the caster credit is real, stated, and spendable', () => {
  test('the contest reads the target REFILL BASE, not its live residual (cast.move:1880-1895)', () => {
    // The mob already spent its turn: 1 MP left of a 3 MP refill base. The chain contests against the BASE, so a
    // 2-point steal removes 2 (the target's next refill is denied 2) and the caster is credited 2.
    const { state, ctx } = started(2, { mp: 1 })
    const after = cast_steal(state, ctx).state
    const target = find_entity(after, 'm0')
    const caster = find_entity(after, 'p0')
    const debt = target.effects.find(
      e => e.type === 'STAT_DEBUFF' && e.stat === 'mp',
    )
    expect(
      debt,
      'no MP debt row on the target — the drain did not land',
    ).toBeDefined()
    expect(debt.value).toBe(2) // chain: min(requested, base) = 2, NOT min(requested, live) = 1
    expect(target.mp).toBe(0) // the live half floors at what the pool still holds
    expect(caster.mp).toBe(5) // 3 base + the 2 actually stolen
  })

  test('the receipt STATES the caster credit — the row the client folds as `Granted`', () => {
    const { state, ctx } = started(1)
    const { effects } = cast_steal(state, ctx).events.find(
      e => e.type === 'fight_cast',
    )
    expect(effects).toContainEqual(
      expect.objectContaining({
        target_id: 'p0',
        status: 'STAT_BUFF',
        stat: 'mp',
        value: 1,
      }),
    )
    // …and the target's debit still rides the same receipt (both halves, one statement).
    expect(effects).toContainEqual(
      expect.objectContaining({
        target_id: 'm0',
        status: 'STAT_DEBUFF',
        stat: 'mp',
        value: 1,
      }),
    )
  })

  test('the stolen point is SPENDABLE: base+1 cells resolve without a rollback', () => {
    const { state, ctx } = started(1)
    const cast = cast_steal(state, ctx)
    expect(find_entity(cast.state, 'p0').mp).toBe(4) // 3 base + 1 stolen
    const walked = reduce(
      cast.state,
      { type: 'move', entity_id: 'p0', path: [{ x: 5, y: 9 }] }, // 4 cells — base+1
      ctx,
    )
    const moved = walked.events.find(e => e.type === 'fight_moved')
    expect(moved.tackled).toBe(false)
    expect(moved.path).toHaveLength(4)
    expect(moved.mp_remaining).toBe(0)
    expect(find_entity(walked.state, 'p0').cell).toEqual({ x: 5, y: 9 })
  })
})

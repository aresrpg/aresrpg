// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #974 — "mob AI stays fully passive: never approaches, never steps on a placed trap". This is the SIM-side
// adjudication of that report, over the exact shape it describes: 1 player + 2 mobs, several rounds.
//
// THE CHAIN IS THE SPEC and it has no aggro gate: `turns.move resolve_mob_turn` (turns.move:281-299) feeds every
// living VISIBLE player cell to `mob::decide_turn` and then walks with `move_budget = mob::mp(...)` — a mob closes
// the distance its MP pays for, from any distance. `fight_ai.js` is that twin, and these tests hold it to the
// same outcome, so "the mobs never moved" can never be a sim-policy fact.
//
// MP 0 is the ONE case where standing still is correct — nothing to walk with (the chain's `movement::walk`
// budget is the same number).
//
// An INVISIBLE target is NOT such a case any more (#1061 seat ruling, this commit). It stays true that
// `turns.move living_player_seats_and_cells` filters hidden players out of the AI input on-chain and
// `fight_ai.js nearest_enemy` filters them here — a hidden player is never APPROACHED, since no last-known-cell
// state exists. What changed is what the mob does with the empty target set: it SEARCHES, walking toward its
// spawn anchor (`search_anchor`, both twins) instead of banking a free turn.
import { describe, expect, test } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import {
  normalize_spell_templates,
  MOB_ATTACK_ID,
} from '../src/spell_templates.js'
import { find_entity, get_current_turn_entity } from '../src/fight_state.js'
import { manhattan } from '../src/combat_grid.js'

const spell_templates = normalize_spell_templates([]) // registers MOB_ATTACK_TEMPLATE

const flat_arena = (width = 21) => ({
  width,
  height: width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [{ x: 1, y: 10 }],
  spawns_b: [
    { x: 19, y: 10 },
    { x: 19, y: 11 },
  ],
})

const fighter = (id, cell, is_player, { mp = 3, effects = [] } = {}) => ({
  id,
  name: id,
  cell,
  health: 900,
  health_max: 900,
  ap: 8,
  ap_max: 8,
  mp,
  mp_max: mp,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : 'mob',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [...effects],
  spell_levels: is_player ? {} : { [MOB_ATTACK_ID]: 1 },
  ap_reserve: 0,
})

const P_CELL = { x: 1, y: 10 }
const M0_CELL = { x: 15, y: 10 }
const M1_CELL = { x: 15, y: 12 }

/** A started 1-player + 2-mob fight with the seats FAR apart — the report's layout. */
const three_seat_fight = ({ mob_mp = 3, player_effects = [] } = {}) => {
  const arena = flat_arena()
  const ctx = { spell_templates, arena }
  const initial = create_fight_state({
    fight_id: 'f974',
    arena_seed: 1,
    arena_radius: arena.radius,
    arena,
    team0: [fighter('p0', P_CELL, true, { mp: 4, effects: player_effects })],
    team1: [
      fighter('m0', M0_CELL, false, { mp: mob_mp }),
      fighter('m1', M1_CELL, false, { mp: mob_mp }),
    ],
  })
  return {
    state: reduce(initial, { type: 'ready', entity_id: 'p0' }, ctx).state,
    ctx,
  }
}

/** Drive whole turns for `rounds` full cycles — the player idles, every mob folds its `ai_turn`. */
const drive = (state, ctx, turns) => {
  let next = state
  for (let step = 0; step < turns; step += 1) {
    const cur = get_current_turn_entity(next)
    if (!cur) break
    next = reduce(
      next,
      cur.is_player
        ? { type: 'end_turn', entity_id: cur.id }
        : { type: 'ai_turn', entity_id: cur.id },
      ctx,
    ).state
  }
  return next
}

const dist_to_player = (state, id) =>
  manhattan(find_entity(state, id).cell, find_entity(state, 'p0').cell)

describe('#974 mob AI closes the distance over a multi-round fight (turns.move:281-299 twin)', () => {
  test('both mobs end up STRICTLY closer to the player after one round each', () => {
    const { state, ctx } = three_seat_fight()
    const before = ['m0', 'm1'].map(id => dist_to_player(state, id))
    const after_round = drive(state, ctx, 3)
    const after = ['m0', 'm1'].map(id => dist_to_player(after_round, id))
    expect(after[0]).toBeLessThan(before[0])
    expect(after[1]).toBeLessThan(before[1])
  })

  test('over several rounds they reach the player and land damage', () => {
    const { state, ctx } = three_seat_fight()
    const start_hp = find_entity(state, 'p0').health
    const late = drive(state, ctx, 21)
    expect(dist_to_player(late, 'm0')).toBeLessThanOrEqual(1)
    expect(find_entity(late, 'p0').health).toBeLessThan(start_hp)
  })

  test('MP 0 is the ONE passive case — the walk budget is the whole story (movement::walk)', () => {
    const { state, ctx } = three_seat_fight({ mob_mp: 0 })
    const late = drive(state, ctx, 9)
    expect(find_entity(late, 'm0').cell).toEqual(M0_CELL)
    expect(find_entity(late, 'm1').cell).toEqual(M1_CELL)
  })

  test('an INVISIBLE player is never approached — the mobs SEARCH toward their spawn anchor instead (#1061)', () => {
    const { state, ctx } = three_seat_fight({
      player_effects: [
        {
          id: 'hidden',
          type: 'INVISIBILITY',
          timing: 'TURN_START',
          source_id: 'p0',
          value: 0,
          turns_remaining: 9,
        },
      ],
    })
    const late = drive(state, ctx, 9)
    // #1061 SEALED REVERSAL (seat ruling, cited in this commit): this used to assert both mobs stand on their
    // start cells forever — the reading #974 adjudicated as correct passivity. The ruling repeals it: an
    // invisibility buys repositioning pressure, never free turns. The property that actually mattered is
    // asserted below and is STRONGER than the old one — the mobs walk to the observation-free landmark and
    // never once close on the hidden player, which no amount of standing still could have proven.
    const [anchor] = flat_arena().spawns_b
    for (const [id, from] of [
      ['m0', M0_CELL],
      ['m1', M1_CELL],
    ]) {
      const { cell } = find_entity(late, id)
      expect(cell).not.toEqual(from)
      expect(manhattan(cell, anchor)).toBeLessThan(manhattan(from, anchor))
      expect(manhattan(cell, P_CELL)).toBeGreaterThanOrEqual(
        manhattan(from, P_CELL),
      )
    }
  })
})

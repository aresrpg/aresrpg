// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #973 — THE STATUS-DURATION SCOPE ORACLE. The reported symptom ("a 3-turn status is gone at the caster's next
// own turn, the counter never rendering 2") reads as a duration ticking on EVERY seat's turn: with 1 player +
// 2 mobs that burns 3 in one round. This file pins the sim to the CHAIN's scope so that reading can never
// become true here.
//
// THE CHAIN IS THE SPEC. `turns.move` hands the tick ONE actor at a time — `forfeit_current` (turns.move:167)
// and `resolve_mob_turn` (turns.move:316) both call `cast::tick_turn_end(fight, is_mob, idx)` for the actor
// whose turn ENDS, and that call decrements `spell_board::decrement_fighter_statuses(fx, fid)` (cast.move:1585) —
// the rows of THAT fighter and nobody else. A 3-turn row therefore burns exactly ONE tick per ROUND.
//
// The sim already holds that scope: `process_turn_effects` (fight_actions.js:440) decrements one entity's
// `effects`, and `advance_to_actor` (reduce.js:672) runs it only for the actor whose turn begins. These tests
// are the LOCK on it — the phase differs from the chain's by design (the sim ticks on the owner's turn START,
// the chain on its turn END), but the SCOPE and the lifetime are identical: three usable turns, one tick each.
import { describe, expect, test } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import {
  normalize_spell_templates,
  MOB_ATTACK_ID,
} from '../src/spell_templates.js'
import { find_entity, get_current_turn_entity } from '../src/fight_state.js'
import { K_INVISIBILITY, TF_ONLY_CASTER } from '../src/spell_effect.js'

const MP_BUFF_ID = 'mp_buff3'
const INVIS_ID = 'vanish_probe'

// The player half of the reported cast: `+1 MP · 3 turns`, authored JSON run through the REAL normalizer.
const SPELLS_JSON = {
  senshi: {
    [MP_BUFF_ID]: {
      name: 'MP Buff 3t',
      description: 'self +1 MP for 3 turns',
      levels: [
        {
          cost: 1,
          range: [0, 0],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          modifiable_range: false,
          line_of_sight: false,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'add',
              statistic: 'mp',
              min: 1,
              max: 1,
              target: 'cell',
              chance: 100,
              turns: 3,
            },
          ],
          critical_effects: [],
        },
      ],
    },
  },
}

const spell_templates = normalize_spell_templates(SPELLS_JSON)
// The other half — `Become invisible · 3 turns` (kind 27). Registered RAW so the kind survives verbatim, the
// shape `mob_ai_close_attack.test.js` uses for a kit template.
spell_templates.set(INVIS_ID, {
  id: INVIS_ID,
  name: 'Vanish (probe)',
  description: 'self invisibility for 3 turns',
  levels: [
    {
      cost: 1,
      range: [0, 0],
      critical_chance: 0,
      area: 0,
      area_type: 'CIRCLE',
      casts_per_turn: 255,
      casts_per_target: 255,
      cooldown_turns: 0,
      modifiable_range: false,
      line_of_sight: false,
      linear: false,
      free_cell: false,
      base_effects: [
        {
          type: 'INVISIBILITY',
          kind: K_INVISIBILITY,
          value: 1,
          turns: 3,
          target: 'self',
          target_filter: TF_ONLY_CASTER,
          chance: 100,
        },
      ],
      crit_effects: [],
    },
  ],
})

const DECK = [MP_BUFF_ID, INVIS_ID]

const flat_arena = (width = 21) => ({
  width,
  height: width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [
    { x: 1, y: 10 },
    { x: 1, y: 11 },
  ],
  spawns_b: [
    { x: 19, y: 10 },
    { x: 19, y: 11 },
  ],
})

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell,
  health: 500,
  health_max: 500,
  ap: 10,
  ap_max: 10,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : 'mob',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  deck: is_player ? [...DECK] : [],
  hand: is_player ? [...DECK] : [MOB_ATTACK_ID],
  discard: [],
  spell_levels: is_player
    ? Object.fromEntries(DECK.map(id => [id, 1]))
    : { [MOB_ATTACK_ID]: 1 },
  ap_reserve: 0,
})

/** A started 1-player + 2-mob fight — the seat count that makes a per-TURN tick burn 3 in one round. */
const three_seat_fight = () => {
  const arena = flat_arena()
  const ctx = { spell_templates, arena }
  const initial = create_fight_state({
    fight_id: 'f973',
    arena_seed: 1,
    arena_radius: arena.radius,
    arena,
    team0: [fighter('p0', { x: 1, y: 10 }, true)],
    team1: [
      fighter('m0', { x: 19, y: 10 }, false),
      fighter('m1', { x: 19, y: 11 }, false),
    ],
  })
  const started = reduce(initial, { type: 'ready', entity_id: 'p0' }, ctx).state
  // The interleave can open on a mob (2 mobs vs 1 player): fold mob turns until the caster holds the turn.
  return { state: drive_mobs(started, ctx), ctx }
}

/** Fold `ai_turn` (the sim's mob door) until `p0` holds the turn again. */
const drive_mobs = (state, ctx) => {
  let next = state
  for (let guard = 0; guard < 8; guard += 1) {
    const cur = get_current_turn_entity(next)
    if (!cur || cur.id === 'p0') break
    next = reduce(next, { type: 'ai_turn', entity_id: cur.id }, ctx).state
  }
  return next
}

/** One full ROUND from the caster's turn: p0 ends, every mob acts, p0 lands again. */
const cycle_to_player = (state, ctx) =>
  drive_mobs(
    reduce(state, { type: 'end_turn', entity_id: 'p0' }, ctx).state,
    ctx,
  )

const cast_self = (state, ctx, spell_id) =>
  reduce(
    state,
    { type: 'cast', entity_id: 'p0', spell_id, target: { x: 1, y: 10 } },
    ctx,
  ).state

const row_of = (state, id, type) =>
  find_entity(state, id).effects.find(effect => effect.type === type)

describe("#973 status durations tick on the OWNER's turn only (cast.move:1585 scope)", () => {
  test('a 3-turn MP status survives one full round with 2 turns remaining', () => {
    const { state, ctx } = three_seat_fight()
    expect(get_current_turn_entity(state).id).toBe('p0')

    const cast = cast_self(state, ctx, MP_BUFF_ID)
    expect(row_of(cast, 'p0', 'STAT_BUFF').turns_remaining).toBe(3)

    const round = cycle_to_player(cast, ctx)
    expect(get_current_turn_entity(round).id).toBe('p0')
    // Two mob turns resolved in between; a per-TURN tick would have burned all three.
    expect(row_of(round, 'p0', 'STAT_BUFF').turns_remaining).toBe(2)
  })

  test('a 3-turn INVISIBILITY (the reported kind 27) burns one tick per ROUND, not per seat', () => {
    const { state, ctx } = three_seat_fight()
    let cur = cast_self(state, ctx, INVIS_ID)
    expect(row_of(cur, 'p0', 'INVISIBILITY').turns_remaining).toBe(3)

    const seen = []
    for (let round = 0; round < 4; round += 1) {
      cur = cycle_to_player(cur, ctx)
      seen.push(row_of(cur, 'p0', 'INVISIBILITY')?.turns_remaining ?? 0)
    }
    // The counter RENDERS 2 then 1 before it is purged — three usable turns, exactly the chain's lifetime.
    expect(seen).toEqual([2, 1, 0, 0])
  })

  test("a mob's whole turn never ticks the PLAYER's rows (per-fighter scope)", () => {
    const { state, ctx } = three_seat_fight()
    const cast = cast_self(state, ctx, MP_BUFF_ID)
    let cur = reduce(cast, { type: 'end_turn', entity_id: 'p0' }, ctx).state
    const mob = get_current_turn_entity(cur).id
    cur = reduce(cur, { type: 'ai_turn', entity_id: mob }, ctx).state
    expect(row_of(cur, 'p0', 'STAT_BUFF').turns_remaining).toBe(3)
  })

  test("a mob's OWN 3-turn row ticks on its own turn only — the scope is side-symmetric", () => {
    const { state, ctx } = three_seat_fight()
    // Same probe from the mob side: give m0 the row directly, then walk a full round.
    const seeded = {
      ...state,
      team1: state.team1.map(entity =>
        entity.id === 'm0'
          ? {
              ...entity,
              effects: [
                {
                  id: 'probe',
                  type: 'INVISIBILITY',
                  timing: 'TURN_START',
                  source_id: 'm0',
                  value: 0,
                  turns_remaining: 3,
                },
              ],
            }
          : entity,
      ),
    }
    const round = cycle_to_player(seeded, ctx)
    expect(row_of(round, 'm0', 'INVISIBILITY').turns_remaining).toBe(2)
  })
})

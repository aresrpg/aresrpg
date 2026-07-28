// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// GLYPH-CADENCE CHAIN ANCHOR (#1540) — a CROSS-TWIN pin, deliberately NOT a sim self-recording.
//
// The expectations below are transcribed from the MOVE SOURCE, not from the sim's own behaviour (that
// blindness is #1052: the replay fixtures are sim recordings, so a sim-vs-Move cadence divergence cannot
// fail them by construction). What the chain does, read at the site:
//
//   · `packages/move/engine/sources/cast.move:1691-1712` — `tick_turn_end(fight, is_mob, idx)` runs the
//     end-phase board work for ONE fighter. Its `is_mob` arm (`:1705-1706`) only refreshes mob stats; the
//     non-mob arm calls `spell_board::decrement_glyphs(fight::fx_mut(fight))` at `:1708`. That call is the
//     ONE home of glyph duration on chain (`grep decrement_glyphs packages/move/engine/sources` → 1 hit).
//     The header at `:1691-1692` declares the anchor: "Glyph DURATIONS tick on player turn-ends".
//   · `packages/move/engine/sources/turns.move:167` — `forfeit_current` (the single door every player turn
//     end goes through: pass, crank, active-abandon) calls `cast::tick_turn_end(fight, false, idx)`.
//   · `packages/move/engine/sources/turns.move:280` and `:321` — a mob turn ends with
//     `cast::tick_turn_end(fight, true, midx)`, i.e. the `is_mob` arm: NO glyph decrement.
//   · `packages/move/engine/sources/turns.move:213-247` — a seat that is dead, or that the turn-START tick
//     kills, is stepped over by `resolve_from` and never reaches a turn end: no decrement for it either.
//
// So the canonical clock is the PLAYER-TURN ordinal, never the global turn ordinal — in the commonest fight
// shape in the game (1 player vs N mobs) the global ordinal advances N+1 times per round and would price a
// 3-turn glyph as dead after one round.

import { describe, test, expect } from 'bun:test'

import { reduce, create_fight_state } from '../src/reduce.js'
import { normalize_spell_templates } from '../src/spell_templates.js'
import { get_current_turn_entity } from '../src/fight_state.js'

const flat_arena = (width = 11) => ({
  width,
  radius: (width - 1) / 2,
  center: { x: (width - 1) / 2, y: (width - 1) / 2 },
  cells: new Uint8Array(width * width),
  spawns_a: [
    { x: 1, y: 5 },
    { x: 1, y: 6 },
  ],
  spawns_b: [
    { x: 9, y: 5 },
    { x: 9, y: 6 },
  ],
})

// A single 3-turn glyph spell, through the REAL normalizer so the reducer sees exactly what ships.
const spell_templates = normalize_spell_templates({
  senshi: {
    glyph3: {
      name: 'Glyph',
      description: 'a persistent zone that lives three player turns',
      levels: [
        {
          cost: 3,
          range: [1, 8],
          critical_chance: 0,
          area: 0,
          area_type: 'circle',
          modifiable_range: false,
          line_of_sight: true,
          linear: false,
          free_cell: false,
          base_effects: [
            {
              type: 'glyph',
              min: 5,
              max: 5,
              element: 'fire',
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
})

const make_entity = (id, cell, is_player, spells) => ({
  id,
  name: id,
  cell,
  health: 400,
  health_max: 400,
  ap: 10,
  ap_max: 10,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: 'senshi',
  level: 1,
  stats: { agility: 0, intelligence: 0, range: 0 },
  effects: [],
  spell_levels: spells,
  ap_reserve: 0,
})

/** ONE player against TWO mobs — the shape where the three clocks disagree most loudly (#1540's table). */
const pvm_fight = () => {
  const arena = flat_arena()
  const ctx = { spell_templates, arena }
  const state = create_fight_state({
    fight_id: 'f',
    arena_seed: 7,
    arena_radius: arena.radius,
    arena,
    // The mobs hold an EMPTY spell book on purpose: they walk, they never cast, so `state.glyphs` holds
    // exactly the one glyph under test and its lifetime is the only thing this pin measures.
    team0: [make_entity('p0', { x: 4, y: 5 }, true, { glyph3: 1 })],
    team1: [
      make_entity('m0', { x: 9, y: 5 }, false, {}),
      make_entity('m1', { x: 9, y: 6 }, false, {}),
    ],
  })
  // The §17.28 interleave centers the minority side, so the queue opens on a mob (m0, p0, m1): walk to the
  // player's own turn, which is the only place a glyph can be cast from.
  let acc = reduce(state, { type: 'start' }, ctx).state
  for (let i = 0; i < 4 && !get_current_turn_entity(acc)?.is_player; i++)
    acc = end_current_turn(acc, ctx).state
  return { state: acc, ctx }
}

/** End the CURRENT actor's turn, whoever it is (a player passes, a mob plays its AI turn). */
const end_current_turn = (state, ctx) => {
  const actor = get_current_turn_entity(state)
  expect(actor).not.toBeNull()
  return {
    actor,
    ...reduce(
      state,
      actor.is_player
        ? { type: 'end_turn', entity_id: actor.id }
        : { type: 'ai_turn', entity_id: actor.id },
      ctx,
    ),
  }
}

const glyph_turns = state => state.glyphs[0]?.turns_remaining ?? 0

describe('glyph duration ticks on the CHAIN cadence: player turn-ends only (#1540)', () => {
  test('a 3-turn glyph survives every mob turn-end and dies on the 3rd PLAYER turn-end', () => {
    const { state: started, ctx } = pvm_fight()
    // Cast onto an empty cell: nobody ever stands on it, so no turn-start tick can confuse duration with damage.
    const cast = reduce(
      started,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'glyph3',
        target: { x: 2, y: 5 },
      },
      ctx,
    )
    expect(cast.state.glyphs.length).toBe(1)
    expect(glyph_turns(cast.state)).toBe(3)

    // Walk turns until the 3rd PLAYER turn has ended, recording what the glyph reads after EACH turn end.
    let acc = cast.state
    let player_turn_ends = 0
    /** @type {{ actor: string, is_player: boolean, turns_remaining: number }[]} */
    const ledger = []
    for (let i = 0; i < 20 && player_turn_ends < 3; i++) {
      const step = end_current_turn(acc, ctx)
      acc = step.state
      if (step.actor.is_player) player_turn_ends += 1
      ledger.push({
        actor: step.actor.id,
        is_player: step.actor.is_player,
        turns_remaining: glyph_turns(acc),
      })
    }
    expect(player_turn_ends).toBe(3)

    // Every MOB turn-end leaves the duration untouched (cast.move:1704-1706 — the is_mob arm never decrements).
    const mob_ends = ledger.filter(row => !row.is_player)
    expect(mob_ends.length).toBeGreaterThanOrEqual(4) // two mobs, at least two full rounds
    for (const row of mob_ends)
      expect(row.turns_remaining).toBe(
        // the reading at the previous PLAYER turn-end: 3 minus the player turn-ends seen so far
        3 - ledger.slice(0, ledger.indexOf(row)).filter(r => r.is_player).length,
      )

    // Each PLAYER turn-end spends exactly one turn of the budget (cast.move:1708 via turns.move:167).
    const player_ends = ledger.filter(row => row.is_player)
    expect(player_ends.map(row => row.turns_remaining)).toEqual([2, 1, 0])

    // ... and the 3rd one is the death: expired, dropped from the board.
    expect(acc.glyphs).toEqual([])
  })

  test('the glyph is still ALIVE after a full round of mob turns (the PvM divergence #1540 measures)', () => {
    const { state: started, ctx } = pvm_fight()
    let acc = reduce(
      started,
      {
        type: 'cast',
        entity_id: 'p0',
        spell_id: 'glyph3',
        target: { x: 2, y: 5 },
      },
      ctx,
    ).state

    // ONE round in a 1-player / 2-mob fight = 1 player turn-end + 2 mob turn-ends. The chain decrements ONCE.
    for (let i = 0; i < 3; i++) acc = end_current_turn(acc, ctx).state
    expect(acc.glyphs.length).toBe(1)
    expect(glyph_turns(acc)).toBe(2)
  })
})

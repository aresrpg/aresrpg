// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D3b — THE OPTIMISTIC MOVE OBEYS THE TACKLE TOLL (ruling #239): a failed escape is a toll, not a wall. The move
// EXECUTION path — not only the paint (D3a move_wash) — consults the SAME seed-derived contest the chain
// enforces. `next_move_tackle` mirrors ONE actions.move roll (spell_formula::tackle_seed(fight::turn_seed, slot,
// live mp) → prng::rng_next → escape iff draw % den < num), the golden-pinned sim twin. A non-null bite = the
// next move FAILS the escape, so the client predicts the sim's EXACT resolution — apply_move on a failed escape
// TAXES both pools then WALKS the survivor prefix (fight_actions.js apply_move) — folding a hit-anim/forfeit
// beat AND a survivor move beat THIS frame through the SAME 'Tackled' + 'Moved' actions the receipt folds. The
// receipt's own [Tackled, Moved] then CONFIRMS (version-purge → re-fold), never corrects. One home for the
// contest: next_move_tackle + move_wash share `tackle_roll`, no copy.
//
// Vectors reuse tackle_preview's golden mirror at deadline 90 000, seat 0, agility 40 vs 40 (num/den = 6/12),
// mp 3, ap 6:  ws=1 sid=7 slot=0 → roll 7 → FAIL → tackle_losses(6,3,6,12) = { ap_lost 3, mp_lost 2 };
//              ws=6 sid=7 slot=0 → roll 0 → ESCAPE (null, the move walks free).

import { describe, expect, test } from 'bun:test'

import { next_move_tackle, engine_view } from '../src/project.js'
import { synthetic_tackled_events, local_intent_beats, local_move_beats } from '../src/present.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const ME_CELL = 45
const ADJ_CELL = 46
const FAR_CELL = 210

const fight_object = ({ world_seed = null, spawn_id = null, adj = ADJ_CELL } = {}) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  world_seed,
  spawn_id,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: ME_CELL,
      casts_this_turn: 0,
      stats: { agility: 40 },
    },
  ],
  mobs: [
    { template: '0xabc', hp: 30, max_hp: 30, cell: adj, ap: 4, mp: 3, level: 1, stats: { agility: 40 } },
    { template: '0xabc', hp: 30, max_hp: 30, cell: FAR_CELL, ap: 4, mp: 3, level: 1, stats: { agility: 40 } },
  ],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
})

const boot = (overrides = {}) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: CHAR } }, 1000)
  store.getState().input({ type: 'snapshot', fight: fight_object(overrides), version: 5 }, 1000)
  return store
}

describe('next_move_tackle — the deterministic bite the optimistic move must obey (D3b)', () => {
  test('a FAILING next roll (ws=1) returns the EXACT chain forfeit — ap_lost 3, mp_lost 2', () => {
    expect(next_move_tackle(boot({ world_seed: 1, spawn_id: 7 }).getState())).toEqual({ ap_lost: 3, mp_lost: 2 })
  })

  test('an ESCAPING next roll (ws=6) returns null — the move walks free', () => {
    expect(next_move_tackle(boot({ world_seed: 6, spawn_id: 7 }).getState())).toBeNull()
  })

  test('no living enemy adjacent → null (a move out of everyone’s zone never contests)', () => {
    // the near mob relocated far → me at 45 locks nobody, so even the biting ws=1 seed yields no contest.
    expect(next_move_tackle(boot({ world_seed: 1, spawn_id: 7, adj: FAR_CELL - 1 }).getState())).toBeNull()
  })

  test('a seed-less view (no world_seed/spawn_id) returns null — the roll can’t be derived, the receipt rules', () => {
    expect(next_move_tackle(boot().getState())).toBeNull() // locker present, but no seeds ⇒ no deterministic roll
  })
})

describe('the optimistic tackle prediction — the toll: forfeit + hit-anim beat THEN the survivor walk', () => {
  const resolve_fighter_id = ({ is_mob, idx, character }) =>
    character != null ? String(character) : is_mob ? `mob-${Number(idx)}` : CHAR

  test('folding the predicted bite drops BOTH pools by the exact forfeit AND walks the survivor prefix', () => {
    const store = boot({ world_seed: 1, spawn_id: 7 })
    const hud = () => engine_view(store.getState()).fighters.get(CHAR)
    expect(hud().mp, 'turn-start pools paint from the snapshot').toBe(3)
    expect(hud().ap).toBe(6)

    const bite = next_move_tackle(store.getState())
    expect(bite).toEqual({ ap_lost: 3, mp_lost: 2 })

    // exactly what DungeonBoard.predict_tackle dispatches under the toll: (1) the 'Tackled' action folds the tax +
    // hit-anim beat; (2) a 'move' walks the survivor prefix — survived = 3 − 2 = 1 MP → one cell west (45→44),
    // MP 0. The Moved carries the ABSOLUTE post-tax MP (mp_left 0), the exact chain number.
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'Tackled', runner_is_mob: false, runner_idx: 0, ap_lost: bite.ap_lost, mp_lost: bite.mp_lost },
        beats: local_intent_beats(
          synthetic_tackled_events({
            fight_id: FIGHT,
            runner_is_mob: false,
            runner_idx: 0,
            ap_lost: bite.ap_lost,
            mp_lost: bite.mp_lost,
          }),
          { fight_id: FIGHT, resolve_fighter_id }
        ),
      },
      2000
    )
    store.getState().input(
      {
        type: 'intent',
        intent: { kind: 'move', character: CHAR, to_cell: ME_CELL - 1, mp_left: 0 },
        beats: local_move_beats({ fight_id: FIGHT, character: CHAR, to_cell: ME_CELL - 1, path: [{ x: 4, y: 2 }] }),
      },
      2000
    )

    // MP/AP EXACT — matches the chain's to the point: 3 − 2 tax = 1 MP, then the 1-cell walk spends it → MP 0;
    // 6 − 3 = 3 AP.
    expect(hud().mp, 'the tax then the survivor walk fold THIS frame').toBe(0)
    expect(hud().ap).toBe(3)

    const beats = store.getState().wave.flatMap((t) => t.beats)
    const tackled_i = beats.findIndex((b) => b.kind === 'tackled')
    const move_i = beats.findIndex((b) => b.kind === 'move')
    expect(tackled_i, 'the hit-anim + forfeit beat plays').toBeGreaterThanOrEqual(0)
    expect(move_i, 'and the survivor walk follows (the toll)').toBeGreaterThanOrEqual(0)
    expect(move_i, 'hit FIRST, then the walk — the beat order the receipt also folds').toBeGreaterThan(tackled_i)
    const tackled = beats[tackled_i]
    expect(tackled.payload.mp_lost).toBe(2)
    expect(tackled.payload.ap_lost).toBe(3)
    expect(tackled.payload.target_id).toBe(CHAR)
  })
})

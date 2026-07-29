// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1224 — MY next action's chain slot (`participant::casts_this_turn` at its execution) had TWO homes:
//
//   · project.js `my_next_move_slot` — the tackle seed — folded the ORDERED JOURNAL: the snapshot row as base,
//     reset by MY TurnStarted in the post-view tail, +1 per Cast of mine in that tail (drafted casts included,
//     they ride the log as intents).
//   · predict_cast.js `crit_clock_of` — the §7 crit clock — read `seat_row.casts_this_turn + draft_len`, where
//     `draft_len` came from a DIFFERENT store (use_dungeon_turn.cast_path.length). It never saw the journal, so
//     a snapshot row the tail had already superseded (a fresh turn opened, a receipt landed) priced the seed off
//     a count the chain had already reset — and the two surfaces disagreed about the same on-chain counter.
//
// The seed is `tackle_seed(turn_seed, slot, mp)` / `slot_crit_roll(turn_seed, slot)`: a wrong slot previews the
// wrong roll, which is a predicted escape against a chain bite (then the drafted move is priced from a cell the
// runner never reaches → 104 EIllegalMove) and a crit preview off a sequence the player was not shown.
import { describe, expect, test } from 'bun:test'

import { crit_clock_of } from '../src/predict_cast.js'
import { next_action_slot } from '../src/turn_action_slot.js'
import { create_fight_store } from '../src/store.js'
import { my_action_slot } from '../src/project.js'

const SEED = { world_seed: 7, spawn_id: 9, turn_entropy: 11, turn_ordinal: 4 }
const ROW = { seat: 0, casts_this_turn: 2 }
const at = (version, event_idx, row) => ({ version, event_idx, source: 'receipt', ...row })
const turn_started = (idx) => ({ kind: 'TurnStarted', is_mob: false, idx })
const cast_by = (idx) => ({ kind: 'Cast', caster_is_mob: false, caster_idx: idx })

describe("next_action_slot — the ONE fold of a seat's per-turn action counter", () => {
  test('the snapshot row is only a BASE: my TurnStarted in the tail resets it, my Casts advance it', () => {
    expect(next_action_slot({ base: 2, events: [], seat: 0 })).toBe(2)
    expect(next_action_slot({ base: 2, events: [at(5, 0, turn_started(0))], seat: 0 })).toBe(0)
    expect(next_action_slot({ base: 2, events: [at(5, 0, turn_started(0)), at(5, 1, cast_by(0))], seat: 0 })).toBe(1)
  })

  test("another seat's turn start never resets MY counter, and their casts never advance it", () => {
    expect(next_action_slot({ base: 2, events: [at(5, 0, turn_started(1)), at(5, 1, cast_by(1))], seat: 0 })).toBe(2)
  })

  test('`ahead` adds only actions that are NOT in the journal yet (a planned batch)', () => {
    expect(next_action_slot({ base: 1, events: [], seat: 0, ahead: 2 })).toBe(3)
  })
})

describe('#1224 — the crit clock composes a GIVEN slot and derives none of its own', () => {
  test('it carries the slot it is handed, and reads only the seat off the escrow row', () => {
    expect(crit_clock_of({ fight: SEED, seat_row: ROW, slot: 1 })).toEqual({ ...SEED, seat: 0, slot: 1 })
    // `casts_this_turn` on the row is NOT a slot source any more — a raw row can no longer price a roll.
    expect(crit_clock_of({ fight: SEED, seat_row: ROW, slot: 0 })?.slot).toBe(0)
  })

  test('an unknowable slot refuses the whole clock, exactly like an unknowable seed', () => {
    expect(crit_clock_of({ fight: SEED, seat_row: ROW })).toBeNull()
    expect(crit_clock_of({ fight: SEED, seat_row: ROW, slot: null })).toBeNull()
    expect(crit_clock_of({ fight: SEED, seat_row: ROW, slot: -1 })).toBeNull()
  })
})

describe('#1224 — one live store state, one slot: the crit clock and the tackle seed cannot disagree', () => {
  const FIGHT = '0x51ot'
  const ME = '0xchar_me'
  const T0 = 5_000_000
  const participant = (character, cell, casts_this_turn) => ({
    owner: '0xme',
    character,
    class: 'warrior',
    team: 0,
    hp: 50,
    max_hp: 50,
    ap: 12,
    mp: 3,
    base_ap: 12,
    base_mp: 3,
    cell,
    ready: true,
    casts_this_turn,
    weapon: null,
  })
  const fight_object = (casts_this_turn) => ({
    id: FIGHT,
    status: 1,
    width: 20,
    height: 19,
    participants: [participant(ME, 21, casts_this_turn)],
    group_template: '0xmob_t',
    group_base_ap: 6,
    group_base_mp: 3,
    mobs: [{ template: '0xmob_t', level: 3, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3 }],
    obstacles: [],
    holes: [],
    shape_mask: [],
    start_cells_a: [21],
    start_cells_b: [],
    turn_ptr: 0,
    queue: [],
    turn_deadline_ms: T0 + 30_000,
    turn_entropy: T0 + 30_000,
    turn_ordinal: 1,
    placement_deadline_ms: 0,
    world_seed: 7,
    spawn_id: 9,
    last_action_ms: 0,
  })

  test('a drafted cast advances BOTH reads by exactly one, off the same journal', () => {
    const store = create_fight_store()
    store.getState().input(
      {
        type: 'init',
        fight_id: FIGHT,
        ctx: { my_entity_id: ME, address: '0xme', beat_ctx: { grid_width: 20 } },
      },
      T0
    )
    store.getState().input({ type: 'snapshot', fight: fight_object(2), version: 2 }, T0 + 50)

    const clock_of = () => {
      const s = store.getState()
      return crit_clock_of({ fight: s.view, seat_row: s.view.escrow[0], slot: my_action_slot(s) })?.slot
    }
    expect(my_action_slot(store.getState())).toBe(2)
    expect(clock_of()).toBe(2)

    // MY drafted cast enters the ONE door as an intent; it rides the journal exactly like a receipt Cast does.
    store.getState().input({ type: 'intent', intent: { kind: 'cast', target_cell: 45, damaging: true } }, T0 + 100)

    expect(my_action_slot(store.getState())).toBe(3)
    expect(clock_of()).toBe(3)
  })
})

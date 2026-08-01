// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_open_hand.test.js — THE SEAT'S SPELLS REACH THE BAR (#949, #1012), driven through the page's real doors.
//
// RED-FIRST for #949. The report reads "a level-200 character seats with only its first 3 spells": the spell
// bar renders `fight.hand` and nothing else, and the store's `hand` is only ever written by a `hand_update`
// input, which the shim's open (init + snapshot) never sent — `snapshot_from_sim` carries no spell list on a
// participant row at all. #1012 then retired the deal itself: there is no hand and no draw, on chain or in the
// sim, so the bar's fact is the seat's WHOLE spell book and it is written once at open (and once per focus).
//
// The corpus fixture is the captured 240-row publication (spell_corpus_l2.fixture.json), so the counts
// asserted here are the shipped data sheet's own: 3 spells unlock at level 1 for every class — the exact
// count the report saw — and 20 by level 200.

import { beforeEach, describe, expect, test } from 'bun:test'
import { fight_store } from '@aresrpg/fight/store'
import { fight_view } from '@aresrpg/fight/project'
import { GRID_W, decode } from '@aresrpg/fight/los'
import { LOCAL_ADDRESS, create_sim_chain, snapshot_from_sim } from '@aresrpg/fight/sim_chain'

import { set_spell_corpus_for_test } from '../game/data/spell_corpus.js'
import { reset_fight_core } from '../test_helpers/fight_core_harness.js'

import { board_of } from './board'
import { build_start_args, class_spellbook_of } from './fight_start.js'
import { hand_update_of } from './fight_setup.js'
import { EMPTY_STAT_ALLOC, INITIAL_SIMULATOR_STATE } from './reducer'
import fixture from './spell_corpus_l2.fixture.json'

const CORPUS = fixture.rows
const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)
const FIGHT_ID = 'sim:949:1'

const MOB = {
  id: '0xmob_gronk',
  name: 'Gronk',
  element: 'earth',
  role: 'trash',
  minLevel: 10,
  maxLevel: 20,
  base_hp: 340,
  ap: 6,
  mp: 3,
}

/** The reported seat: a level-200 yajin with Snaptrap invested, no allocation, no gear. */
const character = (level) => ({
  id: 'sim_c1',
  name: 'KAELIS',
  class_id: 'yajin',
  male: true,
  level,
  stat_alloc: { ...EMPTY_STAT_ALLOC },
  spell_levels: { yajin_snaptrap: 5 },
  loadout: {},
})

const open = (level) => {
  set_spell_corpus_for_test(CORPUS)
  const built = build_start_args({
    state: {
      ...INITIAL_SIMULATOR_STATE,
      seed: SEED,
      roster: [character(level)],
      focus_id: 'sim_c1',
      placements: { [BOARD.start_cells_a[0]]: 'sim_c1' },
      mob_picks: { [BOARD.start_cells_b[0]]: { template_id: MOB.id, level: 12 } },
    },
    board: BOARD,
    item_by_id: new Map(),
    mob_by_id: new Map([[MOB.id, MOB]]),
    mob_spells_of: () => [],
  })
  expect(built.ok).toBe(true)
  const chain = create_sim_chain({ ...built.args, fight_id: FIGHT_ID })
  // The two inputs `fight_shim.start` opens a fight with — the ctx the core resolves seats through, then the
  // chain's snapshot adopted at version 1.
  const store = fight_store
  store.getState().input({
    type: 'init',
    fight_id: FIGHT_ID,
    my_key: null,
    ctx: {
      address: LOCAL_ADDRESS,
      roster: built.args.roster.map(({ id, name, class_id, level: char_level }) => ({
        id,
        name,
        classe: class_id,
        level: char_level,
      })),
      my_entity_id: 'sim_c1',
      creator: LOCAL_ADDRESS,
      spectator: false,
      run: null,
      rooms_total: 0,
      mob_names: {},
      mob_levels: {},
      mob_elements: {},
      offset: { x: 0, z: 0 },
      beat_ctx: { grid_width: GRID_W },
    },
  })
  store.getState().input({ type: 'snapshot', fight: snapshot_from_sim(chain, { now_ms: 0 }), version: 1 })
  return { built, chain, store, seat: chain.sim_state.team0[0] }
}

beforeEach(reset_fight_core)

describe('the seat carries its level into the deck', () => {
  test('a level-200 roster row decks every unlocked class spell, not the first tier', () => {
    set_spell_corpus_for_test(CORPUS)
    // 3 at level 1 is CORRECT — it is the count the report mistook for the whole deck.
    expect(class_spellbook_of(character(1), CORPUS).spell_ids.length).toBe(3)
    expect(class_spellbook_of(character(200), CORPUS).spell_ids.length).toBe(20)
  })

  test('the built seat entity fights at the roster level, on the level-scaled pool', () => {
    const { built, seat } = open(200)
    expect(built.args.team0[0].level).toBe(200)
    expect(Object.keys(seat.spell_levels).length).toBe(20)
    expect(built.args.team0[0].cell).toEqual(decode(BOARD.start_cells_a[0]))
  })
})

describe("the seat's spells reach the spell bar", () => {
  test('a level-200 seat is castable on all 20 — nothing is held back by a deal (#1012)', () => {
    const { seat } = open(200)
    expect(Object.keys(seat.spell_levels).length).toBe(20)
    expect(new Set(Object.keys(seat.spell_levels)).size).toBe(20)
  })

  // THE #949 MECHANISM, pinned: the adopted snapshot carries no spell list, so the ctx+snapshot pair the shim
  // opens with can never fill the bar on its own. If a participant row ever starts carrying one, this row is
  // the reminder that the door below stops being the only source.
  test('the adopted snapshot alone leaves the bar empty — a hand is not a snapshot fact', () => {
    const { store } = open(200)
    expect(fight_view(store.getState()).hand).toEqual([])
  })

  test('the opening hand_update puts the WHOLE spell book on the bar', () => {
    const { chain, store, seat } = open(200)
    store.getState().input({ ...hand_update_of(chain.sim_state, 'sim_c1'), fight_id: FIGHT_ID })
    const view = fight_view(store.getState())
    // ONE CARD PER BOOK ROW, dealt in the book's order — but by `name_key`, the bar's one vocabulary (#1034):
    // the seat's book is keyed by the CAST id, and `hand_one_vocabulary.test.js` owns that translation.
    expect(view.hand.length).toBe(Object.keys(seat.spell_levels).length)
    expect(view.hand.length).toBe(20)
  })

  test('a seat the chain does not hold yields no input — never a bar of undefined', () => {
    const { chain } = open(200)
    expect(hand_update_of(chain.sim_state, 'sim_nobody')).toBe(null)
  })
})

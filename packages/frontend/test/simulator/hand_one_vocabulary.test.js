// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1034 — `fight.hand` HAS ONE VOCABULARY.
//
// One store fact, two writers: the world board seeds the bar from `resolve_class_spells(...).name_key`
// (DungeonBoard.jsx) while the simulator shim seeded it from `Object.keys(seat.spell_levels)` — the
// SpellTemplate OBJECT IDs the local chain casts by (`fight_start.js cast_id_of`). Two id spaces under one
// name, and readers guessed.
//
// The chain/corpus side decides which one is load-bearing, and it already has: `name_key` is documented as
// "the arm id" (fight-spells.js), and the ONE consumer that turns an armed card into a castable row —
// `DungeonBoard`'s `my_spells.find((sp) => sp.name_key === fight.armed_spell_id)` — matches on `name_key` and
// nothing else. The simulator mounts that same board (FightHud.jsx), so an object-id hand armed a card whose
// row resolved NULL there: `active_spell` silently fell back to `my_spells[0]`, and every range / AP / crit
// gate described the class primary instead of the spell the player armed.
//
// So: `name_key` is the vocabulary, and `hand_update_of` — the shim's own boundary — converts at ITS door.
// This drives BOTH writers over one character and one corpus and asserts one consistent read.

import { beforeEach, describe, expect, test } from 'bun:test'
import { fight_store } from '@aresrpg/fight/store'
import { create_sim_chain } from '@aresrpg/fight/sim_chain'

import { set_spell_corpus_for_test } from '../../src/game/data/spell_corpus.js'
import { resolve_class_spells } from '../../src/game/screens/hud/fight-spells.js'
import { reset_fight_core } from '../../src/test_helpers/fight_core_harness.js'
import { board_of } from '../../src/simulator/board.js'
import { build_start_args } from '../../src/simulator/fight_start.js'
import { hand_update_of } from '../../src/simulator/fight_setup.js'
import { EMPTY_STAT_ALLOC, INITIAL_SIMULATOR_STATE } from '../../src/simulator/reducer.js'
import fixture from '../../src/simulator/spell_corpus_l2.fixture.json'

const CORPUS = fixture.rows
const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)
const FIGHT_ID = 'sim:1034:1'
const LEVEL = 200

const MOB = { id: '0xmob_gronk', name: 'Gronk', element: 'earth', role: 'trash', base_hp: 340, ap: 6, mp: 3 }

/** The seat both writers describe — a level-200 yajin, the full 20-spell book. */
const character = {
  id: 'sim_c1',
  name: 'KAELIS',
  class_id: 'yajin',
  male: true,
  level: LEVEL,
  stat_alloc: { ...EMPTY_STAT_ALLOC },
  spell_levels: { yajin_snaptrap: 5 },
  loadout: {},
}

/** WRITER A — the world board (DungeonBoard.jsx `hand_spells`): the class' unlocked rows by `name_key`. */
const board_hand = () => resolve_class_spells(character.class_id, LEVEL).map((spell) => spell.name_key)

/** WRITER B — the simulator shim (`fight_shim.start` → `hand_update_of`), over the real start fold. */
const shim_hand_input = () => {
  const built = build_start_args({
    state: {
      ...INITIAL_SIMULATOR_STATE,
      seed: SEED,
      roster: [character],
      focus_id: character.id,
      placements: { [BOARD.start_cells_a[0]]: character.id },
      mob_picks: { [BOARD.start_cells_b[0]]: { template_id: MOB.id, level: 12 } },
    },
    board: BOARD,
    item_by_id: new Map(),
    mob_by_id: new Map([[MOB.id, MOB]]),
    mob_spells_of: () => [],
  })
  expect(built.ok).toBe(true)
  const chain = create_sim_chain({ ...built.args, fight_id: FIGHT_ID })
  return { input: hand_update_of(chain.sim_state, character.id), seat: chain.sim_state.team0[0] }
}

beforeEach(() => {
  reset_fight_core()
  set_spell_corpus_for_test(CORPUS)
})

describe('#1034 — one store fact, one vocabulary', () => {
  test('the two writers deal the SAME hand — same ids, same order', () => {
    const { input } = shim_hand_input()
    expect(input.hand).toEqual(board_hand())
    expect(input.hand.length).toBe(20)
  })

  test("the shim's hand is name_keys, never the seat's cast-id (object id) keys", () => {
    const { input, seat } = shim_hand_input()
    const cast_ids = Object.keys(seat.spell_levels)
    // the seat's book stays object-id keyed — that IS the cast id space (`seat_spell_level` reads it) — and the
    // two spaces must not overlap, or this assertion would prove nothing.
    expect(cast_ids.length).toBe(20)
    expect(input.hand.some((id) => cast_ids.includes(id))).toBe(false)
  })

  test('every card either writer deals resolves through the ONE armed-row consumer', () => {
    const { input } = shim_hand_input()
    const my_spells = resolve_class_spells(character.class_id, LEVEL)
    // DungeonBoard.jsx `armed_row` verbatim — the read that turns an armed card into range/AP/damage truth.
    const armed_row = (armed_spell_id) => my_spells.find((sp) => sp.name_key === armed_spell_id) ?? null
    for (const card of [...board_hand(), ...input.hand]) expect(armed_row(card)).not.toBe(null)
  })

  test('the store round-trips the shim hand unchanged — the door adds no translation of its own', () => {
    const { input } = shim_hand_input()
    fight_store.getState().input({ type: 'init', fight_id: FIGHT_ID, my_key: null, ctx: {} })
    fight_store.getState().input({ ...input, fight_id: FIGHT_ID })
    expect(fight_store.getState().hand).toEqual(board_hand())
  })
})

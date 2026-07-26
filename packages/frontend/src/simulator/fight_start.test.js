// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_start.test.js — the START button's fold, DRIVEN: a real page state in, a real local chain out.
//
// RED-FIRST for #883 ⑤ — the page shipped with no way to start a fight at all, so nothing had ever taken the
// setup state to the shim's door. This drives that door: the fold's own output is handed to `create_sim_chain`
// (the exact call `fight_shim.start` makes) and the chain is asserted to open with every seat standing on the
// cell the board showed. The shim itself is not mounted here — it is an effect edge over the production
// stores; what is provable headlessly, and what was missing, is the fold.
//
// It also pins the two joins that can silently rot:
//   · TEMPLATES ARE RAW — a normalized row handed back to `normalize_spell_templates` reads as UNSUPPORTED,
//     so a deck would be full of inert spells and every cast would no-op;
//   · the DECK ID SPACE — the page persists spell levels by `name_key`, the chain templates key by their
//     authored id, so an un-re-keyed level silently fights at level 1.

import { describe, expect, test } from 'bun:test'
import { create_sim_chain } from '@aresrpg/fight/sim_chain'
import { decode } from '@aresrpg/fight/los'

import { set_spell_corpus_for_test } from '../game/data/spell_corpus.js'

import { board_of } from './board'
import { build_start_args, class_spellbook_of, START_BLOCKED } from './fight_start.js'
import { EMPTY_STAT_ALLOC, INITIAL_SIMULATOR_STATE } from './reducer'

const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)

/** One authored corpus row for a senshi spell — the RAW shape the chain normalizes and the capsule records. */
const EMBER = {
  id: '0xspell_ember',
  object_id: '0xspell_ember',
  name: 'Ember Strike',
  classType: 'senshi',
  unlock: 1,
  role: 'damage',
  element: 0,
  levels: [
    { min_char_level: 1, ap_cost: 3, range_min: 1, range_max: 4, effects: [{ kind: 0, value: 12, element: 0 }] },
    { min_char_level: 5, ap_cost: 3, range_min: 1, range_max: 5, effects: [{ kind: 0, value: 18, element: 0 }] },
  ],
}
/** A spell the roster has NOT reached — it must not enter the deck. */
const LATE = { ...EMBER, id: '0xspell_late', name: 'Late Bloom', unlock: 90 }

const character = (id, name, spell_levels = {}) => ({
  id,
  name,
  class_id: 'senshi',
  male: true,
  level: 30,
  stat_alloc: { ...EMPTY_STAT_ALLOC, vitality: 100, strength: 45 },
  spell_levels,
  loadout: {},
})

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

/** One authored mob spell (the minted SpellLevel shape world_corpus carries). */
const MOB_SPELL = { ap: 3, rmin: 1, rmax: 2, effects: [{ kind: 0, base: 9, element: 2 }] }

const state_of = ({ placed = 2, picked = 2, spell_levels = {} } = {}) => ({
  ...INITIAL_SIMULATOR_STATE,
  seed: SEED,
  roster: [character('sim_c1', 'KAELIS', spell_levels), character('sim_c2', 'VORREN')],
  focus_id: 'sim_c1',
  placements: Object.fromEntries(
    BOARD.start_cells_a.slice(0, placed).map((cell, index) => [cell, `sim_c${index + 1}`])
  ),
  mob_picks: Object.fromEntries(
    BOARD.start_cells_b.slice(0, picked).map((cell) => [cell, { template_id: MOB.id, level: 12 }])
  ),
})

const fold = (state, { mob_spells = [MOB_SPELL] } = {}) => {
  set_spell_corpus_for_test([EMBER, LATE])
  return build_start_args({
    state,
    board: BOARD,
    item_by_id: new Map(),
    mob_by_id: new Map([[MOB.id, MOB]]),
    mob_spells_of: () => mob_spells,
  })
}

describe('the START fold refuses honestly', () => {
  test('no character on the board is a REASON, never a silent no-op', () => {
    expect(fold({ ...state_of(), placements: {} })).toEqual({ ok: false, reason: START_BLOCKED.EMPTY_ROSTER })
  })

  test('an empty enemy band is its own reason', () => {
    expect(fold({ ...state_of(), mob_picks: {} })).toEqual({ ok: false, reason: START_BLOCKED.NO_MOBS })
  })
})

describe('the START fold seats the board the page is showing', () => {
  const built = fold(state_of({ spell_levels: { ember_strike: 2 } }))

  test('every placed character becomes a team0 seat on ITS cell, in ascending cell order', () => {
    expect(built.ok).toBe(true)
    expect(built.args.team0.map(({ id }) => id)).toEqual(['sim_c1', 'sim_c2'])
    expect(built.args.team0.map(({ cell }) => cell)).toEqual(
      BOARD.start_cells_a.slice(0, 2).map((cell) => decode(cell))
    )
    // the seat's pools are L1's builders, not this module's arithmetic
    expect(built.args.team0[0].health_max).toBeGreaterThan(0)
    expect(built.args.team0[0].health).toBe(built.args.team0[0].health_max)
  })

  test('every picked mob becomes a team1 seat with its BUILT hp at the picked level', () => {
    // ASCENDING CELL ORDER, not the band's own listing order: seat order IS turn order within a side, so it
    // must come from the cells themselves rather than from object-key iteration.
    expect(built.args.team1.map(({ cell }) => cell)).toEqual(
      BOARD.start_cells_b
        .slice(0, 2)
        .sort((left, right) => left - right)
        .map((cell) => decode(cell))
    )
    expect(built.args.team1.every(({ health_max }) => health_max > 0)).toBe(true)
    expect(built.args.mobs.every(({ level }) => level === 12)).toBe(true)
  })

  test('the spell book is the class spells the LEVEL has reached, at the levels the editor allocated', () => {
    const [seat] = built.args.team0
    expect(Object.keys(seat.spell_levels)).toEqual([EMBER.id])
    expect(seat.spell_levels[LATE.id]).toBeUndefined()
    // the editor stored `ember_strike: 2` (name_key); the chain reads it under the TEMPLATE id
    expect(seat.spell_levels[EMBER.id]).toBe(2)
    expect(built.args.team0[1].spell_levels[EMBER.id]).toBe(1) // untouched ⇒ the free baseline
  })

  test('templates_raw carries RAW rows — the class corpus row and every mob kit row, deduped', () => {
    const ids = built.args.templates_raw.map(({ id }) => id)
    expect(ids).toContain(EMBER.id)
    expect(ids.filter((id) => id === EMBER.id).length).toBe(1) // two senshi seats, ONE template row
    expect(ids.filter((id) => String(id).startsWith('mob_spell_')).length).toBe(2)
    // RAW, not normalized: the authored level keys survive (a normalized row would have lost `ap_cost`)
    expect(built.args.templates_raw.find(({ id }) => id === EMBER.id).levels[0].ap_cost).toBe(3)
  })

  test('the fight is fought on the board the page derived — same anchor, same layout', () => {
    expect(built.args.anchor).toEqual({ anchor_x: BOARD.anchor.x, anchor_z: BOARD.anchor.z })
    const chain = create_sim_chain({ ...built.args, fight_id: 'sim:test:1' })
    expect(chain.board.width).toBe(BOARD.width)
    expect(chain.board.height).toBe(BOARD.height)
    expect(chain.board.start_cells_a).toEqual(BOARD.start_cells_a)
    // the chain opened with every seat PLACED and the roster READY — a fight, not a stalled placement
    expect(chain.sim_state.team0.length).toBe(2)
    expect(chain.sim_state.team1.length).toBe(2)
    expect(chain.violations).toEqual([])
    // and the templates resolved: the class spell is a real castable row in the chain's ctx
    expect(chain.ctx.spell_templates.get(EMBER.id)?.levels?.length).toBe(2)
  })
})

describe('the deck join', () => {
  test('a class whose corpus row vanished contributes no deck id — never a template the ctx cannot resolve', () => {
    set_spell_corpus_for_test([])
    const deck = class_spellbook_of(character('sim_c1', 'KAELIS', { ember_strike: 3 }), [])
    expect(deck.spell_ids).toEqual([])
    expect(deck.rows).toEqual([])
  })
})

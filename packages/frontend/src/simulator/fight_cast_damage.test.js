// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_cast_damage.test.js — RED-FIRST for #931: in the simulator a committed player cast folded NOTHING.
//
// The defect was an ID-SPACE SPLIT, and only a test driven end to end could see it. The production fight board
// stages a cast as `{ kind: 1, spell_template_id: <the on-chain SpellTemplate object id> }` — that object is
// literally `act_cast`'s argument — and the simulator hands those same staged rows to the sim chain's
// `commands_from_staged`, which casts the named id verbatim. The START fold, meanwhile, keyed the local
// chain's templates, decks and spell levels by the corpus row's AUTHORED SLUG (`senshi_warcleave`). So every
// player cast named a spell the chain's ctx could not resolve: the turn committed, the AP went, no effect
// folded, no damage row came back, and the optimistic prediction rolled back to nothing. Mobs were immune —
// their ids are minted by `mob_spell_id` on both sides and the AI casts by deck id, never through the staged
// door — which is exactly why the simulator looked alive while the player's own bar did nothing.
//
// Nothing here is shaped by the code under test: the corpus rows are CAPTURED WIRE BYTES from the published
// blob (spell_corpus_wire.fixture.json carries their provenance), they enter through the page's own corpus
// seam, the fight is built by the page's own START door, and the receipt is folded by the PRODUCTION fight
// core — the same door a chain receipt enters in the live game.

import { describe, expect, test } from 'bun:test'
import { committed_state, create_fight_store } from '@aresrpg/fight/store'
import { encode } from '@aresrpg/fight/los'
import {
  commands_from_staged,
  create_sim_chain,
  current_actor,
  pending_mob_turn,
  snapshot_from_sim,
  submit_commands,
} from '@aresrpg/fight/sim_chain'

import { set_spell_corpus_for_test } from '../game/data/spell_corpus.js'

import { board_of } from './board'
import { build_start_args, class_spellbook_of } from './fight_start.js'
import { EMPTY_STAT_ALLOC, INITIAL_SIMULATOR_STATE } from './reducer'
import WIRE from './spell_corpus_wire.fixture.json'

const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)
const CLOCK = { now_ms: 1_700_000_000_000 }

const CORPUS = WIRE.rows
const WARCLEAVE = CORPUS.find((row) => row.id === 'senshi_warcleave')

/** The level-30 Senshi a player would seat — enough vitality to survive the walk in. */
const character = () => ({
  id: 'sim_c1',
  name: 'KAELIS',
  class_id: 'senshi',
  male: true,
  level: 30,
  stat_alloc: { ...EMPTY_STAT_ALLOC, vitality: 100, strength: 45 },
  spell_levels: {},
  loadout: {},
})

/** A spell-less mob: it walks in and never casts, so every hp point the target loses came from the player. */
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

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/** The page's real START door, fed the captured corpus through the corpus seam every fight surface reads. */
const start_args = (corpus = CORPUS) => {
  set_spell_corpus_for_test(corpus)
  return build_start_args({
    state: {
      ...INITIAL_SIMULATOR_STATE,
      seed: SEED,
      roster: [character()],
      focus_id: 'sim_c1',
      placements: { [BOARD.start_cells_a[0]]: 'sim_c1' },
      mob_picks: { [BOARD.start_cells_b[0]]: { template_id: MOB.id, level: 12 } },
    },
    board: BOARD,
    item_by_id: new Map(),
    mob_by_id: new Map([[MOB.id, MOB]]),
    mob_spells_of: () => [],
  })
}

/**
 * Drive the fight the way the page does — mob turns through the AI door, the seat's own turns as MOVE steps —
 * until the seat stands inside Warcleave's reach, then commit ONE cast staged exactly as the production board
 * stages it. Returns the chain history plus the cast's own batch.
 */
const walk_in_and_cast = () => {
  const built = start_args()
  const opened = create_sim_chain({ ...built.args, fight_id: 'sim:931:1' })
  const drive = (state) => {
    if (state.rounds > 60) return { ...state, exhausted: true }
    const mob_turn = pending_mob_turn(state.chain)
    if (mob_turn) {
      const stepped = submit_commands(state.chain, [{ type: 'ai_turn', entity_id: mob_turn }], CLOCK)
      if (stepped.chain.sim_state === state.chain.sim_state) return { ...state, exhausted: true }
      return drive({ ...state, chain: stepped.chain, batches: [...state.batches, stepped], rounds: state.rounds + 1 })
    }
    const actor = current_actor(state.chain)
    if (!actor) return { ...state, exhausted: true }
    const [me] = state.chain.sim_state.team0
    const [mob] = state.chain.sim_state.team1
    if (chebyshev(me.cell, mob.cell) <= 2) {
      // THE STAGED ROW, verbatim in shape: `spell_template_id` is the on-chain object id the board reads off
      // its drafted spell (`drafted_spell.object_id`), `spell_key` is the VFX handoff.
      const staged = [
        {
          kind: 1,
          spell_template_id: WARCLEAVE.object_id,
          spell_key: 'warcleave',
          target: encode(mob.cell.x, mob.cell.y),
        },
      ]
      const cast = submit_commands(state.chain, commands_from_staged(staged, actor), CLOCK)
      return { ...state, chain: cast.chain, batches: [...state.batches, cast], cast, target_hp_before: mob.health }
    }
    const walk = Array.from({ length: me.mp }).reduce(
      (acc) => {
        if (chebyshev(acc.cell, mob.cell) <= 1) return acc
        const next = {
          x: acc.cell.x + Math.sign(mob.cell.x - acc.cell.x),
          y: acc.cell.y + Math.sign(mob.cell.y - acc.cell.y),
        }
        return { cell: next, path: [...acc.path, next] }
      },
      { cell: me.cell, path: [] }
    )
    const stepped = submit_commands(
      state.chain,
      commands_from_staged(
        walk.path.map((cell) => ({ kind: 0, target: encode(cell.x, cell.y) })),
        actor
      ),
      CLOCK
    )
    if (stepped.chain.sim_state === state.chain.sim_state) return { ...state, exhausted: true }
    return drive({ ...state, chain: stepped.chain, batches: [...state.batches, stepped], rounds: state.rounds + 1 })
  }
  return {
    opened,
    ...drive({ chain: opened, batches: [], rounds: 0, cast: null, target_hp_before: 0, exhausted: false }),
  }
}

/** Fold the whole run through the PRODUCTION fight core — the door a chain receipt enters in the live game. */
const fold_through_core = (run) => {
  const store = create_fight_store()
  const { fight_id } = run.opened
  store.getState().input({
    type: 'init',
    fight_id,
    my_key: null,
    ctx: { address: '0x51m', my_entity_id: 'sim_c1', offset: { x: 0, z: 0 }, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: snapshot_from_sim(run.opened, CLOCK), version: 1 })
  for (const batch of run.batches)
    store.getState().input({ type: 'receipt', version: batch.version, receipt: batch.receipt, fight_id })
  return store
}

describe('#931 · a committed player cast lands', () => {
  const run = walk_in_and_cast()

  test('the fight opens with a spell book the board can NAME — the on-chain cast id, not the authored slug', () => {
    const [seat] = start_args().args.team0
    // MECHANISM: the id space the START fold hands the chain is the one a staged cast arrives in.
    expect(Object.keys(seat.spell_levels)).toContain(WARCLEAVE.object_id)
    expect(Object.keys(seat.spell_levels)).not.toContain(WARCLEAVE.id)
    expect(seat.spell_levels[WARCLEAVE.object_id]).toBe(1)
  })

  test('the chain resolves that id to a REAL template — captured wire effects, none of them inert', () => {
    const template = run.opened.ctx.spell_templates.get(WARCLEAVE.object_id)
    expect(template).toBeDefined()
    const effects = template.levels[0].base_effects
    expect(effects.length).toBeGreaterThan(0)
    expect(effects.every((effect) => effect.type === 'UNSUPPORTED')).toBe(false)
    expect(effects.some((effect) => effect.type === 'DAMAGE')).toBe(true)
  })

  test('BEHAVIOUR: the receipt carries a damage row for the target, and the mob loses hp', () => {
    expect(run.exhausted).toBeFalsy()
    expect(run.cast).not.toBeNull()
    const rows = run.cast.receipt.events
    expect(rows.some((row) => row.type.endsWith('Cast'))).toBe(true)
    const hits = rows.filter((row) => row.type.endsWith('Hit'))
    expect(hits.length).toBeGreaterThan(0)
    expect(Number(hits[0].parsedJson.amount)).toBeGreaterThan(0)
    expect(hits[0].parsedJson.victim_is_mob).toBe(true)
    expect(run.chain.sim_state.team1[0].health).toBeLessThan(run.target_hp_before)
  })

  test('and the PRODUCTION core folds the same loss — one observable, two folders', () => {
    const committed = committed_state(fold_through_core(run).getState())
    expect(committed.fighters.m0.hp).toBe(run.chain.sim_state.team1[0].health)
    expect(committed.fighters.m0.hp).toBeLessThan(run.target_hp_before)
  })
})

describe('#931 · a spell no cast can name is dropped LOUDLY', () => {
  test('a class row still awaiting its deployment receipt leaves the spell book and names itself', () => {
    // Not a wire-shape question — the row is the captured one with its receipt field taken away, which is
    // exactly the pre-publish corpus state.
    const { object_id: _dropped, ...receiptless } = WARCLEAVE
    const shouted = []
    const original = console.error
    console.error = (line) => shouted.push(String(line))
    try {
      const built = start_args([receiptless, ...CORPUS.filter((row) => row.id !== WARCLEAVE.id)])
      expect(Object.keys(built.args.team0[0].spell_levels)).not.toContain(WARCLEAVE.id)
    } finally {
      console.error = original
    }
    expect(shouted.length).toBe(1)
    expect(shouted[0]).toContain(WARCLEAVE.id)
  })

  test('the deck fold reports the dropped rows rather than swallowing them', () => {
    const { object_id: _dropped, ...receiptless } = WARCLEAVE
    set_spell_corpus_for_test([receiptless])
    const deck = class_spellbook_of(character(), [receiptless])
    expect(deck.spell_ids).toEqual([])
    expect(deck.uncastable).toEqual([WARCLEAVE.id])
  })
})

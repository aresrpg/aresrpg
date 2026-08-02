// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_terminal_exit.test.js — RED-FIRST for #1632: a WON simulator fight never transitioned.
//
// THE BUG, mechanically. On chain, `use_dungeon.claim()` IS the whole fight-over transition — it opens the
// result card, tears the board down and clears the session (dungeon_run_store.js `claim`). DungeonBoard fires
// it from ONE level-triggered effect the instant the killing receipt folds (`dungeon.decided_winner`,
// DungeonBoard.jsx:1111-1128). The simulator seeds that same door as `claim: async () => {}` — so the terminal
// effect fired, did nothing, and the decided fight had NO exit at all: the frozen board and its dead mob stood
// there forever while the auto-commit loop kept cycling, and the setup screen never came back.
//
// Nothing here is mocked below the page: the shim opens the real local chain, the real fight core folds every
// receipt, and the door under test is the SAME store slice DungeonBoard reads. The assertions in the first test
// are that effect's own gate, verbatim — a fight this test could not have claimed proves nothing about the exit.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

import fixture from './spell_corpus_l2.fixture.json'

const restore_browser_globals = install_browser_globals({ with_document: true, with_element: true })

afterAll(restore_browser_globals)

const { manhattan } = await import('@aresrpg/sim/combat_grid')
const { encode } = await import('@aresrpg/fight/los')
const { STATUS_WON } = await import('@aresrpg/fight/board_state')
const { fight_view } = await import('@aresrpg/fight/project')
const { fight_store } = await import('@aresrpg/fight/store')
const { set_spell_corpus_for_test } = await import('../game/data/spell_corpus.js')
const { use_dungeon } = await import('../world-shell/dungeon_store.js')
const { board_of } = await import('./board')
const { build_start_args } = await import('./fight_start.js')
const { create_fight_shim } = await import('./fight_shim.js')
const { EMPTY_STAT_ALLOC, INITIAL_SIMULATOR_STATE, normalize_character } = await import('./reducer')

const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)
/** A one-hit mob: the fight must reach a VICTORY, not measure balance. */
const MOB = {
  id: '0xmob_gronk',
  name: 'Gronk',
  element: 'earth',
  role: 'trash',
  minLevel: 1,
  maxLevel: 20,
  base_hp: 10,
  ap: 6,
  mp: 3,
}
const MOB_SPELL = { ap: 3, rmin: 1, rmax: 2, effects: [{ kind: 0, base: 1, element: 2 }] }
/** Senshi, from the shipped sheet: 'Cleaving Wrath' (range 1-3, 10 dmg) — one cast ends this mob. */
const KILL_SPELL = '0x0117'
const KILL_RANGE = [1, 3]

const state_of = () => ({
  ...INITIAL_SIMULATOR_STATE,
  seed: SEED,
  roster: [
    normalize_character({
      id: 'sim_c1',
      name: 'KAELIS',
      class_id: 'senshi',
      male: true,
      level: 200,
      stat_alloc: { ...EMPTY_STAT_ALLOC },
      spell_levels: {},
      loadout: {},
    }),
  ],
  focus_id: 'sim_c1',
  placements: { [BOARD.start_cells_a[0]]: 'sim_c1' },
  mob_picks: { [BOARD.start_cells_b[0]]: { template_id: MOB.id, level: 1 } },
})

/** Play the fight to its end through the SHIM'S OWN doors — no store is written by hand. */
const play_to_victory = async (shim, { max_turns = 60 } = {}) => {
  for (let turn = 0; turn < max_turns; turn += 1) {
    const chain = shim.chain()
    if (!chain || chain.sim_state.winner !== -1) return chain
    const [me] = chain.sim_state.team0
    const target = chain.sim_state.team1.find((mob) => mob.health > 0)
    const reach = target ? manhattan(me.cell, target.cell) : Infinity
    const staged =
      reach >= KILL_RANGE[0] && reach <= KILL_RANGE[1]
        ? [{ kind: 1, spell_template_id: KILL_SPELL, target: encode(target.cell.x, target.cell.y) }]
        : []
    const committed = await shim.commit_turn(staged)
    if (!committed && staged.length > 0) await shim.commit_turn([])
  }
  return shim.chain()
}

/** The page's session end, verbatim from `useSimFight.stop` — the ONE home for "a simulator fight is over". */
let page_phase = 'fighting'
const session = { ended: 0 }
const shim = create_fight_shim({
  engine_context: { get_state: () => ({ sui: { characters: [] } }), dispatch: () => {} },
  save: async () => {},
  schedule: (fn) => fn(), // the mob pump, run inline: a test has no macrotask clock to wait on
  on_finish: () => {
    session.ended += 1
    shim.stop()
    shim.dispose()
    page_phase = 'setup'
  },
})

set_spell_corpus_for_test(fixture.rows)
const built = build_start_args({
  state: state_of(),
  board: BOARD,
  item_by_id: new Map(),
  mob_by_id: new Map([[MOB.id, MOB]]),
  mob_spells_of: () => [MOB_SPELL],
})
if (!built.ok) throw new Error(`the fight would not start: ${built.reason}`)
const started = shim.start({ ...built.args, fight_id: 'sim:1632:1' })
if (!started.ok) throw new Error(`the fight would not start: ${started.reason}`)
const ended = await play_to_victory(shim)

describe('#1632 — a decided simulator fight transitions out instead of standing frozen forever', () => {
  test("the terminal effect's own gate is armed: a receipt-proven victory on a still-escrowed seat", () => {
    expect(ended.sim_state.winner).toBe(0) // team0 — a genuine VICTORY, not an abandon
    const { dungeon, busy } = use_dungeon.getState()
    const entity_id = fight_view(fight_store.getState())?.my_entity_id ?? null
    // DungeonBoard.jsx:1111-1128, verbatim: decided_winner ∧ still_escrowed ∧ !busy ⇒ void claim()
    expect(dungeon.status).toBe(STATUS_WON)
    expect(dungeon.decided_winner).toBe(0)
    expect((dungeon.escrow ?? []).some((p) => (p.character ?? p.character_id) === entity_id)).toBe(true)
    expect(busy).toBe(false)
  })

  test('firing that gate ENDS the session — the board is gone and the page is back at setup', async () => {
    // The exact door the board fires. Seeded as `async () => {}`, this returned and nothing ever happened.
    await use_dungeon.getState().claim()
    // THE HOLD IS REAL: the exit waits for the killing wave, so nothing has collapsed yet while beats remain.
    const wave = fight_store.getState().wave ?? []
    expect(wave.length).toBeGreaterThan(0)
    expect(session.ended).toBe(0)
    // The renderer's own ack, verbatim (store.js `presented`) — this is what drains that wave on the page.
    fight_store.getState().input({ type: 'presented', seq: Math.max(...wave.map((turn) => turn.seq)) })
    for (let i = 0; i < 5 && session.ended === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(session.ended).toBe(1)
    expect(page_phase).toBe('setup')
    // The board slice is the mount authority (phase.js derives ROAM off a null dungeon) — a gone board is the
    // observable "the mob model no longer stands there".
    expect(use_dungeon.getState().dungeon).toBe(null)
  })
})

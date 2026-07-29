// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_terminal_gate.test.js — RED-FIRST for #1056: WINNING a simulator fight turned the page BLACK.
//
// THE BUG, mechanically. The phase machine gives a WON/FAILED read a result card only when this client
// actually FOUGHT it — the D81 latch (`had_active_seat`, phase.js). On chain that latch is fired by the 4s
// poll off an ACTIVE read; the simulator has no poll and never fired it, so its own victory read failed
// `terminal_unmet` and derived EXIT instead of TERMINAL. EXIT mounts nothing (`should_mount_board`) — the whole
// fight layer unmounted — and the adapter's board_lifecycle_decision read it as 'teardown', destroying the
// frozen board while the live chain read still said WON. That is precisely the condition the adapter's
// [terminal-gate2] sentinel warns on, and a black page is what the player saw.
//
// Nothing here is mocked: the shim opens the real local chain, the real fight core folds every receipt, and the
// terminal status under test is published by the ONE projection mirror (#1646). The last two assertions are the
// ADAPTER'S reconcile head, verbatim — the same two folds that decided to tear the board down.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

import fixture from './spell_corpus_l2.fixture.json'

const restore_browser_globals = install_browser_globals({ with_document: true, with_element: true })

afterAll(restore_browser_globals)

const { encode } = await import('@aresrpg/fight/los')
const { STATUS_WON } = await import('@aresrpg/fight/board_state')
const { fight_view } = await import('@aresrpg/fight/project')
const { fight_store } = await import('@aresrpg/fight/store')
const { set_spell_corpus_for_test } = await import('../game/data/spell_corpus.js')
const { use_dungeon } = await import('../world-shell/dungeon_store.js')
const { my_seat_of, board_lifecycle_decision } = await import('../world-shell/voxel_fight_folds.js')
const { derive_phase, PHASE, should_mount_board, should_show_result } = await import('../fight-engine/phase.js')
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

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/**
 * Play the fight to its end through the SHIM'S OWN doors: the player holds position and casts the moment the
 * closing mob is in range; every mob turn is pumped by the shim itself. No store is written by hand — the
 * terminal status under test is published by the ONE projection mirror, exactly as it is on the page.
 */
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
    // A refused cast must still end the turn, or the mob never gets to close and the loop spins.
    const committed = await shim.commit_turn(staged)
    if (!committed && staged.length > 0) await shim.commit_turn([])
  }
  return shim.chain()
}

/** The adapter's reconcile head, verbatim (voxel_fight_adapter.js reconcile()). */
const reconcile_verdict = () => {
  const fight = fight_view(fight_store.getState())
  const { dungeon } = use_dungeon.getState()
  const seat = my_seat_of(dungeon, fight?.my_entity_id ?? null)
  const result = derive_phase(dungeon, fight, seat)
  const build_key = fight && dungeon ? `${fight.fight_id}#${dungeon.room_index}` : null
  const decision = board_lifecycle_decision({
    phase: result.phase,
    desired: result.desired,
    unmet: result.unmet,
    has_dungeon: !!dungeon,
    has_fight: !!fight,
    built_for: build_key, // the board the fight has been fought on is BUILT
    build_key,
    building: false,
  })
  return { result, decision, dungeon }
}

const shim = create_fight_shim({
  engine_context: { get_state: () => ({ sui: { characters: [] } }), dispatch: () => {} },
  save: async () => {},
  schedule: (fn) => fn(), // the mob pump, run inline: a test has no macrotask clock to wait on
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
const started = shim.start({ ...built.args, fight_id: 'sim:1056:1' })
if (!started.ok) throw new Error(`the fight would not start: ${started.reason}`)
const ended = await play_to_victory(shim)

describe('#1056 — a WON simulator fight reaches its victory sequence, never a black page', () => {
  test('the fight really was won through the shim, and the shim published the terminal', () => {
    expect(ended.sim_state.winner).toBe(0) // team0 — a genuine VICTORY, not an abandon
    expect(use_dungeon.getState().dungeon.status).toBe(STATUS_WON) // the projection mirror published it
  })

  test('the phase machine reads that victory as TERMINAL — the card is EARNED, not an EXIT', () => {
    const { result } = reconcile_verdict()
    // EXIT here is the bug: the fight layer (SimulatorFightHud → should_mount_board) unmounts wholesale and
    // the board is torn down under it — a black page where the victory card belongs.
    expect(result.unmet).toEqual([])
    expect(result.phase).toBe(PHASE.TERMINAL)
    expect(result.outcome).toBe('victory')
    expect(should_mount_board(result)).toBe(true)
    expect(should_show_result(result)).toBe(true)
  })

  test('and the board lifecycle WIRES the frozen board — teardown belongs to the terminal gate alone', () => {
    const { decision, dungeon, result } = reconcile_verdict()
    expect(decision).not.toBe('teardown')
    expect(decision).toBe('wire')
    // The adapter's own [terminal-gate2] sentinel predicate: a BUILT board torn down while the live chain read
    // is still terminal. It must be unreachable on a clean victory.
    const ungated_teardown = decision === 'teardown' && dungeon?.status === STATUS_WON
    expect(ungated_teardown).toBe(false)
    expect(result.phase).not.toBe(PHASE.EXIT)
  })
})

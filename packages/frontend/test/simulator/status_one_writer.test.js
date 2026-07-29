// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1646 — THE RUN STATUS HAS ONE WRITER.
//
// `use_dungeon.dungeon` is published by the projection mirror alone (dungeon_run_store.js: `fight_store
// .subscribe(s => setState({ dungeon: board_view(s) }))`). The simulator shim used to publish a SECOND status,
// translated from `live.chain.sim_state.winner` — the same fact with its own mapping, written to a field the
// mirror overwrites wholesale on its very next pass. Two homes for one fact: whichever fires last wins, and
// the DRAW is the input where the two mappings were closest to parting ways.
//
// This pins the derivation the deletion rests on: a stalemate DRAW is encoded, folded and projected as a
// TERMINAL run status — never left ACTIVE — with no shim-side translation anywhere in the path.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

const restore = install_browser_globals({ with_document: true, with_element: true })

afterAll(restore)

const { encode_sim_step } = await import('@aresrpg/fight/sim_chain')
const { board_view } = await import('@aresrpg/fight/project')
const { STATUS_ACTIVE, STATUS_FAILED, STATUS_WON } = await import('@aresrpg/fight/board_state')
const { active_store, ev } = await import('../../../fight/harness/fixtures.js')
const shim_source = await Bun.file(new URL('../../src/simulator/fight_shim.js', import.meta.url)).text()

const entity = (id, x) => ({ id, cell: { x, y: 0 }, health: 5, max_health: 5, alive: true, ap: 6, mp: 3 })
const sim_state = (winner) => ({
  team0: [entity('a', 1)],
  team1: [entity('b', 3)],
  order: ['a', 'b'],
  current_turn_idx: 0,
  turn_number: 1,
  winner,
})

/** The sim's own terminal event, run through the encoder the shim's chain feeds the core with. */
const encoded_terminal = (winner) =>
  encode_sim_step({
    pre_state: sim_state(-1),
    post_state: sim_state(winner),
    events: [{ type: 'fight_ended', fight_id: 'f1', winner }],
    fight_id: 'f1',
  }).rows

/** The status the ONE writer publishes after that terminal folds through the core's door. */
const published_status = (rows) => {
  const store = active_store()
  store.getState().input({ type: 'receipt', version: 3, receipt: { events: rows } })
  return board_view(store.getState()).status
}

describe('#1646 — one writer for the run status', () => {
  // Asserted as a boolean — a failure names the offence, it does not dump the whole file back at the reader.
  // Scoped to the SIM-WINNER translation: the session's own lifecycle writes (the seed's opening board, STOP's
  // return to setup) are transitions the core has no vocabulary for, not a second home for the fight's verdict.
  test('the shim publishes no run status derived from the sim winner', () => {
    expect(/status_of|sync_status/.test(shim_source), 'a second run-status writer came back').toBe(false)
  })

  test('a sim DRAW (winner 2) is published as a TERMINAL status, never left ACTIVE', () => {
    const rows = encoded_terminal(2)
    // the encoder speaks the chain's vocabulary — a stalemate has no winning team, so it rides the Defeat row
    // and the page paints its own draw banner over the terminal (spec §4.4).
    expect(rows.map((row) => row.type)).toEqual(['0xsim::fight_events::Defeat'])
    const status = published_status(rows)
    expect(status, 'the stalemate terminal must not read as a live fight').not.toBe(STATUS_ACTIVE)
    expect(status).toBe(STATUS_FAILED)
  })

  test('the win and loss terminals publish through the same one writer', () => {
    expect(published_status(encoded_terminal(0))).toBe(STATUS_WON)
    expect(published_status(encoded_terminal(1))).toBe(STATUS_FAILED)
  })

  test('an undecided fight stays ACTIVE — the projection, not a translation, decides', () => {
    const store = active_store()
    store.getState().input({ type: 'receipt', version: 3, receipt: { events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 1, remaining_hp: 19 })] } })
    expect(board_view(store.getState()).status).toBe(STATUS_ACTIVE)
  })
})

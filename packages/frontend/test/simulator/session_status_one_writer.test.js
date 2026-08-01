// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1687 — `dungeon.status` HAS ONE WRITER, INCLUDING ACROSS SESSION LIFECYCLE.
//
// #1646 killed the shim's sim-winner translation but left two SESSION-lifecycle writes behind: `seed_stores`
// opened a board with `{ status: STATUS_ACTIVE, … }` and `stop()` forced `{ status: STATUS_PLACEMENT }`. Both
// write a field the projection mirror owns wholesale (`fight_store.subscribe(s => setState({ dungeon:
// board_view(s) }))`), so whichever fires last wins.
//
// Neither is a transition the core lacks a vocabulary for — the core already publishes both:
//   · the OPEN seed is superseded ~two statements later by `init` (mirror → null) and then by the adopted
//     snapshot, which carries the real status, geometry and escrow;
//   · the STOP write is a LIE for the whole window it survives — `stop()` abandons THROUGH the sim first, so
//     the fold's verdict is a terminal, and the page is told the fight is back in placement.
// So this is a deletion, not a new input: the mirror is the one writer, and these two stop writing.
//
// Driven through the production shim with the production mirror wired exactly as `dungeon_run_store.js` wires
// it, so a returning second writer fails here rather than in a browser.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals({ with_document: true, with_element: true })

afterAll(restore_browser_globals)

const { create_fight_store } = await import('@aresrpg/fight/store')
const { board_view } = await import('@aresrpg/fight/project')
const { decode } = await import('@aresrpg/fight/los')
const { create_sim_chain } = await import('@aresrpg/fight/sim_chain')
const { create_fight_shim } = await import('../../src/simulator/fight_shim.js')

const SEED = 0x1687
const CHARACTER_ID = 'sim_c1'

const fighter = (id, cell, is_player) => ({
  id,
  name: id,
  cell,
  health: 30,
  health_max: 30,
  ap: 6,
  ap_max: 6,
  mp: 3,
  mp_max: 3,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_seed',
  level: 1,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

/**
 * A session opened through the real shim. `mirrored` wires the SAME subscription production runs, so the
 * dungeon store this shim writes into is the one the page actually reads.
 */
const open = ({ mirrored }) => {
  const store = create_fight_store()
  const shim_writes = []
  const dungeon_state = { dungeon: null, busy: false, mob_names: {}, mob_levels: {}, mob_elements: {} }
  const apply = (update) => {
    const patch = typeof update === 'function' ? update(dungeon_state) : update
    Object.assign(dungeon_state, patch)
    return patch
  }
  const dungeon = {
    getState: () => dungeon_state,
    setState: (update) => shim_writes.push(apply(update)),
  }
  // dungeon_run_store.js's one mirror, verbatim in shape — never routed through `dungeon.setState`, so every
  // patch collected above is a SHIM write and nothing else.
  const unmirror = mirrored ? store.subscribe((s) => apply({ dungeon: board_view(s) })) : () => {}

  const probe = create_sim_chain({ seed: SEED, fight_id: 'probe', team0: [], team1: [], templates_raw: [] })
  const started = create_fight_shim({
    store,
    dungeon,
    engine_context: { get_state: () => ({ sui: { characters: [{}] } }), dispatch: () => {} },
    schedule: () => {},
    now: () => 1_700_000_000_000,
  })
  const opened = started.start({
    seed: SEED,
    fight_id: 'sim:1687:1',
    team0: [fighter(CHARACTER_ID, decode(probe.board.start_cells_a[0]), true)],
    team1: [fighter('mob_0', decode(probe.board.start_cells_b[0]), false)],
    templates_raw: [],
    roster: [{ id: CHARACTER_ID, name: 'KAELIS', class_id: 'senshi', level: 1 }],
    mobs: [{ template_id: '0xmob_seed', name: 'Seed Mob', level: 1, element: 0 }],
    focus_id: CHARACTER_ID,
  })
  expect(opened.ok).toBe(true)
  return { shim: started, store, dungeon_state, shim_writes, unmirror }
}

describe('#1687 — the session lifecycle writes no status of its own', () => {
  test('the OPEN seed writes no board at all — the snapshot mirror publishes the first one', () => {
    const { shim_writes, unmirror } = open({ mirrored: false })
    unmirror()
    // Every patch here is the shim's own. `dungeon` is the mirror's field; the shim seeds ids, doors and flags.
    expect(shim_writes.length).toBeGreaterThan(0)
    for (const patch of shim_writes) expect(Object.hasOwn(patch, 'dungeon')).toBe(false)
  })

  test('STOP writes no status — the page reads the fold verdict, not a second translation', () => {
    const { shim, store, dungeon_state, shim_writes, unmirror } = open({ mirrored: true })
    const before = shim_writes.length
    shim.stop()
    unmirror()
    for (const patch of shim_writes.slice(before)) expect(Object.hasOwn(patch, 'dungeon')).toBe(false)
    // THE DIVERGENCE: `stop()` abandons THROUGH the sim, so the fold's verdict is a terminal. A shim-written
    // STATUS_PLACEMENT told the page the fight had gone back to seat picking.
    expect(dungeon_state.dungeon.status).toBe(board_view(store.getState()).status)
  })

  test('STOP still clears the busy latch — its own field, and the only one it owns', () => {
    const { shim, dungeon_state, unmirror } = open({ mirrored: true })
    dungeon_state.busy = true
    shim.stop()
    unmirror()
    expect(dungeon_state.busy).toBe(false)
  })
})

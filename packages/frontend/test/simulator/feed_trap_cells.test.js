// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1646 (sibling finding) — THE SHIM'S RECEIPT DOOR WAS MISSING A FIELD.
//
// All three world call sites feed a receipt with `trap_cells` (dungeon_run_store's commit, its overdue retry
// and its forfeit): the store's chain leg hands that list to `wave_turns_of`, which is what attributes a
// trap-triggered wave to the seat that OWNS the trap (`store_chain.js` → `fold.js` `owned_trap_cells`). The
// simulator shim's own `feed()` omitted it, so every input it published carried an implicit empty list and the
// player's own trap procs were folded as ownerless — a presentation divergence in the exact composition the
// simulator exists to catch.
//
// The law: the shim's door speaks the SAME envelope the world's does, read from the same projection.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

const restore = install_browser_globals({ with_document: true, with_element: true })

afterAll(restore)

const { create_fight_store } = await import('@aresrpg/fight/store')
const { create_sim_chain } = await import('@aresrpg/fight/sim_chain')
const { decode } = await import('@aresrpg/fight/los')
const { build_teams } = await import('../../src/simulator/fight_setup.js')
const { build_seat } = await import('../../src/simulator/content.js')
const { create_fight_shim } = await import('../../src/simulator/fight_shim.js')

const SEED = 0xc81f3a92
const SEAT = 'sim_c1'

const character = (id, name) => ({
  id,
  name,
  class_id: 'senshi',
  level: 30,
  stat_alloc: { vitality: 100, wisdom: 0, strength: 45, intelligence: 0, chance: 0, agility: 0 },
  spell_levels: {},
  loadout: {},
})

const mob_block = (name) => ({
  template_id: `0xmob_${name}`,
  name,
  element: 3,
  role: 'striker',
  level: 6,
  min_level: 4,
  max_level: 8,
  hp: 30,
  max_hp: 30,
  ap: 6,
  mp: 3,
  stats: {},
  combat_block_published: true,
})

/** A shim on its OWN core store, with a tap on the door recording every message it publishes. */
const open_fight = () => {
  const store = create_fight_store()
  const seen = []
  const original = store.getState().input
  store.setState({
    input: (/** @type {any} */ msg, /** @type {any} */ now) => {
      seen.push(msg)
      return original(msg, now)
    },
  })

  const roster = [character(SEAT, 'KAELIS')]
  const mobs = [mob_block('aetherwing')]
  const probe = create_sim_chain({ seed: SEED, fight_id: 'probe', team0: [], team1: [], templates_raw: [] })
  const ally = probe.board.start_cells_a.map((cell) => decode(Number(cell)))
  const enemy = probe.board.start_cells_b.map((cell) => decode(Number(cell)))
  const { team0, team1 } = build_teams({
    placements: roster.map((row, index) => ({
      cell: ally[index],
      character: row,
      seat: build_seat(row, []),
      spell_ids: [],
    })),
    picks: mobs.map((mob, index) => ({ cell: enemy[index], mob })),
    class_templates: new Map(),
  })

  const tasks = []
  const shim = create_fight_shim({
    store,
    schedule: (/** @type {any} */ fn) => tasks.push(fn),
    now: () => 1_700_000_000_000,
    dungeon: {
      getState: () => ({ dungeon: null, mob_names: {}, mob_levels: {}, mob_elements: {} }),
      setState: () => {},
    },
    engine_context: { get_state: () => ({ sui: { characters: roster } }), dispatch: () => {} },
  })
  const opened = shim.start({
    seed: SEED,
    fight_id: `sim:${SEED}:traps`,
    team0,
    team1,
    templates_raw: [],
    roster,
    mobs,
    focus_id: SEAT,
  })
  expect(opened.ok).toBe(true)
  const drain = () => {
    let guard = 0
    while (tasks.length && guard < 200) {
      tasks.shift()?.()
      guard += 1
    }
  }
  return { shim, store, seen, drain }
}

describe('#1646 — the shim feeds receipts with the same envelope the world does', () => {
  test('every receipt the shim publishes carries trap_cells', async () => {
    const { shim, seen, drain } = open_fight()
    await shim.commit_turn([])
    drain()

    const receipts = seen.filter((msg) => msg?.type === 'receipt')
    expect(receipts.length, 'the drive must actually publish a receipt for this to mean anything').toBeGreaterThan(0)
    for (const receipt of receipts)
      expect(Array.isArray(receipt.trap_cells), `a receipt reached the door without trap_cells`).toBe(true)
  })
})

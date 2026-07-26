// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1026 — the shim briefly seeded dungeon.escrow with bare character-id strings even though every consumer reads
// board_view participant rows (`cave_session.js` is shape-sensitive at `.addr`). The seed must stay empty until the
// fight snapshot crosses the core door; project.board_view is the one owner that then publishes full seat rows.

import { describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

install_browser_globals({ with_document: true, with_element: true })

const { create_fight_store } = await import('@aresrpg/fight/store')
const { board_view } = await import('@aresrpg/fight/project')
const { decode } = await import('@aresrpg/fight/los')
const { create_sim_chain } = await import('@aresrpg/fight/sim_chain')
const { create_fight_shim, LOCAL_ADDRESS: local_address } = await import('./fight_shim.js')

const seed = 0x1026
const character_id = 'sim_c1'

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

const open = () => {
  const store = create_fight_store()
  const writes = []
  const dungeon_state = { dungeon: null, mob_names: {}, mob_levels: {}, mob_elements: {} }
  const dungeon = {
    getState: () => dungeon_state,
    setState: (update) => {
      const patch = typeof update === 'function' ? update(dungeon_state) : update
      writes.push(patch)
      Object.assign(dungeon_state, patch)
    },
  }
  const probe = create_sim_chain({ seed, fight_id: 'probe', team0: [], team1: [], templates_raw: [] })
  const team0 = [fighter(character_id, decode(probe.board.start_cells_a[0]), true)]
  const team1 = [fighter('mob_0', decode(probe.board.start_cells_b[0]), false)]
  const roster = [{ id: character_id, name: 'KAELIS', class_id: 'senshi', level: 1 }]
  const mobs = [{ template_id: '0xmob_seed', name: 'Seed Mob', level: 1, element: 0 }]
  const shim = create_fight_shim({
    store,
    dungeon,
    engine_context: { get_state: () => ({ sui: { characters: [{}] } }), dispatch: () => {} },
    schedule: () => {},
    now: () => 1_700_000_000_000,
  })

  const started = shim.start({
    seed,
    fight_id: 'sim:1026:1',
    team0,
    team1,
    templates_raw: [],
    roster,
    mobs,
    focus_id: character_id,
  })
  expect(started.ok).toBe(true)
  return { store, writes }
}

describe('#1026 — simulator escrow has one shape owner', () => {
  test('the lifecycle seed is empty, then board_view publishes the consumer-compatible participant row', () => {
    const { store, writes } = open()

    expect(writes[0].dungeon.escrow).toEqual([])
    expect(board_view(store.getState()).escrow[0]).toMatchObject({
      addr: local_address,
      character: character_id,
    })
  })
})

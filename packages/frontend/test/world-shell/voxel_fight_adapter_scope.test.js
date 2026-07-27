// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST: the resident WORLD adapter and the SIMULATOR adapter share one fight core, but they are distinct
// render scopes. Opening a simulator fight must never make the hidden world adapter build that local board and
// reveal it when the player returns to WORLD.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals()

function audio_stub() {
  this.play = () => Promise.resolve()
  this.pause = () => {}
  this.addEventListener = () => {}
  this.removeEventListener = () => {}
}

const had_audio = 'Audio' in globalThis
if (!had_audio) globalThis.Audio = audio_stub

const { create_sim_chain } = await import('@aresrpg/fight/sim_chain')
const { decode } = await import('@aresrpg/fight/los')
const { fight_store } = await import('@aresrpg/fight/store')
const { create_fight_shim } = await import('../../src/simulator/fight_shim.js')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
const { create_voxel_fight_adapter } = await import('../../src/world-shell/voxel_fight_adapter.js')
const { fight_scope_sim, fight_scope_world, world_fight_view } =
  await import('../../src/world-shell/fight_session_scope.js')

const seed = 0x00c0ffee
const fight_id = 'sim:00c0ffee:1'
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
  template_id: is_player ? 'senshi' : '0xmob',
  level: 1,
  stats: {},
  effects: [],
  spell_levels: {},
  ap_reserve: 0,
})

const make_board = () => {
  const calls = { builds: [] }
  return {
    calls,
    on: () => () => {},
    build: async (spec) => {
      calls.builds.push(spec)
    },
    teardown: () => {},
    entity_upsert: () => {},
    entity_remove: () => {},
    entity_move: () => Promise.resolve(),
    entity_beat: () => {
      const beat = Promise.resolve()
      beat.done = Promise.resolve()
      beat.duration_ms = 300
      return beat
    },
    flash_cell: () => {},
    flash_entity: () => {},
    pulse_cells: () => {},
    ripple: () => {},
    set_cell_state: () => {},
    clear_states: () => {},
    render_position_of: () => null,
    set_entity_anchor: () => {},
    clear_entity_anchor: () => {},
    entity_height_of: () => 2,
  }
}

const game_context = {
  events: { on: () => {}, off: () => {} },
  dispatch: () => {},
}

const make_view_probe = () => {
  let selected_view = 'world'
  return {
    on_fight: (active) => {
      selected_view = active ? 'fight' : 'world'
    },
    selected_view: () => selected_view,
  }
}

const open_simulator_fight = () => {
  const probe = create_sim_chain({ seed, fight_id: 'probe', team0: [], team1: [], templates_raw: [] })
  const team0 = [fighter(character_id, decode(probe.board.start_cells_a[0]), true)]
  const team1 = [fighter('mob_0', decode(probe.board.start_cells_b[0]), false)]
  const shim = create_fight_shim({
    store: fight_store,
    dungeon: use_dungeon,
    engine_context: { get_state: () => ({ sui: { characters: [{}] } }), dispatch: () => {} },
    schedule: () => {},
    now: () => 1_700_000_000_000,
  })
  const opened = shim.start({
    seed,
    fight_id,
    team0,
    team1,
    templates_raw: [],
    roster: [{ id: character_id, name: 'KAELIS', class_id: 'senshi', level: 1 }],
    mobs: [{ template_id: '0xmob', name: 'Mob', level: 1, element: 0 }],
    focus_id: character_id,
  })
  expect(opened.ok).toBe(true)
  expect(fight_store.getState()).toMatchObject({ fight_id, view: { id: fight_id } })
  return shim
}

beforeEach(() => {
  use_dungeon.getState().reset_local()
  fight_store.getState().input({ type: 'init', fight_id: null, my_key: null, ctx: {} })
})

afterAll(() => {
  use_dungeon.getState().reset_local()
  if (!had_audio) delete globalThis.Audio
  restore_browser_globals()
})

describe('world fight rendering is mode-partitioned', () => {
  test('a resident WORLD adapter stays on the world view when a simulator fight opens', async () => {
    const board = make_board()
    const view = make_view_probe()
    const adapter = create_voxel_fight_adapter(board, {
      scope: fight_scope_world,
      game_context,
      on_fight: view.on_fight,
    })
    const shim = open_simulator_fight()

    await new Promise((resolve) => setTimeout(resolve, 20))
    const scoped_view = world_fight_view(fight_store.getState())
    const board_frame = adapter.get_board_frame()
    const build_count = board.calls.builds.length
    const selected_view = view.selected_view()

    adapter.destroy()
    shim.dispose()
    expect(scoped_view).toBeNull()
    expect(board_frame).toBeNull()
    expect(build_count).toBe(0)
    expect(selected_view).toBe('world')
  })

  test('a resident SIM adapter selects the same simulator session as its fight view', async () => {
    const board = make_board()
    const view = make_view_probe()
    const adapter = create_voxel_fight_adapter(board, {
      scope: fight_scope_sim,
      game_context,
      on_fight: view.on_fight,
    })
    const shim = open_simulator_fight()

    await new Promise((resolve) => setTimeout(resolve, 20))
    const board_frame = adapter.get_board_frame()
    const selected_view = view.selected_view()

    adapter.destroy()
    shim.dispose()
    expect(board_frame).not.toBeNull()
    expect(board.calls.builds).toHaveLength(1)
    expect(selected_view).toBe('fight')
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression: a legal placement click must move the projected fighter before READY/receipt. The
// adapter already stored the READY target, but dropping the local Placed reducer input left the rendered fighter
// on its chain cell, making the click look dead. This mounts the real adapter and drives its real cell_click seam.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals()

function AudioStub() {
  this.play = () => Promise.resolve()
  this.pause = () => {}
  this.addEventListener = () => {}
  this.removeEventListener = () => {}
}

const had_audio = 'Audio' in globalThis
// @ts-expect-error test shim
if (!had_audio) globalThis.Audio = AudioStub

const { fight_store } = await import('@aresrpg/fight/store')
const { fight_view } = await import('@aresrpg/fight/project')
const { use_dungeon } = await import('./dungeon_store.js')
const { use_dungeon_turn } = await import('../game/screens/dungeon-turn.js')
const { SENSHI_MALE_GLB_AVAILABLE } = await import('../test_helpers/glb_fixture.js')
// MISSING-ARTIFACT (#117): voxel_fight_adapter.js imports @aresrpg/engine3/tactical, whose board_entities.js
// unconditionally imports character_avatar.js — a static import of the absent-by-design senshi_male.glb
// (test_helpers/glb_fixture.js; full chain documented in packages/engine/src/test_helpers/glb_fixture.js).
const { create_voxel_fight_adapter } = SENSHI_MALE_GLB_AVAILABLE ? await import('./voxel_fight_adapter.js') : {}

const FIGHT = '0xplacement-click'
const CHAR = '0xc1'
const CHAIN_CELL = 100
const PICK_CELL = 101

const FIGHT_OBJECT = {
  id: FIGHT,
  width: 20,
  height: 19,
  status: 0,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: CHAIN_CELL,
      ready: false,
    },
  ],
  mobs: [{ template: '0xabc', level: 1, hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3 }],
  group_template: '0xgroup',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  start_cells_a: [CHAIN_CELL, PICK_CELL],
  start_cells_b: [105],
  queue: [],
  turn_ptr: 0,
  turn_deadline_ms: 0,
  placement_deadline_ms: 90_000,
  world_seed: 1,
  spawn_id: 1,
  anchor_x: 0,
  anchor_z: 0,
  shape_mask: [],
  invisibility_statuses: [],
}

const make_board = () => {
  const handlers = new Map()
  const calls = { upserts: [] }
  return {
    calls,
    emit: (kind, value) => handlers.get(kind)?.(value),
    on: (kind, handler) => {
      handlers.set(kind, handler)
      return () => handlers.delete(kind)
    },
    build: async () => {},
    teardown: () => {},
    entity_upsert: (spec) => calls.upserts.push(spec),
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const poll = async (predicate, timeout = 2_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return true
    await sleep(20)
  }
  return predicate()
}

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('voxel fight adapter placement click', () => {
  const board = make_board()
  const adapter_handle = { current: null }

  afterAll(() => {
    adapter_handle.current?.destroy()
    fight_store.getState().input({ type: 'init', fight_id: null })
    use_dungeon_turn.getState().clear_picks()
    use_dungeon.setState({ fight_id: null, fight_fresh: false })
    // @ts-expect-error test shim
    if (!had_audio) delete globalThis.Audio
    restore_browser_globals()
  })

  test('a free start-cell click predicts the selected fighter cell before READY', async () => {
    fight_store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    fight_store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 })
    adapter_handle.current = create_voxel_fight_adapter(board)

    expect(await poll(() => board.calls.upserts.some((row) => row.id === CHAR))).toBe(true)
    board.emit('cell_click', { x: PICK_CELL % 20, y: Math.floor(PICK_CELL / 20) })

    expect(use_dungeon_turn.getState().placement_pick).toBe(PICK_CELL)
    expect(fight_view().fighters.get(CHAR)?.cell).toEqual({ x: 1, y: 5 })
    expect(await poll(() => board.calls.upserts.some((row) => row.id === CHAR && row.cell?.x === 1))).toBe(true)
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1866) — PAINT TRUTH = CLICK TRUTH on the placement strips.
//
// Live testnet, group fight, solo player: TWO strips rendered in the same blue — the player's own band and a
// second band across the board that refuses every click ("what are these other starting cells if I can't click
// on them?"). Two lies in one paint pass, both from the same root: the board painted the DECLARED bands, while
// `project.placement_click` decides the pick on something narrower.
//   · my own band lit every cell clickable-blue, including the one an ally already stands on (a 'deny' click);
//   · the other seats' band lit through the engine's `target` channel — a second blue — with no reader at all
//     in a solo group fight (mobs never use it; it seats joined allies/PvP foes only).
// The fix derives both from the ONE predicate: a cell paints as pickable IFF the click door accepts it, and the
// other seats' strip renders only when a seat actually stands on it.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

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
const { placement_click } = await import('@aresrpg/fight/project')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
const { use_dungeon_turn } = await import('../../src/game/screens/dungeon-turn.js')
const { SENSHI_MALE_GLB_AVAILABLE } = await import('../../src/test_helpers/glb_fixture.js')
const { create_voxel_fight_adapter } = SENSHI_MALE_GLB_AVAILABLE
  ? await import('../../src/world-shell/voxel_fight_adapter.js')
  : {}

const FIGHT = '0xplacement-strips'
const ME = '0xc1'
const ALLY = '0xc2'
const W = 20

// My band: the cell I stand on (100), a free one (102), and 101 — where the ally already stands, so the click
// door denies it. The other seats' band (140/141) holds nobody: the solo-group-fight strip with no reader.
const MY_CELL = 100
const ALLY_CELL = 101
const FREE_CELL = 102
const OTHER_BAND = [140, 141]
const MOB_CELL = 105 // mid-board, as mobs always are — never on the other band

const cell_of = (encoded) => ({ x: encoded % W, y: Math.floor(encoded / W) })

const seat = (character, cell, team) => ({
  owner: `0x${character}`,
  character,
  class: 'senshi',
  team,
  hp: 50,
  max_hp: 50,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell,
  ready: false,
})

const FIGHT_OBJECT = {
  id: FIGHT,
  width: W,
  height: 19,
  status: 0, // placement
  participants: [seat(ME, MY_CELL, 0), seat(ALLY, ALLY_CELL, 0)],
  mobs: [{ template: '0xabc', level: 1, hp: 30, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3 }],
  group_template: '0xgroup',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  start_cells_a: [MY_CELL, ALLY_CELL, FREE_CELL],
  start_cells_b: OTHER_BAND,
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

/** A board double that records the resolved per-channel cell paint the player actually sees. */
const make_board = () => {
  const handlers = new Map()
  /** @type {Map<string, Set<number>>} */
  const painted = new Map()
  const of = (channel) => painted.get(channel) ?? new Set()
  return {
    painted,
    /** every cell currently wearing `channel`, ENCODED */
    cells_on: (channel) => [...of(channel)].sort((a, b) => a - b),
    /** the channel a cell wears, or null */
    channel_of: (cell) => [...painted].find(([, cells]) => cells.has(cell))?.[0] ?? null,
    emit: (kind, value) => handlers.get(kind)?.(value),
    on: (kind, handler) => {
      handlers.set(kind, handler)
      return () => handlers.delete(kind)
    },
    build: async () => {},
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
    set_cell_state: (cells, channel) => {
      const next = of(channel)
      for (const cell of cells) next.add(cell.y * W + cell.x)
      painted.set(channel, next)
    },
    highlight: (channel, cells, on) => {
      const next = of(channel)
      for (const cell of cells) if (!on) next.delete(cell.y * W + cell.x)
      painted.set(channel, next)
    },
    clear_states: (channel) => painted.delete(channel),
    render_position_of: () => null,
    set_entity_anchor: () => {},
    clear_entity_anchor: () => {},
    entity_height_of: () => 2,
  }
}

// The adapter's own default is the live game context module, whose evaluation order is not this file's to
// depend on (voxel_fight_adapter_scope.test.js takes the same injection): the paint pass under test needs the
// STATE_UPDATED seam and a dispatch sink, nothing more.
const game_context = { events: { on: () => {}, off: () => {} }, dispatch: () => {} }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const poll = async (predicate, timeout = 2_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return true
    await sleep(20)
  }
  return predicate()
}

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('#1866 — the placement strips paint exactly what the click accepts', () => {
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

  test('the clickable blue covers the pick-accepting cells and NOTHING else', async () => {
    fight_store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: ME } })
    fight_store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 })
    adapter_handle.current = create_voxel_fight_adapter(board, { game_context })

    expect(await poll(() => board.cells_on('placement').length > 0)).toBe(true)

    // The click door is the truth: my own cell re-picks, the free cell picks, the ally's cell denies.
    const verdict = (cell) => placement_click(fight_store.getState(), cell_of(cell))
    expect([MY_CELL, FREE_CELL].map(verdict)).toEqual(['pick', 'pick'])
    expect(verdict(ALLY_CELL)).toBe('deny')

    // …and the paint says exactly that — no cell that refuses a click wears the clickable blue.
    expect(board.cells_on('placement')).toEqual([MY_CELL, FREE_CELL])
  })

  test('a taken start cell reads as unavailable, in the neutral grey grammar — never a second blue', () => {
    expect(board.channel_of(ALLY_CELL)).toBe('unavailable')
  })

  test('the other seats’ strip has no reader in a solo group fight — it paints nothing at all', () => {
    for (const cell of OTHER_BAND) expect(board.channel_of(cell)).toBeNull()
  })

  test('a seat standing on the other band brings its strip back — unavailable grey, never the clickable blue', async () => {
    fight_store.getState().input({
      type: 'snapshot',
      fight: {
        ...FIGHT_OBJECT,
        participants: [seat(ME, MY_CELL, 0), seat(ALLY, ALLY_CELL, 0), seat('0xc3', OTHER_BAND[0], 1)],
      },
      version: 6,
    })

    expect(await poll(() => board.channel_of(OTHER_BAND[0]) !== null)).toBe(true)
    for (const cell of OTHER_BAND) expect(board.channel_of(cell)).toBe('unavailable')
    expect(board.cells_on('placement')).toEqual([MY_CELL, FREE_CELL])
  })
})

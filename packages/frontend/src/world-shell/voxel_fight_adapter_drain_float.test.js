// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DRAIN RESOURCE FLOATS (#1478) — the reported symptom: a landed drain stripped AP/MP silently, the status row
// never spoke. The contract this drives: one landed DRAIN beat mounts EXACTLY ONE house-coloured number float on
// the affected target ("-3" in AP amber / "-2" in MP mint — tackle_float_payloads, the one home shared with the
// tackle forfeit), never the generic "DRAIN" info float the standalone-status arm mounts for SHIELD/STUN/POISON.
//
// Driven, not source-read: the real create_voxel_fight_adapter over the real singleton fight_store, with a
// recording board handle (the voxel_fight_beat_playback.test.js harness). Counting `board.float?.(` occurrences
// in a source slice cannot survive a neighbouring branch landing inside the slice — and it never proved a float
// actually reaches the board. This does both: the per-beat delta is the assertion.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

// the adapter drags the browser-flavoured graph (auth/i18n/toast/context) — window must exist BEFORE import.
const restore_browser_globals = install_browser_globals()

const { fight_store } = await import('@aresrpg/fight/store')
const { use_dungeon } = await import('./dungeon_store.js')
const { SENSHI_MALE_GLB_AVAILABLE } = await import('../test_helpers/glb_fixture.js')
const { create_voxel_fight_adapter } = SENSHI_MALE_GLB_AVAILABLE ? await import('./voxel_fight_adapter.js') : {}

const FIGHT = '0xdrain-fight'
const CHAR = '0xd1'

/** A decoded-Fight-shaped object the core's snapshot door adopts, ACTIVE so derive_phase wants a live board. */
const FIGHT_OBJECT = {
  id: FIGHT,
  width: 20,
  height: 19,
  status: 1, // STATUS_ACTIVE
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
      cell: 100, // { x: 0, y: 5 }
      ready: true,
      casts_this_turn: 0,
    },
  ],
  mobs: [{ template: '0xabc', level: 1, hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3 }], // { x: 5, y: 5 }
  group_template: '0xgroup',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  start_cells_a: [100],
  start_cells_b: [105],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  placement_deadline_ms: 0,
  world_seed: 1,
  spawn_id: 1,
  anchor_x: 0,
  anchor_z: 0,
  shape_mask: [],
  invisibility_statuses: [],
}

/** A recording BoardHandle stand-in: every mount surface writes a row (voxel_fight_beat_playback's shape). */
const make_board = () => {
  const calls = { beats: [], upserts: [], moves: [], floats: [] }
  const beat_promise = () => {
    const p = Promise.resolve()
    p.done = Promise.resolve()
    p.duration_ms = 300
    return p
  }
  return {
    calls,
    on: () => () => {},
    build: async () => {},
    teardown: () => {},
    entity_upsert: (spec) => calls.upserts.push(spec),
    entity_remove: () => {},
    entity_move: (id, path) => {
      calls.moves.push({ id, path })
      return Promise.resolve()
    },
    entity_beat: (id, opts) => {
      calls.beats.push({ id, ...opts })
      return beat_promise()
    },
    float: (id, payload) => calls.floats.push({ id, ...payload }),
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
const poll = async (predicate, { timeout = 8_000, step = 50 } = {}) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (predicate()) return true
    await sleep(step)
  }
  return predicate()
}

const drain_beat = (pool, landed) => ({
  kind: 'status',
  at: 0,
  duration: 0,
  payload: { target_id: CHAR, caster_id: CHAR, status: 'DRAIN', pool, landed, dodged: 0 },
  source_turn: `drain-${pool}`,
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('voxel fight adapter — Drain resource floats (#1478)', () => {
  const board = make_board()
  const adapter_handle = { current: null }

  afterAll(() => {
    adapter_handle.current?.destroy()
    fight_store.getState().input({ type: 'init', fight_id: null }) // reset the singleton for the rest of the suite
    use_dungeon.setState({ fight_id: null, fight_fresh: false })
    restore_browser_globals()
  })

  test('each landed Drain beat mounts exactly one house-coloured number float on its target', async () => {
    fight_store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
    })
    fight_store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 })
    expect(use_dungeon.getState().dungeon?.id, 'the run store must project the live board record').toBe(FIGHT)

    adapter_handle.current = create_voxel_fight_adapter(board)
    // the board build is async — the rigs must exist before any beat (entity_ids gates every mount).
    const wired = await poll(() => board.calls.upserts.some((u) => u.id === CHAR))
    expect(wired, 'the adapter never built/wired the board (no fighter rig upserted)').toBe(true)

    for (const [pool, landed, expected] of [
      ['ap', 3, { text: '-3', kind: 'ap' }],
      ['mp', 2, { text: '-2', kind: 'mp' }],
    ]) {
      const before = board.calls.floats.length
      fight_store.getState().input({
        type: 'predicted',
        intent_id: `drain-${pool}`,
        basis_version: 6,
        actions: [],
        beats: [drain_beat(pool, landed)],
      })
      const mounted = await poll(() => board.calls.floats.length > before)
      expect(mounted, `the landed ${pool} Drain beat never mounted a float on the board`).toBe(true)
      await sleep(250) // give a second (wrong) float the chance to land before counting

      const emitted = board.calls.floats.slice(before)
      expect(emitted, `a landed ${pool} Drain must mount exactly one float, not ${emitted.length}`).toHaveLength(1)
      expect(emitted[0]).toEqual({ id: CHAR, ...expected })
    }

    // the generic standalone-status arm (SHIELD/STUN/POISON…) must never also voice DRAIN as a text float.
    expect(
      board.calls.floats.some((row) => row.text === 'DRAIN'),
      'a DRAIN beat mounted the generic status float — its own number arm is shadowed'
    ).toBe(false)
  }, 20_000)
})

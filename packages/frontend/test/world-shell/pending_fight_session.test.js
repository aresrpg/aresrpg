// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1609 — THE PENDING SESSION, red-first. Measured before this row: engage → placement cells took 6.20–6.95s,
// of which the read layer is 3ms; the whole residual was create-transaction finality. The board, though, is
// derivable at the click — so the assertion that gates this ticket is SYNCHRONOUS: mount, then read placement
// cells in the SAME turn, with no await between them.
//
// The four laws under test, in the order they can break:
//   ① THE MEASURE — placement cells exist synchronously at submit, and they are the REAL derived board.
//   ② SILENCE — a pending session reads nothing (no object read, no journal); there is no journal before
//     finality, so anything it read would be a fabrication.
//   ③ THE RE-KEY — one transition moves BOTH identity homes (shared store + fight core) and the predicted
//     board survives it; the reads start only then.
//   ④ THE SAD PATH — a failed create leaves no session, no latch, nothing settleable.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import {
  reset_expedition_sdk_mock,
  set_expedition_sdk_mock,
} from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const FIGHT_ID = '0xworldfight'
const WORLD_ID = '0xworld'
const WORLD_SEED = 0x1234abcd
// A group anchored in chain space — the ticket's own `x`/`z`, which is exactly what `fight::create` folds into
// `board::generate_for_anchor`. The zone row this client rendered carries the same pair.
const ANCHOR_X = 512
const ANCHOR_Z = 768

const get_object = mock(async () => {
  throw new Error('a pending session must never read a chain object')
})
set_expedition_sdk_mock(async () => ({ grpc_client: { core: { getObject: get_object } } }))

const { use_auth } = await import('../../src/auth')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
const { fight_store } = await import('@aresrpg/fight/store')
const { engine_view_of } = await import('@aresrpg/fight/project')
const { generate_for_anchor } = await import('@aresrpg/sim/board_gen')
const { is_pending_fight_id } = await import('@aresrpg/sdk/pending_fight_id')
const {
  abandon_pending_world_fight,
  enter_pending_world_fight,
  predicted_world_fight,
  rekey_world_fight,
} = await import('../../src/world-shell/world_fight.js')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch

const mount = () =>
  enter_pending_world_fight({
    world_id: WORLD_ID,
    character_id: CHARACTER_ID,
    world_seed: WORLD_SEED,
    anchor_x: ANCHOR_X,
    anchor_z: ANCHOR_Z,
    mob_roster: [{ id: 'mob-0', template_id: '0xtemplate', name: 'Aetherwing' }],
  })

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  globalThis.fetch = mock(async () => {
    throw new Error('a pending session must never hit the read layer')
  })
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null })
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null })
  globalThis.fetch = real_fetch
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('① the measure — placement cells at SUBMIT, not at finality', () => {
  test('a pending mount publishes the derived placement cells in its own turn', () => {
    const pending_id = mount() // NO await anywhere in this test — that is the whole assertion
    expect(pending_id).not.toBeNull()
    expect(is_pending_fight_id(pending_id)).toBe(true)

    const view = engine_view_of(fight_store.getState())
    expect(view.placement).toBe(true)
    expect(view.placement_cells[0].length).toBeGreaterThan(0)

    // …and they are the REAL board, not a fallback frame: bit-equal to the deterministic twin the chain runs.
    const board = generate_for_anchor(WORLD_SEED, ANCHOR_X, ANCHOR_Z)
    expect(board.start_cells_a.length).toBeGreaterThan(0)
    expect(view.placement_cells[0].length).toBe(board.start_cells_a.length)
    expect(view.placement_cells[1].length).toBe(board.start_cells_b.length)
    const adopted = fight_store.getState().view
    expect(adopted.grid_width).toBe(board.width)
    expect(adopted.grid_height).toBe(board.height)
    expect(adopted.obstacles).toEqual(board.obstacles)
  })

  test('the predicted record carries geometry and NOTHING it cannot know', () => {
    const predicted = predicted_world_fight({
      pending_id: 'pending:test',
      world_id: WORLD_ID,
      world_seed: WORLD_SEED,
      anchor_x: ANCHOR_X,
      anchor_z: ANCHOR_Z,
    })
    const board = generate_for_anchor(WORLD_SEED, ANCHOR_X, ANCHOR_Z)
    expect(predicted.obstacles).toEqual(board.obstacles)
    expect(predicted.holes).toEqual(board.holes)
    expect(predicted.shape_mask).toEqual(board.shape_mask)
    // Seats and mob cells are NOT byte-exact twins (mob_placement.js says so) — they stay chain truth.
    expect(predicted.participants).toEqual([])
    expect(predicted.mobs).toEqual([])
  })

  test('a world this tab has not read yields NO prediction rather than a fabricated board', () => {
    expect(
      predicted_world_fight({
        pending_id: 'pending:test',
        world_id: WORLD_ID,
        world_seed: null,
        anchor_x: ANCHOR_X,
        anchor_z: ANCHOR_Z,
      }),
    ).toBeNull()
    expect(
      enter_pending_world_fight({
        world_id: WORLD_ID,
        character_id: CHARACTER_ID,
        world_seed: undefined,
        anchor_x: ANCHOR_X,
        anchor_z: ANCHOR_Z,
      }),
    ).toBeNull()
    expect(use_dungeon.getState().fight_id).toBeNull() // …and no half-mounted session survives the refusal
  })
})

describe('② silence — a pending session reads nothing', () => {
  test('no chain object read and no /v1 request happens while the create is in flight', async () => {
    mount()
    await use_dungeon.getState().refresh() // the guard: even an explicit refresh must stay silent
    expect(get_object).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('③ the re-key — one transition, both identity homes', () => {
  test('pending → minted id moves the store and the core, and the board survives', () => {
    const pending_id = mount()
    const cells_before = engine_view_of(fight_store.getState()).placement_cells[0].length

    use_dungeon.getState()._stop_polling() // the activation's heartbeat is not what this test measures
    expect(rekey_world_fight(pending_id, FIGHT_ID, { is_public: true, world_group: null })).toBe(true)
    use_dungeon.getState()._stop_polling()

    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
    expect(use_dungeon.getState().dungeon_id).toBe(FIGHT_ID)
    expect(fight_store.getState().fight_id).toBe(FIGHT_ID)
    expect(fight_store.getState().core.fight_id).toBe(FIGHT_ID)
    expect(fight_store.getState().view.id).toBe(FIGHT_ID)
    // The whole point: the predicted board did not blink through the transition.
    expect(engine_view_of(fight_store.getState()).placement_cells[0].length).toBe(cells_before)
  })

  test('a stale re-key changes nothing', () => {
    const pending_id = mount()
    expect(rekey_world_fight('pending:someone-elses-session', FIGHT_ID)).toBe(false)
    expect(use_dungeon.getState().fight_id).toBe(pending_id)
    expect(fight_store.getState().fight_id).toBe(pending_id)
  })
})

describe('④ the sad path — a failed create leaves nothing behind', () => {
  test('abandoning a pending session clears every latch and closes the core', () => {
    const pending_id = mount()
    expect(use_dungeon.getState().fight_id).toBe(pending_id)

    expect(abandon_pending_world_fight(pending_id)).toBe(true)

    const store = use_dungeon.getState()
    expect(store.fight_id).toBeNull()
    expect(store.dungeon_id).toBeNull()
    expect(store.run_pass_id).toBeNull()
    expect(store.world_group).toBeNull() // #609: nothing to give back, because nothing was ever claimed
    expect(store.fight_syncing).toBe(false)
    expect(store.spectating).toBe(false)
    expect(fight_store.getState().fight_id).toBeNull() // the core session is closed, the predicted fold gone
    expect(fight_store.getState().view).toBeNull()
    expect(engine_view_of(fight_store.getState())).toBeNull() // nothing left to render, nothing to settle
  })

  test('abandoning is idempotent and never touches a session that already moved on', () => {
    const pending_id = mount()
    abandon_pending_world_fight(pending_id)
    expect(abandon_pending_world_fight(pending_id)).toBe(false)

    const second = mount()
    expect(abandon_pending_world_fight(pending_id)).toBe(false) // a LATE failure from the dead session
    expect(use_dungeon.getState().fight_id).toBe(second)
  })
})

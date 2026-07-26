// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #932 — REFRESHING DURING PLACEMENT STRANDED THE PLAYER IN ROAM.
//
// A player reloading while their world fight sat in PLACEMENT came back to the overworld with no board, no
// error and no log, while the fight was alive on chain still holding their seat. The reads were all healthy:
// /v1 served the fight, the liveness gate returned live/status 0/'placement'. The boot resume simply
// returned without entering.
//
// ROOT CAUSE — two status namespaces, one constant name. fight-liquidation.js declared `STATUS_PLACEMENT = 5`
// (the PROJECTED BOARD VIEW scalar from @aresrpg/fight/board_state, correct for the janitor probes it feeds)
// and reused it in `placement_resume_decision`, which reads a RAW CHAIN decode where placement is 0
// (fight.move). So every real placement fight matched neither branch and fell through to 'skip' — silently.
// ACTIVE is 1 in BOTH namespaces, which is why only placement broke and why a manual force_start to ACTIVE
// made both clients mount the board instantly: the active branch never depended on the wrong constant.
//
// COMPOUNDING: fight-liquidation.js embodies the permissionless janitor in every WATCHING client, so a fight
// nobody can re-enter is also a fight nobody can heal — an expired placement window had no healer at all.
//
// The guard below pins BOTH namespaces so the next reader cannot silently collapse them again.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const FIGHT_ID = '0xplacementfight'
const WORLD_ID = '0xworld'

let read_response = /** @type {(object_id:string) => Promise<any>} */ (
  async () => {
    throw new Error('test read response was not configured')
  }
)
const get_object = mock(({ objectId }) => read_response(objectId))
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

const { use_auth } = await import('../auth')
const { _reset_rpc_client_for_test } = await import('../rpc/client')
const { use_dungeon } = await import('./dungeon_store.js')
const { fight_store } = await import('@aresrpg/fight/store')
const { resume_world_fight } = await import('./world_fight.js')
const { placement_resume_decision } = await import('./fight-liquidation.js')
const { read_fight_liveness } = await import('./fight_liveness.js')
const { CHAIN_STATUS_ACTIVE, CHAIN_STATUS_PLACEMENT } = await import('./fight_chain_status.js')
const { decode_fight } = await import('@aresrpg/sdk/fight')
const { STATUS_PLACEMENT: VIEW_STATUS_PLACEMENT, board_state_from_fight } = await import('@aresrpg/fight/board_state')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch

/** A `json:true`-flattened `fight::Fight` read — CHAIN status scalars only (what decode_fight really sees). */
const fight_object = (status, { placement_deadline_ms = 0, turn_deadline_ms = 0 } = {}) => ({
  object: {
    json: {
      id: FIGHT_ID,
      world: WORLD_ID,
      status,
      placement_deadline_ms: String(placement_deadline_ms),
      turn_deadline_ms: String(turn_deadline_ms),
      last_action_ms: '0',
      participants: [{ addr: OWNER, character: CHARACTER_ID, cell: 0, ready: false, hp: 30, alive: true }],
      mobs: [],
      queue: [],
      turn_ptr: 0,
      board: {},
      group: {},
    },
    version: '9',
  },
})

const serve_v1_fight = (doc) => {
  globalThis.fetch = mock(async (input) => {
    const query = new URL(String(input)).searchParams
    const fights = query.has('id') ? [doc].filter((f) => f.fight_id === query.get('id')) : [doc]
    return new Response(JSON.stringify({ fights }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null })
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
  _reset_rpc_client_for_test()
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null })
  globalThis.fetch = real_fetch
  _reset_rpc_client_for_test()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('#932 — a refresh during PLACEMENT re-enters the fight', () => {
  test('the reported strand: /v1 live + chain placement inside its window ⇒ the board mounts, not roam', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'placement' })
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      // CHAIN placement (0) with an OPEN window — exactly what the live drive observed.
      return fight_object(CHAIN_STATUS_PLACEMENT, { placement_deadline_ms: Date.now() + 60_000 })
    }
    const force_start_door = mock(async () => ({ digest: '0xnever' }))

    // Ground truth first: the app's own liveness gate agrees the fight is live and in placement.
    const liveness = await read_fight_liveness(await get_sdk(), FIGHT_ID)
    expect(liveness.state).toBe('live')
    expect(Number(liveness.fight.status)).toBe(CHAIN_STATUS_PLACEMENT)

    await resume_world_fight(CHARACTER_ID, { force_start_door })

    // The window is open — there is nothing to heal; this is a plain mid-placement refresh.
    expect(force_start_door).not.toHaveBeenCalled()
    // BEFORE THE FIX: the decision fell through to 'skip', so the store stayed empty and the player roamed.
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
    expect(use_dungeon.getState().character_id).toBe(CHARACTER_ID)
    expect(use_dungeon.getState().fight_fresh).toBe(false) // resumed — the entry cinematic never replays
  })

  test('the janitor watch is armed once re-entered: the adopted view carries the placement scalar the probes gate on', () => {
    // The healer chain is: re-enter → refresh adapts the chain read into a BOARD VIEW → dungeon_run_store hands
    // that view to maybe_liquidate → maybe_force_start, which gates on the VIEW placement scalar. A client that
    // cannot re-enter never produces this view — which is why an expired placement window had no healer at all.
    // Asserted on the pure adapter (the fire itself is jittered + wallet-bound, so it is not unit-reachable).
    const expired_window = Date.now() - 180_000
    const view = board_state_from_fight({
      fight: decode_fight(fight_object(CHAIN_STATUS_PLACEMENT, { placement_deadline_ms: expired_window }).object.json),
      version: 9,
    })
    expect(view).not.toBeNull()
    expect(view.status).toBe(VIEW_STATUS_PLACEMENT) // what maybe_force_start requires to arm
    expect(view.placement_deadline_ms).toBe(expired_window) // and an expired window to fire on
  })

  test('a refused resume is never silent — it names the fight and the reason', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'placement' })
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      return fight_object(2, { placement_deadline_ms: Date.now() + 60_000 }) // VICTORY — terminal, not resumable
    }
    const real_console_error = console.error
    const errors = /** @type {string[]} */ ([])
    console.error = mock((...args) => void errors.push(args.join(' ')))
    try {
      await resume_world_fight(CHARACTER_ID, { force_start_door: mock(async () => ({})) })
    } finally {
      console.error = real_console_error
    }

    expect(use_dungeon.getState().fight_id).toBeNull() // terminal stays out of session — that part was right
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain(FIGHT_ID)
    expect(errors[0]).toContain('victory') // the REASON, not just a refusal
  })
})

describe('the two status namespaces stay apart (the #932 guard)', () => {
  const NOW = 1_000_000

  test('chain placement is 0 and view placement is 5 — never collapse them', () => {
    expect(CHAIN_STATUS_PLACEMENT).toBe(0)
    expect(VIEW_STATUS_PLACEMENT).toBe(5)
    expect(CHAIN_STATUS_ACTIVE).toBe(1) // identical in both — the reason the bug hid
  })

  test('placement_resume_decision reads CHAIN scalars, and says why on every refusal', () => {
    expect(placement_resume_decision({ status: CHAIN_STATUS_ACTIVE }, NOW).decision).toBe('enter')
    expect(
      placement_resume_decision({ status: CHAIN_STATUS_PLACEMENT, placement_deadline_ms: NOW + 1 }, NOW).decision
    ).toBe('enter')
    expect(
      placement_resume_decision({ status: CHAIN_STATUS_PLACEMENT, placement_deadline_ms: NOW }, NOW).decision
    ).toBe('liquidate')
    // The view scalar is NOT a chain status — feeding it in must refuse loudly, never be mistaken for placement.
    const view_scalar = placement_resume_decision({ status: VIEW_STATUS_PLACEMENT }, NOW)
    expect(view_scalar.decision).toBe('skip')
    expect(view_scalar.reason).toContain('unknown(5)')
    expect(placement_resume_decision(null, NOW).reason).toBe('fight object unreadable')
  })
})

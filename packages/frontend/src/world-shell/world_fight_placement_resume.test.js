// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #932 — A REFRESH DURING PLACEMENT NEVER CAME BACK TO THE BOARD.
//
// A player reloading while their world fight sat in PLACEMENT came back to the overworld with no board, while
// the fight was alive on chain still holding their seat. Every read was healthy: /v1 served the fight, the
// liveness gate returned live/status 0/'placement'. The boot resume simply refused to enter.
//
// ROOT CAUSE — two status namespaces, one constant name. fight-liquidation.js declares its janitor-probe
// scalars from the PROJECTED BOARD VIEW (@aresrpg/fight/board_state — placement is 5, correct for the adapted
// views maybe_force_start is fed) and `resume_decision` reused them while reading a RAW CHAIN decode, where
// placement is 0 (fight.move, mirrored by the SDK's own status labels). Every real placement fight matched
// neither branch. ACTIVE is 1 in BOTH namespaces, which is why only placement broke, and why a manual
// force_start to ACTIVE made both clients mount the board instantly.
//
// WHAT THE HONEST-EXIT FOLD (513f41de) CHANGED ABOUT THE SYMPTOM: the fall-through is no longer silent, it is
// LOUDER AND WRONG — an unmatched status off a READABLE chain now means terminal, so a live placement fight is
// announced as cleared, the character is released and the seat is abandoned on chain. Same root, worse blast.
//
// COMPOUNDING (why the janitor cannot be the whole cure, #677): fight-liquidation.js embodies the
// permissionless sweeper in every WATCHING client, so a fight nobody can re-enter is a fight nobody can heal.
//
// The guard at the bottom pins BOTH namespaces so the next reader cannot silently collapse them again.

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
const { resume_decision } = await import('./fight-liquidation.js')
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
      // `status: undefined` is the TORN shape (#1277) — the key is absent from the flattened json entirely.
      ...(status == null ? {} : { status }),
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

/** /v1 fights mock: the discovery list (?character=) and the by-id validation both serve `doc`. */
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

const settle_tick = () => new Promise((resolve) => setTimeout(resolve, 0))

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
    await settle_tick()

    // The window is open — there is nothing to heal; this is a plain mid-placement refresh.
    expect(force_start_door).not.toHaveBeenCalled()
    // BEFORE THE FIX: chain placement matched no branch, the readable chain read as terminal, and the honest-exit
    // path released the character ("your expired fight was cleared") while the seat stayed live on chain.
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
      // An expired placement window whose heal never lands: still placement on the re-read ⇒ nothing to mount.
      return fight_object(CHAIN_STATUS_PLACEMENT, { placement_deadline_ms: Date.now() - 180_000 })
    }
    const force_start_door = mock(async () => {
      throw new Error('pre-flight refused (test)')
    })
    const real_console_error = console.error
    const errors = /** @type {string[]} */ ([])
    console.error = mock((...args) => void errors.push(args.join(' ')))
    try {
      // #1751/#2122: the entry consents before it liquidates — this row measures the liquidation mechanics, so it
      // answers directly rather than depending on which way the consent lands (autonomous on a fight's first pass
      // this session, the modal after that). The consent's own behaviour: test/world-shell/world_fight_resume_offer.test.js.
      await resume_world_fight(CHARACTER_ID, { force_start_door, consent: () => 'rejoin' })
      await settle_tick()
    } finally {
      console.error = real_console_error
    }

    expect(force_start_door).toHaveBeenCalledTimes(1) // ONE attempt — the tx-retry burn law, never a loop
    expect(use_dungeon.getState().fight_id).toBeNull() // an unstartable placement board is not presentable
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain(FIGHT_ID)
    expect(errors[0]).toContain('placement') // the REASON, not just a refusal
  })
})

describe('the two status namespaces stay apart (the #932 guard)', () => {
  const NOW = 1_000_000

  test('chain placement is 0 and view placement is 5 — never collapse them', () => {
    expect(CHAIN_STATUS_PLACEMENT).toBe(0)
    expect(VIEW_STATUS_PLACEMENT).toBe(5)
    expect(CHAIN_STATUS_ACTIVE).toBe(1) // identical in both — the reason the bug hid
  })

  test('resume_decision reads CHAIN scalars, and a VIEW scalar is never mistaken for placement', () => {
    expect(resume_decision({ status: CHAIN_STATUS_ACTIVE }, NOW)).toBe('enter')
    expect(resume_decision({ status: CHAIN_STATUS_PLACEMENT, placement_deadline_ms: NOW + 1 }, NOW)).toBe('enter')
    expect(resume_decision({ status: CHAIN_STATUS_PLACEMENT, placement_deadline_ms: NOW }, NOW)).toBe('force_start')
    // The view scalar is NOT a chain status — feeding it in must refuse, never be read as placement.
    expect(resume_decision({ status: VIEW_STATUS_PLACEMENT, placement_deadline_ms: NOW + 1 }, NOW)).toBe('skip')
  })
})

// #1277 — the same gate, fed a TORN read: board intact, `status` gone. Defaulted to 0 it decodes as CHAIN
// placement, which is exactly the shape the test above proves resumable — so a torn read would mount a
// fabricated placement board and hold the seat there. Absence is not a verdict; the gate must refuse to answer.
describe('#1277 — a status-less chain read is never a liveness verdict', () => {
  test('read_fight_liveness throws on a board-intact / status-absent record rather than reporting live placement', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'placement' })
    read_response = async () => fight_object(null, { placement_deadline_ms: Date.now() + 60_000 })

    await expect(read_fight_liveness(await get_sdk(), FIGHT_ID)).rejects.toThrow(/torn read/)
  })
})

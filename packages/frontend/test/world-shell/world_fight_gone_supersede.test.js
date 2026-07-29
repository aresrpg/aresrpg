// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1645 — THE BOOT RESUME UNMOUNTED A LIVE BOARD.
//
// `resume_world_fight` runs at boot for a CHARACTER and takes seconds: two /v1 hops, a chain read, and a
// permissionless liquidation door. A player does not wait — they walk up to a group and engage. When the slow
// resolution of the STALE boot candidate finally lands `gone`, its recovery (`_recover_dead_fight_reference` →
// `reset_local()`) is a FULL session teardown: the fight the player is standing on vanished mid-placement.
//
// Both other exits of that function already refuse to touch a store that moved on ("never stomp it"); the
// `gone` branch was the one that did not. The candidate this pass discovered is stale the moment ANY session
// stands in the store — this resume only ever starts from an empty one (its own entry gate), so whatever is
// mounted now is younger than these reads and owns the seat.
//
// Test seams (house idiom, mirrors world_fight.rejoin.test.js): /v1 via the fetch mock, the chain read via the
// expedition SDK mock — gated on a deferred promise so the "player engages" beat lands INSIDE the await the
// production call site cannot cancel (world_spawns.js passes no `is_current`, so this drives that exact shape).

import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const STALE_FIGHT_ID = '0xstalefight' // the boot candidate /v1 still lists — destroyed on chain by the time we read
const LIVE_FIGHT_ID = '0xlivefight' // what the player engaged while the boot resume was awaiting
const WORLD_ID = '0xworld'

/** The chain read the resume blocks on; the test decides WHEN it answers and with what. */
let chain_read = /** @type {(object_id:string) => Promise<any>} */ (
  async () => {
    throw new Error('test read response was not configured')
  }
)
const get_object = mock(({ objectId }) => chain_read(objectId))
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

const { use_auth } = await import('../../src/auth')
const { default: i18n } = await import('../../src/i18n')
const { _reset_rpc_client_for_test } = await import('../../src/rpc/client')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
const { event_toast_store } = await import('../../src/game/core/toast.js')
const { fight_store } = await import('@aresrpg/fight/store')
const { resume_world_fight } = await import('../../src/world-shell/world_fight.js')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch

/** /v1 fights: the boot discovery (?character=) and the by-id liveness hop both serve the stale candidate as
 *  ACTIVE — the serving node is behind the chain, which is exactly how this candidate reaches the door. */
const serve_stale_candidate = () => {
  globalThis.fetch = mock(async (input) => {
    // The recovery path also heals the roster off /v1 — serve it empty so its read is not an unrelated throw.
    const body = new URL(String(input)).pathname.endsWith('/fights')
      ? { fights: [{ fight_id: STALE_FIGHT_ID, world: WORLD_ID, status: 'active' }] }
      : { characters: [] }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

const settle_tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
/** Is the "your fight was already resolved" claim on the event stack? (title, not count — the stack is capped
 *  and self-dismissing, and the CLAIM is what this fix is about.) */
const cleared_claim_shown = () =>
  event_toast_store.get().some((t) => t.title === i18n.t('fights.expired_fight_cleared'))
/** Let the resume run until it is parked on the chain read (its last await before the `gone` verdict). The two
 *  /v1 hops sit WORLD_POLL_STAGGER_MS (750) apart in the poll scheduler, so this waits in real time. */
const until_chain_read = async () => {
  for (let i = 0; i < 150 && get_object.mock.calls.length === 0; i += 1) await settle_tick(20)
  expect(get_object).toHaveBeenCalled()
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
  serve_stale_candidate()
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

test('RED-FIRST: a stale boot candidate resolving GONE never tears down the fight the player engaged meanwhile', async () => {
  const gate = Promise.withResolvers()
  chain_read = async (object_id) => {
    if (object_id !== STALE_FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
    await gate.promise
    throw { code: 'deleted', message: 'object read failed' } // destroyed — the door's `gone` verdict
  }

  // The production call site (world_spawns.js: `void resume_world_fight(character_id)`) passes NO deps: no
  // is_current, no doors. Anything this pass does after its awaits, it does uncancelled.
  const resume = resume_world_fight(CHARACTER_ID)
  await until_chain_read()

  // …the player walks up to a group and engages. The store IS the mount truth the board renders off.
  use_dungeon.setState({
    fight_id: LIVE_FIGHT_ID,
    dungeon_id: LIVE_FIGHT_ID,
    world_id: WORLD_ID,
    character_id: CHARACTER_ID,
    run_pass_id: null,
    phase: 'playing',
    fight_fresh: true,
    session_address: OWNER,
  })
  gate.resolve(null)
  await resume
  await settle_tick()

  // Pre-fix: `_recover_dead_fight_reference` → reset_local() nulls all of these — the live board unmounts.
  expect(use_dungeon.getState().fight_id).toBe(LIVE_FIGHT_ID)
  expect(use_dungeon.getState().dungeon_id).toBe(LIVE_FIGHT_ID)
  expect(use_dungeon.getState().phase).toBe('playing')
  expect(use_dungeon.getState().character_id).toBe(CHARACTER_ID)
  // …and no "that fight was already resolved" claim about a fight the player never saw.
  expect(cleared_claim_shown()).toBe(false)
})

test('the legitimate path stays: with the store still empty, a GONE candidate recovers the character and says so', async () => {
  chain_read = async (object_id) => {
    if (object_id !== STALE_FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
    throw { code: 'deleted', message: 'object read failed' }
  }
  const recover = mock(() => {})
  use_dungeon.setState({ _recover_dead_fight_reference: recover })
  expect(cleared_claim_shown()).toBe(false)

  await resume_world_fight(CHARACTER_ID)

  expect(recover).toHaveBeenCalledTimes(1)
  expect(recover.mock.calls[0][0]).toMatchObject({ character_id: CHARACTER_ID, state: 'settled' })
  expect(cleared_claim_shown()).toBe(true)
})

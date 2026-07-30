// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1751 / #1757 — THE DOOR: A BOOT MAY NOT SPEND OR RESOLVE A FIGHT ON ITS OWN.
//
// Measured on served `15813ddb0`: every boot onto a chain-seated character re-entered through the dialog-less
// create-adopt path, and the liquidation door then committed the overdue turn — one real gas-burning transaction
// per boot, five boots in the leg, five transactions, no player action anywhere. The same mechanism resolved a
// stranded QA fight as a DEFEAT the player never chose.
//
// The ruled fix is the DOOR: a chain-live seat this client is not mounting gets a CHOICE — rejoin or forfeit —
// and NOTHING commits before that choice arrives. It generalizes #677's entry sweep from placement to active
// fights, and it is scoped to the ENTRY path only: the in-fight liquidation probes (maybe_liquidate /
// maybe_force_start — the permissionless janitors every watching client embodies) keep auto-advancing, because
// there the player is present, watching their own fight run.
//
// Harness idiom mirrors world_fight_gone_supersede.test.js: /v1 through the fetch mock, the chain read through
// the expedition SDK mock, the chain WRITES through the injected doors (nothing signs in a unit test).

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const FIGHT_ID = '0xstrandedfight'
const WORLD_ID = '0xworld'
const HOUR_MS = 3_600_000

/** The chain read the entry blocks on — the test decides what the Fight object says. */
let chain_read = /** @type {(object_id: string) => Promise<any>} */ (
  async () => {
    throw new Error('test read response was not configured')
  }
)
const get_object = mock(({ objectId }) => chain_read(objectId))
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

const { use_auth } = await import('../../src/auth')
const { _reset_rpc_client_for_test } = await import('../../src/rpc/client')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
const { resume_world_fight } = await import('../../src/world-shell/world_fight.js')
const { choose_fight_resume, fight_resume_offer_store, reset_fight_resume_offer } =
  await import('../../src/world-shell/fight_resume_offer.js')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch

/** A Fight object read: ACTIVE, with its turn deadline an hour in the past (the stranded seat of record). */
const stranded_fight = (turn_deadline_ms) => ({
  object: {
    version: 7,
    json: {
      id: FIGHT_ID,
      world: WORLD_ID,
      status: 1, // fight.move ACTIVE
      turn_deadline_ms: String(turn_deadline_ms),
      participants: [],
      mobs: [],
      queue: [],
    },
  },
})

/** /v1 lists the character's live seat (the serving node's projection — how the candidate reaches the door). */
const serve_live_seat = () => {
  globalThis.fetch = mock(async (input) => {
    const body = new URL(String(input)).pathname.endsWith('/fights')
      ? { fights: [{ fight_id: FIGHT_ID, world: WORLD_ID, status: 'active' }] }
      : { characters: [] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

const settle_tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
/** Park until the entry raises its offer (the two /v1 hops sit 750ms apart, then the chain read lands). */
const until_offer = async () => {
  for (let i = 0; i < 400 && !fight_resume_offer_store.get(); i += 1) await settle_tick(10)
  return fight_resume_offer_store.get()
}
const trace_rows = () => /** @type {any[]} */ (globalThis.window?.__ARES_FIGHT_TRACE ?? [])
const traced = (event) => trace_rows().filter((row) => row.event === event)

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
  _reset_rpc_client_for_test()
  reset_fight_resume_offer()
  serve_live_seat()
  const target = /** @type {any} */ (globalThis.window)
  target.__ARES_FIGHT_TRACE_ENABLED = true // the trace rail is dev-gated; this row asserts on it
  target.__ARES_FIGHT_TRACE = []
  chain_read = async (object_id) => {
    if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
    return stranded_fight(Date.now() - HOUR_MS)
  }
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  globalThis.fetch = real_fetch
  _reset_rpc_client_for_test()
  reset_fight_resume_offer()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('#1751 — the entry offers a choice before anything commits', () => {
  test('RED-FIRST: a stranded seat raises the offer and NO transaction is dispatched before the choice', async () => {
    const crank_door = mock(async () => ({ digest: '0xcrank' }))
    const forfeit_door = mock(async () => ({ digest: '0xabandon' }))

    const entry = resume_world_fight(CHARACTER_ID, { crank_door, forfeit_door })
    const offer = await until_offer()

    // Pre-fix: the crank fired here, uninvited — one gas-burning tx per boot (#1757, measured 5-for-5).
    expect(crank_door).not.toHaveBeenCalled()
    expect(forfeit_door).not.toHaveBeenCalled()
    expect(offer).toMatchObject({ fight_id: FIGHT_ID, character_id: CHARACTER_ID, action: 'crank' })
    expect(traced('fight_resume_offer')).toHaveLength(1)
    // …and nothing is mounted while the question stands.
    expect(use_dungeon.getState().fight_id).toBe(null)

    choose_fight_resume('later')
    await entry
    await settle_tick()

    expect(crank_door).not.toHaveBeenCalled()
    expect(traced('fight_resume_choice')[0]).toMatchObject({ choice: 'later' })
  })

  test('REJOIN runs the liquidation door exactly once, then adopts the fight', async () => {
    const crank_door = mock(async () => {
      // the crank advanced the turn: the re-read now sees a live fight inside its deadline
      chain_read = async () => stranded_fight(Date.now() + HOUR_MS)
      return { digest: '0xcrank' }
    })

    const entry = resume_world_fight(CHARACTER_ID, { crank_door })
    await until_offer()
    choose_fight_resume('rejoin')
    await entry
    await settle_tick()

    expect(crank_door).toHaveBeenCalledTimes(1)
    expect(crank_door.mock.calls[0][0]).toBe(FIGHT_ID)
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
    expect(traced('fight_resume_choice')[0]).toMatchObject({ choice: 'rejoin' })
  })

  test('FORFEIT abandons the seat and never cranks the turn toward a defeat nobody chose', async () => {
    const crank_door = mock(async () => ({ digest: '0xcrank' }))
    const forfeit_door = mock(async () => ({ digest: '0xabandon' }))
    const recover = mock(() => {})
    use_dungeon.setState({ _recover_dead_fight_reference: recover })

    const entry = resume_world_fight(CHARACTER_ID, { crank_door, forfeit_door })
    await until_offer()
    choose_fight_resume('forfeit')
    await entry
    await settle_tick()

    expect(crank_door).not.toHaveBeenCalled()
    expect(forfeit_door).toHaveBeenCalledTimes(1)
    expect(forfeit_door.mock.calls[0].slice(0, 2)).toEqual([FIGHT_ID, CHARACTER_ID])
    expect(use_dungeon.getState().fight_id).toBe(null)
    expect(recover).toHaveBeenCalledTimes(1)
    expect(recover.mock.calls[0][0]).toMatchObject({ character_id: CHARACTER_ID, state: 'settled' })
  })

  test('a forfeit whose transaction fails NEVER claims the seat is free (no silent recovery)', async () => {
    const forfeit_door = mock(async () => {
      throw new Error('abandon aborted on chain')
    })
    const recover = mock(() => {})
    use_dungeon.setState({ _recover_dead_fight_reference: recover })

    const entry = resume_world_fight(CHARACTER_ID, { crank_door: mock(async () => ({})), forfeit_door })
    await until_offer()
    choose_fight_resume('forfeit')
    await entry
    await settle_tick()

    expect(forfeit_door).toHaveBeenCalledTimes(1)
    expect(recover).not.toHaveBeenCalled()
  })

  test.each(['en', 'fr', 'de', 'es', 'ja', 'uk'])(
    '%s.json carries the whole door: title, message and all three answers',
    async (lang) => {
      const json = await Bun.file(new URL(`../../src/i18n/locales/${lang}.json`, import.meta.url)).json()

      for (const key of [
        'resume_offer_title',
        'resume_offer_message',
        'resume_offer_rejoin',
        'resume_offer_forfeit',
        'resume_offer_later',
      ]) {
        expect(typeof json?.fights?.[key]).toBe('string')
        expect(json.fights[key].trim().length).toBeGreaterThan(0)
      }
    }
  )

  test('a HEALTHY seat inside its deadline mounts straight away — no dialog, no transaction', async () => {
    const crank_door = mock(async () => ({ digest: '0xcrank' }))
    chain_read = async () => stranded_fight(Date.now() + HOUR_MS)

    await resume_world_fight(CHARACTER_ID, { crank_door })
    await settle_tick()

    expect(fight_resume_offer_store.get()).toBe(null)
    expect(traced('fight_resume_offer')).toHaveLength(0)
    expect(crank_door).not.toHaveBeenCalled()
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
  })
})

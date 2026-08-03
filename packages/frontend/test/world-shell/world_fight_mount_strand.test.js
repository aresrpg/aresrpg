// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2125 — A FAILED CLIENT MOUNT MUST SAY SO. THE SEAT IT LEFT BEHIND IS REAL.
//
// Measured on the 2026-08-03 two-client drive: an engage press executed `fight::create` — the chain showed the
// fight ACTIVE with the character seated — while the client board never mounted, and NOT ONE surface said so.
// The player stood in the overworld with a seat they could not see and no reason to suspect one.
//
// Recovery was never the missing half and is now automatic (#2122: the next candidacy at a held fight answers
// its own consent and rejoins). What was missing is the announcement, so these rows measure exactly that: every
// mount refusal that carries a REAL on-chain fight id toasts + logs + consoles, the one refusal that carries no
// chain seat (the optimistic pending board) stays quiet, a re-entry on an already-mounted board never cries
// wolf, and the whole strand closes — surfaced failure, then the SAME fight rejoining itself on the next pass.
//
// Harness idiom mirrors world_fight_resume_auto.test.js: /v1 through the fetch mock, the chain read through the
// expedition SDK mock, the chain WRITES through injected doors (nothing signs in a unit test).

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const FIGHT_ID = '0xstrandedfight' // the fight the create MINTED — a live seat, whatever the client managed to do
const OTHER_FIGHT_ID = '0xothersession' // whatever already owns the shared store when the receipt lands
const WORLD_ID = '0xworld'
const HOUR_MS = 3_600_000

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
const { enter_world_fight, rekey_world_fight, resume_world_fight } =
  await import('../../src/world-shell/world_fight.js')
const { dismiss_event_toast, event_toast_store } = await import('../../src/game/core/toast.js')
const { _reset_log_for_test, get_log_buffer } = await import('../../src/core/log.js')
const en = await Bun.file(new URL('../../src/i18n/locales/en.json', import.meta.url)).json()

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch
const real_console_error = console.error
let console_error = mock(() => {})

const settle_tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const toasts = () => event_toast_store.get()
const strand_logs = () =>
  get_log_buffer().filter((row) => row.ns === 'world-fight' && row.message.includes('mount failed'))
const trace_rows = () => /** @type {any[]} */ (globalThis.window?.__ARES_FIGHT_TRACE ?? [])
const traced = (event) => trace_rows().filter((row) => row.event === event)

/** A Fight object read: ACTIVE, its turn deadline an hour in the past — the stranded seat of record. */
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

/** /v1 lists the character's live seat — the projection that carries the held fight into the next candidacy. */
const serve_live_seat = () => {
  globalThis.fetch = mock(async (input) => {
    const body = new URL(String(input)).pathname.endsWith('/fights')
      ? { fights: [{ fight_id: FIGHT_ID, world: WORLD_ID, status: 'active' }] }
      : { characters: [] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
  _reset_rpc_client_for_test()
  _reset_log_for_test()
  serve_live_seat()
  for (const toast of toasts()) dismiss_event_toast(toast.id)
  console_error = mock(() => {})
  console.error = console_error
  const target = /** @type {any} */ (globalThis.window)
  target.__ARES_FIGHT_TRACE_ENABLED = true // the trace rail is dev-gated; the self-heal row asserts on it
  target.__ARES_FIGHT_TRACE = []
  chain_read = async (object_id) => {
    if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
    return stranded_fight(Date.now() - HOUR_MS)
  }
})

afterEach(() => {
  console.error = real_console_error
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  globalThis.fetch = real_fetch
  _reset_rpc_client_for_test()
  _reset_log_for_test()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

/** The whole surface, asserted as one: the player's toast AND the two lines a bug report is written from. */
const expect_strand_surfaced = (reason) => {
  const toast = toasts().at(-1)
  expect(toast).toMatchObject({ state: 'error', title: en.fights.mount_failed_title })
  expect(toast?.message).toBe(en.fights.mount_failed_message)
  // The copy is the promise the auto-rejoin keeps: the seat is HELD, and it comes back by itself.
  expect(en.fights.mount_failed_message).toContain('rejoin')

  expect(strand_logs()).toHaveLength(1)
  expect(strand_logs()[0].message).toContain(reason)

  expect(console_error).toHaveBeenCalledTimes(1)
  expect(String(console_error.mock.calls[0][0])).toContain('[world-fight] mount failed')
}

describe('#2125 — the mount refusal that strands a chain seat announces itself', () => {
  test('RED-FIRST: a receipt-time entry refused by a live session toasts, logs and consoles', () => {
    // A session already owns the shared store when the create receipt lands — the entry refuses ('busy') and,
    // pre-#2125, returned into the void: no toast, no error line, only a dev-gated trace nobody reads.
    use_dungeon.setState({ fight_id: OTHER_FIGHT_ID })

    enter_world_fight({ fight_id: FIGHT_ID, world_id: WORLD_ID, character_id: CHARACTER_ID })

    expect_strand_surfaced('busy')
    expect(strand_logs()[0].message).toContain(FIGHT_ID)
    expect(use_dungeon.getState().fight_id).toBe(OTHER_FIGHT_ID) // and the live board is still untouched
  })

  test('RED-FIRST: a stale re-key on a MINTED fight is the same strand, said the same way', () => {
    // The pending session this create was ordered from is gone (superseded/torn down), so the id the receipt
    // minted has no home. The board is real on chain; nothing will render it.
    expect(rekey_world_fight('pending:someone-elses-session', FIGHT_ID)).toBe(false)

    expect_strand_surfaced('rekey_stale')
    expect(traced('fight_pending_rekey_stale')).toHaveLength(1)
  })

  test('RED-FIRST: an entry with no character to seat is a refusal that still holds a seat', () => {
    enter_world_fight({ fight_id: FIGHT_ID, world_id: WORLD_ID, character_id: null })

    expect_strand_surfaced('invalid')
  })

  test('the same id re-entering its own mounted board never cries wolf', () => {
    // 'same' is the receipt catching up with a board that is already up — enriching it, not failing.
    use_dungeon.setState({ fight_id: FIGHT_ID })

    enter_world_fight({ fight_id: FIGHT_ID, world_id: WORLD_ID, character_id: CHARACTER_ID })

    expect(toasts()).toHaveLength(0)
    expect(strand_logs()).toHaveLength(0)
    expect(console_error).not.toHaveBeenCalled()
  })

  test('a re-key with no minted fight id claims no strand — there is no seat to hold', () => {
    // The create never named a fight, so this is the abandon path, not the stranded one.
    expect(rekey_world_fight('pending:aborted-session', null)).toBe(false)

    expect(toasts()).toHaveLength(0)
    expect(strand_logs()).toHaveLength(0)
  })

  test('the engage arm that mints NO fight id announces the strand it cannot name', async () => {
    // engage() is an un-exported closure over the engine context, so this arm is pinned by source shape (the
    // world_spawns.test.js idiom). A receipt with no fight id is a create that EXECUTED — a failed one throws —
    // so the seat may be held while nothing here can ever mount it.
    const source = await Bun.file(new URL('../../src/game/world_spawns.js', import.meta.url)).text()
    const abandon_at = source.indexOf('abandon_pending_world_fight(pending_id)\n        report_fight_mount_failure')

    expect(source).toContain('report_fight_mount_failure,') // imported from the one surface home
    expect(abandon_at, 'the unnamed-create arm kills the pending session AND says so').toBeGreaterThan(-1)
    expect(source.indexOf("reason: 'no_fight_id'", abandon_at)).toBeGreaterThan(abandon_at)
  })

  test('THE STRAND CLOSES: the surfaced failure is followed by the SAME fight rejoining itself', async () => {
    use_dungeon.setState({ fight_id: OTHER_FIGHT_ID })
    enter_world_fight({ fight_id: FIGHT_ID, world_id: WORLD_ID, character_id: CHARACTER_ID })
    expect_strand_surfaced('busy')

    // The session that blocked the mount ends (a teardown, a reload — the player is back in the world with
    // nothing mounted). The seat, meanwhile, is exactly where the toast said it was: held on chain.
    use_dungeon.setState(initial_dungeon, true)
    const crank_door = mock(async () => {
      chain_read = async () => stranded_fight(Date.now() + HOUR_MS) // the crank advanced the overdue turn
      return { digest: '0xcrank' }
    })

    await resume_world_fight(CHARACTER_ID, { crank_door })
    await settle_tick()

    // The autonomous answer (#2122 → D48) — no dialog, one transaction, and it is the player's own rejoin.
    expect(traced('fight_resume_auto')).toHaveLength(1)
    expect(traced('fight_resume_auto')[0]).toMatchObject({ fight_id: FIGHT_ID, character_id: CHARACTER_ID })
    expect(traced('fight_resume_offer')).toHaveLength(0)
    expect(crank_door).toHaveBeenCalledTimes(1)
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID) // the seat the failed mount left behind, mounted
    expect(strand_logs()).toHaveLength(1) // …and the recovery never re-announces the strand it healed
  }, 20_000)

  test.each(['en', 'fr', 'de', 'es', 'ja', 'uk'])('%s.json carries both halves of the strand copy', async (lang) => {
    const json = await Bun.file(new URL(`../../src/i18n/locales/${lang}.json`, import.meta.url)).json()

    for (const key of ['mount_failed_title', 'mount_failed_message']) {
      expect(typeof json?.fights?.[key]).toBe('string')
      expect(json.fights[key].trim().length).toBeGreaterThan(0)
    }
  })
})

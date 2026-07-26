// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #978 — THE BOOT HEAL RACED ITS OWN EFFECTS.
//
// Driven proof on PR #966 (two fights, digests KH37SNmt… / 6LH9GGwt…): `ensure_resumable_fight` fires
// `force_start` on an expired placement window, the tx SUCCEEDS and the fight goes ACTIVE — but the door
// resolves on CERTIFIED effects (dungeon_actions' EXECUTE-CERT fast path skips the finality wait), so the
// READ node has not indexed it yet. The immediate re-read still sees expired placement, the boot refuses with
// "its force_start door did not land", the healing client never mounts — and since the janitor population is
// exactly the clients that refused, nothing else ever heals it (15.6 minutes observed untouched).
//
// The fix is to OBSERVE the sent transaction before judging it: wait on its digest through the house door
// (`grpc_client.core.waitForTransaction`, the same call world_join.js and tx.js use), THEN re-read. Never
// re-fire — `turns::force_start` asserts status==placement, so a second send aborts (tx-retry burn law).
//
// #940 rides the same missing fact: the heal's fire now claims the SAME per-deadline dedup the watching probe
// gates on, so the probe can no longer pay a second, aborting `force_start` for a window this pass started.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const FIGHT_ID = '0xplacementfight'
const WORLD_ID = '0xworld'
const DIGEST = 'KH37SNmtTestDigest'

let read_response = /** @type {(object_id: string) => Promise<any>} */ (
  async () => {
    throw new Error('test read response was not configured')
  }
)
const get_object = mock(({ objectId }) => read_response(objectId))
const wait_for_transaction = mock(async () => ({ Transaction: {} }))
const get_sdk = async () => ({
  grpc_client: { core: { getObject: get_object, waitForTransaction: wait_for_transaction } },
})
set_expedition_sdk_mock(get_sdk)

const { use_auth } = await import('../auth')
const { ensure_resumable_fight, maybe_force_start, reset_liquidation } = await import('./fight-liquidation.js')
const { CHAIN_STATUS_ACTIVE, CHAIN_STATUS_PLACEMENT } = await import('./fight_chain_status.js')
const { STATUS_PLACEMENT: VIEW_STATUS_PLACEMENT } = await import('@aresrpg/fight/board_state')

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

const EXPIRED_WINDOW = () => Date.now() - 180_000

/**
 * The reported race, as a read function: the placement window is expired and STAYS expired to this node until
 * the transaction is observed — which is exactly what a fullnode that has certified but not yet indexed the tx
 * serves. `confirm()` is what waitForTransaction resolving means.
 */
const racing_reads = () => {
  let indexed = false
  read_response = async (object_id) => {
    if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
    return indexed
      ? fight_object(CHAIN_STATUS_ACTIVE, { turn_deadline_ms: Date.now() + 60_000 })
      : fight_object(CHAIN_STATUS_PLACEMENT, { placement_deadline_ms: EXPIRED_WINDOW() })
  }
  return () => {
    indexed = true
  }
}

const settle_tick = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  use_auth.setState({ address: OWNER })
  reset_liquidation()
  get_object.mockClear()
  wait_for_transaction.mockClear()
})

afterEach(() => {
  reset_liquidation()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('#978 — the boot heal observes its own transaction before judging it', () => {
  test('the reported wedge: effects readable only AFTER confirmation ⇒ the heal enters, never refuses', async () => {
    const confirm = racing_reads()
    // The door resolves the instant its effects are CERTIFIED — the read node is still one beat behind.
    const force_start_door = mock(async () => ({ digest: DIGEST, effects: { status: { status: 'success' } } }))
    wait_for_transaction.mockImplementation(async () => {
      confirm()
      return { Transaction: {} }
    })

    const { decision, reason } = await ensure_resumable_fight(FIGHT_ID, { force_start_door })

    expect(force_start_door).toHaveBeenCalledTimes(1) // ONE send, ever — force_start asserts placement
    expect(wait_for_transaction).toHaveBeenCalledTimes(1)
    expect(wait_for_transaction.mock.calls[0][0].digest).toBe(DIGEST)
    // BEFORE THE FIX: the re-read fired before the wait, still saw an expired window, and this was
    // { decision: 'skip', reason: '… its force_start door did not land' } — the 15.6-minute wedge.
    expect(decision).toBe('enter')
    expect(reason).toContain('active')
  })

  test('a wait that times out still refuses — but the refusal names the digest', async () => {
    racing_reads() // never confirmed: the node keeps serving the expired window
    const force_start_door = mock(async () => ({ digest: DIGEST, effects: { status: { status: 'success' } } }))
    wait_for_transaction.mockImplementation(async () => {
      throw new Error('waitForTransaction timed out (test)')
    })

    const { decision, reason } = await ensure_resumable_fight(FIGHT_ID, { force_start_door })

    expect(decision).toBe('skip') // an unstartable placement board is still not presentable
    expect(reason).toContain(DIGEST) // …but a bug report can now name the transaction that DID execute
    expect(force_start_door).toHaveBeenCalledTimes(1) // never a second send
  })

  test('a PRE-FLIGHT door failure has no digest to observe — the old refusal is unchanged', async () => {
    racing_reads()
    const force_start_door = mock(async () => {
      throw new Error('pre-flight refused (test)')
    })

    const { decision, reason } = await ensure_resumable_fight(FIGHT_ID, { force_start_door })

    expect(decision).toBe('skip')
    expect(reason).toContain('did not land')
    expect(wait_for_transaction).not.toHaveBeenCalled() // nothing was sent — nothing to observe
  })
})

describe('#940 — the heal and the probe share ONE dedup per deadline', () => {
  // The probe arms synchronously and does its store re-check inside a jittered timeout; pinning the jitter to 0
  // makes "did it arm?" observable in one tick — `get` is called if and only if the probe fired.
  const real_random = Math.random
  const armed_probe = async (view) => {
    const get = mock(() => ({ dungeon: null, busy: true, refresh: async () => {} }))
    Math.random = () => 0
    try {
      maybe_force_start(view, get)
      await settle_tick()
    } finally {
      Math.random = real_random
    }
    return get.mock.calls.length > 0
  }

  const expired_view = (placement_deadline_ms) => ({
    id: FIGHT_ID,
    status: VIEW_STATUS_PLACEMENT,
    placement_deadline_ms,
  })

  test('control: an expired placement window with no prior fire DOES arm the probe', async () => {
    expect(await armed_probe(expired_view(EXPIRED_WINDOW()))).toBe(true)
  })

  test('a window the boot heal just force-started never gets a second, aborting send', async () => {
    const window_ms = EXPIRED_WINDOW()
    read_response = async () => fight_object(CHAIN_STATUS_PLACEMENT, { placement_deadline_ms: window_ms })
    const force_start_door = mock(async () => ({ digest: DIGEST, effects: { status: { status: 'success' } } }))

    await ensure_resumable_fight(FIGHT_ID, { force_start_door })
    expect(force_start_door).toHaveBeenCalledTimes(1)

    // BEFORE THE FIX: the probe's snapshot predates the heal, its own latch was never claimed, and ~4s later it
    // paid a second `force_start` that executed and aborted (code 101) — one wasted gas payment per healed boot.
    expect(await armed_probe(expired_view(window_ms))).toBe(false)
  })

  test('a PRE-FLIGHT failure burns nothing and leaves the probe free to heal the window', async () => {
    const window_ms = EXPIRED_WINDOW()
    read_response = async () => fight_object(CHAIN_STATUS_PLACEMENT, { placement_deadline_ms: window_ms })
    const force_start_door = mock(async () => {
      throw new Error('pre-flight refused (test)')
    })

    await ensure_resumable_fight(FIGHT_ID, { force_start_door })

    expect(await armed_probe(expired_view(window_ms))).toBe(true)
  })
})

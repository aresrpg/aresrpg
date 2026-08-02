// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2057 RED-FIRST — THE #2054 LIE, ONE CONSUMER UP. The read seam now throws typed failures and returns `null`
// only for genuine absence, but `friends_reads.read_friend_list` caught EVERYTHING into `{ list_id: null,
// friends: [] }`: a dead transport reached the reducer as a perfectly good snapshot of an empty roster, so a
// network blip silently emptied the social surface. Absent is DATA; failed is an ERROR — the discrimination
// has to survive the hop out of the SDK, or the seam's honesty stops at its own file.
//
// These rows drive the REAL path — friends_adapter.refresh_friends → friends_reads.read_roster → the SDK's
// `get_friend_list_by_owner` → `_object.get_object_json` — against a grpc client that answers the way the wire
// actually answers (probed in _object.js): a transport failure carries an rpc `code`, while the ledger's own
// "no such object" answer is a plain Error naming the id. Only the store's own degraded input (`load_failed`,
// the treatment the presence family already ships) may result from the first; the second stays an empty roster.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals()

const { read_friend_list, read_roster } = await import('../../src/world-shell/friends_reads.js')
const { friends_input, friends_store, refresh_friends } = await import('../../src/world-shell/friends_adapter.js')

afterAll(restore_browser_globals)

const OWNER = `0x${'a1'.repeat(32)}`
const FRIEND = `0x${'b2'.repeat(32)}`

/** A transport failure: the call never reached an answer. `code` is what an RpcError carries on the wire. */
const TRANSPORT_DOWN = () => ({
  core: {
    getObject: async () => {
      throw Object.assign(new Error('Unable to connect to the fullnode'), { code: 'INTERNAL' })
    },
  },
})

/** The ledger's own per-object "not found" ANSWER — the call SUCCEEDED and stated absence. */
const LEDGER_SAYS_ABSENT = () => ({
  core: {
    getObject: async (/** @type {{ objectId: string }} */ { objectId }) => {
      throw new Error(`Object ${objectId} not found`)
    },
  },
})

/** A real, decodable FriendList carrying one address. */
const LIST_WITH_ONE_FRIEND = () => ({
  core: {
    getObject: async (/** @type {{ objectId: string }} */ { objectId }) => ({
      object: { json: { id: objectId, owner: OWNER, friends: { contents: [FRIEND] } } },
    }),
  },
})

const real_fetch = globalThis.fetch

beforeEach(() => {
  // /v1 enrichment is not what these rows measure — answer it honestly and emptily.
  globalThis.fetch = async () => new Response(JSON.stringify({ characters: [] }), { status: 200 })
  friends_input({ type: 'session_bound', address: null })
  friends_input({ type: 'session_bound', address: OWNER })
})

afterEach(() => {
  globalThis.fetch = real_fetch
  reset_expedition_sdk_mock()
})

describe('#2057 · a failed friend-list read is never an empty roster', () => {
  test('RED: a transport failure PROPAGATES out of read_friend_list instead of painting an empty roster', async () => {
    set_expedition_sdk_mock(async () => ({ grpc_client: TRANSPORT_DOWN() }))

    expect(read_friend_list(OWNER)).rejects.toThrow()
    await expect(read_roster(OWNER)).rejects.toThrow()
  })

  test('RED: the panel state after a failed read is DEGRADED — never a good snapshot of zero friends', async () => {
    set_expedition_sdk_mock(async () => ({ grpc_client: TRANSPORT_DOWN() }))

    await refresh_friends(OWNER)

    const state = friends_store.getState()
    expect(state.error).toBeTruthy() // the honest degraded treatment (load_failed), not a snapshot
    expect(state.rows).toEqual([]) // nothing invented either — we know NOTHING, and say so
  })

  test('CONTROL: the ledger answering "no such list" stays a genuine empty roster (the create-first flow)', async () => {
    set_expedition_sdk_mock(async () => ({ grpc_client: LEDGER_SAYS_ABSENT() }))

    expect(await read_friend_list(OWNER)).toEqual({ list_id: null, friends: [] })

    await refresh_friends(OWNER)
    const state = friends_store.getState()
    expect(state.error).toBeNull()
    expect(state.loaded).toBe(true)
    expect(state.rows).toEqual([])
  })

  test('CONTROL: a real list still reconciles into rows', async () => {
    set_expedition_sdk_mock(async () => ({ grpc_client: LIST_WITH_ONE_FRIEND() }))

    await refresh_friends(OWNER)
    const state = friends_store.getState()
    expect(state.error).toBeNull()
    expect(state.rows.map((row) => row.address)).toEqual([FRIEND])
  })
})

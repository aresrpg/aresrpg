// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1759 RED: a newly created FriendList is certified before the fullnode can resolve it as an owned object.
// The first add must observe that object before gas-guard simulation; otherwise the zero-gas refusal is swallowed
// and only a manual retry succeeds.
import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'
import { use_toast } from '../../src/toast'

const address = (digit) => `0x${digit.repeat(64)}`
const OWNER = address('a')
const FRIEND = address('b')
const LIST = address('c')

reset_auth_mock()

let object_reads = 0
let add_succeeded = false
let add_refusal
const tx_classes = []

const friends_adapter = await import('../../src/world-shell/friends_adapter.js')
const tx_module = await import('../../src/world-shell/tx.js')

const run_tx = spyOn(tx_module, 'run_tx').mockImplementation(async (klass) => {
  tx_classes.push(klass)
  if (klass === 'friends_create')
    return {
      result: {
        objectChanges: [{ type: 'created', objectType: '0xsocial::friends::FriendList', objectId: LIST }],
      },
    }
  if (klass === 'friends_add') {
    if (object_reads < 2) {
      add_refusal = new Error(`RpcError: Object ${LIST} not found`)
      throw add_refusal
    }
    add_succeeded = true
    return { result: { effects: { status: { status: 'success' } } } }
  }
  throw new Error(`unexpected tx class ${klass}`)
})

const refresh_friends = spyOn(friends_adapter, 'refresh_friends').mockImplementation(async () => {})
const toast_promise = spyOn(use_toast.getState(), 'promise').mockImplementation(async (task) =>
  typeof task === 'function' ? task() : task
)

const get_sdk = async () => ({
  grpc_client: {
    core: {
      getObject: mock(async () => {
        object_reads += 1
        return object_reads < 2
          ? { object: null }
          : { object: { json: { id: LIST, owner: OWNER, friends: { contents: [] } } } }
      }),
    },
  },
})
set_expedition_sdk_mock(get_sdk)

const { add_friend_flow } = await import('../../src/world-shell/friends_actions.js')

beforeEach(() => {
  object_reads = 0
  add_succeeded = false
  add_refusal = undefined
  tx_classes.length = 0
  set_expedition_sdk_mock(get_sdk)
  friends_adapter.friends_input({ type: 'session_bound', address: null })
  friends_adapter.friends_input({ type: 'session_bound', address: OWNER })
  friends_adapter.friends_input({ type: 'snapshot', address: OWNER, list_id: null, rows: [] })
})

afterEach(() => {
  reset_expedition_sdk_mock()
})

afterAll(() => {
  run_tx.mockRestore()
  refresh_friends.mockRestore()
  toast_promise.mockRestore()
})

test('first-ever add waits for the created FriendList to become readable before submitting add', async () => {
  await add_friend_flow(OWNER, FRIEND)

  if (add_refusal) throw add_refusal
  expect(object_reads).toBe(2)
  expect(tx_classes).toEqual(['friends_create', 'friends_add'])
  expect(add_succeeded).toBe(true)
  expect(friends_adapter.use_friends.getState().rows.map((row) => row.address)).toEqual([FRIEND])
})

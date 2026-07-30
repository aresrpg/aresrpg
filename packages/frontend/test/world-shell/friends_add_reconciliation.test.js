// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { create_friends_store } from '@aresrpg/world/friends'

const owner = '0xowner'
const friend = '0xfriend'

const ready_store = () => {
  const store = create_friends_store()
  store.getState().input({ type: 'session_bound', address: owner })
  store.getState().input({ type: 'snapshot', address: owner, list_id: '0xlist', rows: [] }, 1_000)
  return store
}

describe('add-friend optimistic reconciliation', () => {
  test('a failed async add rolls its exact optimistic row back through the reducer', () => {
    const store = ready_store()
    const request_id = Symbol('add-friend')
    const { input } = store.getState()

    input({ type: 'friend_add_started', address: owner, friend, request_id }, 1_050)
    expect(store.getState().rows.map((row) => row.address)).toEqual([friend])
    expect(store.getState().optimistic_adds[friend]).toMatchObject({ request_id, phase: 'pending' })

    input({ type: 'friend_add_failed', address: owner, friend, request_id }, 1_100)
    expect(store.getState().rows).toEqual([])
    expect(store.getState().optimistic_adds).toEqual({})
  })

  test('success confirms the optimistic floor until an authoritative snapshot reconciles it', () => {
    const store = ready_store()
    const request_id = Symbol('add-friend')
    const { input } = store.getState()

    input({ type: 'friend_add_started', address: owner, friend, request_id }, 1_050)
    input({ type: 'friend_add_succeeded', address: owner, friend, request_id, list_id: '0xlist' }, 1_100)
    expect(store.getState().optimistic_adds[friend]).toMatchObject({ request_id, phase: 'confirmed' })

    input({ type: 'snapshot', address: owner, list_id: '0xlist', rows: [] }, 1_200)
    expect(store.getState().rows.map((row) => row.address)).toEqual([friend])

    input({
      type: 'snapshot',
      address: owner,
      list_id: '0xlist',
      rows: [{ address: friend, name: 'Ares', jobs: { smith: 25 } }],
    })
    expect(store.getState().rows).toEqual([{ address: friend, name: 'Ares', jobs: { smith: 25 } }])
    expect(store.getState().optimistic_adds).toEqual({})

    input({ type: 'friend_add_failed', address: owner, friend, request_id }, 1_300)
    expect(store.getState().rows).toEqual([{ address: friend, name: 'Ares', jobs: { smith: 25 } }])
  })

  test('the async edge returns all three outcomes through the friend input door', () => {
    const source = readFileSync(new URL('../../src/world-shell/friends_actions.js', import.meta.url), 'utf8')
    expect(source).toContain("type: 'friend_add_started'")
    expect(source).toContain("type: 'friend_add_succeeded'")
    expect(source).toContain("type: 'friend_add_failed'")
    expect(source).not.toContain('friends_store.setState')
    expect(source).not.toContain('use_friends.setState')
  })
})

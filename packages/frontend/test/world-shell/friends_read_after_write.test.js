// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ROW #1666 RED: the confirmed add is a reducer input, visible before any read-layer poll, and held across a
// lagging snapshot until the authoritative row catches up.
import { describe, expect, test } from 'bun:test'
import { create_friends_store } from '@aresrpg/world/friends'

const OWNER = '0xowner'
const FRIEND = '0xfriend'

describe('row #1666 — confirmed friend add folds optimistically and reconciles', () => {
  test('confirmed add is visible on the same reducer turn, not after the former 6s+ read cadence', () => {
    const store = create_friends_store()
    const { input } = store.getState()
    input({ type: 'session_bound', address: OWNER })
    input({ type: 'snapshot', address: OWNER, list_id: '0xlist', rows: [] }, 1_000)
    input({ type: 'friend_added', address: OWNER, list_id: '0xlist', friend: FRIEND }, 1_050)

    expect(store.getState().rows.map((row) => row.address)).toEqual([FRIEND])
    expect(store.getState().optimistic_adds).toHaveProperty(FRIEND)
  })

  test('a lagging negative is ignored; an agreeing enriched snapshot drains the optimistic floor', () => {
    const store = create_friends_store()
    const { input } = store.getState()
    input({ type: 'session_bound', address: OWNER })
    input({ type: 'friend_added', address: OWNER, list_id: '0xlist', friend: FRIEND }, 1_000)
    input({ type: 'snapshot', address: OWNER, list_id: '0xlist', rows: [] }, 7_000)
    expect(store.getState().rows.map((row) => row.address)).toEqual([FRIEND])

    input({
      type: 'snapshot',
      address: OWNER,
      list_id: '0xlist',
      rows: [{ address: FRIEND, name: 'Ares', jobs: { smith: 25 } }],
    })
    expect(store.getState().rows).toEqual([{ address: FRIEND, name: 'Ares', jobs: { smith: 25 } }])
    expect(store.getState().optimistic_adds).toEqual({})
  })
})

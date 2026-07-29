// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#327): the friend entry reached the dragon reducer with only an address. Roster worlds and live
// presence character/cells were both available to the surface, but the menu discarded those facts and the
// resolver guessed an arbitrary owned character later. Offline rows entered that same stale-anchor path without
// a reason.

import { describe, expect, test } from 'bun:test'

import { dispatch_fast_travel, fast_travel_intent } from './fast_travel_intent.js'

const live_friend = {
  kind: 'friend',
  address: '0xfriend',
  name: 'Ares',
  routes: [{ character_id: 'C_FRIEND', world_id: 'W_FAR' }],
}
const live_peer = {
  id: 'C_FRIEND',
  cell: { x: 42, y: -7, ts: 2_000 },
  position: { x: 42, z: -7 },
}

describe('friend entry → the shared fast-travel input door', () => {
  test('dispatches one begin intent carrying the live character, roster world, and presence cell', () => {
    const dispatched = []
    const intent = dispatch_fast_travel(live_friend, (input) => dispatched.push(input), [live_peer])

    expect(intent).toEqual({
      type: 'begin',
      character_id: 'C_FRIEND',
      address: '0xfriend',
      name: 'Ares',
      world_id: 'W_FAR',
      x: 42,
      z: -7,
      live: true,
    })
    expect(dispatched).toEqual([intent])
  })

  test('an offline friend dispatches the honest offline refusal, never a stale travel begin', () => {
    const intent = fast_travel_intent(live_friend, [])

    expect(intent).toEqual({ type: 'begin', refusal: 'fast_travel.friend_offline' })
  })

  // #1641 — with the presence stream dead we do not KNOW where anyone is. Saying "that friend is offline" or
  // "a realm you can't reach" states a fact we cannot have; the outage itself is the honest answer.
  test('a DEAD presence stream refuses as an outage, never as offline or an unreachable realm', () => {
    expect(fast_travel_intent(live_friend, [], 'failed')).toEqual({
      type: 'begin',
      refusal: 'fast_travel.presence_down',
    })
    expect(fast_travel_intent(live_friend, [], 'idle')).toEqual({
      type: 'begin',
      refusal: 'fast_travel.presence_down',
    })
    expect(fast_travel_intent(live_friend, [{}], 'failed')).toEqual({
      type: 'begin',
      refusal: 'fast_travel.presence_down',
    })
  })

  test('a stream still trying (connecting/reconnecting) is not an outage — the honest offline answer stands', () => {
    expect(fast_travel_intent(live_friend, [], 'reconnecting').refusal).toBe('fast_travel.friend_offline')
    expect(fast_travel_intent(live_friend, [live_peer], 'reconnecting')).toMatchObject({ character_id: 'C_FRIEND' })
  })

  // #1641 — an online friend with no live pose used to be "a realm you can't reach", which is a lie about the
  // WORLD: presence and reachability are the read layer's, and the resolver reads the target's own /v1 document
  // for its world and anchor position. A pose only REFINES the landing coordinate; its absence never refuses.
  test('an online friend without an accepted cell still travels — the /v1 resolver decides, never a refusal', () => {
    const intent = fast_travel_intent(live_friend, [{ ...live_peer, cell: { x: 0, y: 0, ts: 0 } }])

    expect(intent).toEqual({
      type: 'begin',
      character_id: 'C_FRIEND',
      address: '0xfriend',
      name: 'Ares',
      world_id: 'W_FAR',
    })
  })

  test('a friend the read layer sees but the roster has no route for resolves through /v1 too', () => {
    const intent = fast_travel_intent({ ...live_friend, routes: [] }, [{ id: 'C_FRIEND' }])

    expect(intent).toMatchObject({ type: 'begin', character_id: 'C_FRIEND', world_id: null })
    expect(intent.refusal).toBeUndefined()
  })

  test('a route that names NO world is still an honest refusal (the character is in no world to reach)', () => {
    const intent = fast_travel_intent(
      { ...live_friend, routes: [{ character_id: 'C_FRIEND', world_id: null }] },
      [{ id: 'C_FRIEND' }]
    )

    expect(intent).toEqual({ type: 'begin', refusal: 'fast_travel.realm_unreachable' })
  })

  test('selects the freshest live alt and its matching roster world, never the first wallet character', () => {
    const friend = {
      ...live_friend,
      routes: [
        { character_id: 'C_OLD', world_id: 'W_OLD' },
        { character_id: 'C_FRIEND', world_id: 'W_FAR' },
      ],
    }
    const old_peer = { id: 'C_OLD', cell: { ts: 1_000 }, position: { x: 1, z: 1 } }

    expect(fast_travel_intent(friend, [old_peer, live_peer])).toMatchObject({
      character_id: 'C_FRIEND',
      world_id: 'W_FAR',
      x: 42,
      z: -7,
    })
  })

  test('an in-world player keeps the existing identity-only begin contract', () => {
    expect(fast_travel_intent({ id: 'C_WORLD', address: '0xworld', name: 'Kessa' })).toEqual({
      type: 'begin',
      character_id: 'C_WORLD',
      address: '0xworld',
      name: 'Kessa',
    })
  })
})

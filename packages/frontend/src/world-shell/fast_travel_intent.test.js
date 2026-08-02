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

  // ADVISORY-ONLY LAW (realtime constitution D2): an observation may never answer an authority question.
  // "Nobody is observing this friend" is UNKNOWN — it is not "this friend is offline", and it is not a reason
  // to refuse. The authoritative /v1 roster read already names the character and its world; travel proceeds
  // on that read and the resolver verifies it.
  test('a friend nobody observes still travels on the authoritative route — absence is unknown, never offline', () => {
    expect(fast_travel_intent(live_friend, [])).toEqual({
      type: 'begin',
      character_id: 'C_FRIEND',
      address: '0xfriend',
      name: 'Ares',
      world_id: 'W_FAR',
    })
  })

  // The peer stream's own health is not an input either: it can only refine a coordinate, so an outage in it
  // changes nothing about what the authoritative read proved.
  test('the observation stream decides nothing — observed or not, the same authoritative begin', () => {
    expect(fast_travel_intent(live_friend, [])).toEqual(fast_travel_intent(live_friend, [{}]))
  })

  // Identity that enables a consequential flow may never be peer-carried: a character id nobody authoritative
  // named is not a travel target. With no route, the begin names the wallet only and the /v1 resolver picks.
  test('a peer-carried character id the roster does not name never becomes the travel target', () => {
    expect(fast_travel_intent({ ...live_friend, routes: [] }, [{ ...live_peer, id: 'C_UNLISTED' }])).toEqual({
      type: 'begin',
      character_id: null,
      address: '0xfriend',
      name: 'Ares',
      world_id: null,
    })
  })

  test('a pose broadcast for a character the roster does not name never refines the landing coordinate', () => {
    const intent = fast_travel_intent(live_friend, [
      { id: 'C_UNLISTED', cell: { ts: 9_999 }, position: { x: 999, z: 999 } },
    ])

    expect(intent).toEqual({
      type: 'begin',
      character_id: 'C_FRIEND',
      address: '0xfriend',
      name: 'Ares',
      world_id: 'W_FAR',
    })
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

  test('a friend the roster has no route for resolves through /v1 by wallet, never a refusal', () => {
    const intent = fast_travel_intent({ ...live_friend, routes: [] }, [{ id: 'C_FRIEND' }])

    expect(intent).toMatchObject({ type: 'begin', character_id: null, address: '0xfriend', world_id: null })
    expect(intent.refusal).toBeUndefined()
  })

  test('a route that names NO world is still an honest refusal (the character is in no world to reach)', () => {
    const intent = fast_travel_intent({ ...live_friend, routes: [{ character_id: 'C_FRIEND', world_id: null }] }, [
      { id: 'C_FRIEND' },
    ])

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

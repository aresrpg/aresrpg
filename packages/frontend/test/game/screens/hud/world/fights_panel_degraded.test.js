// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2062 RED-FIRST — THE ABSENT≡FAILED CLASS, THIRD INSTANCE. The read seam stopped merging "failed" into
// "absent" (#2054) and friends_reads stopped re-creating it one hop up (#2057), but FightsModal kept its OWN
// `.catch(() => ({ friends: [] }))` over the same read: a dead transport produced the byte-identical friend set
// as a genuinely empty roster (`[]` both ways — the measured red), so with the FRIENDS filter on the panel
// printed "No fights in range" over a read it never got an answer from. Absent is DATA; failed is an ERROR.
//
// The fixture is the transport failure itself, driven through the REAL read path (friends_reads.read_friend_list
// → the SDK's get_friend_list_by_owner → _object.get_object_json) against a grpc client that answers the way the
// wire actually answers: a transport failure carries an rpc `code`, the ledger's own "no such object" is a plain
// Error naming the id. The panel's derivation is then fed exactly what that path produced.
// (The slot's WIRING is proved by source text — the house pattern for a component whose auth/p2p/tx graph a unit
// test has no business booting; see friends_panel_degraded.test.js and PlayerActionMenu.wiring.test.js.)
import { readFileSync } from 'node:fs'

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../../../../src/test_helpers/browser_globals.js'
import {
  reset_expedition_sdk_mock,
  set_expedition_sdk_mock,
} from '../../../../../src/test_helpers/expedition_sdk_mock.js'
import en from '../../../../../src/i18n/locales/en.json'

const restore_browser_globals = install_browser_globals()

const { fights_empty_key } = await import('../../../../../src/game/screens/hud/world/FightsModal.jsx')
const { read_friend_list } = await import('../../../../../src/world-shell/friends_reads.js')

afterAll(restore_browser_globals)

const OWNER = `0x${'d4'.repeat(32)}`

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

const real_fetch = globalThis.fetch

/** The panel's own effect, verbatim: `null` is the failed read, anything else is an answer. */
const roster_failed = () =>
  read_friend_list(OWNER)
    .then(() => false)
    .catch(() => true)

const copy = (/** @type {string} */ key) => {
  const [group, id] = key.split('.')
  return en[group][id]
}

/** What the empty slot PRINTS after driving the real read — the line a player actually reads. */
const line_for = async (/** @type {boolean} */ friends_only) =>
  copy(fights_empty_key(friends_only, await roster_failed()))

beforeEach(() => {
  // /v1 character enrichment is not what these rows measure — answer it honestly and emptily.
  globalThis.fetch = async () => new Response(JSON.stringify({ characters: [] }), { status: 200 })
})

afterEach(() => {
  globalThis.fetch = real_fetch
  reset_expedition_sdk_mock()
})

describe('#2062 · the fights panel never renders a dead friend read as "no fights in range"', () => {
  test('RED: with the friends filter on, a transport failure prints the degraded line, not the empty line', async () => {
    set_expedition_sdk_mock(async () => ({ grpc_client: TRANSPORT_DOWN() }))

    expect(await line_for(true)).toBe(en.presence.roster_unavailable)
    expect(await line_for(true)).not.toBe(en.fights.none_in_range)
  })

  test('CONTROL: a genuinely absent roster still prints the empty line — the read ANSWERED', async () => {
    set_expedition_sdk_mock(async () => ({ grpc_client: LEDGER_SAYS_ABSENT() }))

    expect(await read_friend_list(OWNER)).toEqual({ list_id: null, friends: [] })
    expect(await line_for(true)).toBe(en.fights.none_in_range)
  })

  test('CONTROL: filter OFF — the friend roster gates nothing, so a failed read never explains the empty list', async () => {
    set_expedition_sdk_mock(async () => ({ grpc_client: TRANSPORT_DOWN() }))

    expect(await line_for(false)).toBe(en.fights.none_in_range)
  })

  test('CONTROL: rows still standing are a STALE list, not an empty one — the derivation only runs when empty', () => {
    // The slot is rendered under `rows.length === 0`; a failure with rows keeps rendering them.
    const source = readFileSync(
      new URL('../../../../../src/game/screens/hud/world/FightsModal.jsx', import.meta.url),
      'utf8'
    )
    expect(source).toContain('{rows.length === 0 ? (')
  })

  test('the panel slot prints THIS derivation, and the swallowing catch is gone', () => {
    const source = readFileSync(
      new URL('../../../../../src/game/screens/hud/world/FightsModal.jsx', import.meta.url),
      'utf8'
    )
    expect(source).toContain('{t(fights_empty_key(friends_only, friends_error))}')
    expect(source).not.toContain("{t('fights.none_in_range')}")
    expect(source).not.toContain('catch(() => ({ friends: [] }))')
  })
})

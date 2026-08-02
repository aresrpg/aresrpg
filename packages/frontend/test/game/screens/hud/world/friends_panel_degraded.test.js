// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2057 RED-FIRST, THE PLAYER-FELT HALF — what the presence panel PRINTS when the friend-list read dies.
// "No friends seen right now" over a dead transport is a lie the panel had no way to avoid: every failure
// reached it as a good snapshot of zero friends (friends_reads swallowed the seam's typed throw). With the
// throw preserved, the reducer's own degraded input lands and the empty slot has a second truth to tell.
//
// The fixture is the transport failure itself, driven through the REAL refresh path into the REAL reducer, and
// the derivation is fed the state that path produced — the panel's empty slot prints exactly this key.
// (The slot's WIRING is proved by source text, the house pattern for a component whose auth/p2p/tx graph a
// unit test has no business booting — see PlayerActionMenu.wiring.test.js's header. A static render could not
// prove it either way: zustand v5 hands renderToStaticMarkup `getInitialState`, so every store update is
// invisible to it — the reason this file is not a .jsx.)
import { readFileSync } from 'node:fs'

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../../../../src/test_helpers/browser_globals.js'
import {
  reset_expedition_sdk_mock,
  set_expedition_sdk_mock,
} from '../../../../../src/test_helpers/expedition_sdk_mock.js'
import en from '../../../../../src/i18n/locales/en.json'

const restore_browser_globals = install_browser_globals()

const { roster_empty_key } = await import('../../../../../src/game/screens/hud/world/OnlinePlayers.jsx')
const { friends_input, friends_store, refresh_friends } =
  await import('../../../../../src/world-shell/friends_adapter.js')

afterAll(restore_browser_globals)

const OWNER = `0x${'c3'.repeat(32)}`

const grpc_that_throws = (/** @type {(id: string) => Error} */ make_error) => ({
  core: {
    getObject: async (/** @type {{ objectId: string }} */ { objectId }) => {
      throw make_error(objectId)
    },
  },
})

const real_fetch = globalThis.fetch
const line_for = () => {
  const { rows, error } = friends_store.getState()
  return en.presence[roster_empty_key(rows, error).replace('presence.', '')]
}

beforeEach(() => {
  globalThis.fetch = async () => new Response(JSON.stringify({ characters: [] }), { status: 200 })
  friends_input({ type: 'session_bound', address: null })
  friends_input({ type: 'session_bound', address: OWNER })
})

afterEach(() => {
  globalThis.fetch = real_fetch
  reset_expedition_sdk_mock()
})

describe('#2057 · the presence panel never renders a dead read as "no friends"', () => {
  test('RED: after a transport failure the empty slot prints the degraded line, not the empty-roster line', async () => {
    set_expedition_sdk_mock(async () => ({
      grpc_client: grpc_that_throws(() => Object.assign(new Error('Unable to connect'), { code: 'INTERNAL' })),
    }))

    await refresh_friends(OWNER)

    expect(line_for()).toBe(en.presence.roster_unavailable)
    expect(line_for()).not.toBe(en.presence.none_seen)
  })

  test('CONTROL: a genuinely empty roster still prints the empty line, never a failure', async () => {
    set_expedition_sdk_mock(async () => ({
      grpc_client: grpc_that_throws((id) => new Error(`Object ${id} not found`)),
    }))

    await refresh_friends(OWNER)

    expect(line_for()).toBe(en.presence.none_seen)
  })

  test('CONTROL: a stale roster (rows survived a failed refresh) is not an empty one — no degraded line', () => {
    friends_input({ type: 'snapshot', address: OWNER, list_id: '0xlist', rows: [{ address: '0xfriend' }] })
    friends_input({ type: 'load_failed', address: OWNER, error: 'transport' })

    expect(line_for()).toBe(en.presence.none_seen)
  })

  test('the panel slot prints THIS derivation — the discrimination is what a player reads', () => {
    const source = readFileSync(
      new URL('../../../../../src/game/screens/hud/world/OnlinePlayers.jsx', import.meta.url),
      'utf8'
    )
    expect(source).toContain('{t(roster_empty_key(rows, roster_error))}')
    expect(source).not.toContain("{t('presence.none_seen')}")
  })
})

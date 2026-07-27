// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1361 — the boot gate must not be coupled to third-party relay uptime. The pinned line below is the REAL
// captured text, copied verbatim from the failing smoke job's report (run 30292508702, job 90066924781,
// 2026-07-27T18:17:02Z, branch lane/coop-edges): Chrome emits it itself, so no app code can suppress it.
// The p2p layer runs 5 relays at redundancy 3 precisely so one dead relay is a non-event — but a browser
// -native error line still turned the whole landing queue red. Exemption scope is EXACTLY that: the native
// failure line, aimed at a host in our own relay list. Everything else keeps blocking.
import { describe, expect, test } from 'bun:test'

import { RELAY_HOSTS, is_blocking_console_error } from '../../scripts/boot_smoke_filter.mjs'
import { RELAY_URLS } from '../../src/p2p/relays.js'

const DAMUS_503 =
  "WebSocket connection to 'wss://relay.damus.io/' failed: Error during WebSocket handshake: Unexpected response code: 503"

describe('is_blocking_console_error — relay weather is not a defect', () => {
  test('the captured damus handshake failure does not block', () => {
    expect(is_blocking_console_error(DAMUS_503)).toBe(false)
  })

  test('every relay the app dials is exempt — the hosts are derived from the one list', () => {
    expect(RELAY_HOSTS).toEqual(RELAY_URLS.map((url) => new URL(url).host))
    for (const url of RELAY_URLS)
      expect(
        is_blocking_console_error(
          `WebSocket connection to '${url}/' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED`
        )
      ).toBe(false)
  })
})

describe('is_blocking_console_error — everything else still blocks', () => {
  test('an ordinary app console.error blocks', () => {
    expect(is_blocking_console_error('[spell_cast] TypeError: cannot read properties of undefined')).toBe(true)
  })

  test('a WebSocket failure to a NON-relay host blocks — a dead backend is our problem', () => {
    expect(
      is_blocking_console_error(
        "WebSocket connection to 'wss://rpc.aresrpg.world/v1/stream' failed: Error during WebSocket handshake: Unexpected response code: 503"
      )
    ).toBe(true)
  })

  test('a relay host named inside a non-native error line blocks — the shape is not the browser’s', () => {
    expect(is_blocking_console_error('[lobby-room] giving up on wss://relay.damus.io/ after 5 retries')).toBe(true)
  })

  test('the known boot degrades stay allowlisted', () => {
    expect(is_blocking_console_error('[spell-corpus] no spell_corpus runtime asset')).toBe(false)
    expect(is_blocking_console_error('Failed to load resource: the server responded with a status of 404')).toBe(false)
  })
})

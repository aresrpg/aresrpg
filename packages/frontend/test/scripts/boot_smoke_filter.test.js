// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
import { describe, expect, test } from 'bun:test'

import { is_blocking_console_error } from '../../scripts/boot_smoke_filter.mjs'

const DAMUS_503 =
  "WebSocket connection to 'wss://relay.damus.io/' failed: Error during WebSocket handshake: Unexpected response code: 503"

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

  test('an obsolete relay failure is no longer exempt', () => {
    expect(is_blocking_console_error(DAMUS_503)).toBe(true)
  })

  test('a real boot-serving error is not swallowed by the resource-load allowlist', () => {
    expect(
      is_blocking_console_error(
        'Failed to load resource: the server responded with a status of 500 (Internal Server Error)'
      )
    ).toBe(true)
  })

  test('the known boot degrades stay allowlisted', () => {
    expect(is_blocking_console_error('[spell-corpus] no spell_corpus runtime asset')).toBe(false)
    expect(is_blocking_console_error('[seed_manifest] no seed manifest at /release/seed_manifest.json')).toBe(false)
    expect(is_blocking_console_error('[deployment] seed manifest carries no worlds')).toBe(false)
    expect(is_blocking_console_error('[world_corpus] world knowledge inert')).toBe(false)
    expect(is_blocking_console_error('[living_corpus] seed manifest carries no living entries')).toBe(false)
    expect(is_blocking_console_error('Failed to load resource: the server responded with a status of 404')).toBe(false)
  })
})

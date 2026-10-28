// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  application_packet_sendable,
  create_login_response,
  is_session_takeover_close,
  is_terminal_auth_close,
} from '../src/server_link.ts'

for (const development of [false, true])
  test(`${development ? 'development' : 'production'} build keeps packet tracing development-only`, async () => {
    const result = await Bun.build({
      entrypoints: [new URL('../src/server_link.ts', import.meta.url).pathname],
      target: 'browser',
      define: { 'import.meta.env.DEV': String(development) },
      minify: true,
    })
    expect(result.success).toBeTrue()
    const code = await result.outputs[0]!.text()
    expect(code.includes('%c WS')).toBe(development)
    expect(code).toContain('Malformed server frame ignored.')
    expect(code).toContain('Server connection failed; retrying.')
  })

describe('server authentication link', () => {
  test('signs the server challenge on the socket that issued it', async () => {
    const response = await create_login_response(
      {
        sign_personal_message: async (message) => ({
          bytes: new TextDecoder().decode(message),
          signature: 'proof',
        }),
      },
      'fresh'
    )

    expect(response).toEqual({ type: 'packet/signature_response', bytes: 'aresrpg::fresh', signature: 'proof' })
  })

  test('application packets cannot enter the socket before challenge acceptance', () => {
    expect(application_packet_sendable(false, 1)).toBeFalse()
    expect(application_packet_sendable(true, 0)).toBeFalse()
    expect(application_packet_sendable(true, 1)).toBeTrue()
  })

  test('expires remembered auth only for admission failures', () => {
    expect(is_terminal_auth_close(1008, 'INVALID_SIGNATURE')).toBeTrue()
    expect(is_terminal_auth_close(1008, 'INVALID_PACKET')).toBeTrue()
    expect(is_terminal_auth_close(1008, 'SIGNATURE_TIMEOUT')).toBeFalse()
    expect(is_terminal_auth_close(1008, 'SERVER_FULL')).toBeFalse()
    expect(is_terminal_auth_close(1006, '')).toBeFalse()
  })

  test('a session takeover is terminal on both close codes — the kicked tab never reconnects', () => {
    expect(is_session_takeover_close(1008, 'ALREADY_CONNECTED')).toBeTrue()
    expect(is_session_takeover_close(1000, 'REPLACED')).toBeTrue()
    expect(is_session_takeover_close(1006, '')).toBeFalse()
    expect(is_session_takeover_close(1008, 'SPEED')).toBeFalse()
    // a takeover is neither an auth rejection nor a violation retry
    expect(is_terminal_auth_close(1008, 'ALREADY_CONNECTED')).toBeFalse()
  })
})

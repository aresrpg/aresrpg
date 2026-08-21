// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_login_response, is_session_takeover_close, is_terminal_auth_close } from '../src/server_link.ts'

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

  test('expires remembered auth only for admission failures', () => {
    expect(is_terminal_auth_close(1008, 'INVALID_SIGNATURE')).toBeTrue()
    expect(is_terminal_auth_close(1008, 'SIGNATURE_TIMEOUT')).toBeTrue()
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

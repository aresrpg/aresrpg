// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_login_response, is_terminal_auth_close } from '../src/server_link.ts'

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
})

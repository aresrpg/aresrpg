// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import i18n from '../src/i18n'
import { use_toast } from '../src/toast'

afterEach(() => {
  use_toast.setState({ toasts: [] })
})

const last_error_copy = () => [...use_toast.getState().toasts].reverse().find((toast) => toast.type === 'error')

describe('player toast error boundary', () => {
  test('wallet and JSON-RPC shapes become short player copy, never raw provider text', () => {
    const cases = [
      [{ code: 4001, message: 'User rejected the request.' }, 'errors.wallet_request_rejected'],
      [
        { code: -32002, message: 'Request of type wallet_requestPermissions already pending' },
        'errors.wallet_request_pending',
      ],
      [{ code: -32603, message: 'Internal JSON-RPC error.' }, 'errors.rpc_unavailable'],
      [
        Object.assign(new Error('Wallet account is disconnected'), { name: 'WalletNotConnectedError' }),
        'errors.wallet_unavailable',
      ],
    ] as const

    for (const [raw_error, key] of cases) {
      use_toast.setState({ toasts: [] })
      use_toast.getState().add(raw_error, 'error')
      expect(last_error_copy()?.message).toBe(i18n.t(key))
      expect(last_error_copy()?.message).not.toContain(String((raw_error as { message?: string }).message))
    }
  })

  test('an unknown thrown shape gets honest generic copy and keeps raw detail in the error console', () => {
    const raw_error = { code: 'WALLET_FUTURE_FAILURE', data: { request_id: 'rpc-17' } }
    const console_error = spyOn(console, 'error').mockImplementation(() => {})

    use_toast.getState().add(raw_error, 'error')

    expect(last_error_copy()?.message).toBe(i18n.t('errors.request_failed'))
    expect(console_error).toHaveBeenCalledWith(
      '[ares-error]',
      raw_error,
      raw_error,
      '',
      expect.objectContaining({ area: 'toast', action: 'add' })
    )
    console_error.mockRestore()
  })

  test('already translated player copy still passes through unchanged', () => {
    const player_copy = i18n.t('friends.invalid_address')
    use_toast.getState().add(player_copy, 'error')
    expect(last_error_copy()?.message).toBe(player_copy)
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, mock, test } from 'bun:test'

import { reset_auth_mock } from '../../test_helpers/auth_mock.js'

reset_auth_mock()

const { execute_gift_send } = await import('./write_gift')

describe('item SEND execution', () => {
  test('submits the exact previewed PTB through the ordinary self-pay runner and returns its digest', async () => {
    const transaction = { exact: 'previewed-ptb' }
    const execute = mock(async () => ({ timing: { digest: '0xdigest' } }))

    await expect(execute_gift_send(transaction, execute)).resolves.toEqual({ digest: '0xdigest' })
    expect(execute).toHaveBeenCalledWith('gift_send', transaction)
  })
})

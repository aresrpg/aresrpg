// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, mock, test } from 'bun:test'

import { dry_run_item_send } from './item_send_preview'

describe('item SEND dry-run preview', () => {
  test('simulates the exact prepared transaction with effects and reports net gas', async () => {
    const transaction = { exact: 'prepared-ptb' }
    const simulate = mock(async () => ({
      $kind: 'Transaction',
      Transaction: {
        effects: {
          status: { success: true },
          gasUsed: { computationCost: '100', storageCost: '50', storageRebate: '25' },
        },
      },
    }))

    await expect(dry_run_item_send(transaction, simulate)).resolves.toEqual({
      ok: true,
      gas_estimate_mist: 125n,
    })
    expect(simulate).toHaveBeenCalledWith({ transaction, include: { effects: true } })
  })

  test('refuses a failed simulation instead of creating a review', async () => {
    const failure = { $kind: 'MoveAbort', abortCode: '101' }
    const simulate = mock(async () => ({
      $kind: 'FailedTransaction',
      FailedTransaction: { effects: { status: { success: false, error: failure } } },
    }))

    await expect(dry_run_item_send({}, simulate)).resolves.toEqual({
      ok: false,
      kind: 'effects',
      error: failure,
    })
  })
})

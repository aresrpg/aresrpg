// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { use_settings } from '../stores/settings'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

const grpc = {
  core: {
    // `$kind` is part of the shape SuiGrpcClient.core.simulateTransaction ALWAYS returns (it union-tags every
    // result `Transaction` or `FailedTransaction` — @mysten/sui dist/grpc/core.mjs). Omitting it here modelled a
    // result the node cannot produce, and the gas guard now refuses verdict-less shapes outright (#796).
    simulateTransaction: mock(async () => ({
      $kind: 'Transaction',
      Transaction: {
        effects: {
          status: { success: true },
          gasUsed: { computationCost: '1000000', storageCost: '2000000', storageRebate: '500000' },
        },
      },
    })),
  },
}
const get_sdk = async () => ({ grpc_client: grpc })
set_expedition_sdk_mock(get_sdk)

const { execute_tx } = await import('./index')
const { clear_budget_cache } = await import('./budget_cache.js')

beforeEach(() => set_expedition_sdk_mock(get_sdk))

function transaction(set_budget = mock(() => {})) {
  return { setSenderIfNotSet() {}, setGasBudget: set_budget } as any
}

function wallet(sign_and_execute: ReturnType<typeof mock>) {
  return {
    features: {
      'sui:signAndExecuteTransaction': { signAndExecuteTransaction: sign_and_execute },
      'enoki:getSession': { getSession: async () => null },
    },
  } as any
}

function sponsor_deps() {
  return {
    fetch_balance_mist: mock(async () => 0n),
    run_sponsored: mock(async () => ({ digest: 'sponsored', effects: { status: { status: 'success' } } })),
  }
}

afterEach(() => {
  clear_budget_cache()
  grpc.core.simulateTransaction.mockClear()
  use_settings.setState({ sponsored_gameplay_enabled: true })
  reset_expedition_sdk_mock()
})

describe('marketplace self-pay transaction route', () => {
  test('pins the computation-padded budget and self-pays once even for an eligible low-balance zkLogin wallet', async () => {
    const set_budget = mock(() => {})
    const sign = mock(async () => ({ digest: 'self-paid' }))
    const sponsor = sponsor_deps()
    const result = await execute_tx({
      wallet: wallet(sign),
      address: '0xbuyer',
      transaction: transaction(set_budget),
      chain: 'sui:testnet',
      cached_balance_mist: 0n,
      sponsor_excluded: true,
      sponsor_fallback: sponsor,
    })

    expect(result.digest).toBe('self-paid')
    expect(set_budget).toHaveBeenCalledWith(3_500_000n)
    expect(sign).toHaveBeenCalledTimes(1)
    expect(sponsor.run_sponsored).toHaveBeenCalledTimes(0)
  })

  test('a pre-execution gas-selection failure cannot fall back to sponsor gas', async () => {
    const sign = mock(async () => {
      throw new Error('Unable to perform gas selection to satisfy required budget')
    })
    const sponsor = sponsor_deps()

    await expect(
      execute_tx({
        wallet: wallet(sign),
        address: '0xbuyer',
        transaction: transaction(),
        chain: 'sui:testnet',
        cached_balance_mist: 0n,
        sponsor_excluded: true,
        sponsor_fallback: sponsor,
      })
    ).rejects.toThrow('gas selection')
    expect(sign).toHaveBeenCalledTimes(1)
    expect(sponsor.fetch_balance_mist).toHaveBeenCalledTimes(0)
    expect(sponsor.run_sponsored).toHaveBeenCalledTimes(0)
  })
})

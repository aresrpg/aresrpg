// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { use_settings } from '../stores/settings'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'

const GAS_USED = { computationCost: '1000000', storageCost: '2000000', storageRebate: '500000' }
const GAS_SELECTION_ERROR =
  'Unable to perform gas selection due to insufficient SUI balance to satisfy required budget 4500000'
const grpc = {
  core: {
    // `$kind` is part of the shape SuiGrpcClient.core.simulateTransaction ALWAYS returns (it union-tags every
    // result `Transaction` or `FailedTransaction` — @mysten/sui dist/grpc/core.mjs). Omitting it here modelled a
    // result the node cannot produce, and the gas guard now refuses verdict-less shapes outright (#796).
    simulateTransaction: mock(async () => ({
      $kind: 'Transaction',
      Transaction: { effects: { status: { success: true }, gasUsed: GAS_USED } },
    })),
    executeTransaction: mock(async () => ({
      Transaction: { digest: 'SELF', effects: { status: { success: true }, gasUsed: GAS_USED } },
    })),
  },
}

const get_sdk = async () => ({ grpc_client: grpc })
set_expedition_sdk_mock(get_sdk)

const { execute_tx } = await import('./index')
const { rolling_gas_spend_mist } = await import('./gas_spend_ledger')

beforeEach(() => set_expedition_sdk_mock(get_sdk))
afterEach(reset_expedition_sdk_mock)

function transaction() {
  return { setSenderIfNotSet() {}, setGasBudget() {} } as any
}

function zk_wallet(sign_and_execute: ReturnType<typeof mock>) {
  return {
    features: {
      'sui:signAndExecuteTransaction': { signAndExecuteTransaction: sign_and_execute },
      'enoki:getSession': { getSession: async () => ({}) },
    },
  } as any
}

function sponsor_deps(digest: string) {
  return {
    fetch_balance_mist: mock(async () => 1_000_000n),
    run_sponsored: mock(async () => ({
      digest,
      effects: { status: { status: 'success' as const }, gasUsed: GAS_USED },
    })),
  }
}

function memory_storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('execute_tx — player-paid rolling gas ledger', () => {
  test('records self-pay execution, but sponsor-first and fallback add zero player spend', async () => {
    const storage = memory_storage()
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    const address = '0xledger'

    try {
      use_settings.setState({ sponsored_gameplay_enabled: true })
      await execute_tx({
        wallet: {
          features: {
            'sui:signAndExecuteTransaction': { signAndExecuteTransaction: mock(async () => ({ digest: 'unused' })) },
            'sui:signTransaction': { signTransaction: mock(async () => ({ signature: 'sig', bytes: 'AAAA' })) },
          },
        } as any,
        address,
        transaction: transaction(),
        chain: 'sui:testnet',
        want_effects: true,
      })
      expect(rolling_gas_spend_mist(address, Date.now(), storage)).toBe(2_500_000n)

      await execute_tx({
        wallet: zk_wallet(mock(async () => ({ digest: 'unused' }))),
        address,
        transaction: transaction(),
        chain: 'sui:testnet',
        cached_balance_mist: 100_000_000n,
        cached_balance_read_at_ms: Date.now(),
        sponsor_fallback: sponsor_deps('SPONSOR-FIRST'),
      })

      await execute_tx({
        wallet: zk_wallet(
          mock(async () => {
            throw new Error(GAS_SELECTION_ERROR)
          })
        ),
        address,
        transaction: transaction(),
        chain: 'sui:testnet',
        cached_balance_mist: 300_000_000n,
        cached_balance_read_at_ms: Date.now(),
        sponsor_fallback: sponsor_deps('SPONSOR-FALLBACK'),
      })

      expect(rolling_gas_spend_mist(address, Date.now(), storage)).toBe(2_500_000n)
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
      else delete (globalThis as any).localStorage
      use_settings.setState({ sponsored_gameplay_enabled: true })
    }
  })
})

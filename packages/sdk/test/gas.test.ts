// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_gas_ledger, gas_mist_from_receipt } from '../src/gas.ts'

const storage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

const receipt = (digest: string, computation = '7', stored = '5', rebate = '2') => ({
  digest,
  effects: {
    gasUsed: { computationCost: computation, storageCost: stored, storageRebate: rebate },
  },
})

describe('rolling gas spend', () => {
  test('reads the executed receipt net cost', () => {
    expect(gas_mist_from_receipt(receipt('tx'))).toBe(10n)
  })

  test('deduplicates digests and expires rows after 24 hours', () => {
    let now_ms = 1_000
    const ledger = create_gas_ledger({ address: '0xA', network: 'testnet', storage: storage(), now: () => now_ms })

    ledger.record(receipt('first'))
    ledger.record(receipt('first'))
    expect(ledger.spent_24h()).toBe(10n)

    now_ms += 24 * 60 * 60 * 1_000 + 1
    expect(ledger.spent_24h()).toBe(0n)
  })

  test('treats unavailable storage and malformed receipts as display-only failures', () => {
    const broken = {
      getItem: () => {
        throw new Error('disabled')
      },
      setItem: () => {
        throw new Error('disabled')
      },
      removeItem: () => {
        throw new Error('disabled')
      },
    }
    const ledger = create_gas_ledger({ address: '0xA', network: 'testnet', storage: broken })
    expect(() => ledger.record({ digest: 'bad', effects: { gasUsed: { computationCost: 'wat' } } })).not.toThrow()
    expect(ledger.spent_24h()).toBe(0n)
  })
})

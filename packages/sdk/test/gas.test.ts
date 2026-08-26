// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, spyOn, test } from 'bun:test'

import { create_gas_ledger, gas_mist_from_receipt, log_transaction_receipt } from '../src/gas.ts'

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

  test('every certified receipt logs its digest and colored net gas cost', () => {
    const log = spyOn(console, 'log').mockImplementation(() => undefined)
    log_transaction_receipt(receipt('tx', '2000000', '1000000', '500000'))
    expect(log).toHaveBeenCalledWith('%c tx ', 'color:#ff5a8b;font-weight:700', 'tx', '0.0025 SUI', {
      status: 'success',
      net_sui: '0.0025',
      computation_sui: '0.002',
      storage_sui: '0.001',
      rebate_sui: '0.0005',
    })
    log_transaction_receipt({
      $kind: 'FailedTransaction',
      FailedTransaction: {
        digest: 'failed',
        effects: { gasUsed: { computationCost: '2000000', storageCost: '0', storageRebate: '0' } },
      },
    })
    expect(log).toHaveBeenCalledWith('%c tx ', 'color:#ff5a8b;font-weight:700', 'failed', '0.002 SUI', {
      status: 'failed',
      net_sui: '0.002',
      computation_sui: '0.002',
      storage_sui: '0',
      rebate_sui: '0',
    })
    log.mockRestore()
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

  test('attributes one executed receipt to its fight without duplicating the wallet total', () => {
    const ledger = create_gas_ledger({ address: '0xA', network: 'testnet', storage: storage() })
    const landed = receipt('fight-turn')

    ledger.record(landed)
    ledger.tag(landed, 'fight:0xf1')
    ledger.tag(landed, 'fight:0xf1')

    expect(ledger.spent_24h()).toBe(10n)
    expect(ledger.spent_24h('fight:0xf1')).toBe(10n)
    expect(ledger.spent_24h('fight:0xf2')).toBe(0n)
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

    const memory = create_gas_ledger({ address: '0xA', network: 'testnet', storage: null })
    memory.record(receipt('memory'))
    memory.tag(receipt('memory'), 'fight:0xf1')
    expect(memory.spent_24h('fight:0xf1')).toBe(10n)
  })
})

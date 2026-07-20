// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import {
  GAS_SPEND_WINDOW_MS,
  format_gas_spend_sui,
  gas_spend_storage_key,
  gas_used_from_receipt,
  prune_gas_spend_entries,
  record_gas_spend,
  record_self_paid_receipt,
  rolling_gas_spend_mist,
  subscribe_gas_spend,
} from './gas_spend_ledger'

function memory_storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('24h gas-spend ledger', () => {
  test('prunes only entries older than 24h and drops malformed local rows', () => {
    const now = 200_000_000
    expect(
      prune_gas_spend_entries(
        [
          { ts: now - GAS_SPEND_WINDOW_MS - 1, mist: '1' },
          { ts: now - GAS_SPEND_WINDOW_MS, mist: '2' },
          { ts: now - 1, mist: '3' },
          { ts: 'bad', mist: '4' },
          { ts: now, mist: 'not-mist' },
        ],
        now
      )
    ).toEqual([
      { ts: now - GAS_SPEND_WINDOW_MS, mist: '2' },
      { ts: now - 1, mist: '3' },
    ])
  })

  test('persists and sums entries per normalized address, pruning on the next read', () => {
    const storage = memory_storage()
    const now = 300_000_000
    record_gas_spend(' 0xAbC ', 7n, now - GAS_SPEND_WINDOW_MS, storage)
    record_gas_spend('0xabc', 11n, now, storage)
    record_gas_spend('0xdef', 50n, now, storage)

    expect(rolling_gas_spend_mist('0xABC', now, storage)).toBe(18n)
    expect(rolling_gas_spend_mist('0xdef', now, storage)).toBe(50n)
    expect(rolling_gas_spend_mist('0xabc', now + 1, storage)).toBe(11n)
    expect(JSON.parse(storage.getItem(gas_spend_storage_key('0xabc')) ?? '[]')).toEqual([{ ts: now, mist: '11' }])
  })

  test('self-pay receipt hook records exact net gas and notifies the live display subscriber', () => {
    const storage = memory_storage()
    let notifications = 0
    const unsubscribe = subscribe_gas_spend(() => notifications++)
    const receipt = {
      digest: 'EXECUTED',
      effects_result: {
        Transaction: {
          effects: {
            gasUsed: { computationCost: '1000000', storageCost: '2000000', storageRebate: '500000' },
          },
        },
      },
    }

    expect(record_self_paid_receipt('0xabc', receipt, 42, storage)).toBe(receipt)
    expect(rolling_gas_spend_mist('0xabc', 42, storage)).toBe(2_500_000n)
    expect(notifications).toBe(1)
    unsubscribe()
  })

  test('a throwing display subscriber cannot reject recording or starve other subscribers', () => {
    const storage = memory_storage()
    let observed = 0
    const unsubscribe_bad = subscribe_gas_spend(() => {
      throw new Error('broken display')
    })
    const unsubscribe_good = subscribe_gas_spend(() => observed++)

    expect(() => record_gas_spend('0xabc', 5n, 42, storage)).not.toThrow()
    expect(rolling_gas_spend_mist('0xabc', 42, storage)).toBe(5n)
    expect(observed).toBe(1)
    unsubscribe_bad()
    unsubscribe_good()
  })

  test('failed executed receipts still count, while a digestless pre-flight refusal does not', () => {
    const storage = memory_storage()
    const gasUsed = { computationCost: '9', storageCost: '4', storageRebate: '2' }
    record_self_paid_receipt(
      '0xabc',
      { digest: 'BURNED', effects_result: { FailedTransaction: { effects: { gasUsed } } } },
      10,
      storage
    )
    record_self_paid_receipt('0xabc', { digest: '', gasUsed }, 11, storage)
    expect(rolling_gas_spend_mist('0xabc', 11, storage)).toBe(11n)
  })

  test('receipt extraction accepts direct gasUsed; display is 2dp with a sub-cent floor', () => {
    const gasUsed = { computationCost: '4', storageCost: '5', storageRebate: '2' }
    expect(gas_used_from_receipt({ digest: 'D', gasUsed })).toBe(gasUsed)
    expect(format_gas_spend_sui(2_500_000n)).toBe('<0.01') // non-zero spend never reads as zero
    expect(format_gas_spend_sui(21_171_584n)).toBe('0.02') // a real screenshot case, trimmed
    expect(format_gas_spend_sui(-1_000_000_001n)).toBe('-1.00')
    expect(format_gas_spend_sui(0n)).toBe('0.00')
  })
})

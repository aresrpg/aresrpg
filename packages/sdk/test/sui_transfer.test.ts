// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The two facts that actually move money — the split AMOUNT and the RECIPIENT — are asserted
// from the composed transaction bytes, not just the command shapes.

import { describe, expect, test } from 'bun:test'
import type { Transaction } from '@mysten/sui/transactions'

import { sui_transfer_actions, sui_transfer_ptb } from '../src/sui_transfer.ts'

const address = (digit: string): string => `0x${digit.repeat(64)}`

const pure_bytes = (transaction: Transaction): readonly Uint8Array[] =>
  transaction
    .getData()
    .inputs.flatMap((input) =>
      input.Pure?.bytes ? [Uint8Array.from(atob(input.Pure.bytes), (char) => char.charCodeAt(0))] : []
    )

const pure_u64s = (transaction: Transaction): readonly bigint[] =>
  pure_bytes(transaction)
    .filter((bytes) => bytes.length === 8)
    .map((bytes) => bytes.reduce((value, byte, index) => value | (BigInt(byte) << BigInt(8 * index)), 0n))

const pure_addresses = (transaction: Transaction): readonly string[] =>
  pure_bytes(transaction)
    .filter((bytes) => bytes.length === 32)
    .map((bytes) => `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`)

describe('SUI transfer PTB', () => {
  test('an amount transfer splits EXACTLY the requested MIST to EXACTLY the recipient', () => {
    const transaction = sui_transfer_ptb({
      sender: address('1'),
      recipient: address('2'),
      amount_mist: 1_234_567n,
    })
    expect(transaction.getData().commands.map(({ $kind }) => $kind)).toEqual(['SplitCoins', 'TransferObjects'])
    expect(pure_u64s(transaction)).toEqual([1_234_567n])
    expect(pure_addresses(transaction)).toEqual([address('2')])
  })

  test('MAX transfers the gas coin itself to the recipient so gas is deducted from what lands', () => {
    const transaction = sui_transfer_ptb({ sender: address('1'), recipient: address('2'), amount_mist: null })
    expect(transaction.getData().commands.map(({ $kind }) => $kind)).toEqual(['TransferObjects'])
    expect(pure_addresses(transaction)).toEqual([address('2')])
    expect(pure_u64s(transaction)).toEqual([])
  })

  test('a zero or negative amount refuses before composing anything', () => {
    expect(() => sui_transfer_ptb({ sender: address('1'), recipient: address('2'), amount_mist: 0n })).toThrow(
      'positive'
    )
  })
})

test('shared SUI actions preserve multisig sender, exact amount and destination, and recheck before signing', async () => {
  const transactions: Transaction[] = []
  let current = true
  let signatures = 0
  const assert_current = () => {
    if (!current) throw new Error('changed')
  }
  const actions = sui_transfer_actions(
    {
      simulate: async (tx) => {
        transactions.push(tx)
        return { effects: { gasUsed: { computationCost: '10', storageCost: '5', storageRebate: '2' } } }
      },
      execute: async (tx, options) => {
        transactions.push(tx)
        await Promise.resolve()
        options?.before_sign?.()
        signatures += 1
        return { digest: 'certified' }
      },
    },
    address('3'),
    assert_current
  )
  expect(await actions.estimate_sui_transfer(address('4'), 123n, false)).toBe(13n)
  expect(await actions.send_sui(address('4'), 123n, false)).toEqual({ digest: 'certified' })
  for (const tx of transactions) {
    expect(tx.getData().sender).toBe(address('3'))
    expect(pure_u64s(tx)).toEqual([123n])
    expect(pure_addresses(tx)).toEqual([address('4')])
  }
  const pending = actions.send_sui(address('4'), 123n, false)
  current = false
  await expect(pending).rejects.toThrow('changed')
  expect(signatures).toBe(1)
  await expect(actions.estimate_sui_transfer(address('4'), 123n, false)).rejects.toThrow('changed')
})
test('failed or underfunded simulation never signs and invalid amounts fail before SDK work', async () => {
  let executions = 0
  const actions = sui_transfer_actions(
    {
      simulate: async () => ({ $kind: 'FailedTransaction' }),
      execute: async () => {
        executions += 1
        return { digest: 'unused' }
      },
    },
    address('3')
  )
  await expect(actions.estimate_sui_transfer(address('4'), 1n, false)).rejects.toThrow('cannot be built')
  await expect(actions.send_sui(address('4'), 0n, false)).rejects.toThrow('positive')
  await expect(actions.send_sui('invalid', 1n, false)).rejects.toThrow('valid Sui address')
  expect(executions).toBe(0)
})

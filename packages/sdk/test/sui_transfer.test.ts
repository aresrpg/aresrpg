// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The two facts that actually move money — the split AMOUNT and the RECIPIENT — are asserted
// from the composed transaction bytes, not just the command shapes.

import { describe, expect, test } from 'bun:test'
import type { Transaction } from '@mysten/sui/transactions'

import { sui_transfer_ptb } from '../src/sui_transfer.ts'

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

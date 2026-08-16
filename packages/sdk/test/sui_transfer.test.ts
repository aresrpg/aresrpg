// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { sui_transfer_ptb } from '../src/sui_transfer.ts'

const address = (digit: string): string => `0x${digit.repeat(64)}`

describe('SUI transfer PTB', () => {
  test('an amount transfer splits the gas coin', () => {
    const transaction = sui_transfer_ptb({ sender: address('1'), recipient: address('2'), amount_mist: 7n })
    expect(transaction.getData().commands.map(({ $kind }) => $kind)).toEqual(['SplitCoins', 'TransferObjects'])
  })

  test('MAX transfers the gas coin itself so gas is deducted from what lands', () => {
    const transaction = sui_transfer_ptb({ sender: address('1'), recipient: address('2'), amount_mist: null })
    expect(transaction.getData().commands.map(({ $kind }) => $kind)).toEqual(['TransferObjects'])
  })
})

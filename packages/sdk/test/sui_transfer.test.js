// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2243 — the wallet Send door composes TWO shapes and only two. Compose-only: nothing here signs, dry-runs,
// or executes; the assertions read the built command graph.
import { describe, test, expect } from 'bun:test'

import { sui_transfer_ptb } from '../src/sui/write/sui_transfer.js'

const SENDER = `0x${'a'.repeat(64)}`
const RECIPIENT = `0x${'b'.repeat(64)}`

const commands_of = tx => tx.getData().commands
const inputs_of = tx => tx.getData().inputs

describe('sui_transfer_ptb — DRAIN (amount_mist = null) transfers the gas coin itself', () => {
  const drain = () =>
    sui_transfer_ptb({ sender: SENDER, recipient: RECIPIENT, amount_mist: null })

  test('exactly ONE command, a TransferObjects — nothing is split off first', () => {
    const commands = commands_of(drain())
    expect(commands.length).toBe(1)
    expect(commands[0].$kind).toBe('TransferObjects')
  })

  test('the transferred object IS the GasCoin — the fee is paid from the coin being sent, so the sender lands on zero', () => {
    const { objects } = commands_of(drain())[0].TransferObjects
    expect(objects.length).toBe(1)
    expect(objects[0].$kind).toBe('GasCoin')
  })

  test('no amount is ever encoded — a drain has no figure to get wrong', () => {
    const tx = drain()
    // The recipient address is the ONLY pure input.
    expect(inputs_of(tx).length).toBe(1)
    expect(tx.getData().sender).toBe(SENDER)
  })
})

describe('sui_transfer_ptb — PARTIAL keeps the split shape unchanged', () => {
  const commands = commands_of(
    sui_transfer_ptb({
      sender: SENDER,
      recipient: RECIPIENT,
      amount_mist: 1_234n,
    }),
  )

  test('SplitCoins(GasCoin) then TransferObjects(that split result)', () => {
    expect(commands.map(({ $kind }) => $kind)).toEqual([
      'SplitCoins',
      'TransferObjects',
    ])
    expect(commands[0].SplitCoins.coin.$kind).toBe('GasCoin')
    const { objects } = commands[1].TransferObjects
    expect(objects.length).toBe(1)
    expect(objects[0].$kind).toBe('NestedResult')
    // NEVER the gas coin: a partial send must leave the remainder with the sender.
    expect(objects.some(({ $kind }) => $kind === 'GasCoin')).toBe(false)
  })
})

describe('sui_transfer_ptb — the only refusals left are honest ones', () => {
  test('a non-positive amount refuses loudly instead of composing a no-op transfer', () => {
    expect(() =>
      sui_transfer_ptb({ sender: SENDER, recipient: RECIPIENT, amount_mist: 0n }),
    ).toThrow(/must be positive/)
  })

  test('NO upper bound exists — an amount far past any wallet balance composes fine (the chain refuses it, not us)', () => {
    const huge = 18_446_744_073_709_551_615n // u64::MAX
    const commands = commands_of(
      sui_transfer_ptb({
        sender: SENDER,
        recipient: RECIPIENT,
        amount_mist: huge,
      }),
    )
    expect(commands[0].$kind).toBe('SplitCoins')
  })
})

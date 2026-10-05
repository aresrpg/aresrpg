// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'

import { create_kares_transaction, kares_actions } from '../src/kares_actions.ts'

import { kares_test_client, kares_test_owner, kares_test_pins, kares_test_position } from './helpers/kares.ts'
import { id } from './helpers/transport.ts'

const fixture = () => {
  const { client, state } = kares_test_client()
  const transactions: ReturnType<Transaction['getData']>[] = []
  const sdk = {
    network: 'testnet',
    pins: kares_test_pins,
    hydrate_unknown: async () => undefined,
    door_context: { obj: (tx: Transaction, object_id: string) => tx.object(object_id) },
    execute: async (tx: Transaction, options: { budget?: unknown }) => {
      expect(options.budget).toBe('estimate')
      transactions.push(tx.getData())
      if (tx.getData().commands.some((command) => command.MoveCall?.function === 'open_position'))
        state.positions = [kares_test_position()]
      return { Transaction: { digest: `receipt-${transactions.length}` } }
    },
  }
  return {
    sdk,
    state,
    transactions,
    actions: kares_actions({ sdk: sdk as never, client: client as never, address: kares_test_owner }),
  }
}

test('deposits reuse owned positions instead of accumulating permanent claim inputs', async () => {
  const { state, transactions, actions } = fixture()
  state.positions = []
  await actions.stake(1n)
  await actions.stake(2n)
  await actions.stake(3n)
  expect(transactions.map((tx) => tx.commands.find((command) => command.MoveCall)?.MoveCall?.function)).toEqual([
    'open_position',
    'add_stake',
    'add_stake',
  ])
})

test('oversized claims are rejected before producing a protocol-invalid transfer', async () => {
  const { sdk } = fixture()
  await expect(
    create_kares_transaction(
      { sdk: sdk as never, address: kares_test_owner },
      {
        kind: 'claim',
        ids: Array.from({ length: 256 }, (_, index) => id(1_000 + index)),
      }
    )
  ).rejects.toThrow('50')
})

test('oversized withdrawals are rejected before building or signing', async () => {
  const { sdk } = fixture()
  await expect(
    create_kares_transaction(
      { sdk: sdk as never, address: kares_test_owner },
      {
        kind: 'withdraw',
        withdrawals: Array.from({ length: 51 }, (_, index) => ({ id: id(1_000 + index), amount: 1n })),
      }
    )
  ).rejects.toThrow('50')
})

test('a full claim batch transfers two consolidated coins rather than 100 payment objects', async () => {
  const { sdk } = fixture()
  const tx = await create_kares_transaction(
    { sdk: sdk as never, address: kares_test_owner },
    {
      kind: 'claim',
      ids: Array.from({ length: 50 }, (_, index) => id(1_000 + index)),
    }
  )
  const { commands } = tx.getData()
  expect(commands.filter((command) => command.MoveCall?.function === 'claim')).toHaveLength(50)
  expect(commands.filter((command) => command.MergeCoins)).toHaveLength(2)
  expect(commands.find((command) => command.TransferObjects)?.TransferObjects?.objects).toHaveLength(2)
})

test('claim and withdrawal batches use estimated gas instead of a fixed single-position budget', async () => {
  const { actions, transactions } = fixture()
  await actions.claim_rewards(Array.from({ length: 50 }, (_, index) => id(1_000 + index)))
  await actions.withdraw(
    Array.from({ length: 50 }, (_, index) => ({ id: id(1_000 + index), amount: 1n })),
    50n
  )
  expect(transactions).toHaveLength(2)
  expect(transactions[1].commands.find((command) => command.TransferObjects)?.TransferObjects?.objects).toHaveLength(1)
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { reduce_wallet, initial_wallet_state } from '../../src/wallet/model.ts'

test('authorizing one account queues its connection without another selection click', () => {
  const wallet = {
    name: 'Single wallet',
    authorize: async () => ['0xonly'],
    connect: async () => {
      throw new Error('not executed by reducer')
    },
    disconnect: async () => undefined,
  }
  const requested = reduce_wallet(
    { ...initial_wallet_state(), wallets: [wallet] },
    { type: 'external_wallet/authorize', wallet_name: wallet.name }
  )
  const authorized = reduce_wallet(requested, {
    type: 'external_wallet/accounts',
    sequence: requested.sequence,
    accounts: ['0xonly'],
  })
  expect(authorized.request).toEqual({ kind: 'connect', wallet, address: '0xonly' })
  expect(authorized.sequence).toBe(requested.sequence + 1)
})

test('authorizing multiple accounts never chooses one silently', () => {
  const wallet = {
    name: 'Multiple wallets',
    authorize: async () => ['0xone', '0xtwo'],
    connect: async () => {
      throw new Error('not executed by reducer')
    },
    disconnect: async () => undefined,
  }
  const requested = reduce_wallet(
    { ...initial_wallet_state(), wallets: [wallet] },
    { type: 'external_wallet/authorize', wallet_name: wallet.name }
  )
  const authorized = reduce_wallet(requested, {
    type: 'external_wallet/accounts',
    sequence: requested.sequence,
    accounts: ['0xone', '0xtwo'],
  })
  expect(authorized.request).toBeNull()
  expect(authorized.accounts).toEqual([
    { wallet_name: wallet.name, address: '0xone' },
    { wallet_name: wallet.name, address: '0xtwo' },
  ])
})

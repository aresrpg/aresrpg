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

test('forgetting a saved account removes only it until the provider loses its last account', () => {
  const wallet = {
    name: 'Saved wallet',
    authorize: async () => ['0xone', '0xtwo'],
    connect: async () => {
      throw new Error('not executed by reducer')
    },
    disconnect: async () => undefined,
  }
  const saved = {
    ...initial_wallet_state(),
    wallets: [wallet],
    accounts: [
      { wallet_name: wallet.name, address: '0xone' },
      { wallet_name: wallet.name, address: '0xtwo' },
    ],
  }
  const one_left = reduce_wallet(saved, { type: 'external_wallet/forget', wallet_name: wallet.name, address: '0xone' })
  expect(one_left.accounts).toEqual([{ wallet_name: wallet.name, address: '0xtwo' }])
  expect(one_left.request).toBeNull()
  const none_left = reduce_wallet(one_left, {
    type: 'external_wallet/forget',
    wallet_name: wallet.name,
    address: '0xtwo',
  })
  expect(none_left.accounts).toEqual([])
  expect(none_left.request).toEqual({ kind: 'disconnect', session: null, wallet })
  expect(reduce_wallet(saved, { type: 'external_wallet/forget', wallet_name: 'Other', address: '0xone' })).toBe(saved)
})

test('forgetting the selected account disconnects its session', () => {
  const session = { wallet_name: 'Saved wallet', address: '0xone', disconnect: async () => undefined }
  const connected = {
    ...initial_wallet_state(),
    session,
    accounts: [{ wallet_name: session.wallet_name, address: session.address }],
  }
  const forgotten = reduce_wallet(connected, {
    type: 'external_wallet/forget',
    wallet_name: session.wallet_name,
    address: session.address,
  })
  expect(forgotten.session).toBeNull()
  expect(forgotten.accounts).toEqual([])
  expect(forgotten.request).toMatchObject({ kind: 'disconnect', session })
})

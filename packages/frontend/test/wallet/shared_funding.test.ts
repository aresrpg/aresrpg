// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { initial_app_state, reduce_app_state } from '../../src/store.ts'
import { sui_session, crypto_session, type CryptoWalletSession } from '../../src/wallet/external_session.ts'
import { wallet_selection } from '../../src/wallet/selection.ts'

const initial = () => initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
const source: CryptoWalletSession = {
  family: 'evm',
  address: `0x${'11'.repeat(20)}`,
  wallet_name: 'MetaMask · EVM',
  disconnect: async () => {},
  is_transaction_idle: () => true,
  balance: async () => 1n,
  balances: async () => ({ assets: [], failed: false }),
  send: async () => 'hash',
}

test('connecting a funding wallet never replaces the game wallet and cannot acquire Sui capabilities', () => {
  const base = initial()
  const game_wallet = { address: `0x${'22'.repeat(32)}`, identity: 'zklogin' } as never
  const state = { ...base, session: { ...base.session, wallet: game_wallet } }
  const requested = reduce_app_state(state, { type: 'external_wallet/crypto_requested' })
  const next = reduce_app_state(requested, {
    type: 'external_wallet/connected',
    sequence: requested.external_wallet.sequence,
    session: source,
  })
  expect(next.session.wallet).toBe(game_wallet)
  expect(next.external_wallet.session).toBe(source)
  expect(sui_session(next.external_wallet.session)).toBeNull()
  expect(next.external_wallet.connector_request).toBeNull()
  expect(reduce_app_state(next, { type: 'external_wallet/disconnect' }).session.wallet).toBe(game_wallet)
})

test('opening and closing funding preserves the existing character dialog', () => {
  const state = reduce_app_state(initial(), { type: 'dialog/open', dialog: 'character_create' })
  const funding = reduce_app_state(state, { type: 'funding/open', cost_mist: 1_000_000_000n })
  expect(funding.navigation.dialog).toBe('character_create')
  expect(funding.navigation.funding_cost_mist).toBe(1_000_000_000n)
  expect(reduce_app_state(funding, { type: 'funding/close' }).navigation.dialog).toBe('character_create')
})

test('public source selection restores Solana addresses without storing keys or attempts', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  const selection = wallet_selection(storage, 'mainnet')
  const public_selection = {
    wallet_name: 'Phantom · Solana',
    family: 'solana' as const,
    address: '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK',
  }
  selection.write(public_selection)
  expect(selection.read()).toEqual(public_selection)
  expect(Object.keys(JSON.parse([...values.values()][0]))).toEqual(['wallet_name', 'address', 'family'])
})

test('a failed optional connector leaves Google and the Sui funding source available', () => {
  const base = initial()
  const google = { address: '0xgoogle', identity: 'zklogin' } as never
  const slush = { address: '0xslush', wallet_name: 'Slush', identity: 'wallet' } as never
  const state = {
    ...base,
    session: { ...base.session, wallet: google },
    external_wallet: {
      ...base.external_wallet,
      session: slush,
      connector_enabled: true,
      connector_request: 1,
    },
  }
  const failed = reduce_app_state(state, { type: 'external_wallet/connector_failed' })
  expect(failed.session.wallet).toBe(google)
  expect(failed.external_wallet.session).toBe(slush)
  expect(failed.external_wallet.connector_request).toBeNull()
  expect(failed.external_wallet.connector_enabled).toBe(false)
})

test('disconnect does not restore Solana before the next Privy selection', () => {
  const base = initial()
  const solana = { ...source, family: 'solana' as const, address: 'solana-account', wallet_name: 'Phantom · Solana' }
  const connected = reduce_app_state(base, { type: 'external_wallet/connected', sequence: 0, session: solana })
  const disconnected = reduce_app_state(connected, { type: 'external_wallet/disconnect' })
  expect(disconnected.external_wallet.session).toBeNull()
  expect(disconnected.external_wallet.remembered).toBeNull()
  const premature = reduce_app_state(disconnected, { type: 'external_wallet/crypto_requested' })
  expect(premature).toBe(disconnected)
  const finished = reduce_app_state(disconnected, {
    type: 'external_wallet/finished',
    sequence: disconnected.external_wallet.sequence,
  })
  const discovered = reduce_app_state(finished, {
    type: 'external_wallet/crypto_ready',
    wallets: [
      {
        name: solana.wallet_name,
        family: 'solana',
        authorize: async () => [solana.address],
        connect: async () => solana,
        disconnect: async () => {},
      },
    ],
  })
  expect(discovered.external_wallet.session).toBeNull()
  const requested = reduce_app_state(discovered, { type: 'external_wallet/crypto_requested' })
  expect(requested.external_wallet.connector_request).toBe(requested.external_wallet.sequence)
  const selected = reduce_app_state(requested, {
    type: 'external_wallet/connected',
    sequence: requested.external_wallet.sequence,
    session: source,
  })
  expect(crypto_session(selected.external_wallet.session)?.family).toBe('evm')
})

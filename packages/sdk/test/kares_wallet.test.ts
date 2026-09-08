// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { getWallets, type Wallet, type WalletAccount } from '@mysten/wallet-standard'

import { create_kares_wallet_auth } from '../src/kares_wallet.ts'
import { create_wallet_auth } from '../src/auth.ts'

import { id } from './helpers/transport.ts'

test('finance and game wallet sessions share account binding and boot with every deployment pin absent', async () => {
  const account = {
    address: id(200),
    publicKey: new Uint8Array(32),
    chains: ['sui:testnet'],
    features: ['sui:signPersonalMessage', 'sui:signTransaction'],
  }
  let disconnects = 0
  const wallet = {
    version: '1.0.0',
    name: 'KARES isolated wallet',
    icon: 'data:image/svg+xml,<svg/>',
    chains: ['sui:testnet'],
    accounts: [account],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:events': { version: '1.0.0', on: () => () => undefined },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          disconnects += 1
        },
      },
      'sui:signPersonalMessage': { version: '1.1.0', signPersonalMessage: async () => ({ bytes: '', signature: '' }) },
      'sui:signTransaction': { version: '2.0.0', signTransaction: async () => ({ bytes: '', signature: '' }) },
    },
  } as unknown as Wallet
  const unregister = getWallets().register(wallet)
  try {
    const options = { network: 'testnet' as const, pins: {}, rpc_url: 'https://example.invalid' }
    const factories = [
      create_kares_wallet_auth(options),
      create_wallet_auth({ ...options, graphql_url: 'https://example.invalid' }),
    ]
    for (const factory of factories) {
      const selected = factory.wallets().find(({ name }) => name === wallet.name)!
      expect(await selected.authorize()).toEqual([account.address])
      const session = await selected.connect(account.address)
      expect(session.address).toBe(account.address)
      await expect(session.kares.snapshot()).rejects.toThrow('not configured')
      await session.disconnect()
    }
    expect(disconnects).toBe(2)
  } finally {
    unregister()
  }
})

test('disposed wallet bindings reject signing and detach provider events once', async () => {
  const { create_wallet_binding } = await import('../src/wallet_standard.ts')
  let stops = 0
  let signatures = 0
  const account: WalletAccount = {
    address: id(200),
    publicKey: new Uint8Array(32),
    chains: ['sui:testnet'],
    features: [],
  }
  const wallet = {
    features: {
      'standard:events': {
        on: () => () => {
          stops += 1
        },
      },
      'sui:signPersonalMessage': {
        signPersonalMessage: async () => {
          signatures += 1
          return { bytes: '', signature: '' }
        },
      },
      'sui:signTransaction': {
        signTransaction: async () => {
          signatures += 1
          return { bytes: '', signature: '' }
        },
      },
    },
  } as unknown as Wallet
  const binding = create_wallet_binding(wallet, account, 'testnet')
  binding.dispose()
  await binding.disconnect()
  expect(stops).toBe(1)
  expect(() => binding.sign_personal_message(new Uint8Array())).toThrow('disconnected')
  expect(() => binding.sign_transaction({} as never)).toThrow('disconnected')
  expect(signatures).toBe(0)
})

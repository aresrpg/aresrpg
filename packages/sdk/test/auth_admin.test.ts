// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterEach, describe, expect, test } from 'bun:test'
import { getWallets, type Wallet, type WalletAccount } from '@mysten/wallet-standard'

import { create_wallet_auth } from '../src/auth.ts'

const account = (address: string): WalletAccount =>
  Object.freeze({
    address,
    publicKey: new Uint8Array(32),
    chains: ['sui:testnet'] as const,
    features: ['sui:signPersonalMessage', 'sui:signTransaction'] as const,
  })

describe('admin wallet selection', () => {
  let unregister: (() => void) | null = null
  afterEach(() => {
    unregister?.()
    unregister = null
  })

  test('binds the session and signatures to the explicitly selected account', async () => {
    const accounts = Object.freeze([account('0xfirst'), account('0xadmin')])
    let signed_address: string | null = null
    let change_listener: ((properties: Readonly<{ accounts?: readonly WalletAccount[] }>) => void) | null = null
    const wallet = {
      version: '1.0.0',
      name: 'Admin Test Wallet',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      chains: ['sui:testnet'],
      accounts,
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts }) },
        'standard:events': {
          version: '1.0.0',
          on: (_event: 'change', listener: typeof change_listener) => {
            change_listener = listener
            return () => {
              change_listener = null
            }
          },
        },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => undefined },
        'sui:signPersonalMessage': {
          version: '1.1.0',
          signPersonalMessage: async ({ account: selected }: Readonly<{ account: WalletAccount }>) => {
            signed_address = selected.address
            return { bytes: '', signature: '' }
          },
        },
        'sui:signTransaction': {
          version: '2.0.0',
          signTransaction: async () => ({ bytes: '', signature: '' }),
        },
      },
    } as unknown as Wallet
    unregister = getWallets().register(wallet)
    const auth = create_wallet_auth({
      graphql_url: 'https://example.invalid/graphql',
      network: 'testnet',
    })
    const selectable = auth.wallets().find(({ name }) => name === wallet.name)
    if (!selectable) throw new Error('The test wallet was not discovered')

    expect(await selectable.authorize()).toEqual(['0xfirst', '0xadmin'])
    const session = await selectable.connect('0xadmin')
    await session.sign_personal_message(new Uint8Array([1]))

    expect(session.address).toBe('0xadmin')
    expect(String(signed_address)).toBe('0xadmin')
    expect(selectable.connect('0xmissing')).rejects.toThrow('is not authorized')
    let invalidated = false
    session.on_invalidated?.(() => {
      invalidated = true
    })
    const notify_change = change_listener as ((properties: { accounts: readonly WalletAccount[] }) => void) | null
    notify_change?.({ accounts: [accounts[0]!] })
    expect(invalidated).toBe(true)
  })

  test('forwards silent wallet restoration without changing account selection', async () => {
    const accounts = Object.freeze([account('0xfirst')])
    let connect_options: { silent?: boolean } | undefined
    const wallet = {
      version: '1.0.0',
      name: 'Silent Test Wallet',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      chains: ['sui:testnet'],
      accounts,
      features: {
        'standard:connect': {
          version: '1.0.0',
          connect: async (options?: { silent?: boolean }) => {
            connect_options = options
            return { accounts }
          },
        },
        'standard:events': { version: '1.0.0', on: () => () => undefined },
        'sui:signPersonalMessage': {
          version: '1.1.0',
          signPersonalMessage: async () => ({ bytes: '', signature: '' }),
        },
        'sui:signTransaction': {
          version: '2.0.0',
          signTransaction: async () => ({ bytes: '', signature: '' }),
        },
      },
    } as unknown as Wallet
    unregister = getWallets().register(wallet)
    const auth = create_wallet_auth({ graphql_url: 'https://example.invalid/graphql', network: 'testnet' })
    const selectable = auth.wallets().find(({ name }) => name === wallet.name)
    if (!selectable) throw new Error('The silent test wallet was not discovered')

    expect(await selectable.authorize(true)).toEqual(['0xfirst'])
    expect(connect_options).toEqual({ silent: true })
  })
})

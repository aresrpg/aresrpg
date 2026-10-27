// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { BaseConnectedEthereumWallet, BaseConnectedSolanaWallet } from '@privy-io/react-auth'

import { create_privy_discovery, create_privy_prompt, privy_wallet_choice } from '../../src/wallet/privy_adapter.ts'

test('repeated empty Privy snapshots do not feed a render/discovery loop', () => {
  const discover = create_privy_discovery()
  expect(discover([])).toEqual([])
  expect(discover([])).toBeNull()
  expect(discover([])).toBeNull()
})

test('Solana wrapper churn is ignored but provider replacements and account changes are published', () => {
  const discover = create_privy_discovery()
  const standard_wallet = { name: 'Phantom' }
  const source = (address: string, wallet = standard_wallet) =>
    ({
      type: 'solana',
      address,
      meta: { name: wallet.name },
      provider: { standardWallet: wallet },
    }) as BaseConnectedSolanaWallet
  expect(discover([source('first')])?.map(({ name }) => name)).toEqual(['Phantom · Solana'])
  expect(discover([source('first')])).toBeNull()
  expect(discover([source('second')])).not.toBeNull()
  expect(discover([source('second', { name: 'Phantom' })])).not.toBeNull()
  expect(discover([])).toEqual([])
  expect(discover([])).toBeNull()
})

test('EVM snapshots copy addresses and retain provider identity changes', () => {
  const discover = create_privy_discovery()
  const wallet = { type: 'ethereum', address: 'first', meta: { name: 'MetaMask' } } as BaseConnectedEthereumWallet
  expect(discover([wallet])).not.toBeNull()
  expect(discover([wallet])).toBeNull()
  wallet.address = 'second'
  expect(discover([wallet])).not.toBeNull()
  expect(discover([{ ...wallet }])).not.toBeNull()
})

test('Solana disconnect waits for the provider and reports a failed disconnect', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const provider = { disconnect: () => pending }
  const wallet = {
    type: 'solana',
    address: 'first',
    meta: { name: 'Phantom' },
    provider,
    disconnect: () => provider.disconnect(),
  } as unknown as BaseConnectedSolanaWallet
  let completed = false
  const disconnect = privy_wallet_choice(wallet)
    .disconnect()
    .then(() => {
      completed = true
    })
  await Promise.resolve()
  expect(completed).toBe(false)
  finish()
  await disconnect
  expect(completed).toBe(true)
  const rejected = {
    ...wallet,
    provider: {
      disconnect: async () => {
        throw new Error('Disconnect failed')
      },
    },
    disconnect: async () => {
      throw new Error('Disconnect failed')
    },
  } as unknown as BaseConnectedSolanaWallet
  await expect(privy_wallet_choice(rejected).disconnect()).rejects.toThrow('Disconnect failed')
})

test('closing a displayed Privy chooser releases the request once, without cancelling adapter setup', () => {
  const prompt = create_privy_prompt()
  expect(prompt.begin(1)).toBe(true)
  expect(prompt.begin(1)).toBe(false)
  expect(prompt.changed(1, false)).toBe(false)
  expect(prompt.changed(1, true)).toBe(false)
  expect(prompt.changed(1, false)).toBe(true)
  expect(prompt.changed(1, false)).toBe(false)
  expect(prompt.begin(2)).toBe(true)
  prompt.changed(2, true)
  prompt.selected(2)
  expect(prompt.changed(2, false)).toBe(false)
  expect(prompt.begin(3)).toBe(true)
  prompt.selected(2)
  expect(prompt.changed(2, false)).toBe(false)
  prompt.changed(3, true)
  expect(prompt.changed(3, false)).toBe(true)
})

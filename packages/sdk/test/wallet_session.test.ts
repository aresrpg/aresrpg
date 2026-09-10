// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { Wallet, WalletAccount } from '@mysten/wallet-standard'

import { create_wallet_binding } from '../src/wallet_standard.ts'

const fixture = (read_session: () => Promise<unknown>) => {
  const calls: string[] = []
  const wallet = {
    features: {
      'standard:events': { on: () => () => undefined },
      'enoki:getSession': {
        getSession: async ({ network }: { network: string }) => {
          calls.push(network)
          return read_session()
        },
      },
      'sui:signPersonalMessage': {
        signPersonalMessage: async () => {
          calls.push('message')
          return { bytes: '', signature: 'proof' }
        },
      },
      'sui:signTransaction': {
        signTransaction: async () => {
          calls.push('transaction')
          return { bytes: '', signature: 'transaction' }
        },
      },
    },
  } as unknown as Wallet
  const binding = create_wallet_binding(wallet, { address: '0x1' } as WalletAccount, 'mainnet')
  binding.on_invalidated(() => {
    calls.push('invalidated')
  })
  return { binding, calls }
}

for (const session of [null, { expiresAt: Number.MAX_SAFE_INTEGER }, { jwt: 'test-only', expiresAt: 0 }]) {
  test(`a missing or expired Enoki session cannot open a signing popup: ${JSON.stringify(session)}`, async () => {
    for (const action of ['message', 'transaction']) {
      const { binding, calls } = fixture(async () => session)
      await expect(
        action === 'message' ? binding.sign_personal_message(new Uint8Array()) : binding.sign_transaction({} as never)
      ).rejects.toThrow('session expired')
      expect(calls).toEqual(['mainnet', 'invalidated'])
      binding.dispose()
    }
  })
}

test('a live Enoki session signs on the selected network without invalidating the account', async () => {
  const { binding, calls } = fixture(async () => ({ jwt: 'test-only', expiresAt: Number.MAX_SAFE_INTEGER }))
  await binding.sign_personal_message(new Uint8Array())
  await binding.sign_transaction({} as never)
  expect(calls).toEqual(['mainnet', 'message', 'mainnet', 'transaction'])
  binding.dispose()
})

test('a session read failure is not evidence that the wallet expired', async () => {
  const { binding, calls } = fixture(async () => {
    throw new Error('storage interrupted')
  })
  await expect(binding.sign_personal_message(new Uint8Array())).rejects.toThrow('storage interrupted')
  expect(calls).toEqual(['mainnet'])
  binding.dispose()
})

test('a late session check cannot sign or invalidate after disposal', async () => {
  let complete!: (session: unknown) => void
  const { binding, calls } = fixture(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  const pending = binding.sign_personal_message(new Uint8Array())
  binding.dispose()
  complete(null)
  await expect(pending).rejects.toThrow('disconnected')
  expect(calls).toEqual(['mainnet'])
})

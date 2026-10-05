// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import { getWallets, type Wallet } from '@mysten/wallet-standard'
import type { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiObjectId } from '@mysten/sui/utils'

import { create_wallet_auth, admin_wallet_context } from '../src/auth.ts'
import { as_admin_session } from '../src/admin_auth.ts'

import { digest, id } from './helpers/transport.ts'

test('setup passes the retained original capability and rejects a foreign or upgraded package', async () => {
  const account = {
    address: id(200),
    publicKey: new Uint8Array(32),
    chains: ['sui:testnet'],
    features: ['sui:signPersonalMessage', 'sui:signTransaction'],
  }
  const wallet = {
    version: '1.0.0',
    name: 'KARES funding test',
    icon: 'data:image/svg+xml,<svg/>',
    chains: ['sui:testnet'],
    accounts: [account],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:events': { version: '1.0.0', on: () => () => undefined },
      'sui:signPersonalMessage': { version: '1.1.0', signPersonalMessage: async () => ({ bytes: '', signature: '' }) },
      'sui:signTransaction': { version: '2.0.0', signTransaction: async () => ({ bytes: '', signature: '' }) },
    },
  } as unknown as Wallet
  const unregister = getWallets().register(wallet)
  try {
    const auth = create_wallet_auth({
      network: 'testnet',
      graphql_url: 'https://example.invalid',
      pins: { kares_package: id(100), kares_upgrade_cap: id(101) },
    })
    const selected = auth.wallets().find(({ name }) => name === wallet.name)!
    await selected.authorize()
    const session = await selected.connect(account.address)
    const context = admin_wallet_context(session)
    const read = spyOn(context.read_client.core, 'getObjects').mockResolvedValue({
      objects: [{ objectId: id(101), json: { package: id(100), version: '1', policy: 0 } }],
    } as never)
    const hydrate = spyOn(context.sdk, 'hydrate').mockImplementation(async () => {
      for (const object_id of [id(101), id(103), id(104)])
        context.sdk.cache.owned.set(object_id, { objectId: object_id, version: '1', digest })
      context.sdk.cache.shared.set(normalizeSuiObjectId('0xc'), { initialSharedVersion: '1' })
      return context.sdk.cache
    })
    let submitted: Transaction | null = null
    const execute = spyOn(context.sdk, 'execute').mockImplementation(async (transaction) => {
      submitted = transaction
      return { Transaction: { digest: 'funded' } }
    })
    try {
      const admin = as_admin_session(session)
      const terms = {
        package: id(100),
        upgrade_cap: id(101),
        setup: id(103),
        economy: { id: id(107), shared_version: '1' },
        currency: { id: id(106), shared_version: '1' },
        coin_type: `${id(500)}::token::TOKEN`,
        treasury: account.address,
        victory_type: `${id(600)}::fight_rewards::BossVictory`,
      }
      await admin.setup_rewards(terms)
      const data = (submitted as Transaction | null)!.getData()
      const calls = data.commands.flatMap((command) => (command.MoveCall ? [command.MoveCall] : []))
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        package: id(100),
        module: 'economy',
        function: 'setup',
      })
      const [, , argument] = calls[0].arguments
      if (argument.$kind !== 'Input') throw new Error('Setup capability must be a direct object input')
      expect(data.inputs[argument.Input].Object?.ImmOrOwnedObject?.objectId).toBe(id(101))
      read.mockResolvedValue({
        objects: [{ objectId: id(101), json: { package: id(999), version: '1', policy: 0 } }],
      } as never)
      await expect(admin.setup_rewards(terms)).rejects.toThrow('original, never-upgraded')
      read.mockResolvedValue({
        objects: [{ objectId: id(101), json: { package: id(100), version: '2', policy: 0 } }],
      } as never)
      await expect(admin.setup_rewards(terms)).rejects.toThrow('original, never-upgraded')
      read.mockResolvedValue({
        objects: [{ objectId: id(101), json: { package: id(100), version: '1', policy: 192 } }],
      } as never)
      await expect(admin.setup_rewards(terms)).rejects.toThrow('unrestricted upgrade authority')
      expect(execute).toHaveBeenCalledTimes(1)
    } finally {
      read.mockRestore()
      hydrate.mockRestore()
      execute.mockRestore()
      await session.disconnect()
    }
  } finally {
    unregister()
  }
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import { getWallets, type Wallet } from '@mysten/wallet-standard'
import type { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiObjectId } from '@mysten/sui/utils'

import { create_wallet_auth, operator_wallet_context } from '../src/auth.ts'
import { as_operator_session } from '../src/operator_auth.ts'

import { digest, id } from './helpers/transport.ts'

test('setup seals its original capability atomically and rejects a foreign or upgraded package', async () => {
  const account = {
    address: id(200),
    publicKey: new Uint8Array(32),
    chains: ['sui:testnet'],
    features: ['sui:signPersonalMessage', 'sui:signTransaction'],
  }
  const wallet = {
    version: '1.0.0',
    name: 'KARES seal test',
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
    const context = operator_wallet_context(session)
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
      return { Transaction: { digest: 'immutable' } }
    })
    try {
      const operator = as_operator_session(session)
      const terms = {
        package: id(100),
        upgrade_cap: id(101),
        genesis: id(103),
        currency: id(104),
        minimum: 5n,
        maximum: 20n,
        duration_ms: 100n,
        treasury: account.address,
        liquidity: id(201),
        team: id(202),
        community: id(203),
      }
      await operator.setup_kares(terms)
      const data = (submitted as Transaction | null)!.getData()
      expect(data.commands).toHaveLength(2)
      expect(data.commands[1].MoveCall).toMatchObject({
        package: id(100),
        module: 'offering',
        function: 'setup',
      })
      const [, argument] = data.commands[1].MoveCall!.arguments
      if (argument.$kind !== 'Input') throw new Error('Setup capability must be a direct object input')
      expect(data.inputs[argument.Input].Object?.ImmOrOwnedObject?.objectId).toBe(id(101))
      read.mockResolvedValue({
        objects: [{ objectId: id(101), json: { package: id(999), version: '1', policy: 0 } }],
      } as never)
      await expect(operator.setup_kares(terms)).rejects.toThrow('original, never-upgraded')
      read.mockResolvedValue({
        objects: [{ objectId: id(101), json: { package: id(100), version: '2', policy: 0 } }],
      } as never)
      await expect(operator.setup_kares(terms)).rejects.toThrow('original, never-upgraded')
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

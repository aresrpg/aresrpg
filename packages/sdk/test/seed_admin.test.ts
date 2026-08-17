// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { TransactionPlugin } from '@mysten/sui/transactions'

import type { Receipt } from '../src/cache.ts'
import { SDK, type Pins, type SuiTransport } from '../src/client.ts'
import { seal_marker_id, type SeedContent } from '../src/seed.ts'
import {
  create_seed_admin,
  create_seed_session_authorization_transaction,
  next_seed_batch,
  project_temp_admin_cap,
  SEED_SESSION_GAS,
} from '../src/seed_admin.ts'

const object_id = (value: number): string => `0x${value.toString(16).padStart(2, '0').repeat(32)}`
const package_id = object_id(1)
const registry_id = object_id(2)
const admin_cap_id = object_id(3)
const pins: Pins = {
  package: package_id,
  math_package: object_id(4),
  template_registry: { id: registry_id, shared_version: '1' },
  loot_registry: { id: object_id(5), shared_version: '1' },
}
const content: SeedContent = {
  items: [{ item_type: 'ore', name: 'Ore', category: 'resource', level: 1 }],
  spells: [],
  mobs: [],
  recipes: [],
  worlds: [],
  shop: { sales: [] },
  airdrop: { drops: [], giftcards: [] },
  biome_maps: [],
}
const resolve_transaction: TransactionPlugin = async (_data, _options, next) => next()

const sdk_with = (existing: ReadonlySet<string>) =>
  SDK({
    address: object_id(9),
    pins,
    sign_transaction: async () => ({ bytes: '', signature: '' }),
    client: {
      core: {
        resolveTransactionPlugin: () => resolve_transaction,
        getBalance: async () => ({ balance: { balance: '0' } }),
        getCurrentSystemState: async () => ({ systemState: { epoch: '1', referenceGasPrice: '1' } }),
        getChainIdentifier: async () => ({ chainIdentifier: object_id(0) }),
        getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
        listCoins: async () => ({ objects: [] }),
        getObjects: async ({ objectIds }) => ({
          objects: objectIds
            .filter((id) => existing.has(id))
            .map((object_id_value) => ({
              objectId: object_id_value,
              version: '1',
              digest: 'digest',
              owner: { AddressOwner: object_id(9) },
            })),
        }),
        simulateTransaction: async () => ({}),
        executeTransaction: async () => ({}),
      },
    } as SuiTransport,
  })

describe('seed admin progress', () => {
  test('authorizes the local signer and funds it in one wallet transaction', () => {
    const sdk = sdk_with(new Set())
    sdk.cache.owned.set(admin_cap_id, {
      objectId: admin_cap_id,
      version: '1',
      digest: '11111111111111111111111111111111',
    })
    const transaction = create_seed_session_authorization_transaction({
      sdk,
      admin_cap: admin_cap_id,
      recipient: object_id(8),
    })

    expect(transaction.getData().commands.map(({ $kind }) => $kind)).toEqual([
      'MoveCall',
      'SplitCoins',
      'TransferObjects',
    ])
    expect(SEED_SESSION_GAS).toBe(50_000_000_000n)
  })

  test('projects the temporary AdminCap exact ref from its authorization receipt', () => {
    const created = object_id(12)
    const receipt: Receipt = {
      Transaction: {
        objectTypes: { [created]: `${package_id}::admin::AdminCap` },
        effects: {
          changedObjects: [
            {
              objectId: created,
              idOperation: 'Created',
              outputVersion: '42',
              outputDigest: 'receipt-digest',
              outputOwner: { AddressOwner: object_id(8) },
            },
          ],
        },
      },
    }

    expect(project_temp_admin_cap(receipt)).toEqual({
      objectId: created,
      version: '42',
      digest: 'receipt-digest',
    })
  })

  test('recovers the permanent seal from chain state without local progress', async () => {
    const seal_id = seal_marker_id(registry_id, package_id)
    const session = await create_seed_admin({
      sdk: sdk_with(new Set([admin_cap_id, seal_id])),
      content,
      config: { admin_cap: admin_cap_id, worlds: {} },
    })

    const snapshot = await session.refresh()
    expect(snapshot.sealed).toBeTrue()
    expect(next_seed_batch(snapshot)).toBeNull()
    expect(snapshot.batches.every(({ state }) => state === 'complete')).toBeTrue()
  })

  test('reports every inspected batch while deterministic addresses are checked', async () => {
    const session = await create_seed_admin({
      sdk: sdk_with(new Set([admin_cap_id])),
      content,
      config: { admin_cap: admin_cap_id, worlds: {} },
    })
    const progress: number[] = []
    const snapshot = await session.refresh(({ inspected }) => progress.push(inspected))

    expect(progress).toEqual(snapshot.batches.map((_batch, index) => index + 1))
  })
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { SDK, type Pins, type SuiTransport } from '../src/client.ts'
import { seal_marker_id, type SeedContent } from '../src/seed.ts'
import { create_seed_admin, next_seed_batch } from '../src/seed_admin.ts'

const object_id = (value: number): string => `0x${value.toString(16).padStart(2, '0').repeat(32)}`
const package_id = object_id(1)
const registry_id = object_id(2)
const publisher_id = object_id(3)
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

const sdk_with = (existing: ReadonlySet<string>) =>
  SDK({
    address: object_id(9),
    pins,
    sign_transaction: async () => ({ bytes: '', signature: '' }),
    client: {
      core: {
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
  test('recovers the permanent seal from chain state without local progress', async () => {
    const seal_id = seal_marker_id(registry_id, package_id)
    const session = await create_seed_admin({
      sdk: sdk_with(new Set([publisher_id, seal_id])),
      content,
      config: { publisher: publisher_id, worlds: {} },
    })

    const snapshot = await session.refresh()
    expect(snapshot.sealed).toBeTrue()
    expect(next_seed_batch(snapshot)).toBeNull()
    expect(snapshot.batches.every(({ state }) => state === 'complete')).toBeTrue()
  })
})

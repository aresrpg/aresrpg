// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { TransactionPlugin } from '@mysten/sui/transactions'

import type { Sdk } from '../src/client.ts'
import { create_seed_plan, type SeedContent } from '../src/seed.ts'
import { SDK, type Pins, type SuiTransport } from '../src/client.ts'

const REGISTRY = `0x${'11'.repeat(32)}`
const PACKAGE = `0x${'22'.repeat(32)}`
const resolve_transaction: TransactionPlugin = async (_data, _options, next) => next()

const sdk = {
  pins: {
    package: PACKAGE,
    math_package: `0x${'33'.repeat(32)}`,
    template_registry: { id: REGISTRY, shared_version: '1' },
  },
} as unknown as Sdk

const content: SeedContent = {
  items: [
    {
      item_type: 'box',
      name: 'Box',
      category: 'consumable',
      level: 1,
      consumable: { type: 'loot_box', rewards: [{ item_type: 'ore', weight: 1, amount: 50 }] },
    },
    { item_type: 'ore', name: 'Ore', category: 'resource', level: 1 },
  ],
  spells: [],
  mobs: [],
  recipes: [],
  worlds: [],
  shop: { sales: [] },
  airdrop: {
    drops: [{ id: 'launch', item_type: 'ore', amount_each: 2, whitelist: [`0x${'44'.repeat(32)}`] }],
    giftcards: [{ id: 'press', item_type: 'ore', amount: 3, custody: `0x${'55'.repeat(32)}` }],
  },
  biome_maps: [],
}

describe('seed plan', () => {
  test('publishes reward templates before boxes and gives every supply row a resumable target', () => {
    const plan = create_seed_plan(sdk, content)
    const phases = plan.batches.map(({ phase }) => phase)
    const supply = plan.batches.filter(({ phase }) => phase === 'supply')

    expect(phases.indexOf('items')).toBeLessThan(phases.indexOf('loot_boxes'))
    expect(supply).toHaveLength(2)
    expect(supply.every(({ target_ids }) => target_ids.length === 1)).toBeTrue()
    expect(new Set(supply.flatMap(({ target_ids }) => target_ids)).size).toBe(2)
    expect(supply.every(({ dependencies }) => dependencies.length === 1)).toBeTrue()
  })

  test('packs against the protocol command ceiling because the gRPC resolver accepts full-size PTBs', () => {
    const many_items = Array.from({ length: 500 }, (_, index) => ({
      item_type: `ore_${index}`,
      name: `Ore ${index}`,
      category: 'resource' as const,
      level: 1,
    }))
    const plan = create_seed_plan(sdk, { ...content, items: many_items })

    expect(plan.batches.filter(({ phase }) => phase === 'items')).toHaveLength(2)
  })

  test('interns repeated pure values inside one generated transaction', () => {
    const game = SDK({
      address: `0x${'99'.repeat(32)}`,
      pins: sdk.pins as Pins,
      client: {
        core: {
          resolveTransactionPlugin: () => resolve_transaction,
          getBalance: async () => ({ balance: { balance: '0' } }),
          getCurrentSystemState: async () => ({ systemState: { epoch: '1', referenceGasPrice: '1' } }),
          getChainIdentifier: async () => ({ chainIdentifier: REGISTRY }),
          getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
          listCoins: async () => ({ objects: [] }),
          getObjects: async () => ({ objects: [] }),
          simulateTransaction: async () => ({}),
          executeTransaction: async () => ({}),
        },
      } as SuiTransport,
    })
    game.cache.owned.set(REGISTRY, { objectId: REGISTRY, version: '1', digest: 'digest' })
    game.cache.owned.set(`0x${'44'.repeat(32)}`, {
      objectId: `0x${'44'.repeat(32)}`,
      version: '1',
      digest: 'digest',
    })
    const plan = create_seed_plan(game, {
      ...content,
      items: [
        { item_type: 'ore_a', name: 'Ore', category: 'resource', level: 1 },
        { item_type: 'ore_b', name: 'Ore', category: 'resource', level: 1 },
      ],
    })
    const transaction = plan.batches[0]?.build({ admin_cap: `0x${'44'.repeat(32)}`, worlds: {} }, new Set<string>())

    expect(transaction?.getData().inputs.length).toBeLessThan(10)
  })

  test('refuses two authored rows that would claim the same derived address', () => {
    expect(() =>
      create_seed_plan(sdk, {
        ...content,
        airdrop: { ...content.airdrop, drops: [content.airdrop.drops[0], content.airdrop.drops[0]] },
      })
    ).toThrow('is claimed by both')
  })
})

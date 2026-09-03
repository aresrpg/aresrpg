// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { Transaction, TransactionPlugin } from '@mysten/sui/transactions'

import type { Sdk } from '../src/client.ts'
import { create_seed_plan, recipe_door_args, type SeedContent } from '../src/seed.ts'
import { board_catalog_id, item_template_id, mob_template_id, world_content_id, world_id } from '../src/seed_ids.ts'
import { SDK, type Pins, type SuiTransport } from '../src/client.ts'

const REGISTRY = `0x${'11'.repeat(32)}`
const PACKAGE = `0x${'22'.repeat(32)}`
const ADMIN_CAP = `0x${'44'.repeat(32)}`
const resolve_transaction: TransactionPlugin = async (_data, _options, next) => next()

const sdk = {
  game_type_package: PACKAGE,
  pins: {
    package: PACKAGE,
    math_package: `0x${'33'.repeat(32)}`,
    seed_package: '0x5eed'.padEnd(66, '0'),
    seed_package_original: '0x5eed'.padEnd(66, '0'),
    content_root: { id: '0xc0'.padEnd(66, '0'), shared_version: '1' },
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
  dungeons: [],
  worlds: [],
  mastery: { offers: [] },
  airdrop: {
    drops: [{ id: 'launch', item_type: 'ore', amount_each: 2, whitelist: [`0x${'44'.repeat(32)}`] }],
    giftcards: [{ id: 'press', item_type: 'ore', amount: 3, custody: `0x${'55'.repeat(32)}` }],
  },
  biome_maps: [],
  boards: [],
}

test('recipe composition refuses a ninth ingredient before building a transaction', () => {
  const inputs = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`ingredient_${index}`, 1]))
  expect(() =>
    recipe_door_args('0xc0'.padEnd(66, '0'), '0x5eed'.padEnd(66, '0'), { output_type: 'ore', inputs }, 'MINER')
  ).toThrow('must use 1..8 distinct ingredients')
})

test('fieldless BoardCatalogKey derives the catalog created on Testnet', () => {
  // Captured 2026-08-25 from successful transaction 646PM6JqsZNcbvu3uRcZb4xvYF5BwayTjwe6arQuJkDF.
  expect(
    board_catalog_id(
      '0x1bd402ec24ffc9e82663d88e44bc13b76c3d2cc176d7def52455e53bb1310a98',
      '0x3e7f52a64c7bcea94cdeadd5a0b32b6f83bd03f35aebf8f1060107213a53bb77'
    )
  ).toBe('0x759f42d1cdbc221789b9010d4a12a7dc53ea8b651180fb69417c2d35cb361a73')
})

const game = () => {
  const result = SDK({
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
  result.cache.owned.set(ADMIN_CAP, { objectId: ADMIN_CAP, version: '1', digest: 'digest' })
  return result
}

const pure_u64s = (tx: Transaction): readonly bigint[] =>
  tx.getData().inputs.flatMap((input) => {
    if (!input.Pure?.bytes) return []
    const bytes = Uint8Array.from(atob(input.Pure.bytes), (char) => char.charCodeAt(0))
    if (bytes.length !== 8) return []
    let value = 0n
    for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index]!)
    return [value]
  })

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

  test('mastery offers publish only after their referenced item exists', () => {
    const plan = create_seed_plan(sdk, { ...content, mastery: { offers: [{ item_type: 'ore', cost: 5 }] } })
    const [offer] = plan.batches.filter(({ phase }) => phase === 'mastery_offers')
    expect(offer?.dependencies).toHaveLength(1)
    expect(plan.batches.indexOf(offer!)).toBeGreaterThan(plan.batches.findIndex(({ phase }) => phase === 'items'))
  })

  test('interns repeated pure values inside one generated transaction', () => {
    const seeded = game()
    seeded.cache.owned.set(REGISTRY, { objectId: REGISTRY, version: '1', digest: 'digest' })
    const plan = create_seed_plan(seeded, {
      ...content,
      items: [
        { item_type: 'ore_a', name: 'Ore', category: 'resource', level: 1 },
        { item_type: 'ore_b', name: 'Ore', category: 'resource', level: 1 },
      ],
    })
    const transaction = plan.batches[0]?.build({ admin_cap: ADMIN_CAP, content_root: ADMIN_CAP }, new Set<string>())

    expect(transaction?.getData().inputs.length).toBeLessThan(10)
  })

  test('a JSON world creates both derived objects without deployment world pins', () => {
    const seeded = game()
    const root = '0xc0'.padEnd(66, '0')
    const seed_original = '0x5eed'.padEnd(66, '0')
    const plan = create_seed_plan(seeded, {
      ...content,
      worlds: [
        {
          world: 'nauvis',
          entry_level: 1,
          archis: [{ ordinary_type: 'fuwa', archi_type: 'fukuo' }],
          cities: [],
          mobs: [],
          resources: [],
        },
      ],
    })
    const batch = plan.batches.find(({ phase }) => phase === 'worlds')!
    const transaction = batch.build({ admin_cap: ADMIN_CAP, content_root: ADMIN_CAP }, new Set<string>())!
    const calls = transaction
      .getData()
      .commands.flatMap((command) =>
        command.MoveCall ? [`${command.MoveCall.module}::${command.MoveCall.function}`] : []
      )

    expect(batch.target_ids).toEqual([
      world_content_id(root, seed_original, 'nauvis'),
      world_id(root, PACKAGE, 'nauvis'),
    ])
    expect(calls).toContain('world_content::create')
    expect(calls).toContain('world_content::set_archi_rows')
    expect(calls).toContain('world_map::new_archi_row')
    expect(calls).toContain('world::create')
    expect(batch.dependencies).toContain(mob_template_id(root, seed_original, 'fukuo'))
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

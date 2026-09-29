// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { fromHex } from '@mysten/sui/utils'

import { create_item_snapshot_reader, LINKED_ITEM_CACHE_CAPACITY, read_item_snapshot } from '../src/item_snapshot.ts'
import rolled_fixture from '../../indexer/tests/rolled_stats.localnet.json'

// getDynamicField returns the value, excluding the captured Field UID (32 bytes) and marker key (1).
const stats = fromHex(rolled_fixture.bcs_hex).subarray(33)
test('reads the exact linked item and its captured stat dynamic field', async () => {
  const fields = [{ name: { type: '0xgame::item::StatsKey', bcs: new Uint8Array([0]) } }]
  const client = {
    core: {
      getObjects: async () => ({
        objects: [
          {
            objectId: '0xhat',
            type: '0xgame::item::Item',
            json: { name: 'Fuwa Hat', item_type: 'fuwa_hat', category: 'hat', level: 12 },
          },
        ],
      }),
      listDynamicFields: async () => ({ dynamicFields: fields }),
      getDynamicField: async () => ({ dynamicField: { value: { bcs: stats } } }),
    },
  }

  expect(await read_item_snapshot(client as never, '0xgame', '0xhat')).toMatchObject({
    id: '0xhat',
    name: 'Fuwa Hat',
    item_type: 'fuwa_hat',
    category: 'hat',
    level: 12,
    stats: { strength: 32_772, wisdom: 32_779 },
  })
  const truncated = {
    core: {
      ...client.core,
      getDynamicField: async () => ({ dynamicField: { value: { bcs: stats.subarray(0, 30) } } }),
    },
  }
  await expect(read_item_snapshot(truncated, '0xgame', '0xhat')).rejects.toThrow()
})

test('rejects an Item lookalike from another package before decoding its fields', async () => {
  const client = {
    core: {
      getObjects: async () => ({
        objects: [
          {
            objectId: '0xhat',
            type: '0xforeign::item::Item',
            json: { name: 'Fake', item_type: 'fake', category: 'hat', level: 1 },
          },
        ],
      }),
      listDynamicFields: async () => ({ dynamicFields: [] }),
    },
  }
  expect(read_item_snapshot(client as never, '0xgame', '0xhat')).rejects.toThrow(/unavailable/)
})

test('the authenticated reader keeps one 20-entry promise LRU', async () => {
  expect(LINKED_ITEM_CACHE_CAPACITY).toBe(20)
  const calls: string[] = []
  const client = {
    core: {
      getObjects: async ({ objectIds }: { objectIds: string[] }) => {
        calls.push(objectIds[0]!)
        return {
          objects: [
            {
              objectId: objectIds[0],
              type: '0xgame::item::Item',
              json: { name: objectIds[0], item_type: 'wool', category: 'resource', level: 1 },
            },
          ],
        }
      },
      listDynamicFields: async () => ({ dynamicFields: [] }),
      getDynamicField: async () => {
        throw new Error('no dynamic fields')
      },
    },
  }
  const read = create_item_snapshot_reader(client as never, '0xgame', 2)
  expect((await Promise.all([read('0xa'), read('0xa')])).map(({ id }) => id)).toEqual(['0xa', '0xa'])
  await read('0xb')
  await read('0xa')
  await read('0xc')
  await read('0xb')
  expect(calls).toEqual(['0xa', '0xb', '0xc', '0xb'])
})

test('a transient item read failure is not cached', async () => {
  let calls = 0
  const client = {
    core: {
      getObjects: async () => {
        calls += 1
        if (calls === 1) throw new Error('temporary read failure')
        return {
          objects: [
            {
              objectId: '0xhat',
              type: '0xgame::item::Item',
              json: { name: 'Hat', item_type: 'hat', category: 'hat', level: 1 },
            },
          ],
        }
      },
      listDynamicFields: async () => ({ dynamicFields: [] }),
      getDynamicField: async () => {
        throw new Error('no dynamic fields')
      },
    },
  }
  const read = create_item_snapshot_reader(client as never, '0xgame')
  await expect(read('0xhat')).rejects.toThrow('temporary read failure')
  expect(await read('0xhat')).toMatchObject({ id: '0xhat', name: 'Hat' })
  expect(calls).toBe(2)
})

test('linked pets retain feed power while never-fed pets start at zero', async () => {
  const feed_name = { type: '0xgame::pet::FeedKey', bcs: new Uint8Array([0]) }
  let fields = [{ name: feed_name }]
  const calls: string[] = []
  const client = {
    core: {
      getObjects: async () => ({
        objects: [
          {
            objectId: '0xpet',
            type: '0xgame::item::Item',
            json: { name: 'Pet', item_type: 'pet', category: 'pet', level: 1 },
          },
        ],
      }),
      listDynamicFields: async () => ({ dynamicFields: fields }),
      getDynamicField: async ({ name }: { name: { type: string } }) => {
        calls.push(name.type)
        return { dynamicField: { value: { bcs: new Uint8Array([30, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]) } } }
      },
    },
  }
  expect(await read_item_snapshot(client, '0xgame', '0xpet')).toMatchObject({ pet_power: 30 })
  expect(calls).toEqual(['0xgame::pet::FeedKey'])
  fields = []
  expect(await read_item_snapshot(client, '0xgame', '0xpet')).toMatchObject({ pet_power: 0 })
})

test('captured mainnet pet with no FeedKey contributes zero power', async () => {
  const fixture = (await import('./fixtures/item_snapshot_pet.mainnet.json')).default
  // Public Item and dynamic-field IDs, versions and capture timestamp are retained in the fixture.
  const client = {
    core: {
      getObjects: async () => ({ objects: [fixture.item] }),
      listDynamicFields: async () => ({
        dynamicFields: fixture.fields.map(({ name }) => ({ name: { type: name.type, bcs: fromHex(name.bcs_hex) } })),
      }),
      getDynamicField: async ({ name }: { name: { type: string } }) => ({
        dynamicField: {
          value: {
            bcs: fromHex(fixture.fields.find((field) => field.name.type === name.type)!.value_bcs_hex),
          },
        },
      }),
    },
  }
  const result = await read_item_snapshot(client, fixture.item.type.split('::')[0]!, fixture.item.objectId)
  expect(result.pet_power).toBe(0)
  expect(result.category).toBe('pet')
  expect(result.stats).toBeDefined()
})

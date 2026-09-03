// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { fromBase64 } from '@mysten/sui/utils'

import { create_item_snapshot_reader, LINKED_ITEM_CACHE_CAPACITY, read_item_snapshot } from '../src/item_snapshot.ts'

// Live testnet ItemStatistics from Fuwa Hat template
// 0xc7dd4637…ac55f @ version 993653972, captured 2026-08-28.
const stats = fromBase64('AIAAgAGAAYAAgACAAIAAgACAAIAAgACAAIAAgACA')
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
    stats: { strength: 32_769, intelligence: 32_769 },
  })
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

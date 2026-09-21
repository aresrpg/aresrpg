// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { FalkorDB } from 'falkordb'
import { ITEM_STAT_FIELDS } from '@aresrpg/fight/move_contract'

import { get_market_slice, get_market_types } from '../../src/reads/get_market_slice.ts'
import type { Graph, GraphRow } from '../../src/graph.ts'

const url = process.env.FALKOR_TEST_URL

test.skipIf(!url)(
  'real grouped market pages keep three cheapest complete rolls, privacy and exact prices',
  async () => {
    expect(url).toStartWith('redis://127.0.0.1:')
    const db = await FalkorDB.connect({ url })
    const store = db.selectGraph(`market_groups_${process.pid}_${Date.now()}`)
    const graph: Graph = {
      read: async (query, params) => (await store.roQuery(query, { params })).data as GraphRow[],
      close: () => db.close(),
    }
    try {
      await store.query('CREATE INDEX FOR (i:Item) ON (i.item_type)')
      await store.query('CREATE INDEX FOR (i:Item) ON (i.category)')
      await store.query(
        "CREATE (seller:User {address:'seller'})-[:OWNS]->(:Kiosk {id:'seller_kiosk',market_version:'99'}), (:User {address:'buyer'})-[:OWNS]->(:Kiosk {id:'buyer_kiosk',market_version:'99'})"
      )
      const rows = Array.from({ length: 24 }, (_, roll) =>
        Array.from({ length: 6 }, (_, offer) => ({
          id: `roll_${roll}_${offer}`,
          name: 'Hat',
          item_type: 'mokan',
          category: 'hat',
          level: 1,
          amount: 1,
          stats: ITEM_STAT_FIELDS.map((field) => 32768 + (field === 'wisdom' ? roll : 0)),
          price: offer < 4 ? String(9007199254740992n + BigInt([1, 0, 2, 3][offer]!)) : '1',
          kiosk: offer === 4 ? 'buyer_kiosk' : 'seller_kiosk',
          exclusive: offer === 5,
        }))
      ).flat()
      await store.query(
        `UNWIND $rows AS row MATCH (k:Kiosk {id:row.kiosk})
      CREATE (i:Item {id:row.id,name:row.name,item_type:row.item_type,category:row.category,level:row.level,amount:row.amount,stats:row.stats})
      CREATE (i)-[:LISTED_IN {exclusive:row.exclusive,price:row.price,version:'98',at_ms:1}]->(k)`,
        { params: { rows } }
      )
      const observation = { kind: 'offers' as const, category: 'hat' as const, item_type: 'mokan', request: 1 }
      const first = await get_market_slice(graph, { observation, address: 'buyer' })
      expect(first.listings).toHaveLength(60)
      expect(first.next_cursor).not.toBeNull()
      expect(new Set(first.listings.map((row) => row.group_key)).size).toBe(20)
      expect(first.listings.every((row) => typeof row.group_key === 'string')).toBeTrue()
      expect(new Set(first.listings.map((row) => row.stats?.wisdom)).size).toBe(20)
      expect(first.listings.slice(0, 3).map((row) => row.price_mist)).toEqual([
        '9007199254740992',
        '9007199254740993',
        '9007199254740994',
      ])
      expect(first.listings.every((row) => row.seller !== 'buyer' && !row.id.endsWith('_5'))).toBeTrue()
      const second = await get_market_slice(graph, {
        observation: { ...observation, cursor: first.next_cursor! },
        address: 'buyer',
      })
      expect(second.listings).toHaveLength(12)
      expect(second.next_cursor).toBeNull()
      expect(new Set([...first.listings, ...second.listings].map((row) => row.id)).size).toBe(72)
      expect(await get_market_types(graph, 'hat')).toEqual([
        { category: 'hat', item_type: 'mokan', name: 'Hat', level: 1 },
      ])
      expect(await get_market_types(graph, 'resource')).toEqual([])
      await store.query("MATCH (i:Item {item_type:'mokan'}) WHERE i.id STARTS WITH 'roll_20_' DETACH DELETE i")
      const changed_page = await get_market_slice(graph, {
        observation: { ...observation, cursor: first.next_cursor! },
        address: 'buyer',
      })
      expect(changed_page.listings).toHaveLength(9)
      const stats = ITEM_STAT_FIELDS.map(() => 32768)
      const variants = [
        { id: 'base', stats },
        { id: 'same', stats },
        { id: 'damage', stats, damages: JSON.stringify([{ element: 'fire', from: 1, to: 2, damage_type: 'damage' }]) },
        { id: 'sink', stats, puits: '20' },
        { id: 'power', stats, pet_power: 1 },
        { id: 'fed', stats, pet_power: 1, pet_last_day: 99 },
        { id: 'unknown_a', stats: null },
        { id: 'unknown_b', stats: null },
        { id: 'bad_a', stats: [1] },
        { id: 'bad_b', stats: [1] },
      ]
      await store.query(
        `UNWIND $rows AS row MATCH (k:Kiosk {id:'seller_kiosk'})
      CREATE (i:Item {id:row.id,name:'Variants',item_type:'variants',category:'pet',level:1,amount:1,
        stats:row.stats,damages:row.damages,puits:row.puits,pet_power:row.pet_power,pet_last_day:row.pet_last_day})
      CREATE (i)-[:LISTED_IN {exclusive:false,price:'1',version:'98',at_ms:1}]->(k)`,
        {
          params: {
            rows: variants.map((row) => ({
              ...row,
              damages: row.damages ?? null,
              puits: row.puits ?? null,
              pet_power: row.pet_power ?? null,
              pet_last_day: row.pet_last_day ?? null,
            })),
          },
        }
      )
      const variant_page = await get_market_slice(graph, {
        observation: { kind: 'offers', category: 'pet', item_type: 'variants', request: 1 },
        address: 'buyer',
      })
      expect(variant_page.listings).toHaveLength(10)
      expect(variant_page.listings.find(({ id }) => id === 'sink')?.puits).toBe('20')
      expect(variant_page.listings.find(({ id }) => id === 'fed')).toMatchObject({ pet_power: 1, pet_last_day: 99 })
      // More than three unknown objects must never be collapsed into one made-up zero roll.
      await store.query(`UNWIND ['unknown_c','unknown_d'] AS id MATCH (k:Kiosk {id:'seller_kiosk'})
      CREATE (i:Item {id:id,name:'Variants',item_type:'variants',category:'pet',level:1,amount:1})
      CREATE (i)-[:LISTED_IN {exclusive:false,price:'1',version:'98',at_ms:1}]->(k)`)
      const unknown_page = await get_market_slice(graph, {
        observation: { kind: 'offers', category: 'pet', item_type: 'variants', request: 2 },
        address: 'buyer',
      })
      expect(unknown_page.listings.filter(({ id }) => id.startsWith('unknown_'))).toHaveLength(4)
      await store.query(`UNWIND [1,10,100] AS amount UNWIND [1,2,3,4] AS price MATCH (k:Kiosk {id:'seller_kiosk'})
      CREATE (i:Item {id:'lot_'+toString(amount)+'_'+toString(price),name:'Wood',item_type:'wood',category:'resource',level:1,amount:amount})
      CREATE (i)-[:LISTED_IN {exclusive:false,price:toString(price),version:'98',at_ms:1}]->(k)`)
      const lots = await get_market_slice(graph, {
        observation: { kind: 'offers', category: 'resource', item_type: 'wood', request: 1 },
        address: 'buyer',
      })
      expect(lots.listings).toHaveLength(9)
      for (const quantity of [1, 10, 100])
        expect(lots.listings.filter(({ amount }) => amount === quantity).map(({ price_mist }) => price_mist)).toEqual([
          '1',
          '2',
          '3',
        ])
    } finally {
      await store.delete()
      await db.close()
    }
  }
)

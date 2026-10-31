// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { FalkorDB } from 'falkordb'

import { get_market_floor } from '../../src/reads/get_market_floor.ts'
import type { Graph, GraphRow } from '../../src/graph.ts'

const url = process.env.FALKOR_TEST_URL

test.skipIf(!url)(
  'lowest prices use exact lots, public custody, and integer ordering beyond safe numbers',
  async () => {
    expect(url).toStartWith('redis://127.0.0.1:')
    const db = await FalkorDB.connect({ url })
    const store = db.selectGraph(`market_floor_${process.pid}_${Date.now()}`)
    const graph: Graph = {
      read: async (query, params) => (await store.roQuery(query, { params })).data as GraphRow[],
      close: () => db.close(),
    }
    try {
      await store.query("CREATE (:User {address:'seller'})-[:OWNS]->(:Kiosk {id:'own'}), (:Kiosk {id:'orphan'})")
      await store.query(
        `UNWIND $offers AS offer MATCH (k:Kiosk {id:offer.kiosk})
      CREATE (:Item {item_type:offer.item_type, amount:offer.amount})
      -[:LISTED_IN {exclusive:offer.exclusive, price:offer.price}]->(k)`,
        {
          params: {
            offers: [
              { amount: 1, price: '10' },
              { amount: 1, price: '9' },
              { amount: 10, price: '9007199254740993' },
              { amount: 10, price: '9007199254740992' },
              { amount: 100, price: '200' },
              { amount: 1000, price: '500' },
              { amount: 10, price: '0' },
              { amount: 10, price: '1', exclusive: true },
              { amount: 10, price: '2', kiosk: 'orphan' },
              { amount: 10, price: '3', item_type: 'wood' },
              { amount: 5, price: '4' },
            ].map((row) => ({ kiosk: 'own', exclusive: false, item_type: 'wheat', ...row })),
          },
        }
      )
      expect(await get_market_floor(graph, 'missing')).toEqual({})
      expect(await get_market_floor(graph, 'wheat')).toEqual({
        1: '9',
        10: '9007199254740992',
        100: '200',
        1000: '500',
      })
    } finally {
      await store.delete()
      await db.close()
    }
  }
)

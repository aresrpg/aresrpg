// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { FalkorDB } from 'falkordb'

import { get_market_type_counts } from '../../src/reads/get_market_slice.ts'
import type { Graph, GraphRow } from '../../src/graph.ts'

const url = process.env.FALKOR_TEST_URL

test.skipIf(!url)(
  'counts distinct public types, including own offers, excluding private and unowned kiosks',
  async () => {
    expect(url).toStartWith('redis://127.0.0.1:')
    const db = await FalkorDB.connect({ url })
    const store = db.selectGraph(`market_counts_${process.pid}_${Date.now()}`)
    const graph: Graph = {
      read: async (query, params) => (await store.roQuery(query, { params })).data as GraphRow[],
      close: () => db.close(),
    }
    try {
      await store.query("CREATE (:User {address:'owner'})-[:OWNS]->(:Kiosk {id:'owned'}), (:Kiosk {id:'orphan'})")
      await store.query(`UNWIND range(1,100) AS roll MATCH (k:Kiosk {id:'owned'})
      CREATE (:Item {item_type:'hat_a',category:'hat',amount:roll,stats:[roll]})-[:LISTED_IN {exclusive:false}]->(k)`)
      await store.query(`MATCH (k:Kiosk {id:'owned'}), (orphan:Kiosk {id:'orphan'})
      CREATE (:Item {item_type:'hat_b',category:'hat'})-[:LISTED_IN {exclusive:false}]->(k),
      (:Item {item_type:'private',category:'hat'})-[:LISTED_IN {exclusive:true}]->(k),
      (:Item {item_type:'orphan',category:'hat'})-[:LISTED_IN {exclusive:false}]->(orphan),
      (:Item {item_type:'wood',category:'resource',amount:1000})-[:LISTED_IN {exclusive:false}]->(k),
      (:Item {item_type:'unlisted',category:'hat'})`)
      expect(await get_market_type_counts(graph)).toEqual({ hat: 2, resource: 1 })
      await store.query("MATCH (i:Item {item_type:'hat_a'}) DETACH DELETE i")
      expect(await get_market_type_counts(graph)).toEqual({ hat: 1, resource: 1 })
    } finally {
      await store.delete()
      await db.close()
    }
  }
)

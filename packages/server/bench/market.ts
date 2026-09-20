// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Isolated selected-type cardinality measurement; no game database or RPC is used.
import { FalkorDB } from 'falkordb'
import { ITEM_STAT_FIELDS } from '@aresrpg/fight/move_contract'

import { get_market_slice } from '../src/reads/get_market_slice.ts'
import type { Graph, GraphRow } from '../src/graph.ts'

const [url, raw_count = '10000'] = process.argv.slice(2)
const count = Number(raw_count)
if (!url?.startsWith('redis://127.0.0.1:') || !Number.isInteger(count) || count < 1 || count > 100_000)
  throw new Error('Local scratch database and 1–100000 listings required')
const db = await FalkorDB.connect({ url })
const store = db.selectGraph(`capacity_market_${process.pid}_${Date.now()}`)
let query_text = ''
let query_params: Record<string, unknown> = {}
const graph: Graph = {
  read: async (query, params) => {
    query_text = query
    query_params = params ?? {}
    return (await store.roQuery(query, { params })).data as GraphRow[]
  },
  close: () => db.close(),
}
try {
  await store.query('CREATE INDEX FOR (i:Item) ON (i.item_type)')
  await store.query('CREATE INDEX FOR (i:Item) ON (i.id)')
  await store.query('CREATE INDEX FOR (k:Kiosk) ON (k.id)')
  await store.query("CREATE (:User {address:'seller'})-[:OWNS]->(:Kiosk {id:'seller',market_version:'1'})")
  for (let offset = 0; offset < count; offset += 1000) {
    const rows = Array.from({ length: Math.min(1000, count - offset) }, (_, index) => ({
      id: `item_${offset + index}`,
      price: String(index + 1),
      stats: ITEM_STAT_FIELDS.map((field) => 32768 + (field === 'wisdom' ? (offset + index) % 100 : 0)),
    }))
    await store.query(
      `MATCH (k:Kiosk {id:'seller'}) UNWIND $rows AS row
      CREATE (:Item {id:row.id,item_type:'mokan',name:'Mokan',category:'hat',amount:1,level:1,stats:row.stats})
      -[:LISTED_IN {exclusive:false,price:row.price,version:'1',at_ms:1}]->(k)`,
      { params: { rows } }
    )
  }
  const read = () =>
    get_market_slice(graph, {
      address: 'buyer',
      observation: { kind: 'offers', category: 'hat', item_type: 'mokan', request: 1 },
    })
  const samples: number[] = []
  let offered = 0
  for (let index = 0; index < 20; index++) {
    const started = performance.now()
    offered = (await read()).listings.length
    samples.push(performance.now() - started)
  }
  const params = Object.entries(query_params)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ')
  const plan = await store.explain(`CYPHER ${params} ${query_text}`)
  console.log(JSON.stringify({ count, offered, samples_ms: samples, plan }, null, 2))
} finally {
  await store.delete()
  await db.close()
}

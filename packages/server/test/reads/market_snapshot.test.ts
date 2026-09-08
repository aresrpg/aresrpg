// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { FalkorDB } from 'falkordb'

import type { Graph, GraphRow } from '../../src/graph.ts'
import { get_market_slice } from '../../src/reads/get_market_slice.ts'
import { get_my_listings } from '../../src/reads/get_user_economy.ts'

const url = process.env.FALKOR_TEST_URL

test.skipIf(!url)('real market reads retain exact revisions for listed and empty catalogues', async () => {
  expect(url).toStartWith('redis://127.0.0.1:')
  const db = await FalkorDB.connect({ url })
  const name = `market_regression_${process.pid}_${Date.now()}`
  const store = db.selectGraph(name)
  const graph: Graph = {
    read: async (query, params) => (await store.roQuery(query, { params })).data as GraphRow[],
    close: () => db.close(),
  }
  try {
    await store.query(`CREATE (u:User {address: 'owner'}), (k:Kiosk {id: 'kiosk', market_version: '9007199254740993'}),
      (u)-[:OWNS]->(k), (i:Item {id: 'asset', category: 'hat', name: 'Hat', item_type: 'hat', level: 1, amount: 1}),
      (i)-[:LISTED_IN {exclusive: false, price: '5', at_ms: 1, version: '9007199254740992'}]->(k)`)
    const observation = { categories: ['hat'] as const, characters: false }
    const snapshot = await get_market_slice(graph, { observation })
    expect(snapshot.listings).toHaveLength(1)
    expect(snapshot.listings[0]?.version).toBe('9007199254740992')
    expect(snapshot.kiosk_versions).toEqual({ kiosk: '9007199254740993' })
    await store.query(`MATCH (:Item)-[l:LISTED_IN]->(k:Kiosk) DELETE l SET k.market_version = '9007199254740994'`)
    expect(await get_market_slice(graph, { observation, kiosks: ['kiosk'] })).toEqual({
      listings: [],
      kiosk_versions: { kiosk: '9007199254740994' },
    })
    expect(await get_my_listings(graph, { address: 'owner' })).toEqual({
      listings: [],
      kiosk_versions: { kiosk: '9007199254740994' },
    })
  } finally {
    await store.delete()
    await db.close()
  }
})

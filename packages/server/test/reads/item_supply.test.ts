// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { FalkorDB } from 'falkordb'

import { create_item_supply_reader, get_item_supply } from '../../src/reads/get_item_supply.ts'
import type { Graph, GraphRow } from '../../src/graph.ts'

const url = process.env.FALKOR_TEST_URL

test.skipIf(!url)('supply counts units across listed and unlisted stacks with exact large integer totals', async () => {
  expect(url).toStartWith('redis://127.0.0.1:')
  const db = await FalkorDB.connect({ url })
  const store = db.selectGraph(`market_supply_${process.pid}_${Date.now()}`)
  const graph: Graph = {
    read: async (query, params) => (await store.roQuery(query, { params })).data as GraphRow[],
    close: () => db.close(),
  }
  try {
    await store.query('CREATE INDEX FOR (i:Item) ON (i.item_type)')
    await store.query(`CREATE (:Item {id:'listed',item_type:'wood',category:'resource',amount:10})-[:LISTED_IN]->(:Kiosk),
      (:Item {id:'bag',item_type:'wood',category:'resource',amount:9007199254740993}),
      (:Item {id:'other',item_type:'stone',category:'resource',amount:999}),
      (:Item {id:'gear',item_type:'hat',category:'hat',amount:1})`)
    expect(await get_item_supply(graph, 'wood')).toBe('9007199254741003')
    expect(await get_item_supply(graph, 'missing')).toBe('0')
    expect(await get_item_supply(graph, 'hat')).toBe('0')
    await store.query("MATCH (i:Item {id:'listed'}) DETACH DELETE i")
    expect(await get_item_supply(graph, 'wood')).toBe('9007199254740993')
  } finally {
    await store.delete()
    await db.close()
  }
})

test('viewers share supply reads, including pending work and unavailable samples, until lazy expiry', async () => {
  let now = 0
  let calls = 0
  const read = create_item_supply_reader(
    {
      read: async () => {
        calls++
        return [{ whole: 0, remainder: calls === 1 ? 42 : Number.NaN }]
      },
      close: async () => {},
    },
    () => now
  )
  const first = read('wood')
  expect(read('wood')).toBe(first)
  expect(await first).toBe('42')
  now = 29_999
  expect(await read('wood')).toBe('42')
  expect(calls).toBe(1)
  now = 30_000
  expect(await read('wood')).toBeNull()
  expect(await read('wood')).toBeNull()
  expect(calls).toBe(2)
})

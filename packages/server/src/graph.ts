// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The graph read door — the ONE place cypher leaves this process. READ-ONLY by law: this
// server never writes the db (the indexer is the only writer); `read` refuses any cypher
// that isn't a MATCH-shaped query, mechanically. Top-level await: importing this module IS
// connecting (the harness receives it injected, so tests never import it).

import { FalkorDB } from 'falkordb'

import { GRAPH_URL, GRAPH_NAME } from './env.ts'
import logger from './logger.ts'

const log = logger(import.meta)

export type GraphRow = Record<string, any>
/** A Falkor node row: `{ properties: {...} }` — the shape `RETURN n` yields. */
export type Node = { properties: Record<string, unknown> } | null | undefined
export type Graph = {
  read: (cypher: string, params?: Record<string, any>) => Promise<GraphRow[]>
  close: () => Promise<void>
}

// Death watch note: pod suicide on a lost indexer set lives on the graph BUS (pubsub.ts) —
// bus and graph point at the same instance, so one door owns the watch.
const db = await FalkorDB.connect({ url: GRAPH_URL })
const falkor_graph = db.selectGraph(GRAPH_NAME)
log.info({ url: GRAPH_URL, graph: GRAPH_NAME }, 'graph connected')

export const graph: Graph = {
  read: async (cypher, params) => {
    const head = cypher.trimStart().toUpperCase()
    if (!head.startsWith('MATCH ') && !head.startsWith('OPTIONAL MATCH'))
      throw new Error('[graph] read-only law: only MATCH queries leave this server')
    const result = await falkor_graph.roQuery(cypher, { params })
    return (result.data ?? []) as GraphRow[]
  },
  close: () => db.close(),
}

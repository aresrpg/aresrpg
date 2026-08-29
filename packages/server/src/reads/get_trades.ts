// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The player's open trades (either side) + the single-trade read the stream enriches from.
// The node's cap manifests are item-id arrays; the row the client renders names each item.

import type { TradeRow, TradeCapRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

const enrich_caps = async (graph: Graph, ids: readonly string[]): Promise<Map<string, TradeCapRow>> => {
  if (ids.length === 0) return new Map()
  const rows = await graph.read(
    `MATCH (asset)-[:LISTED_IN {exclusive: true}]->(k:Kiosk)
     WHERE asset.id IN ${JSON.stringify([...ids])} AND asset:Item
     RETURN asset, k.id AS kiosk`
  )
  return new Map(
    rows.flatMap((row): [string, TradeCapRow][] => {
      if (!row.asset) return []
      const props = (row.asset as Exclude<Node, null | undefined>).properties
      const cap = {
        object: String(props.id),
        name: String(props.name),
        level: Number(props.level),
        amount: Number(props.amount),
        item_type: String(props.item_type),
        category: String(props.category),
        kiosk: String(row.kiosk),
      } satisfies TradeCapRow
      return [[cap.object, cap]]
    })
  )
}

const cap_ids = (props: Record<string, unknown>, side: 'a' | 'b'): string[] =>
  JSON.parse((props[`caps_${side}`] as string) ?? '[]') as string[]

const shape_trade = (props: Record<string, unknown>, caps: ReadonlyMap<string, TradeCapRow>): TradeRow => {
  const resolved = (side: 'a' | 'b'): TradeCapRow[] =>
    cap_ids(props, side).map((id) => {
      const cap = caps.get(id)
      if (!cap) throw new Error(`Trade ${String(props.id)} manifest cap ${id} has no exclusive listing projection.`)
      return cap
    })
  return {
    id: props.id as string,
    a: props.a as string,
    b: props.b as string,
    phase: props.phase as TradeRow['phase'],
    offer_revision: Number(props.offer_revision),
    accept_a: Boolean(props.accept_a),
    accept_b: Boolean(props.accept_b),
    sui_a: String(props.sui_a ?? '0'),
    sui_b: String(props.sui_b ?? '0'),
    caps_a: resolved('a'),
    caps_b: resolved('b'),
  }
}

export async function get_trades(graph: Graph, { address }: { address: string }): Promise<TradeRow[]> {
  const essential_filter = `(t.phase <> 'requested' OR t.sui_a <> '0' OR t.sui_b <> '0' OR
                       t.caps_a <> '[]' OR t.caps_b <> '[]')`
  const request_query = (side: 'a' | 'b') =>
    `MATCH (t:Trade) WHERE t.${side} = $address AND NOT ${essential_filter}
     RETURN t AS trade ORDER BY t.ckpt DESC, t.id DESC LIMIT 1`
  const [essential_rows, incoming_request, outgoing_request] = await Promise.all([
    graph.read(
      `MATCH (t:Trade) WHERE (t.a = $address OR t.b = $address) AND ${essential_filter}
       RETURN t AS trade ORDER BY t.ckpt DESC`,
      { address }
    ),
    graph.read(request_query('b'), { address }),
    graph.read(request_query('a'), { address }),
  ])
  const props = [...essential_rows, ...incoming_request, ...outgoing_request].flatMap(({ trade }) =>
    trade ? [(trade as Exclude<Node, null | undefined>).properties] : []
  )
  const ids = [...new Set(props.flatMap((row) => [...cap_ids(row, 'a'), ...cap_ids(row, 'b')]))]
  const caps = await enrich_caps(graph, ids)
  return props.map((row) => shape_trade(row, caps))
}

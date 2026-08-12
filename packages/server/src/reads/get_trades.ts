// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The player's open trades (either side) + the single-trade read the stream enriches from.
// The node's cap manifests are item-id arrays; the row the client renders names each item.

import type { TradeRow, TradeCapRow } from '@aresrpg/protocol'

import { type Graph, type Node } from '../graph.ts'

import { get_item } from './get_item.ts'

const enrich_caps = async (graph: Graph, ids: string[]): Promise<TradeCapRow[]> => {
  const items = await Promise.all(ids.map((id) => get_item(graph, { id })))
  return items
    .filter((item) => item !== null)
    .map((item) => ({ object: item.id, name: item.name, item_type: item.item_type }))
}

const shape_trade = async (graph: Graph, props: Record<string, unknown>): Promise<TradeRow> => {
  const [caps_a, caps_b] = await Promise.all([
    enrich_caps(graph, JSON.parse((props.caps_a as string) ?? '[]') as string[]),
    enrich_caps(graph, JSON.parse((props.caps_b as string) ?? '[]') as string[]),
  ])
  return {
    id: props.id as string,
    a: props.a as string,
    b: props.b as string,
    version: Number(props.version),
    accept_a: Boolean(props.accept_a),
    accept_b: Boolean(props.accept_b),
    locked: Boolean(props.locked),
    sui_a: String(props.sui_a ?? '0'),
    sui_b: String(props.sui_b ?? '0'),
    caps_a,
    caps_b,
  }
}

export async function get_trades(graph: Graph, { address }: { address: string }): Promise<TradeRow[]> {
  const rows = await graph.read(`MATCH (t:Trade) WHERE t.a = $address OR t.b = $address RETURN t AS trade`, { address })
  return Promise.all(
    rows
      .filter(({ trade }) => trade)
      .map(({ trade }) => shape_trade(graph, (trade as Exclude<Node, null | undefined>).properties))
  )
}

export async function get_trade(graph: Graph, { trade_id }: { trade_id: string }): Promise<TradeRow | null> {
  const rows = await graph.read(`MATCH (t:Trade {id: $trade_id}) RETURN t AS trade`, { trade_id })
  const [row] = rows
  if (!row?.trade) return null
  return shape_trade(graph, (row.trade as Exclude<Node, null | undefined>).properties)
}

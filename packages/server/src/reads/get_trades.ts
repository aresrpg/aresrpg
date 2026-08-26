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
     WHERE asset.id IN ${JSON.stringify([...ids])} AND (asset:Item OR asset:Character)
     RETURN asset, labels(asset) AS kinds, k.id AS kiosk`
  )
  return new Map(
    rows.flatMap((row): [string, TradeCapRow][] => {
      if (!row.asset) return []
      const props = (row.asset as Exclude<Node, null | undefined>).properties
      const kind = (row.kinds as string[]).includes('Character') ? ('character' as const) : ('item' as const)
      const cap = {
        object: String(props.id),
        kind,
        name: String(props.name),
        level: Number(props.level),
        amount: kind === 'item' ? Number(props.amount) : 1,
        classe: kind === 'character' ? String(props.classe) : null,
        item_type: kind === 'item' ? String(props.item_type) : null,
        category: kind === 'item' ? String(props.category) : null,
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
    version: Number(props.version),
    accept_a: Boolean(props.accept_a),
    accept_b: Boolean(props.accept_b),
    locked: Boolean(props.locked),
    sui_a: String(props.sui_a ?? '0'),
    sui_b: String(props.sui_b ?? '0'),
    caps_a: resolved('a'),
    caps_b: resolved('b'),
  }
}

export async function get_trades(graph: Graph, { address }: { address: string }): Promise<TradeRow[]> {
  const own_escrow = `(t.locked OR (t.a = $address AND (t.sui_a <> '0' OR t.caps_a <> '[]')) OR
                       (t.b = $address AND (t.sui_b <> '0' OR t.caps_b <> '[]')))`
  const [essential, requests] = await Promise.all([
    graph.read(
      `MATCH (t:Trade) WHERE (t.a = $address OR t.b = $address) AND ${own_escrow}
       RETURN t AS trade ORDER BY t.ckpt DESC`,
      { address }
    ),
    graph.read(
      `MATCH (t:Trade) WHERE (t.a = $address OR t.b = $address) AND NOT ${own_escrow}
       RETURN t AS trade ORDER BY t.ckpt DESC LIMIT 50`,
      { address }
    ),
  ])
  const props = [...essential, ...requests].flatMap(({ trade }) =>
    trade ? [(trade as Exclude<Node, null | undefined>).properties] : []
  )
  const ids = [...new Set(props.flatMap((row) => [...cap_ids(row, 'a'), ...cap_ids(row, 'b')]))]
  const caps = await enrich_caps(graph, ids)
  return props.map((row) => shape_trade(row, caps))
}

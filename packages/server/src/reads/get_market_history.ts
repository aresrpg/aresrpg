// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The seller ledger is the indexer's retained sales zset. Kiosk profits remain graph truth.

import type { MarketSaleRow } from '@aresrpg/protocol'

import type { Graph } from '../graph.ts'
import type { GraphBus } from '../pubsub_bus.ts'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000
const nullable_string = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const parse_sale = (member: string): MarketSaleRow & Readonly<{ side: string }> => {
  const separator = member.indexOf('|')
  if (separator < 0) throw new Error('sales history member has no coordinate separator')
  const id = member.slice(0, separator)
  try {
    const row = JSON.parse(member.slice(separator + 1)) as Record<string, unknown>
    if (
      (row.kind !== 'item' && row.kind !== 'character') ||
      typeof row.object !== 'string' ||
      typeof row.price_mist !== 'string' ||
      typeof row.ts_ms !== 'number' ||
      typeof row.side !== 'string'
    )
      throw new Error('sales history member has an invalid shape')
    return {
      id,
      object: row.object,
      kind: row.kind,
      name: nullable_string(row.name),
      item_type: nullable_string(row.item_type),
      amount: Number(row.amount) || 1,
      price_mist: row.price_mist,
      counterparty: nullable_string(row.counterparty),
      ts_ms: row.ts_ms,
      side: row.side,
    }
  } catch (error) {
    throw new Error('sales history member is corrupt', { cause: error })
  }
}

export async function get_market_history(
  graph: Graph,
  bus: GraphBus,
  { address, now_ms = Date.now() }: Readonly<{ address: string; now_ms?: number }>
) {
  const [members, kiosk_rows] = await Promise.all([
    bus.sales_history(address),
    graph.read(
      `MATCH (:User {address: $address})-[:OWNS]->(k:Kiosk)
       RETURN k.id AS kiosk, k.profits AS amount_mist`,
      { address }
    ),
  ])
  const sold = members.map(parse_sale).filter(({ side }) => side === 'sold')
  const revenue_30d_mist = sold
    .filter(({ ts_ms }) => ts_ms >= now_ms - THIRTY_DAYS_MS)
    .reduce((total, { price_mist }) => total + BigInt(price_mist), 0n)
  return Object.freeze({
    sales: sold.slice(0, 200).map(({ side: _side, ...row }) => row),
    revenue_30d_mist: String(revenue_30d_mist),
    total: sold.length,
    profits: kiosk_rows
      .map(({ kiosk, amount_mist }) => ({ kiosk: String(kiosk), amount_mist: String(amount_mist ?? '0') }))
      .filter(({ amount_mist }) => BigInt(amount_mist) > 0n),
  })
}

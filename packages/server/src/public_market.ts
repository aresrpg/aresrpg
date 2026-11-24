// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { MarketQuery, MarketType } from '@aresrpg/protocol'

import type { Graph } from './graph.ts'
import type { GraphBus } from './pubsub_bus.ts'
import type { EventEnvelope } from './protocol.ts'
import { sampled_read } from './sampled_read.ts'
import { get_market_types } from './reads/get_market_slice.ts'

/** The pod reads the listed-type catalogue at most once per this interval, whatever the socket count. */
export const MARKET_TYPES_SAMPLE_MS = 5_000

export const is_market_change = ({ type }: EventEnvelope): boolean =>
  ['MarketListed', 'MarketDelisted', 'MarketPurchased'].includes(type)

/** Whether one market event can change the page of a query; an event without an indexed scope counts. */
export const market_change_matches = (event: EventEnvelope, query: MarketQuery): boolean => {
  if (!is_market_change(event)) return false
  const scope =
    query.kind === 'characters'
      ? { kind: 'character' }
      : { kind: 'item', category: query.category, item_type: query.item_type }
  return Object.entries(scope).every(([key, value]) => event.data[key] == null || event.data[key] === value)
}

/** The pod's one listed-type catalogue, sampled. A sample equal to the previous one keeps its identity,
 *  so a socket compares by reference and pushes only a catalogue that changed. */
export const create_public_market = (graph: Graph, bus: Pick<GraphBus, 'market_changes'>) => {
  let latest: Readonly<{ json: string; items: readonly MarketType[] }> | null = null
  const sample = sampled_read(async (_key, at_ms) => {
    const items = await get_market_types(graph, await bus.market_changes(at_ms))
    const json = JSON.stringify(items)
    if (latest?.json !== json) latest = Object.freeze({ json, items })
    return latest.items
  }, MARKET_TYPES_SAMPLE_MS)
  return (): Promise<readonly MarketType[]> => sample('types')
}
export type PublicMarket = ReturnType<typeof create_public_market>

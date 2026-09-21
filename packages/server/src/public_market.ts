// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ItemCategory } from '@aresrpg/immutable'
import type { MarketObservation } from '@aresrpg/protocol'

import type { Graph } from './graph.ts'
import type { Bus } from './pubsub_bus.ts'
import { channels, type EventEnvelope } from './protocol.ts'
import { shared_projection } from './shared_projection.ts'
import { get_market_types, get_market_type_counts } from './reads/get_market_slice.ts'

export const is_market_change = ({ type }: EventEnvelope): boolean =>
  ['MarketListed', 'MarketDelisted', 'MarketPurchased'].includes(type)

export const market_change_matches = (event: EventEnvelope, observation: MarketObservation): boolean => {
  if (observation.kind === 'overview' || !is_market_change(event)) return false
  const scope =
    observation.kind === 'characters'
      ? { kind: 'character' }
      : {
          kind: 'item',
          category: observation.category,
          item_type: observation.kind === 'offers' ? observation.item_type : undefined,
        }
  return Object.entries(scope).every(
    ([key, value]) => value === undefined || event.data[key] == null || event.data[key] === value
  )
}

export const create_public_market = (graph: Graph, bus: Pick<Bus, 'emitter' | 'subscribe' | 'unsubscribe'>) => ({
  ...shared_projection({
    bus,
    channel: () => channels.economy,
    read: (category) => get_market_types(graph, category as ItemCategory),
    invalidates: (event, category) =>
      market_change_matches(event, { kind: 'types', category: category as ItemCategory, request: 0 }),
  }),
  counts: shared_projection({
    bus,
    channel: () => channels.economy,
    read: () => get_market_type_counts(graph),
    invalidates: (event) => is_market_change(event) && event.data.kind !== 'character',
    sample_interval_ms: 5_000,
  }),
})
export type PublicMarket = ReturnType<typeof create_public_market>

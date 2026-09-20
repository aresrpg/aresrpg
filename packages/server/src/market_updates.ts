// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Graph } from './graph.ts'
import type { EventEnvelope } from './protocol.ts'

/** Resolve list/delist metadata once per pod, before any category viewer sees the invalidation. */
export const market_updates = async (graph: Graph, event: EventEnvelope): Promise<EventEnvelope> => {
  if (event.data.kind === 'character' || (event.data.item_type && event.data.category)) return event
  const [item] = await graph.read(
    `MATCH (asset:Item {id: $object})
    RETURN asset.item_type AS item_type, asset.category AS category`,
    { object: event.data.object }
  )
  // A consumed object may already be absent; the unscoped invalidation remains conservative.
  return item ? { ...event, data: { ...event.data, ...item, kind: 'item' } } : event
}

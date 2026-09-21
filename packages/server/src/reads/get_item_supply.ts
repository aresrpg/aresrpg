// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { stackable_item_categories } from '@aresrpg/immutable'

import type { Graph } from '../graph.ts'
import logger from '../logger.ts'
import { sampled_read } from '../sampled_read.ts'

const log = logger(import.meta)

/** Count current units in every custody, not just public listings. Keep integer precision across the wire. */
export const get_item_supply = async (graph: Graph, item_type: string): Promise<string | null> => {
  const [row] = await graph.read(
    `MATCH (item:Item {item_type: $item_type}) WHERE item.category IN $stackable
     RETURN sum(item.amount / $radix) AS whole, sum(item.amount % $radix) AS remainder`,
    { item_type, stackable: [...stackable_item_categories], radix: 1_000_000 }
  )
  // FalkorDB SUM uses doubles. Sum integer quotient/remainder limbs, validate each, then recombine exactly.
  if (![row?.whole, row?.remainder].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Error('invalid indexed item supply')
  return (BigInt(row!.whole) * 1_000_000n + BigInt(row!.remainder)).toString()
}

/** Shared by viewers on this server; lazy refresh means closed item views generate no work. */
export const create_item_supply_reader = (graph: Graph, now: () => number = Date.now) =>
  sampled_read(
    (item_type) =>
      get_item_supply(graph, item_type).catch((error: unknown) => {
        log.warn({ err: error, item_type }, 'marketplace supply unavailable')
        return null
      }),
    30_000,
    now
  )

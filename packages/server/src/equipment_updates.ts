// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { VISIBLE_SLOTS, visible_equipment, type VisibleSlot } from '@aresrpg/protocol'

import type { Graph } from './graph.ts'
import type { EventEnvelope } from './protocol.ts'
import { latest_keyed_reader } from './latest_read.ts'

/** Both event kinds invalidate the same current projection. Late reads cannot resurrect gear. */
export const equipment_updates = (
  graph: Graph,
  deliver: (character: string, equipment: Readonly<Record<VisibleSlot, string | null>>) => void
) => {
  const refresh = latest_keyed_reader(async (character) => {
    const rows = await graph.read(
      `MATCH (c:Character {id: $character})-[e:EQUIPS]->(i:Item)
         RETURN e.slot AS slot, i.item_type AS item_type`,
      { character }
    )
    return visible_equipment(rows as { slot: string; item_type: string }[])
  }, deliver)
  const on_event = (payload: EventEnvelope): Promise<void> => {
    if (payload.type !== 'ItemEquipped' && payload.type !== 'ItemUnequipped') return Promise.resolve()
    const { character, slot } = payload.data as { character: string; slot: string }
    return (VISIBLE_SLOTS as readonly string[]).includes(slot) ? refresh(character) : Promise.resolve()
  }
  return Object.freeze({ refresh, on_event })
}

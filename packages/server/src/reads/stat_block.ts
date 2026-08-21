// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The graph stores every stat block as a 15-int array in the canonical field order
// (indexer stats_array). This is the ONE array → named-record seam every read shares.

import { ITEM_STAT_FIELDS } from '@aresrpg/fight/move_contract'

export const stats_record_of = (stats: unknown): Record<string, number> => {
  if (Array.isArray(stats) && stats.length === ITEM_STAT_FIELDS.length)
    return Object.fromEntries(ITEM_STAT_FIELDS.map((field, index) => [field, Number(stats[index])]))
  // a present-but-misshapen block is projection drift — surface it, never coerce silently
  if (stats !== undefined && stats !== null)
    console.error('[stat_block] projected stat block does not match the canonical field order', stats)
  return {}
}

/** Shape a projected Item node's DF props for the wire: the stats array becomes a named
 *  record, the damages JSON string becomes real rows. Absent DFs stay absent. */
export const shape_item = <T extends Record<string, unknown>>(props: T) => {
  const { stats, damages, ...rest } = props
  return {
    ...rest,
    ...(Array.isArray(stats) ? { stats: stats_record_of(stats) } : {}),
    ...(typeof damages === 'string' ? { damages: JSON.parse(damages) as unknown[] } : {}),
  }
}

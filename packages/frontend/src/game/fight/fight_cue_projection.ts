// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { FightPresentationCue } from '@aresrpg/engine'
import type { FightEvent, HydratedFightCheckpoint } from '@aresrpg/fight'

export const fight_entity_id = (checkpoint: Readonly<HydratedFightCheckpoint>, seat: bigint): string =>
  checkpoint.contract.fighters[Number(seat)]?.kind.type === 'mob' ? `fight_mob_${seat}` : `fight_character_${seat}`

export const fight_zone_change_cues = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  event: Readonly<FightEvent>,
  id: string
): readonly FightPresentationCue[] | null => {
  if (event.type === 'trap_placed' || event.type === 'glyph_placed')
    return [
      Object.freeze({
        id,
        type: 'zone_placed',
        action: event.type,
        zone_id: event.payload.zone_id,
        owner_id: fight_entity_id(checkpoint, event.payload.owner),
        cell: Number(event.payload.anchor),
      }),
    ]
  if (event.type === 'zone_removed')
    return event.payload.reason === 'triggered'
      ? Object.freeze([])
      : [Object.freeze({ id, type: 'zone_removed', zone_id: event.payload.zone_id })]
  return null
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { PartyRow, PresenceRow } from '@aresrpg/protocol'

export type MapPlayer = Readonly<{ x: number; z: number; role: 'player' | 'party' | 'leader' }>

/** Owned live poses take precedence over mesh echoes; all coordinates remain chain coordinates. */
export const map_players = (
  remote: Readonly<Record<string, PresenceRow>>,
  owned: Readonly<Record<string, PresenceRow>>,
  party: Readonly<PartyRow> | null,
  selected: string | null,
  world: string | null
): readonly MapPlayer[] => {
  const members = new Set(party?.members.map(({ character_id }) => character_id))
  const leader = party?.members[0]?.character_id
  return Object.values({ ...remote, ...owned })
    .filter((player) => player.world === world && player.character_id !== selected)
    .map(({ character_id, x, z }) => ({
      x,
      z,
      role: character_id === leader ? 'leader' : members.has(character_id) ? 'party' : 'player',
    }))
}

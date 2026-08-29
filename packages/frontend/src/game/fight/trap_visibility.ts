// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PvP trap placement is team-private presentation; PvM keeps the ordinary public cast beat.

import type { HydratedFightCheckpoint } from '@aresrpg/fight'

export const trap_placement_visible = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  owner: bigint,
  viewer_team: bigint | null
): boolean => {
  const player_teams = new Set(
    checkpoint.contract.fighters.flatMap((fighter) => (fighter.kind.type === 'player' ? [fighter.team] : []))
  )
  if (player_teams.size < 2) return true
  return viewer_team !== null && checkpoint.contract.fighters[Number(owner)]?.team === viewer_team
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HydratedFightCheckpoint } from './types.ts'

/** The immutable template set for settlement, never predicted drops or caller-supplied assets. */
export const fight_loot_types = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  own_seat: number
): readonly string[] => {
  const own = checkpoint.contract.fighters[own_seat]
  if (!own || own.kind.type !== 'player' || own.forfeited || checkpoint.contract.winner !== own.team)
    return Object.freeze([])
  return Object.freeze([
    ...new Set(
      checkpoint.contract.fighters.flatMap((fighter) =>
        fighter.team === own.team || fighter.kind.type !== 'mob'
          ? []
          : fighter.kind.snapshot.loot.map(({ item_type }) => item_type)
      )
    ),
  ])
}

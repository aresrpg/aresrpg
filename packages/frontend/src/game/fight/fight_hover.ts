// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { HydratedFightCheckpoint } from '@aresrpg/fight'

export type FightHover =
  | Readonly<{ fight: string; type: 'cell'; cell: bigint }>
  | Readonly<{ fight: string; type: 'fighter'; seat: bigint }>
  | null

const EMPTY_HOVER = Object.freeze({ cell: null, seat: null })

/** Retain the pointer's intent; derive its fighter and cell from the current checkpoint. */
export const resolve_fight_hover = (
  checkpoint: Readonly<HydratedFightCheckpoint> | null,
  hover: FightHover
): Readonly<{ cell: bigint | null; seat: bigint | null }> => {
  if (!checkpoint || !hover || checkpoint.contract.id !== hover.fight) return EMPTY_HOVER
  if (hover.type === 'fighter') {
    const fighter = checkpoint.contract.fighters[Number(hover.seat)]
    return fighter ? { cell: fighter.cell, seat: hover.seat } : EMPTY_HOVER
  }
  const seat = checkpoint.contract.fighters.findIndex((fighter) => !fighter.dead && fighter.cell === hover.cell)
  return { cell: hover.cell, seat: seat < 0 ? null : BigInt(seat) }
}

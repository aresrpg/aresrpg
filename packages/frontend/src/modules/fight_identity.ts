// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { HydratedFightCheckpoint } from '@aresrpg/fight'

export const holds_character_seat = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  character_id: string | null,
  owner: string | null
): boolean =>
  !!character_id &&
  !!owner &&
  checkpoint.contract.fighters.some(
    (fighter) =>
      fighter.kind.type === 'player' &&
      fighter.kind.character === character_id &&
      fighter.kind.owner === owner &&
      !fighter.settled
  )

type FightFighter = HydratedFightCheckpoint['contract']['fighters'][number]

const owned_character_id = (
  fighter: Readonly<FightFighter> | undefined,
  owner: string,
  roster: ReadonlySet<string>
): string | null => {
  if (fighter?.kind.type !== 'player') return null
  if (fighter.kind.owner !== owner || !roster.has(fighter.kind.character)) return null
  return fighter.dead || fighter.settled ? null : fighter.kind.character
}

export const active_owned_character = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  owner: string | null,
  roster: ReadonlySet<string>
): string | null => {
  if (!owner || checkpoint.contract.round === 0n || checkpoint.contract.ended) return null
  const seat = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]
  const fighter = seat === undefined ? undefined : checkpoint.contract.fighters[Number(seat)]
  return owned_character_id(fighter, owner, roster)
}

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

export const owned_placement_readiness = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  owner: string | null,
  roster: ReadonlySet<string>,
  submitted: readonly number[] = Object.freeze([])
): Readonly<{ owned_count: number; unready_seats: readonly bigint[] }> => {
  if (!owner) return Object.freeze({ owned_count: 0, unready_seats: Object.freeze([]) })
  const owned = checkpoint.contract.fighters.flatMap((fighter, seat) =>
    fighter.kind.type === 'player' &&
    fighter.kind.owner === owner &&
    roster.has(fighter.kind.character) &&
    !fighter.dead &&
    !fighter.settled
      ? [Object.freeze({ fighter, seat })]
      : []
  )
  const submitted_seats = new Set(submitted)
  return Object.freeze({
    owned_count: owned.length,
    unready_seats: Object.freeze(
      owned.flatMap(({ fighter, seat }) => (!fighter.ready && !submitted_seats.has(seat) ? [BigInt(seat)] : []))
    ),
  })
}

export const requested_owned_unready_seats = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  owner: string | null,
  roster: ReadonlySet<string>,
  requested: readonly bigint[]
): readonly number[] => {
  const wanted = new Set(requested.map(String))
  return Object.freeze(
    owned_placement_readiness(checkpoint, owner, roster)
      .unready_seats.filter((seat) => wanted.has(String(seat)))
      .map(Number)
  )
}

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

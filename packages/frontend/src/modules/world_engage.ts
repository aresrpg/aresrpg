// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { chain_to_client_coordinate } from '@aresrpg/immutable'
import { live_mob_groups, type FightRow } from '@aresrpg/protocol'

import type { PendingEngage, WorldState } from './world.ts'

export const sword_fights = (fights: Readonly<Record<string, FightRow>>, world: string | null): readonly FightRow[] =>
  world
    ? Object.freeze(
        Object.values(fights).filter(
          (fight) => fight.world === world && fight.phase !== 'ended' && !fight.managed && !fight.wagered
        )
      )
    : Object.freeze([])

export const begin_pending_engage = (
  world: WorldState,
  group: string,
  access: 0 | 1,
  started_at_ms: number,
  found: Readonly<{ key: string; index: number }> | null
): WorldState => {
  if (!found || group in world.pending_engages) return world
  const zone = world.zones[found.key]
  const population = world.spawns[found.key]
  const row =
    zone && population ? live_mob_groups(population.mobs, zone).find(({ index }) => index === found.index) : null
  if (!zone || !row) return world
  const pending = Object.freeze({
    group,
    key: found.key,
    index: found.index,
    world: zone.world,
    x: chain_to_client_coordinate(row.x),
    z: chain_to_client_coordinate(row.z),
    members: Object.freeze(row.members),
    started_at_ms,
    access,
    fight: null,
  }) satisfies PendingEngage
  return Object.freeze({
    ...world,
    pending_engages: Object.freeze({ ...world.pending_engages, [group]: pending }),
  })
}

export const submit_pending_engage = (world: WorldState, group: string, fight: string): WorldState => {
  const pending = world.pending_engages[group]
  return pending
    ? Object.freeze({
        ...world,
        pending_engages: Object.freeze({
          ...world.pending_engages,
          [group]: Object.freeze({ ...pending, fight }),
        }),
      })
    : world
}

export const remove_pending_engage = (world: WorldState, group: string): WorldState =>
  group in world.pending_engages
    ? Object.freeze({
        ...world,
        pending_engages: Object.freeze(
          Object.fromEntries(Object.entries(world.pending_engages).filter(([candidate]) => candidate !== group))
        ),
      })
    : world

export const new_pending_engages = (current: WorldState, previous: WorldState): readonly PendingEngage[] =>
  Object.freeze(Object.values(current.pending_engages).filter(({ group }) => !(group in previous.pending_engages)))

const decoded_error = (error: unknown): string => {
  let message = error instanceof Error ? error.message : String(error)
  for (let pass = 0; pass < 2; pass += 1) {
    const decoded = message.replace(/%([\dA-F]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    if (decoded === message) break
    message = decoded
  }
  return message
}

/** Validator-level stale-object conflicts are pre-execution race verdicts, not useful player copy. */
export const engage_conflict_refusal = (error: unknown): boolean => {
  const message = decoded_error(error)
  return /unavailable for consumption/i.test(message) && /current version/i.test(message)
}

export const engage_sword_markers = (
  world: WorldState
): readonly Readonly<{ id: string; x: number; z: number; placement_ms: number }>[] =>
  Object.values(world.pending_engages).flatMap((pending) =>
    pending.fight && pending.fight in world.fights
      ? []
      : [
          Object.freeze({
            id: `engage:${pending.group}`,
            x: pending.x,
            z: pending.z,
            placement_ms: pending.started_at_ms,
          }),
        ]
  )

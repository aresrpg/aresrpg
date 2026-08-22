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

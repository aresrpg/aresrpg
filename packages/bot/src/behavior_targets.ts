// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { live_resource_packs, live_mob_groups } from '@aresrpg/protocol'

import { owned_character, type GameplayContext } from './gameplay_context.ts'
import { zone_checkpoint_id, type GameplayActionName } from './gameplay.ts'
import type { ZoneSnapshot } from './actor_world.ts'

export type SelectedAction = Readonly<{ kind: GameplayActionName; payload: Readonly<Record<string, unknown>> }>
const observed_zones = (character_id: string, context: GameplayContext) => {
  const character = owned_character(context, character_id)
  const window = context.snapshot.tracked_zones[character_id]
  if (!window || window.world !== character.world) throw new Error('needs_resync')
  return Object.values(context.snapshot.zones).filter(
    ({ zone, spawns }) =>
      spawns && zone.world === window.world && window.zones.some(({ zx, zz }) => zx === zone.zx && zz === zone.zz)
  )
}
const location = (character_id: string, row: ZoneSnapshot) => ({
  character_id,
  world: row.zone.world,
  zone_x: row.zone.zx,
  zone_z: row.zone.zz,
  zone_checkpoint_id: zone_checkpoint_id(row),
})
/** Named selection policy only; callers choose the resource, ordering and surrounding strategy. */
export const nearest_gather = (
  character_id: string,
  item_type: string,
  context: GameplayContext
): SelectedAction | undefined => {
  const character = owned_character(context, character_id)
  return observed_zones(character_id, context)
    .flatMap((row) =>
      live_resource_packs(row.spawns!.resources, row.zone)
        .filter((pack) => pack.item_type === item_type)
        .map((pack) => ({
          distance: Math.hypot(pack.x - character.x!, pack.z - character.z!),
          kind: 'gather' as const,
          payload: { ...location(character_id, row), pack_index: pack.index, item_type },
        }))
    )
    .toSorted((a, b) => a.distance - b.distance)[0]
}
export const nearest_group = (
  character_id: string,
  mob_types: readonly string[],
  context: GameplayContext
): SelectedAction | undefined => {
  const character = owned_character(context, character_id)
  return observed_zones(character_id, context)
    .flatMap((row) =>
      live_mob_groups(row.spawns!.mobs, row.zone)
        .filter(
          (group) => group.members.length > 0 && group.members.every(({ mob_type }) => mob_types.includes(mob_type))
        )
        .map((group) => ({
          distance: Math.hypot(group.x - character.x!, group.z - character.z!),
          kind: 'fight_engage' as const,
          payload: { ...location(character_id, row), group_index: String(group.index) },
        }))
    )
    .toSorted((a, b) => a.distance - b.distance)[0]
}

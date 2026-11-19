// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mob_band_scaled } from '@aresrpg/fight'
import { live_resource_packs, live_mob_groups, type MobGroupRow } from '@aresrpg/protocol'

import mobs from '../../../seed/content/mobs.json'

import { area_contains, assert_area_position, group_matches, type TargetOptions } from './target_constraints.ts'
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
export type GroupOrder = Readonly<{ order: 'nearest' } | { order: 'best_xp'; level_margin: number }>
/** Seed-derived facts of an observed group: its strongest mob and the base XP its mobs are worth. */
const group_worth = (members: MobGroupRow['members']) =>
  members.reduce(
    (worth, { mob_type, level_scalar }) => {
      const mob = mobs.find((row) => row.mob_type === mob_type)!
      const [low, high] = [BigInt(mob.level_min), BigInt(mob.level_max)]
      const level = low + ((high - low) * BigInt(level_scalar)) / 100n
      return {
        level: Math.max(worth.level, Number(level)),
        xp: worth.xp + Number(mob_band_scaled(BigInt(mob.xp), low, high, level)),
      }
    },
    { level: 0, xp: 0 }
  )
/** `best_xp` trains on the richest group whose strongest mob stays within the authored level margin. */
export const select_group = (
  character_id: string,
  mob_types: readonly string[],
  context: GameplayContext,
  target_options: TargetOptions | undefined,
  order: GroupOrder
): SelectedAction | undefined => {
  const character = owned_character(context, character_id)
  assert_area_position(target_options?.area, character.world!, character.x!, character.z!)
  return observed_zones(character_id, context)
    .flatMap((row) =>
      live_mob_groups(row.spawns!.mobs, row.zone)
        .filter(
          (group) => group.members.length > 0 && group.members.every(({ mob_type }) => mob_types.includes(mob_type))
        )
        .filter((group) =>
          group_matches(
            group.members.map(({ mob_type }) => mob_type),
            target_options
          )
        )
        .filter(
          (group) => !target_options?.area || area_contains(target_options.area, row.zone.world, group.x, group.z)
        )
        .map((group) => ({ group, worth: group_worth(group.members) }))
        .filter(({ worth }) => order.order === 'nearest' || worth.level <= character.level + order.level_margin)
        .map(({ group, worth }) => ({
          distance: Math.hypot(group.x - character.x!, group.z - character.z!),
          xp: order.order === 'nearest' ? 0 : worth.xp,
          kind: 'fight_engage' as const,
          payload: {
            ...location(character_id, row),
            group_index: String(group.index),
            ...(target_options
              ? {
                  target_options: {
                    ...target_options,
                    mob_types: mob_types.filter(
                      (type) => !target_options.mob_types || target_options.mob_types.includes(type)
                    ),
                  },
                }
              : {}),
          },
        }))
    )
    .toSorted((a, b) => b.xp - a.xp || a.distance - b.distance)
    .map(({ kind, payload }) => ({ kind, payload }))[0]
}

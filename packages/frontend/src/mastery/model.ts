// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow, MasteryRow } from '@aresrpg/protocol'
import { dungeon_content_id } from '@aresrpg/sdk/seed-ids'

import PINS from '../../../../pins.json' with { type: 'json' }
import { content_catalog, type SeedWorld } from '../content/catalog.ts'
import { env } from '../env.ts'

export const mastery_reward = (entry_level: number): number =>
  entry_level >= 200 ? 5 : 1 + Math.floor((entry_level - 1) / 50)

export const effective_mastery_points = (mastery: MasteryRow | null, current_epoch: string | null): bigint => {
  if (!mastery) return 0n
  if (!current_epoch || mastery.last_completed_epoch === null) return BigInt(mastery.points)
  return BigInt(current_epoch) > BigInt(mastery.last_completed_epoch) + 1n ? 0n : BigInt(mastery.points)
}

export const mastery_world_witness = (
  characters: readonly CharacterRow[],
  world: Readonly<SeedWorld>
): CharacterRow | null =>
  [...characters]
    .filter(({ custody, level }) => custody !== 'fight' && level >= world.entry_level)
    .sort((left, right) => right.level - left.level || left.id.localeCompare(right.id))[0] ?? null

const dungeon_ids = (() => {
  let value: ReadonlyMap<string, string> | null = null
  return (): ReadonlyMap<string, string> => {
    if (value) return value
    const pins = (
      PINS as unknown as Record<string, { content_root?: { id?: string }; seed_package_original?: string }>
    )[env.network]
    const content_root = pins?.content_root?.id
    const seed_original = pins?.seed_package_original
    value = new Map(
      content_root && seed_original
        ? content_catalog.dungeons.map(({ dungeon }) => [
            dungeon_content_id(content_root, seed_original, dungeon),
            dungeon,
          ])
        : []
    )
    return value
  }
})()

export const mastery_dungeon_slug = (dungeon_id: string): string | null => dungeon_ids().get(dungeon_id) ?? null

export const mastery_quest_is_current = (mastery: MasteryRow | null, current_epoch: string | null): boolean =>
  !!mastery && current_epoch !== null && mastery.quest_epoch === current_epoch

export const mastery_reminder_visible = (
  character_count: number,
  mastery: MasteryRow | null,
  current_epoch: string | null
): boolean => character_count > 0 && !mastery_quest_is_current(mastery, current_epoch)

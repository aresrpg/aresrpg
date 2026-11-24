// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow, MasteryRow } from '@aresrpg/protocol'

import type { SeedWorld } from '../content/catalog.ts'
import { box_rewards } from '../content/items.ts'
import { docs_path } from '../docs/routes.ts'

/** What a shop offer opens, each page in a new tab: its docs page, and for a crate what it can hold first, each
 *  item with its chance in percent and its own docs page. `contents` is null for an item that is no crate. */
export const offer_view = (item_type: string) => {
  const rewards = box_rewards(item_type)
  const total = rewards.reduce((sum, { weight }) => sum + weight, 0)
  return Object.freeze({
    href: docs_path('items', item_type),
    contents: rewards.length
      ? rewards.map((reward) =>
          Object.freeze({
            item_type: reward.item_type,
            amount: reward.amount,
            percent: total ? (reward.weight * 100) / total : 0,
            href: docs_path('items', reward.item_type),
          })
        )
      : null,
  })
}

export const mastery_reward = (entry_level: number): number =>
  entry_level >= 200 ? 5 : 1 + Math.floor((entry_level - 1) / 50)

export const effective_mastery_points = (mastery: MasteryRow | null, _current_epoch: string | null): bigint =>
  mastery ? BigInt(mastery.points) : 0n

export const mastery_world_witness = (
  characters: readonly CharacterRow[],
  world: Readonly<SeedWorld>
): CharacterRow | null =>
  [...characters]
    .filter(({ custody, level }) => custody !== 'fight' && level >= world.entry_level)
    .sort((left, right) => right.level - left.level || left.id.localeCompare(right.id))[0] ?? null

export const mastery_quest_is_current = (mastery: MasteryRow | null, current_epoch: string | null): boolean =>
  !!mastery && current_epoch !== null && mastery.quest_epoch === current_epoch

export const mastery_reminder_visible = (
  character_count: number,
  mastery: MasteryRow | null,
  current_epoch: string | null
): boolean => character_count > 0 && !mastery_quest_is_current(mastery, current_epoch)

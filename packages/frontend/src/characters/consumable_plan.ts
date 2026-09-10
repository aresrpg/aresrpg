// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { character_max_hp, projected_hp } from '../game/character_stats.ts'
import { stack_merge_sources } from '../inventory_stacks.ts'

export const consumable_plan = (
  character: Readonly<CharacterRow>,
  item: Readonly<ItemRow>,
  inventory: readonly Readonly<ItemRow>[],
  encumbered: ReadonlySet<string>,
  now: number
) => {
  const effect = encyclopedia_catalog.item(item.item_type)?.item.consumable
  const heal = effect?.type === 'heal' ? effect.amount : 0
  const maximum = character_max_hp(character)
  const hp = projected_hp(character, now)
  const live = inventory.find(({ id, kiosk }) => id === item.id && kiosk === character.kiosk && !encumbered.has(id))
  const merge_sources = live ? stack_merge_sources(inventory, encumbered, live) : []
  const sources = new Set(merge_sources)
  const available = live
    ? live.amount + inventory.reduce((sum, row) => sum + (sources.has(row.id) ? row.amount : 0), 0)
    : 0
  return Object.freeze({
    hp,
    maximum,
    heal,
    needed: heal > 0 ? Math.ceil(Math.max(0, maximum - hp) / heal) : 1,
    available,
    merge_sources,
  })
}

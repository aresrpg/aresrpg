// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { stat_names } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'
import type { ComponentType } from 'react'
import { item_stat_offset } from '@aresrpg/protocol/character-stats'

import { items_by_type } from '../content/items.ts'
import { ConsumableEffectSection } from '../encyclopedia/ConsumableEffectSection.tsx'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { PetPower } from '../characters/PetPower.tsx'
import type { equipment_comparison } from '../characters/equipment_comparison.ts'

import type { ItemDetailProps } from './ItemDetailBody.tsx'
import type { ItemCraftSession } from './ItemCrafting.tsx'
import { ItemSummary } from './ItemSummary.tsx'

type OwnedItem = Readonly<Omit<ItemRow, 'kiosk'>>

/** Owned rolls are exact values, including pet scaling; authored ranges never replace them. */
export const owned_item_details = (item: OwnedItem) => {
  const seed = items_by_type[item.item_type]
  const rolled = Object.fromEntries(
    stat_names.map((stat) => [stat, item_stat_offset(item, stat)]).filter(([, value]) => value !== 0)
  )
  return {
    ...item,
    stats: { min: rolled, max: rolled },
    damages: item.damages ?? seed?.damages ?? [],
    consumable: seed?.consumable,
  }
}

/** An owned item's sheet: the summary by default; a window that shows the full sheet passes its own. */
export const OwnedItemDetail = ({
  item,
  copy,
  craft_session,
  comparison,
  Sheet = ItemSummary,
}: Readonly<{
  item: OwnedItem
  copy: AppCopy
  craft_session?: ItemCraftSession
  comparison?: ReturnType<typeof equipment_comparison>
  Sheet?: ComponentType<ItemDetailProps>
}>) => {
  const detail = owned_item_details(item)
  const text = encyclopedia_text(copy)
  return (
    <div className="flex min-h-0 flex-col" data-owned-item-id={item.id}>
      <Sheet
        craft_session={craft_session}
        category={detail.category}
        damages={detail.damages}
        item_type={detail.item_type}
        level={detail.level}
        name={detail.name}
        stats={detail.stats}
        comparison={comparison ?? undefined}
        labels={{
          characteristics: text('characteristics'),
          damages: text('damages'),
          level_short: text('level_short', { level: detail.level }),
          range_to: text('range_to'),
        }}
      >
        <ConsumableEffectSection consumable={detail.consumable} text={text} />
        <PetPower item={item} text={copy_text(copy.characters_page)} />
      </Sheet>
    </div>
  )
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { stat_names } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { ConsumableEffectSection } from '../encyclopedia/ConsumableEffectSection.tsx'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import { item_stat_offset } from '../game/character_stats.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { PetPower } from '../characters/PetPower.tsx'

import { ItemDetailView } from './ItemDetailView.tsx'

type OwnedItem = Readonly<Omit<ItemRow, 'kiosk'>>

/** Owned rolls are exact values, including pet scaling; authored ranges never replace them. */
export const owned_item_details = (item: OwnedItem) => {
  const seed = encyclopedia_catalog.item(item.item_type)?.item
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

export const OwnedItemDetail = ({ item, copy }: Readonly<{ item: OwnedItem; copy: AppCopy }>) => {
  const detail = owned_item_details(item)
  const text = encyclopedia_text(copy)
  return (
    <div data-owned-item-id={item.id}>
      <ItemDetailView
        category={detail.category}
        damages={detail.damages}
        item_type={detail.item_type}
        level={detail.level}
        name={detail.name}
        stats={detail.stats}
        labels={{
          characteristics: text('characteristics'),
          damages: text('damages'),
          level_short: text('level_short', { level: detail.level }),
          range_to: text('range_to'),
        }}
      >
        <ConsumableEffectSection consumable={detail.consumable} text={text} />
        <PetPower item={item} text={copy_text(copy.characters_page)} />
      </ItemDetailView>
    </div>
  )
}

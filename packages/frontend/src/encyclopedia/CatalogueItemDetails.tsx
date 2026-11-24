// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import { pet_max_feeds, type RuneEffect, type StatName } from '@aresrpg/immutable'

import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { LootOdds } from '../components/LootOdds.tsx'
import { encyclopedia_catalog, type ItemDetail } from '../content/catalog.ts'
import { item_is_pet_food } from '../content/item_resource_filters.ts'

import { ConsumableEffectSection } from './ConsumableEffectSection.tsx'
import type { EncyclopediaText } from './copy.ts'
import { EncyclopediaItemIcon } from './EncyclopediaItemIcon.tsx'
import { loot_box_is_random } from './loot_box.ts'
import './catalogue.css'

const item_display_category = (item_type: string, category: string): string =>
  item_is_pet_food(item_type) ? 'pet_food' : category

const DetailTitle = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <span className="text-[9px] font-semibold tracking-[0.25em] text-faint uppercase">{children}</span>
)

const RuneEffectSection = ({
  rune,
  stat_name,
  text,
}: Readonly<{
  rune: RuneEffect | null
  stat_name: (stat: StatName) => string
  text: EncyclopediaText
}>) =>
  rune ? (
    <section className="flex flex-col gap-2">
      <DetailTitle>{text('effects')}</DetailTitle>
      <div className=" bg-white/3 px-3 py-2 text-[10px] tracking-wide text-text">
        {text('rune_effect', { amount: rune.amount, stat: stat_name(rune.stat) })}
      </div>
    </section>
  ) : null

const RecipeLink = ({
  item_type,
  name,
  quantity,
  select,
}: Readonly<{ index: number; item_type: string; name: string; quantity: number; select: () => void }>) => (
  <Button className="aui-related-item" onClick={select}>
    <EncyclopediaItemIcon item_type={item_type} label={name} />
    <b>×{quantity}</b>
    <span>{name}</span>
  </Button>
)

const ConsumableDetails = ({
  detail,
  select_item,
  text,
}: Readonly<{
  detail: ItemDetail
  select_item: (id: string) => void
  text: EncyclopediaText
}>) => {
  const { consumable } = detail.item
  if (!consumable) return null
  if (consumable.type !== 'loot_box') return <ConsumableEffectSection consumable={consumable} text={text} />
  const random = loot_box_is_random(consumable.rewards)
  const total = consumable.rewards.reduce((sum, row) => sum + row.weight, 0)
  return (
    <section className="flex flex-col gap-2">
      <DetailTitle>{text(random ? 'consumable_rewards' : 'consumable_reward_heading')}</DetailTitle>
      <LootOdds
        random={random}
        rewards={consumable.rewards.map((reward) => ({
          item_type: reward.item_type,
          name: encyclopedia_catalog.item(reward.item_type)?.item.name ?? reward.item_type,
          amount: reward.amount,
          percent: total === 0 ? 0 : (reward.weight * 100) / total,
        }))}
        wrap={(reward, tile_class, tile) => (
          <button
            className={`${tile_class} cursor-pointer`}
            type="button"
            onClick={() => select_item(reward.item_type)}
          >
            {tile}
          </button>
        )}
      />
    </section>
  )
}

const item_metadata = (detail: ItemDetail | null, text: EncyclopediaText) => {
  const key = detail ? `item_descriptions.${detail.item.item_type}` : ''
  const description = text(key)
  return {
    description: description === key ? '' : description,
  }
}

export const CatalogueItemDetails = ({
  item_type,
  select_item,
  select_mob,
  select_world,
  text,
  stat_name,
}: Readonly<{
  item_type: string
  select_item: (id: string) => void
  select_mob: (id: string) => void
  select_world: (id: string) => void
  text: EncyclopediaText
  stat_name: (stat: StatName) => string
}>) => {
  const detail = encyclopedia_catalog.item(item_type)
  const { description } = item_metadata(detail, text)
  if (!detail) return null
  return (
    <div className="aui-catalogue-item">
      <ItemDetailView
        select_mob={select_mob}
        select_world={select_world}
        category={item_display_category(detail.item.item_type, detail.item.category)}
        damages={detail.item.damages ?? []}
        description={description}
        item_type={detail.item.item_type}
        labels={{
          characteristics: text('characteristics'),
          damages: text('damages'),
          level_short: text('level_short', { level: detail.item.level }),
          range_to: text('range_to'),
        }}
        level={detail.item.level}
        name={detail.item.name}
        stats={detail.item.stats}
      >
        <RuneEffectSection rune={detail.rune} stat_name={stat_name} text={text} />
        <ConsumableDetails detail={detail} select_item={select_item} text={text} />
        {detail.item.category === 'pet' && detail.pet_foods.length > 0 && (
          <div className="border border-gold/20 bg-gold/5 px-2 py-1.5 text-[9px] leading-relaxed text-faint">
            {text('pet_full_fed_note', { count: pet_max_feeds })}
          </div>
        )}
      </ItemDetailView>
    </div>
  )
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import { pet_max_feeds, type RuneEffect, type StatName } from '@aresrpg/immutable'

import { useNumbers } from '../i18n/useNumbers.ts'
import { Text } from '../i18n/Text.tsx'
import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog, type ItemDetail } from '../content/catalog.ts'

import { ConsumableEffectSection } from './ConsumableEffectSection.tsx'
import type { EncyclopediaText } from './copy.ts'
import { EncyclopediaItemIcon } from './EncyclopediaItemIcon.tsx'
import { loot_box_is_random } from './loot_box.ts'

const pet_food_item_types = new Set(
  encyclopedia_catalog.item_filters.find(({ group, id }) => group === 'resource' && id === 'pet_food')?.item_types ?? []
)
const item_display_category = (item_type: string, category: string): string =>
  pet_food_item_types.has(item_type) ? 'pet_food' : category

const Divider = () => <div className="h-px w-full bg-white/6" />

const DetailTitle = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <span className="text-[9px] font-semibold tracking-[0.25em] text-[#6b7280] uppercase">{children}</span>
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
      <div className=" bg-white/3 px-3 py-2 text-[10px] tracking-wide text-[#e8e4dc]">
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

const PetDietSection = ({
  detail,
  select_item,
  text,
}: Readonly<{ detail: ItemDetail; select_item: (id: string) => void; text: EncyclopediaText }>) => {
  if (detail.item.category !== 'pet') return null
  if (detail.pet_foods.length === 0)
    return (
      <div className="border border-white/8 bg-white/2 px-3 py-3 text-[9px] tracking-[0.15em] text-[#6b7280] italic uppercase">
        {text('no_diet')}
      </div>
    )
  return (
    <>
      <div className="border border-[#c8963c]/20 bg-[#c8963c]/5 px-2 py-1.5 text-[9px] leading-relaxed text-[#6b7280]">
        {text('pet_full_fed_note', { count: pet_max_feeds })}
      </div>
      <Divider />
      <section className="flex flex-col gap-2">
        <DetailTitle>{text('pet_food')}</DetailTitle>
        <span className="text-[9px] leading-relaxed text-[#6b7280]">
          {text('pet_diet_note', { count: detail.pet_foods.length })}
        </span>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1">
          {detail.pet_foods.map((food, index) => (
            <button
              className="flex cursor-pointer items-center gap-2  px-2 py-1.5 text-left  hover:bg-[#c8963c]/8"
              key={food.item_type}
              onClick={() => select_item(food.item_type)}
              style={{ background: index % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)' }}
              type="button"
            >
              {item_icon(food.item_type) && (
                <img alt="" className="size-6 shrink-0 object-contain" src={item_icon(food.item_type)!} />
              )}
              <span className="min-w-0 flex-1 truncate text-[9px] tracking-[0.1em] text-[#e8e4dc] uppercase">
                {food.name}
              </span>
              <span className="shrink-0 text-[8px] text-[#6b7280]">{text('level_short', { level: food.level })}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

const ConsumableDetails = ({
  detail,
  select_item,
  text,
}: Readonly<{
  detail: ItemDetail
  select_item: (id: string) => void
  text: EncyclopediaText
}>) => {
  const numbers = useNumbers()
  const { consumable } = detail.item
  if (!consumable) return null
  if (consumable.type !== 'loot_box') return <ConsumableEffectSection consumable={consumable} text={text} />
  const random = loot_box_is_random(consumable.rewards)
  const total = consumable.rewards.reduce((sum, row) => sum + row.weight, 0)
  return (
    <section className="flex flex-col gap-2" data-loot-rewards="">
      <DetailTitle>{text(random ? 'consumable_rewards' : 'consumable_reward_heading')}</DetailTitle>
      {consumable.rewards.map((reward, index) => {
        const name = encyclopedia_catalog.item(reward.item_type)?.item.name ?? reward.item_type
        const chance = total === 0 ? 0 : (reward.weight * 100) / total
        return (
          <RecipeLink
            key={reward.item_type}
            index={index}
            item_type={reward.item_type}
            name={random ? text('consumable_reward', { chance: numbers.decimal(chance), item: name }) : name}
            quantity={reward.amount}
            select={() => select_item(reward.item_type)}
          />
        )
      })}
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
        <PetDietSection detail={detail} select_item={select_item} text={text} />
      </ItemDetailView>
    </div>
  )
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pet_max_feeds, type RuneEffect, type StatName } from '@aresrpg/immutable'
import { MapPin, Search, Skull, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { item_icon, mob_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize, type ItemDetail } from '../content/catalog.ts'
import { filter_item_types } from '../content/item_filters.ts'

import { Empty, encyclopedia_layout, EntityButton, EntityGrid, EntityIcon, SearchField } from './components.tsx'
import type { EncyclopediaText } from './copy.ts'
import { EncyclopediaItemIcon } from './EncyclopediaItemIcon.tsx'
import { ItemFilterRail, type ItemFilterSelection } from './ItemFilterRail.tsx'
import { loot_box_is_random } from './loot_box.ts'

const pet_food_item_types = new Set(
  encyclopedia_catalog.item_filters.find(({ group, id }) => group === 'resource' && id === 'pet_food')?.item_types ?? []
)
const item_display_category = (item_type: string, category: string): string =>
  pet_food_item_types.has(item_type) ? 'pet_food' : category
const item_category_label = (item_type: string, category: string, text: EncyclopediaText): string =>
  pet_food_item_types.has(item_type) ? text('item_category_pet_food') : titleize(category)

const Divider = () => <div className="h-px w-full bg-white/6" />

const EmptyDetailRow = ({ children, kind }: Readonly<{ children: React.ReactNode; kind: 'recipe' | 'drop' }>) => {
  const Icon = kind === 'drop' ? Skull : Sparkles
  return (
    <div className="flex items-center gap-2 bg-white/2 px-3 py-3">
      <Icon className="text-[#6b7280] opacity-20" size={10} />
      <span className="text-[9px] tracking-[0.15em] text-[#6b7280] italic uppercase">{children}</span>
    </div>
  )
}

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
      <div className="border-l-2 border-l-[#c8963c]/40 bg-white/3 px-3 py-2 text-[10px] tracking-wide text-[#e8e4dc]">
        {text('rune_effect', { amount: rune.amount, stat: stat_name(rune.stat) })}
      </div>
    </section>
  ) : null

const consumable_effect_text = (
  consumable: NonNullable<(typeof encyclopedia_catalog.items)[number]['consumable']>,
  text: EncyclopediaText
): string => {
  if (consumable.type === 'heal') return text('consumable_heal', { amount: consumable.amount })
  if (consumable.type === 'reset_stats') return text('consumable_reset_stats')
  if (consumable.type === 'reset_spells') return text('consumable_reset_spells')
  if (consumable.type === 'recall') return text('consumable_recall')
  if (consumable.type === 'city') return text('consumable_city', { city: titleize(consumable.city) })
  return text('consumable_loot_box')
}

const RecipeLink = ({
  index,
  item_type,
  name,
  quantity,
  select,
}: Readonly<{ index: number; item_type: string; name: string; quantity: number; select: () => void }>) => {
  return (
    <button
      className="flex w-full cursor-pointer items-center gap-3 border-l-2 border-l-[#c8963c]/25 px-3 py-2 text-left transition-none hover:border-l-[#c8963c] hover:bg-[#c8963c]/8 hover:shadow-[0_0_12px_rgba(200,150,60,0.1)]"
      onClick={select}
      style={{ background: index % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)' }}
      type="button"
    >
      <EncyclopediaItemIcon item_type={item_type} label={name} />
      <span className="shrink-0 border border-[#c8963c]/20 bg-[#c8963c]/10 px-2 py-0.5 text-[9px] font-semibold tracking-[0.15em] text-[#c8963c] uppercase">
        ×{quantity}
      </span>
      <span className="min-w-0 truncate text-[10px] tracking-[0.1em] text-[#e8e4dc] uppercase">{name}</span>
    </button>
  )
}

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
              className="flex cursor-pointer items-center gap-2 border-l-2 border-l-[#c8963c]/25 px-2 py-1.5 text-left hover:border-l-[#c8963c] hover:bg-[#c8963c]/8"
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

export const ItemsTab = ({
  selected_id,
  select_item,
  select_mob,
  select_world,
  text,
  stat_name,
}: Readonly<{
  selected_id: string | null
  select_item: (id: string) => void
  select_mob: (id: string) => void
  select_world: (id: string) => void
  stat_name: (stat: StatName) => string
  text: EncyclopediaText
}>) => {
  const [search, set_search] = useState('')
  const [facet_selection, set_facet_selection] = useState<ItemFilterSelection>({})
  const [minimum_level, set_minimum_level] = useState('')
  const [maximum_level, set_maximum_level] = useState('')
  const [sort, set_sort] = useState('level_asc')
  const matching_types = useMemo(
    () =>
      new Set(
        filter_item_types(
          encyclopedia_catalog.items.map(({ item_type }) => item_type),
          encyclopedia_catalog.item_filters,
          facet_selection
        )
      ),
    [facet_selection]
  )
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const minimum = Number(minimum_level) || 0
    const maximum = Number(maximum_level) || Number.POSITIVE_INFINITY
    return encyclopedia_catalog.items
      .filter(
        (item) =>
          (!query || item.name.toLowerCase().includes(query) || item.item_type.includes(query)) &&
          matching_types.has(item.item_type) &&
          item.level >= minimum &&
          item.level <= maximum
      )
      .toSorted((left, right) =>
        sort === 'name_asc'
          ? left.name.localeCompare(right.name)
          : sort === 'level_desc'
            ? right.level - left.level || left.name.localeCompare(right.name)
            : left.level - right.level || left.name.localeCompare(right.name)
      )
  }, [matching_types, maximum_level, minimum_level, search, sort])
  const detail = selected_id ? encyclopedia_catalog.item(selected_id) : null
  const description_key = detail ? `item_descriptions.${detail.item.item_type}` : ''
  const description = description_key ? text(description_key) : ''
  const random_loot_box =
    detail?.item.consumable?.type === 'loot_box' && loot_box_is_random(detail.item.consumable.rewards)

  const filters = (
    <div className={encyclopedia_layout.filters}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <SearchField change={set_search} placeholder={text('search_items')} value={search} />
        </div>
        <span className="shrink-0 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
          {text('showing_count', { count: filtered.length, total: encyclopedia_catalog.items.length })}
        </span>
        <select
          className="h-9 min-w-[110px] cursor-pointer border border-border bg-bg/55 px-2 text-[9px] text-[#9da0a9] uppercase"
          onChange={(event) => set_sort(event.target.value)}
          value={sort}
        >
          <option value="level_asc">{text('sort_level_asc')}</option>
          <option value="level_desc">{text('sort_level_desc')}</option>
          <option value="name_asc">{text('sort_name_asc')}</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">LVL</span>
        <input
          className="h-8 w-13 border border-border bg-bg/55 px-2 text-center text-[9px] outline-none"
          min="0"
          onChange={(event) => set_minimum_level(event.target.value)}
          placeholder="MIN"
          type="number"
          value={minimum_level}
        />
        <span className="text-[8px] text-[#6b7280]">–</span>
        <input
          className="h-8 w-13 border border-border bg-bg/55 px-2 text-center text-[9px] outline-none"
          min="0"
          onChange={(event) => set_maximum_level(event.target.value)}
          placeholder="MAX"
          type="number"
          value={maximum_level}
        />
      </div>
    </div>
  )

  const list = (
    <div className={encyclopedia_layout.list}>
      {filtered.length === 0 ? (
        <Empty>
          <Search size={16} className="opacity-30" />
          {text('no_results')}
        </Empty>
      ) : (
        <EntityGrid>
          {filtered.map((item, index) => (
            <EntityButton
              active={selected_id === item.item_type}
              badge={item.level > 0 ? text('level_short', { level: item.level }) : undefined}
              icon={item_icon(item.item_type)}
              index={index}
              key={item.item_type}
              meta={item_category_label(item.item_type, item.category, text)}
              name={item.name}
              select={() => select_item(item.item_type)}
            />
          ))}
        </EntityGrid>
      )}
    </div>
  )

  const detail_panel = detail && (
    <div className="flex-1 overflow-y-auto p-4 pt-14">
      <ItemDetailView
        category={item_display_category(detail.item.item_type, detail.item.category)}
        damages={detail.item.damages ?? []}
        description={description === description_key ? '' : description}
        item_type={detail.item.item_type}
        labels={{
          characteristics: text('characteristics'),
          damages: text('damages'),
          level_short: text('level_short', { level: detail.item.level }),
          range_to: text('range_to'),
        }}
        level={detail.item.level}
        name={detail.item.name}
        obtention={[
          detail.rune ? text('rune_obtained_by_crushing') : null,
          detail.dropped_by.length > 0 ? text('obtention_dropped_by', { count: detail.dropped_by.length }) : null,
          detail.recipe ? text('obtention_crafted') : null,
        ]
          .filter((value): value is string => value !== null)
          .join(' · ')}
        stats={detail.item.stats}
      >
        <RuneEffectSection rune={detail.rune} stat_name={stat_name} text={text} />
        {detail.item.consumable && (
          <>
            {(detail.item.consumable.type !== 'loot_box' || random_loot_box) && (
              <div className="text-[10px] tracking-wide text-[#ff66b2]">
                {consumable_effect_text(detail.item.consumable, text)}
              </div>
            )}
            {detail.item.consumable.type === 'loot_box' && (
              <section className="flex flex-col gap-2">
                <DetailTitle>{text(random_loot_box ? 'consumable_rewards' : 'consumable_reward_heading')}</DetailTitle>
                <div className="flex flex-col gap-px">
                  {detail.item.consumable.rewards.map((reward, index, rewards) => {
                    const reward_item = encyclopedia_catalog.item(reward.item_type)?.item
                    const total_weight = rewards.reduce((sum, row) => sum + row.weight, 0)
                    const chance = total_weight === 0 ? 0 : (reward.weight * 100) / total_weight
                    return (
                      <RecipeLink
                        index={index}
                        item_type={reward.item_type}
                        key={reward.item_type}
                        name={
                          random_loot_box
                            ? text('consumable_reward', {
                                chance: Number.isInteger(chance) ? chance : chance.toFixed(2),
                                item: reward_item?.name ?? reward.item_type,
                              })
                            : (reward_item?.name ?? reward.item_type)
                        }
                        quantity={reward.amount}
                        select={() => select_item(reward.item_type)}
                      />
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}
        <PetDietSection detail={detail} select_item={select_item} text={text} />
        <Divider />
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <DetailTitle>{text('recipe')}</DetailTitle>
            {detail.recipe && (
              <>
                <span className="border border-[#c8963c]/30 bg-[#c8963c]/8 px-1.5 py-px text-[7px] tracking-[0.15em] text-[#c8963c] uppercase">
                  {titleize(detail.recipe.job)}
                </span>
                {detail.recipe.craft_xp > 0 && (
                  <span className="border border-[#4a9eff]/30 bg-[#4a9eff]/6 px-1.5 py-px text-[7px] tracking-[0.15em] text-[#4a9eff] uppercase">
                    {detail.recipe.craft_xp} XP
                  </span>
                )}
              </>
            )}
          </div>
          {detail.recipe ? (
            <div className="flex flex-col gap-1">
              {detail.recipe.ingredients.map((ingredient, index) => (
                <RecipeLink
                  index={index}
                  item_type={ingredient.item_type}
                  key={ingredient.item_type}
                  name={ingredient.item?.name ?? titleize(ingredient.item_type)}
                  quantity={ingredient.quantity}
                  select={() => select_item(ingredient.item_type)}
                />
              ))}
            </div>
          ) : (
            <EmptyDetailRow kind="recipe">{text('no_recipe')}</EmptyDetailRow>
          )}
        </section>
        <Divider />
        <section className="flex flex-col gap-2">
          <DetailTitle>{text('ingredient_of')}</DetailTitle>
          {detail.ingredient_of.length > 0 ? (
            <div className="flex flex-col gap-1">
              {detail.ingredient_of.map(({ recipe, output }, index) => (
                <RecipeLink
                  index={index}
                  item_type={recipe.output_type}
                  key={recipe.output_type}
                  name={output?.name ?? titleize(recipe.output_type)}
                  quantity={recipe.inputs[detail.item.item_type] ?? 1}
                  select={() => select_item(recipe.output_type)}
                />
              ))}
            </div>
          ) : (
            <EmptyDetailRow kind="recipe">{text('no_ingredient_of')}</EmptyDetailRow>
          )}
        </section>
        <Divider />
        <section className="flex flex-col gap-2">
          <DetailTitle>{text('dropped_by')}</DetailTitle>
          {detail.dropped_by.length > 0 ? (
            <div className="flex flex-col gap-2">
              {detail.dropped_by.map(({ mob, drop }, index) => (
                <button
                  className="flex cursor-pointer items-center justify-between border border-border border-l-2 border-l-[#c8963c]/40 px-3 py-2.5 text-left hover:border-[#c8963c]/25 hover:border-l-[#c8963c] hover:bg-[#c8963c]/8 hover:shadow-[0_0_12px_rgba(200,150,60,0.1)]"
                  key={mob.mob_type}
                  onClick={() => select_mob(mob.mob_type)}
                  style={{ background: index % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)' }}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="contents" data-encyclopedia-mob-icon={mob.mob_type}>
                      <EntityIcon label={mob.name} size="size-8" src={mob_icon(mob.mob_type)} />
                    </span>
                    <span className="truncate text-[10px] font-semibold tracking-[0.1em] text-[#c8963c] uppercase">
                      {mob.name}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-[10px] font-semibold text-[#c8963c] tabular-nums">
                      {(drop.chance_bp / 100).toFixed(2)}%
                    </span>
                    <span className="text-[9px] tracking-[0.1em] text-[#6b7280] uppercase">
                      {text('level_range', { min: mob.level_min, max: mob.level_max })}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyDetailRow kind="drop">{text('no_drops')}</EmptyDetailRow>
          )}
        </section>
        {detail.worlds.length > 0 && (
          <>
            <Divider />
            <section className="flex flex-col gap-2">
              <DetailTitle>{text('found_in')}</DetailTitle>
              <div className="flex flex-col gap-1">
                {detail.worlds.map((world) => (
                  <button
                    className="flex cursor-pointer items-center gap-2 bg-white/2 px-2 py-1.5 text-left hover:bg-[#c8963c]/8"
                    key={world.world}
                    onClick={() => select_world(world.world)}
                    type="button"
                  >
                    <MapPin className="shrink-0 text-[#c8963c]/60" size={11} />
                    <span className="flex-1 text-[10px] tracking-[0.1em] text-[#c8963c] uppercase">
                      {titleize(world.world)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </ItemDetailView>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1">
      <ItemFilterRail
        rows={encyclopedia_catalog.item_filters}
        select={set_facet_selection}
        selected={facet_selection}
        text={text}
        total={encyclopedia_catalog.items.length}
      />
      <div className={`flex min-h-0 min-w-0 flex-col ${detail ? 'flex-[7]' : 'flex-1'}`}>
        {filters}
        {list}
      </div>
      {detail && <aside className={encyclopedia_layout.detail}>{detail_panel}</aside>}
    </div>
  )
}

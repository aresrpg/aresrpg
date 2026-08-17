// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  accessory_categories,
  armor_categories,
  cosmetic_item_categories,
  pet_max_feeds,
  tool_categories,
  weapon_categories,
  type RuneEffect,
  type StatName,
} from '@aresrpg/immutable'
import { MapPin, Search, Skull, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ItemDetailView } from '../components/ItemDetailView.tsx'
import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'

import { category_pill, Empty, encyclopedia_layout, EntityButton, EntityGrid, SearchField } from './components.tsx'
import type { EncyclopediaText } from './copy.ts'
import { loot_box_is_random } from './loot_box.ts'

type Group =
  | 'ALL'
  | 'ARMOR'
  | 'WEAPONS'
  | 'ACCESSORIES'
  | 'COSMETICS'
  | 'PETS'
  | 'RUNES'
  | 'RELICS'
  | 'TOOLS'
  | 'CONSUMABLES'
  | 'RESOURCES'

const GROUPS: Readonly<Record<Group, ReadonlySet<string> | null>> = Object.freeze({
  ALL: null,
  ARMOR: new Set(armor_categories),
  WEAPONS: new Set(weapon_categories),
  ACCESSORIES: new Set(accessory_categories),
  COSMETICS: new Set(cosmetic_item_categories),
  PETS: new Set(['pet']),
  RUNES: new Set(['rune']),
  RELICS: new Set(['relic']),
  TOOLS: new Set(tool_categories),
  CONSUMABLES: new Set(['consumable', 'key']),
  RESOURCES: new Set(['resource']),
})

const group_label = (group: Group, text: EncyclopediaText): string =>
  group === 'ALL' ? text('view_all') : text(`group_${group.toLowerCase()}`)

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
  return text('consumable_loot_box')
}

const RecipeLink = ({
  index,
  name,
  quantity,
  select,
}: Readonly<{ index: number; name: string; quantity: number; select: () => void }>) => (
  <button
    className="flex w-full cursor-pointer items-center gap-3 border-l-2 border-l-[#c8963c]/25 px-3 py-2 text-left transition-none hover:border-l-[#c8963c] hover:bg-[#c8963c]/8 hover:shadow-[0_0_12px_rgba(200,150,60,0.1)]"
    onClick={select}
    style={{ background: index % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)' }}
    type="button"
  >
    <span className="shrink-0 border border-[#c8963c]/20 bg-[#c8963c]/10 px-2 py-0.5 text-[9px] font-semibold tracking-[0.15em] text-[#c8963c] uppercase">
      ×{quantity}
    </span>
    <span className="text-[10px] tracking-[0.1em] text-[#e8e4dc] uppercase">{name}</span>
  </button>
)

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
  const [group, set_group] = useState<Group>('ALL')
  const [subcategory, set_subcategory] = useState<string | null>(null)
  const [minimum_level, set_minimum_level] = useState('')
  const [maximum_level, set_maximum_level] = useState('')
  const [sort, set_sort] = useState('level_asc')
  const group_items = useMemo(() => {
    const categories = GROUPS[group]
    return categories
      ? encyclopedia_catalog.items.filter(({ category }) => categories.has(category))
      : encyclopedia_catalog.items
  }, [group])
  const subcategories = useMemo(
    () =>
      [...new Set(group_items.map(({ category }) => category))]
        .map((type) => Object.freeze({ type, count: group_items.filter(({ category }) => category === type).length }))
        .toSorted((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
    [group_items]
  )
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const minimum = Number(minimum_level) || 0
    const maximum = Number(maximum_level) || Number.POSITIVE_INFINITY
    return group_items
      .filter(
        (item) =>
          (!query || item.name.toLowerCase().includes(query) || item.item_type.includes(query)) &&
          (!subcategory || item.category === subcategory) &&
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
  }, [group_items, maximum_level, minimum_level, search, sort, subcategory])
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
          className="h-9 min-w-[110px] cursor-pointer border border-[#1e1e2e] bg-[#0a0a0f]/55 px-2 text-[9px] text-[#9da0a9] uppercase"
          onChange={(event) => set_sort(event.target.value)}
          value={sort}
        >
          <option value="level_asc">{text('sort_level_asc')}</option>
          <option value="level_desc">{text('sort_level_desc')}</option>
          <option value="name_asc">{text('sort_name_asc')}</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(GROUPS) as Group[]).map((name) => (
          <button
            className={category_pill(group === name)}
            key={name}
            onClick={() => {
              set_group(name)
              set_subcategory(null)
            }}
            type="button"
          >
            {group_label(name, text)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">LVL</span>
        <input
          className="h-8 w-13 border border-[#1e1e2e] bg-[#0a0a0f]/55 px-2 text-center text-[9px] outline-none"
          min="0"
          onChange={(event) => set_minimum_level(event.target.value)}
          placeholder="MIN"
          type="number"
          value={minimum_level}
        />
        <span className="text-[8px] text-[#6b7280]">–</span>
        <input
          className="h-8 w-13 border border-[#1e1e2e] bg-[#0a0a0f]/55 px-2 text-center text-[9px] outline-none"
          min="0"
          onChange={(event) => set_maximum_level(event.target.value)}
          placeholder="MAX"
          type="number"
          value={maximum_level}
        />
      </div>
    </div>
  )

  const type_rail = subcategories.length > 1 && (
    <nav className="w-40 shrink-0 overflow-y-auto border-r border-[#1e1e2e]">
      {subcategories.map(({ type, count }, index) => {
        const active = type === subcategory
        return (
          <button
            className="flex w-full items-center justify-between gap-3 border-l-2 px-4 py-2.5 text-left"
            key={type}
            onClick={() => set_subcategory(active ? null : type)}
            style={{
              borderLeftColor: active ? '#c8963c' : 'transparent',
              background: active ? 'rgba(200,150,60,0.08)' : index % 2 ? 'rgba(255,255,255,0.018)' : 'transparent',
            }}
            type="button"
          >
            <span
              className={`truncate text-[9px] tracking-[0.1em] uppercase ${active ? 'text-[#c8963c]' : 'text-[#6b7280]'}`}
            >
              {titleize(type)}
            </span>
            <span className="shrink-0 text-[8px] text-[#6b7280]/50 tabular-nums">{count}</span>
          </button>
        )
      })}
    </nav>
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
              meta={titleize(item.category)}
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
        category={detail.item.category}
        damages={detail.item.damages ?? []}
        description={description === description_key ? '' : description}
        icon={item_detail_icon(detail.item.item_type)}
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
        {detail.item.category === 'pet' && (
          <>
            <div className="border border-[#c8963c]/20 bg-[#c8963c]/5 px-2 py-1.5 text-[9px] leading-relaxed text-[#6b7280]">
              {text('pet_full_fed_note', { count: pet_max_feeds })}
            </div>
            <Divider />
            <section className="flex flex-col gap-2">
              <DetailTitle>{text('pet_food')}</DetailTitle>
              {detail.pet_foods.length > 0 ? (
                <>
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
                        <span className="shrink-0 text-[8px] text-[#6b7280]">
                          {text('level_short', { level: food.level })}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <span className="bg-white/2 px-3 py-3 text-[9px] tracking-[0.15em] text-[#6b7280] italic uppercase">
                  {text('no_diet')}
                </span>
              )}
            </section>
          </>
        )}
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
                  className="flex cursor-pointer items-center justify-between border border-[#1e1e2e] border-l-2 border-l-[#c8963c]/40 px-3 py-2.5 text-left hover:border-[#c8963c]/25 hover:border-l-[#c8963c] hover:bg-[#c8963c]/8 hover:shadow-[0_0_12px_rgba(200,150,60,0.1)]"
                  key={mob.mob_type}
                  onClick={() => select_mob(mob.mob_type)}
                  style={{ background: index % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)' }}
                  type="button"
                >
                  <span className="text-[10px] font-semibold tracking-[0.1em] text-[#c8963c] uppercase">
                    {mob.name}
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
      {type_rail}
      <div className={`flex min-h-0 min-w-0 flex-col ${detail ? 'flex-[7]' : 'flex-1'}`}>
        {filters}
        {list}
      </div>
      {detail && <aside className={encyclopedia_layout.detail}>{detail_panel}</aside>}
    </div>
  )
}

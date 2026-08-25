// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MapPin, Search, Shield } from 'lucide-react'
import { useMemo, useState } from 'react'

import { FacetRail, type FacetOption } from '../components/FacetRail.tsx'
import { MobCoreStats } from '../components/MobCoreStats.tsx'
import { mob_icon } from '../content/assets.ts'
import { centered_resistance, encyclopedia_catalog, titleize } from '../content/catalog.ts'
import { element_colors, item_category_colors, stat_identities } from '../visual_identity.ts'

import {
  category_pill,
  Empty,
  encyclopedia_layout,
  EntityButton,
  EntityGrid,
  EntityIcon,
  SearchField,
  Section,
} from './components.tsx'
import type { EncyclopediaText } from './copy.ts'
import { SpellCard } from './SpellCard.tsx'

const LEVEL_BRACKETS = Object.freeze([
  { label: '1–20', minimum: 1, maximum: 20 },
  { label: '21–50', minimum: 21, maximum: 50 },
  { label: '51–80', minimum: 51, maximum: 80 },
  { label: '81–120', minimum: 81, maximum: 120 },
  { label: '121+', minimum: 121, maximum: Number.POSITIVE_INFINITY },
])

const mob_facet_options = (text: EncyclopediaText): readonly FacetOption[] =>
  encyclopedia_catalog.mob_filters.map((row, index) => {
    const previous = encyclopedia_catalog.mob_filters[index - 1]
    const section =
      row.kind === 'world' && previous?.kind !== 'world' && previous?.kind !== 'biome'
        ? text('worlds_tab')
        : row.kind === 'family' && previous?.kind !== 'family'
          ? text('all_families')
          : row.kind === 'element' && previous?.kind !== 'element'
            ? text('elements_filter')
            : undefined
    return Object.freeze({
      value: `${row.kind}:${row.id}`,
      label: titleize(row.kind === 'biome' ? row.id.slice(row.id.indexOf(':') + 1) : row.id),
      count: row.count,
      color: row.kind === 'element' ? element_colors[row.id] : undefined,
      section,
      indent: row.kind === 'biome',
    })
  })

export const MobsTab = ({
  selected_id,
  select_item,
  select_mob,
  select_world,
  text,
}: Readonly<{
  selected_id: string | null
  select_item: (id: string) => void
  select_mob: (id: string) => void
  select_world: (id: string) => void
  text: EncyclopediaText
}>) => {
  const [search, set_search] = useState('')
  const [mob_filter, set_mob_filter] = useState<string | null>(null)
  const [sort, set_sort] = useState('level_asc')
  const [view, set_view] = useState<'all' | 'by_level'>('all')
  const [spell_index, set_spell_index] = useState(0)
  const facet_options = useMemo(() => mob_facet_options(text), [text])
  const matching_types = useMemo(
    () =>
      new Set(
        mob_filter
          ? (encyclopedia_catalog.mob_filters.find((row) => `${row.kind}:${row.id}` === mob_filter)?.mob_types ?? [])
          : encyclopedia_catalog.mobs.map(({ mob_type }) => mob_type)
      ),
    [mob_filter]
  )
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return encyclopedia_catalog.mobs
      .filter(
        (mob) =>
          (!query || mob.name.toLowerCase().includes(query) || mob.mob_type.includes(query)) &&
          matching_types.has(mob.mob_type)
      )
      .toSorted((left, right) =>
        sort === 'name_asc'
          ? left.name.localeCompare(right.name)
          : sort === 'level_desc'
            ? right.level_min - left.level_min || left.name.localeCompare(right.name)
            : left.level_min - right.level_min || left.name.localeCompare(right.name)
      )
  }, [matching_types, search, sort])
  const grouped = useMemo(
    () =>
      LEVEL_BRACKETS.map((bracket) =>
        Object.freeze({
          ...bracket,
          mobs: filtered.filter((mob) => {
            const average = (mob.level_min + mob.level_max) / 2
            return average >= bracket.minimum && average <= bracket.maximum
          }),
        })
      ).filter(({ mobs }) => mobs.length > 0),
    [filtered]
  )
  const detail = selected_id ? encyclopedia_catalog.mob(selected_id) : null
  const selected_spell = detail?.mob.spells[Math.min(spell_index, detail.mob.spells.length - 1)]
  const choose_mob = (id: string): void => {
    set_spell_index(0)
    select_mob(id)
  }
  const row = (mob: (typeof encyclopedia_catalog.mobs)[number], index: number) => (
    <EntityButton
      accent={`${element_colors[mob.element] ?? '#6b7280'}40`}
      active={selected_id === mob.mob_type}
      icon={mob_icon(mob.mob_type)}
      index={index}
      key={mob.mob_type}
      meta={`${titleize(mob.element)} · ${text('level_range', { min: mob.level_min, max: mob.level_max })}`}
      name={mob.name}
      select={() => choose_mob(mob.mob_type)}
    />
  )
  const list = (
    <div className={encyclopedia_layout.list}>
      {filtered.length === 0 ? (
        <Empty>
          <Search size={16} className="opacity-30" />
          {text('no_mobs_match')}
        </Empty>
      ) : view === 'by_level' ? (
        grouped.map((group) => (
          <section key={group.label}>
            <div className="border-b border-l-2 border-[#c8963c]/30 bg-[#c8963c]/4 px-3 py-2 text-[8px] tracking-[0.25em] text-[#c8963c]/60 uppercase">
              <Shield className="mr-1 inline opacity-30" size={8} />
              {text('level_bracket', { range: group.label })}
            </div>
            <EntityGrid>{group.mobs.map(row)}</EntityGrid>
          </section>
        ))
      ) : (
        <EntityGrid>{filtered.map(row)}</EntityGrid>
      )}
    </div>
  )
  const detail_panel = detail && (
    <div className="flex-1 overflow-y-auto p-4 pt-14">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        <header className="flex items-center gap-3">
          <EntityIcon label={detail.mob.name} size="size-[73px]" src={mob_icon(detail.mob.mob_type)} />
          <div>
            <h2
              className="text-[14px] font-semibold tracking-[0.15em] uppercase"
              style={{ color: element_colors[detail.mob.element] }}
            >
              {detail.mob.name}
            </h2>
            <p className="mt-1 text-[9px] tracking-[0.12em] text-[#6b7280] uppercase">
              {titleize(detail.mob.role)} ·{' '}
              {text('level_range', { min: detail.mob.level_min, max: detail.mob.level_max })}
            </p>
          </div>
        </header>
        <MobCoreStats
          labels={{
            agility: text('gameplay.stat_agility'),
            wisdom: text('gameplay.stat_wisdom'),
            xp: 'XP',
          }}
          values={detail.mob}
        />
        <Section title={text('gameplay.resistance')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(detail.mob.resistances).map(([name, value]) => {
              const resistance = centered_resistance(value)
              const identity =
                stat_identities[
                  name === 'earth'
                    ? 'strength'
                    : name === 'fire'
                      ? 'intelligence'
                      : name === 'water'
                        ? 'chance'
                        : 'agility'
                ]
              const color = resistance < 0 ? '#ff7d7d' : (element_colors[name] ?? '#78b5ff')
              return (
                <div
                  className="flex min-h-11 items-center gap-3 border border-white/8 bg-white/[0.018] px-3 py-2"
                  data-mob-resistance={name}
                  key={name}
                >
                  {identity && <img alt="" className="size-6 object-contain" src={identity.icon} />}
                  <span className="min-w-0 flex-1 text-[8px] tracking-[0.12em] uppercase" style={{ color }}>
                    {titleize(name)}
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>
                    {resistance > 0 ? '+' : ''}
                    {resistance}%
                  </span>
                </div>
              )
            })}
          </div>
        </Section>
        {detail.mob.spells.length > 0 && (
          <Section title={text('mob_spells')}>
            <div className="border border-[#1e1e2e]" data-mob-spell-tabs="">
              <div className="flex min-w-0 overflow-x-auto border-b border-[#1e1e2e] bg-black/15" role="tablist">
                {detail.mob.spells.map((spell, index) => (
                  <button
                    aria-selected={index === spell_index}
                    className={`shrink-0 border-b-2 px-4 py-2.5 text-[9px] tracking-[0.08em] uppercase ${index === spell_index ? 'border-[#c8963c] bg-[#c8963c]/8 text-[#c8963c]' : 'border-transparent text-[#6b7280] hover:text-[#a9a49a]'}`}
                    key={`${spell.name}-${index}`}
                    onClick={() => set_spell_index(index)}
                    role="tab"
                    type="button"
                  >
                    {spell.name}
                  </button>
                ))}
              </div>
              <div className="min-w-0 p-4">
                {selected_spell && (
                  <SpellCard
                    key={selected_spell.name}
                    spell={{
                      classe: detail.mob.mob_type,
                      levels: selected_spell.levels,
                      name: selected_spell.name,
                      unlock_level: 1,
                    }}
                    text={text}
                  />
                )}
              </div>
            </div>
          </Section>
        )}
        <Section title={text('gameplay.section_loot')}>
          {detail.loot.length === 0 ? (
            <p className="text-[9px] italic text-[#6b7280]">{text('no_drops')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {detail.loot.map(({ drop, item }) => {
                const chance = drop.chance_bp / 100
                const quantity = drop.min_qty === drop.max_qty ? `×${drop.min_qty}` : `×${drop.min_qty}–${drop.max_qty}`
                const category = item?.category ?? ''
                return (
                  <button
                    className="flex cursor-pointer flex-col bg-white/2 px-2 py-1.5 text-left hover:bg-[#c8963c]/8"
                    key={drop.item_type}
                    onClick={() => select_item(drop.item_type)}
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[10px] text-[#e8e4dc]">
                          {item?.name ?? titleize(drop.item_type)}
                        </span>
                        {category && (
                          <span
                            className="shrink-0 text-[8px] tracking-wide uppercase"
                            style={{ color: item_category_colors[category] ?? '#6b728080' }}
                          >
                            {titleize(category)}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-[10px] font-semibold tabular-nums text-[#c8963c]">
                          {chance.toFixed(2)}%
                        </span>
                        <span className="text-[9px] text-[#6b7280]">{quantity}</span>
                      </span>
                    </span>
                    <span className="mt-1 h-[3px] w-full bg-white/5" data-mob-loot-progress="">
                      <span
                        className="block h-full bg-[linear-gradient(90deg,rgba(200,150,60,0.6),rgba(200,150,60,0.3))]"
                        style={{ width: `${Math.min(100, chance)}%` }}
                      />
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Section>
        {detail.worlds.length > 0 && (
          <Section title={text('found_in')}>
            <div className="flex flex-col gap-1" data-mob-found-in="">
              {detail.worlds.map((world) => {
                const biomes = world.mobs.find(({ mob_type }) => mob_type === detail.mob.mob_type)?.biomes ?? []
                return (
                  <button
                    className="flex cursor-pointer items-center gap-2 bg-white/2 px-2 py-1.5 text-left hover:bg-[#c8963c]/8"
                    key={world.world}
                    onClick={() => select_world(world.world)}
                    type="button"
                  >
                    <MapPin className="shrink-0 text-[#c8963c]/60" size={11} />
                    <span className="min-w-0 flex-1 text-[10px] tracking-[0.1em] text-[#c8963c] uppercase">
                      {titleize(world.world)}
                    </span>
                    {biomes.length > 0 && (
                      <span className="text-[8px] tracking-[0.12em] text-[#6b7280] uppercase">
                        {biomes.map(titleize).join(', ')}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </Section>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1">
      <FacetRail
        all_label={text('view_all')}
        class_name="w-40 shrink-0"
        on_select={set_mob_filter}
        options={facet_options}
        selected={mob_filter}
        total={encyclopedia_catalog.mobs.length}
      />
      <div className={`flex min-h-0 min-w-0 flex-col ${detail ? 'flex-[7]' : 'flex-1'}`}>
        <div className={encyclopedia_layout.filters}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <SearchField change={set_search} placeholder={text('search_mobs')} value={search} />
            </div>
            <span className="shrink-0 text-[8px] tracking-[0.15em] text-[#6b7280] uppercase">
              {text('showing_mobs', { count: filtered.length, total: encyclopedia_catalog.mobs.length })}
            </span>
            <select
              className="h-9 min-w-[110px] border border-[#1e1e2e] bg-[#0a0a0f]/55 px-2 text-[9px] text-[#9da0a9] uppercase"
              onChange={(event) => set_sort(event.target.value)}
              value={sort}
            >
              <option value="level_asc">{text('sort_level_asc')}</option>
              <option value="level_desc">{text('sort_level_desc')}</option>
              <option value="name_asc">{text('sort_name_asc')}</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-1">
            <button className={category_pill(view === 'all')} onClick={() => set_view('all')} type="button">
              {text('view_all')}
            </button>
            <button className={category_pill(view === 'by_level')} onClick={() => set_view('by_level')} type="button">
              {text('view_by_level')}
            </button>
          </div>
        </div>
        {list}
      </div>
      {detail && <aside className={encyclopedia_layout.detail}>{detail_panel}</aside>}
    </div>
  )
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { FilterMenu } from '@aresrpg/ui'
import { Search, Shield } from 'lucide-react'
import { useMemo, useState } from 'react'

import { type FacetOption } from '../components/FacetRail.tsx'
import { mob_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'
import { element_colors } from '../visual_identity.ts'

import { CatalogueMobDetails } from './CatalogueMobDetails.tsx'
import {
  Empty,
  EncyclopediaBrowser,
  encyclopedia_layout,
  EntityButton,
  EntityGrid,
  SearchField,
} from './components.tsx'
import type { EncyclopediaText } from './copy.ts'

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
    const section_key = (
      { world: 'worlds_tab', family: 'all_families', element: 'elements_filter' } as Readonly<Record<string, string>>
    )[row.kind]
    const section =
      section_key && previous?.kind !== row.kind && (row.kind !== 'world' || !previous?.parent)
        ? text(section_key)
        : undefined
    return Object.freeze({
      value: `${row.kind}:${row.id}`,
      label:
        row.kind === 'element'
          ? text(`element.${row.id}`)
          : titleize(row.parent ? row.id.slice(row.id.indexOf(':') + 1) : row.id),
      count: row.count,
      color: row.kind === 'element' ? element_colors[row.id] : undefined,
      section,
      indent: Boolean(row.parent),
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
  const choose_mob = (id: string): void => {
    select_mob(id)
  }
  const row = (mob: (typeof encyclopedia_catalog.mobs)[number], index: number) => (
    <EntityButton
      accent={`${element_colors[mob.element] ?? '#6b7280'}40`}
      active={selected_id === mob.mob_type}
      icon={mob_icon(mob.mob_type)}
      index={index}
      key={mob.mob_type}
      meta={`${text(`element.${mob.element}`)} · ${text('level_range', { min: mob.level_min, max: mob.level_max })}`}
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
            <div className="border-b border-[#c8963c]/30 bg-[#c8963c]/4 px-3 py-2 text-[8px] tracking-[0.25em] text-[#c8963c]/60 uppercase">
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

  return (
    <EncyclopediaBrowser
      back={() => select_mob('')}
      text={text}
      detail={null}
      list={
        <div className={`enc-browser__list flex min-h-0 min-w-0 flex-col ${detail ? 'flex-[7]' : 'flex-1'}`}>
          <div className="aui-mob-tools">
            <SearchField change={set_search} placeholder={text('search_mobs')} value={search} />
            <FilterMenu
              title={text('all_families')}
              close_label={text('back_to_list')}
              value={mob_filter}
              choose={set_mob_filter}
              options={[
                { id: '', label: text('view_all'), count: encyclopedia_catalog.mobs.length },
                ...facet_options.map((option) => ({
                  id: option.value,
                  label: option.label,
                  count: option.count,
                  detail: option.section,
                })),
              ]}
            />
            <select aria-label={text('sort_level_asc')} value={sort} onChange={(event) => set_sort(event.target.value)}>
              <option value="level_asc">{text('sort_level_asc')}</option>
              <option value="level_desc">{text('sort_level_desc')}</option>
              <option value="name_asc">{text('sort_name_asc')}</option>
            </select>
            <FilterMenu
              title={text(view === 'all' ? 'view_all' : 'view_by_level')}
              close_label={text('back_to_list')}
              value={view}
              choose={(value) => set_view(value === 'by_level' ? 'by_level' : 'all')}
              options={[
                { id: 'all', label: text('view_all') },
                { id: 'by_level', label: text('view_by_level') },
              ]}
            />
            <small>{text('showing_mobs', { count: filtered.length, total: encyclopedia_catalog.mobs.length })}</small>
          </div>
          {list}
        </div>
      }
    />
  )
}

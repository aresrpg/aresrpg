// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { titleize } from '../content/catalog.ts'
import type { ItemFilterGroup, ItemFilterRow } from '../content/item_filters.ts'

import type { EncyclopediaText } from './copy.ts'

export type ItemFilterSelection = Readonly<Partial<Record<ItemFilterGroup, string>>>

const GROUPS = Object.freeze(['category', 'resource', 'job', 'world', 'family'] as const)

const group_title = (group: ItemFilterGroup, text: EncyclopediaText): string =>
  text(
    group === 'category'
      ? 'filter_by_category'
      : group === 'resource'
        ? 'filter_by_resource'
        : group === 'job'
          ? 'filter_by_job'
          : group === 'world'
            ? 'filter_by_world'
            : 'filter_by_mob_family'
  )

const option_label = (row: ItemFilterRow, text: EncyclopediaText): string => {
  if (row.group === 'resource') return text(`group_${row.id}_resources`)
  return titleize(row.parent ? row.id.slice(row.id.indexOf(':') + 1) : row.id)
}

const FilterSection = ({
  group,
  rows,
  selected,
  select,
  text,
}: Readonly<{
  group: ItemFilterGroup
  rows: readonly ItemFilterRow[]
  selected: string | undefined
  select: (group: ItemFilterGroup, id: string) => void
  text: EncyclopediaText
}>) => {
  const [expanded, set_expanded] = useState(true)
  return (
    <section className="border-t border-white/7" data-item-filter-section={group}>
      <button
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-[8px] font-semibold tracking-[0.16em] text-[#9a9eaa] uppercase hover:bg-white/[0.025] hover:text-[#e6e2da]"
        onClick={() => set_expanded(!expanded)}
        type="button"
      >
        {group_title(group, text)}
        <ChevronDown className={`transition-transform ${expanded ? '' : '-rotate-90'}`} size={12} />
      </button>
      {expanded && (
        <div className="pb-2">
          {rows.map((row) => {
            const active = selected === row.id
            return (
              <button
                className={`flex w-full items-center justify-between gap-2 border-l-2 py-1.5 pr-3 text-left text-[8px] uppercase ${row.parent ? 'pl-7' : 'pl-4'} ${active ? 'border-[#c8963c] bg-[#c8963c]/7 text-[#efbd45]' : 'border-transparent text-[#777d8a] hover:bg-white/[0.035] hover:text-[#dedad2]'}`}
                data-item-filter={`${group}:${row.id}`}
                key={`${row.kind}:${row.id}`}
                onClick={() => select(group, row.id)}
                type="button"
              >
                <span className="min-w-0 truncate">
                  {option_label(row, text)}
                  {row.kind === 'biome' || row.kind === 'city' ? (
                    <span className="ml-1.5 text-[6px] tracking-[0.12em] text-[#4f8099]">
                      {text(row.kind === 'biome' ? 'filter_biome' : 'filter_city')}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums opacity-50">{row.item_types.length}</span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

export const ItemFilterRail = ({
  rows,
  selected,
  select,
  text,
  total,
}: Readonly<{
  rows: readonly ItemFilterRow[]
  selected: ItemFilterSelection
  select: (selected: ItemFilterSelection) => void
  text: EncyclopediaText
  total: number
}>) => {
  const active_count = Object.keys(selected).length
  const select_option = (group: ItemFilterGroup, id: string): void => {
    const remaining = Object.fromEntries(Object.entries(selected).filter(([key]) => key !== group))
    select(selected[group] === id ? remaining : { ...remaining, [group]: id })
  }
  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-white/10 bg-surface" data-item-filter-rail="">
      <button
        className={`flex w-full items-center justify-between border-l-2 px-4 py-3 text-left text-[8px] uppercase ${active_count === 0 ? 'border-[#c8963c] bg-[#c8963c]/7 text-[#efbd45]' : 'border-transparent text-[#858b98] hover:bg-white/[0.045] hover:text-[#e6e2da]'}`}
        onClick={() => select({})}
        type="button"
      >
        <span>{text('view_all')}</span>
        <span className="tabular-nums opacity-55">{total}</span>
      </button>
      {GROUPS.map((group) => (
        <FilterSection
          group={group}
          key={group}
          rows={rows.filter((row) => row.group === group)}
          select={select_option}
          selected={selected[group]}
          text={text}
        />
      ))}
    </aside>
  )
}

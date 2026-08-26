// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  SearchPickerModal,
  type PickerCopy,
  type PickerFacet,
  type PickerItem,
} from '../components/SearchPickerModal.tsx'
import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'

import type { ItemReferenceFilterRow } from './content_list.ts'

const picker_copy: PickerCopy = Object.freeze({
  search: (title) => `Search ${title}`,
  all: 'All items',
  no_results: 'No matching items',
  results: (filtered, total) => `${filtered} / ${total}`,
  selected: (label) => `Selected: ${label}`,
  new_label: 'New',
})

const picker_facet_id = ({ kind, id }: ItemReferenceFilterRow): string => `${kind}:${id}`

export const item_picker_facets = (
  item_types: ReadonlySet<string>,
  filter_rows: readonly ItemReferenceFilterRow[]
): readonly PickerFacet[] => {
  const first_kind = new Set<ItemReferenceFilterRow['kind']>()
  return Object.freeze(
    filter_rows
      .filter((row) => row.item_types.some((item_type) => item_types.has(item_type)))
      .map((row) => {
        const first = !first_kind.has(row.kind)
        first_kind.add(row.kind)
        return Object.freeze({
          id: picker_facet_id(row),
          label: titleize(row.id),
          ...(first
            ? {
                section: row.kind === 'category' ? 'Categories' : row.kind === 'world' ? 'Worlds' : 'Mob families',
              }
            : {}),
        })
      })
  )
}

export const ItemReferencePicker = ({
  value,
  label,
  select,
  excluded = new Set(),
  categories,
  item_types,
  class_name = '',
  placeholder = 'Choose item',
  empty_sublabel,
  filter_rows,
}: Readonly<{
  value: string
  label: string
  select: (item_type: string) => void
  excluded?: ReadonlySet<string>
  categories?: ReadonlySet<string>
  item_types?: readonly string[]
  class_name?: string
  placeholder?: string
  empty_sublabel?: string
  filter_rows?: readonly ItemReferenceFilterRow[]
}>) => {
  const [open, set_open] = useState(false)
  const selected = encyclopedia_catalog.items.find(({ item_type }) => item_type === value)
  const options = useMemo<readonly PickerItem[]>(
    () =>
      Object.freeze(
        encyclopedia_catalog.items
          .filter(
            ({ item_type, category }) =>
              item_type === value ||
              (!excluded.has(item_type) &&
                (!categories || categories.has(category)) &&
                (!item_types || item_types.includes(item_type)))
          )
          .map((item) =>
            Object.freeze({
              id: item.item_type,
              label: item.name,
              category: item.category,
              ...(filter_rows
                ? {
                    facets: Object.freeze(
                      filter_rows.filter(({ item_types }) => item_types.includes(item.item_type)).map(picker_facet_id)
                    ),
                  }
                : {}),
              sublabel: `Level ${item.level} · ${titleize(item.category)}`,
              icon: item_icon(item.item_type),
            })
          )
      ),
    [categories, excluded, filter_rows, item_types, value]
  )
  const facets = useMemo(
    () => (filter_rows ? item_picker_facets(new Set(options.map(({ id }) => id)), filter_rows) : []),
    [filter_rows, options]
  )
  return (
    <>
      <button
        aria-label={`Choose ${label}`}
        className={`flex h-10 min-w-0 items-center gap-2 border border-white/10 bg-bg px-2 text-left hover:border-[#c8963c]/45 ${class_name}`}
        data-item-reference-picker={label}
        onClick={() => set_open(true)}
        type="button"
      >
        <span className="grid size-7 shrink-0 place-items-center">
          {item_icon(value) && <img alt="" className="size-7 object-contain" src={item_icon(value)!} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[9px] text-[#d8d3ca]">
            {selected?.name ?? (titleize(value) || placeholder)}
          </span>
          {selected ? (
            <span className="block truncate text-[7px] text-[#5f646e]">
              {titleize(selected.category)} · Level {selected.level}
            </span>
          ) : (
            (empty_sublabel || value) && (
              <span className="block truncate text-[7px] text-[#5f646e]">{empty_sublabel || value}</span>
            )
          )}
        </span>
        <ChevronDown className="shrink-0 text-[#666b75]" size={12} />
      </button>
      {open && (
        <SearchPickerModal
          copy={picker_copy}
          facets={facets}
          items={options}
          on_close={() => set_open(false)}
          on_select={(item_type) => {
            select(item_type)
            set_open(false)
          }}
          title={label}
          value={value}
        />
      )}
    </>
  )
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'

import { SearchPickerModal, type PickerCopy, type PickerItem } from '../components/SearchPickerModal.tsx'
import { item_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'

const picker_copy: PickerCopy = Object.freeze({
  search: (title) => `Search ${title}`,
  all: 'All items',
  no_results: 'No matching items',
  results: (filtered, total) => `${filtered} / ${total}`,
  selected: (label) => `Selected: ${label}`,
  new_label: 'New',
})

export const ItemReferencePicker = ({
  value,
  label,
  select,
  excluded = new Set(),
  categories,
  class_name = '',
}: Readonly<{
  value: string
  label: string
  select: (item_type: string) => void
  excluded?: ReadonlySet<string>
  categories?: ReadonlySet<string>
  class_name?: string
}>) => {
  const [open, set_open] = useState(false)
  const selected = encyclopedia_catalog.items.find(({ item_type }) => item_type === value)
  const options = useMemo<readonly PickerItem[]>(
    () =>
      Object.freeze(
        encyclopedia_catalog.items
          .filter(
            ({ item_type, category }) =>
              item_type === value || (!excluded.has(item_type) && (!categories || categories.has(category)))
          )
          .map((item) =>
            Object.freeze({
              id: item.item_type,
              label: item.name,
              category: item.category,
              sublabel: `Level ${item.level} · ${titleize(item.category)}`,
              icon: item_icon(item.item_type),
            })
          )
      ),
    [categories, excluded, value]
  )
  return (
    <>
      <button
        aria-label={`Choose ${label}`}
        className={`flex h-10 min-w-0 items-center gap-2 border border-white/10 bg-[#090a10] px-2 text-left hover:border-[#c8963c]/45 ${class_name}`}
        data-item-reference-picker={label}
        onClick={() => set_open(true)}
        type="button"
      >
        <span className="grid size-7 shrink-0 place-items-center">
          {item_icon(value) && <img alt="" className="size-7 object-contain" src={item_icon(value)!} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[9px] text-[#d8d3ca]">
            {selected?.name ?? (titleize(value) || 'Choose item')}
          </span>
          {selected ? (
            <span className="block truncate text-[7px] text-[#5f646e]">
              {titleize(selected.category)} · Level {selected.level}
            </span>
          ) : (
            value && <span className="block truncate text-[7px] text-[#5f646e]">{value}</span>
          )}
        </span>
        <ChevronDown className="shrink-0 text-[#666b75]" size={12} />
      </button>
      {open && (
        <SearchPickerModal
          copy={picker_copy}
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

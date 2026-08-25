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
import { mob_icon } from '../content/assets.ts'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'

import { mob_filter_rows, type MobFilterRow } from './content_list.ts'
import type { JsonValue, SeedEntityRow } from './seed_editor.ts'

const picker_copy: PickerCopy = Object.freeze({
  search: (title) => `Search ${title}`,
  all: 'All mobs',
  no_results: 'No matching mobs',
  results: (filtered, total) => `${filtered} / ${total}`,
  selected: (label) => `Selected: ${label}`,
  new_label: 'New',
})

const catalog_rows = <T extends Readonly<Record<string, unknown>>>(
  rows: readonly T[],
  id: (row: T) => string
): readonly SeedEntityRow[] =>
  Object.freeze(
    rows.map((row, index) =>
      Object.freeze({ id: id(row), label: id(row), path: Object.freeze([index]), value: row as unknown as JsonValue })
    )
  )

const MOB_FILTER_ROWS = mob_filter_rows(
  catalog_rows(encyclopedia_catalog.mobs, ({ mob_type }) => String(mob_type)),
  catalog_rows(encyclopedia_catalog.worlds ?? [], ({ world }) => String(world))
)
const picker_facet_id = ({ kind, id }: MobFilterRow): string => `${kind}:${id}`

export const mob_picker_facets = (
  mob_types: ReadonlySet<string>,
  filter_rows: readonly MobFilterRow[] = MOB_FILTER_ROWS
): readonly PickerFacet[] => {
  const first_kind = new Set<MobFilterRow['kind']>()
  return Object.freeze(
    filter_rows
      .filter((row) => row.kind !== 'protector' && row.mob_types.some((mob_type) => mob_types.has(mob_type)))
      .map((row) => {
        const first = !first_kind.has(row.kind)
        first_kind.add(row.kind)
        return Object.freeze({
          id: picker_facet_id(row),
          label: titleize(row.kind === 'biome' ? row.id.slice(row.id.indexOf(':') + 1) : row.id),
          ...(first
            ? {
                section:
                  row.kind === 'world'
                    ? 'Worlds & biomes'
                    : row.kind === 'family'
                      ? 'Families'
                      : row.kind === 'element'
                        ? 'Elements'
                        : undefined,
              }
            : {}),
          ...(row.parent ? { parent: row.parent } : {}),
        })
      })
  )
}

export const MobReferencePicker = ({
  value,
  label,
  select,
  excluded = new Set(),
  roles,
  class_name = '',
  placeholder = 'Choose mob',
  empty_sublabel,
  filter_rows = MOB_FILTER_ROWS,
}: Readonly<{
  value: string
  label: string
  select: (mob_type: string) => void
  excluded?: ReadonlySet<string>
  roles?: ReadonlySet<string>
  class_name?: string
  placeholder?: string
  empty_sublabel?: string
  filter_rows?: readonly MobFilterRow[]
}>) => {
  const [open, set_open] = useState(false)
  const selected = encyclopedia_catalog.mobs.find(({ mob_type }) => mob_type === value)
  const options = useMemo<readonly PickerItem[]>(() => {
    const candidates = encyclopedia_catalog.mobs.filter(
      ({ mob_type, role }) => mob_type === value || (!excluded.has(mob_type) && (!roles || roles.has(role)))
    )
    return Object.freeze(
      candidates.map((mob) =>
        Object.freeze({
          id: mob.mob_type,
          label: mob.name,
          category: mob.element,
          facets: Object.freeze(
            filter_rows.filter(({ mob_types }) => mob_types.includes(mob.mob_type)).map(picker_facet_id)
          ),
          sublabel: `Level ${mob.level_min}–${mob.level_max} · ${titleize(mob.element)}`,
          icon: mob_icon(mob.mob_type),
        })
      )
    )
  }, [excluded, filter_rows, roles, value])
  const facets = useMemo(
    () => mob_picker_facets(new Set(options.map(({ id }) => id)), filter_rows),
    [filter_rows, options]
  )
  return (
    <>
      <button
        aria-label={`Choose ${label}`}
        className={`flex h-10 min-w-0 items-center gap-2 border border-white/10 bg-[#090a10] px-2 text-left hover:border-[#c8963c]/45 ${class_name}`}
        data-mob-reference-picker={label}
        onClick={() => set_open(true)}
        type="button"
      >
        <span className="grid size-7 shrink-0 place-items-center">
          {mob_icon(value) && <img alt="" className="size-7 object-contain" src={mob_icon(value)!} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[9px] text-[#d8d3ca]">
            {selected?.name ?? (titleize(value) || placeholder)}
          </span>
          {selected ? (
            <span className="block truncate text-[7px] text-[#5f646e]">
              {titleize(selected.element)} · Level {selected.level_min}–{selected.level_max}
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
          on_select={(mob_type) => {
            select(mob_type)
            set_open(false)
          }}
          title={label}
          value={value}
        />
      )}
    </>
  )
}

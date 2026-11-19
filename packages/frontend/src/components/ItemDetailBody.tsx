// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { element_names, item_categories, rune_effect, stat_names } from '@aresrpg/immutable'
import { ItemSheet, ItemStatLine, item_stat_display_range, type ItemSheetField, type ItemSheetProps } from '@aresrpg/ui'
import { useState, type FocusEvent, type ReactNode } from 'react'

import { item_detail_icon } from '../content/item_detail_assets.ts'
import { useVocabulary } from '../i18n/useVocabulary.ts'
import { useItemCategoryName } from '../i18n/useItemCategoryName.ts'
import { element_colors, item_category_colors } from '../visual_identity.ts'
import type { equipment_comparison } from '../characters/equipment_comparison.ts'

import { comparison_values, ComparisonHeading } from './ItemComparison.tsx'
import type { ItemCraftSession } from './ItemCrafting.tsx'

export type ItemDetailPath = readonly (string | number)[]
export type ItemDetailValue =
  string | number | null | readonly ItemDetailValue[] | Readonly<{ [key: string]: ItemDetailValue }>

export type ItemDetailEdit = Readonly<{
  change: (path: ItemDetailPath, value: ItemDetailValue) => void
  save: () => void
}>

type ItemStats = Readonly<{
  min: Readonly<Record<string, number>>
  max: Readonly<Record<string, number>>
}>

type ItemDamage = Readonly<{ element: string; from: number; to: number; damage_type: string }>

export type ItemStatRow = Readonly<{ key: string; minimum: number; maximum: number }>

const titleize = (value: string): string =>
  value
    .replaceAll('_', ' ')
    .replace(/\b(?:ap|hp|mp|xp)\b/gi, (word) => word.toUpperCase())
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

const stat_is_defined = ({ minimum, maximum }: ItemStatRow): boolean => minimum !== 0 || maximum !== 0

export const item_stat_rows = (stats: ItemStats, include_empty = false): readonly ItemStatRow[] => {
  const authored = new Set([...Object.keys(stats.min), ...Object.keys(stats.max)])
  const keys = [
    ...stat_names,
    ...[...authored].filter((key) => !stat_names.includes(key as (typeof stat_names)[number])),
  ]
  return Object.freeze(
    keys
      .map((key) =>
        Object.freeze({ key, minimum: stats.min[key] ?? 0, maximum: stats.max[key] ?? stats.min[key] ?? 0 })
      )
      .filter((row) => include_empty || stat_is_defined(row))
      .toSorted((left, right) => Number(stat_is_defined(right)) - Number(stat_is_defined(left)))
  )
}

export { item_stat_display_range }

const input_class = 'h-8 border border-white/12 bg-bg px-2 text-[10px] text-text outline-none focus:border-gold/60'
const action_class =
  'h-7 border border-white/12 bg-white/[0.025] px-2 text-[8px] tracking-[0.12em] text-faint uppercase hover:border-gold/50 hover:text-gold'

export const InlineField = ({
  class_name = '',
  display,
  edit,
  editor,
  label,
}: Readonly<{
  class_name?: string
  display: ReactNode
  edit?: ItemDetailEdit
  editor: ReactNode
  label: string
}>) => {
  const [editing, set_editing] = useState(false)
  const finish = (event: Readonly<FocusEvent<HTMLSpanElement>>): void => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return
    set_editing(false)
    edit?.save()
  }
  if (!edit) return display
  if (editing)
    return (
      <span className={class_name} onBlur={finish}>
        {editor}
      </span>
    )
  return (
    <button
      aria-label={`Edit ${label}`}
      className={`${class_name} cursor-text text-left hover:bg-white/[0.035]`}
      data-item-inline-edit={label}
      onClick={() => set_editing(true)}
      type="button"
    >
      {display}
    </button>
  )
}

const stat_editor = (row: ItemStatRow, edit: ItemDetailEdit): ReactNode => {
  const [display_minimum, display_maximum] = item_stat_display_range(row)
  const reversed = row.minimum < 0 && row.maximum < 0
  return (
    <span className="flex items-center gap-2">
      <input
        aria-label={`${row.key} from`}
        autoFocus
        className={`${input_class} w-16 text-right tabular-nums`}
        onChange={(event) => edit.change(['stats', reversed ? 'max' : 'min', row.key], Number(event.target.value))}
        type="number"
        value={display_minimum}
      />
      <span className="text-[7px] text-faint uppercase">to</span>
      <input
        aria-label={`${row.key} to`}
        className={`${input_class} w-16 text-right tabular-nums`}
        onChange={(event) => edit.change(['stats', reversed ? 'min' : 'max', row.key], Number(event.target.value))}
        type="number"
        value={display_maximum}
      />
    </span>
  )
}

const damage_editor = (damage: ItemDamage, index: number, edit: ItemDetailEdit): ReactNode => (
  <span className="flex min-h-10 w-full flex-wrap items-center gap-2 px-2">
    <input
      aria-label={`Damage ${index + 1} from`}
      autoFocus
      className={`${input_class} w-16 text-right`}
      onChange={(event) => edit.change(['damages', index, 'from'], Number(event.target.value))}
      type="number"
      value={damage.from}
    />
    <span className="text-[7px] text-faint uppercase">to</span>
    <input
      aria-label={`Damage ${index + 1} to`}
      className={`${input_class} w-16 text-right`}
      onChange={(event) => edit.change(['damages', index, 'to'], Number(event.target.value))}
      type="number"
      value={damage.to}
    />
    <select
      aria-label={`Damage ${index + 1} element`}
      className={`${input_class} w-28`}
      onChange={(event) => edit.change(['damages', index, 'element'], event.target.value)}
      value={damage.element}
    >
      {element_names.map((element) => (
        <option key={element} value={element}>
          {titleize(element)}
        </option>
      ))}
    </select>
    <input
      aria-label={`Damage ${index + 1} type`}
      className={`${input_class} w-28`}
      onChange={(event) => edit.change(['damages', index, 'damage_type'], event.target.value)}
      value={damage.damage_type}
    />
  </span>
)

const remove_stat_action = (row: ItemStatRow, edit: ItemDetailEdit): ReactNode => (
  <button
    aria-label={`Remove ${row.key}`}
    className="grid size-7 shrink-0 cursor-pointer place-items-center text-faint hover:text-[#ff6b86]"
    onClick={() => {
      edit.change(['stats', 'min', row.key], 0)
      edit.change(['stats', 'max', row.key], 0)
    }}
    type="button"
  >
    ×
  </button>
)

export type ItemDetailProps = Readonly<{
  allow_damage_add?: boolean
  category: string
  comparison?: NonNullable<ReturnType<typeof equipment_comparison>>
  children?: ReactNode
  craft_session?: ItemCraftSession
  damages: readonly ItemDamage[]
  description?: string | null
  edit?: ItemDetailEdit
  item_type: string
  labels: Readonly<{
    characteristics: string
    characteristics_note?: string
    damages: string
    level_short: string
    range_to: string
  }>
  level: number
  name: string
  obtention?: string | null
  select_mob?: (id: string) => void
  select_world?: (id: string) => void
  stat_budget?: ReactNode
  stats?: ItemStats
}>

/** One characteristic row outside a full sheet, such as a loot notification. */
export const StatLine = ({
  labels,
  row,
  delta,
}: Readonly<{ delta?: number; labels: ItemDetailProps['labels']; row: ItemStatRow }>) => {
  const vocabulary = useVocabulary()
  return <ItemStatLine range_to={labels.range_to} stat={{ ...row, delta, label: vocabulary.stat(row.key) }} />
}

type Authoring = Pick<ItemSheetProps, 'field' | 'damage_action' | 'damages_footer' | 'stat_action' | 'stats_footer'>
type AuthoringInput = Readonly<{
  allow_damage_add: boolean
  category: string
  category_name: (category: string) => string
  damages: readonly ItemDamage[]
  edit: ItemDetailEdit
  level: number
  name: string
  range_to: string
  stat_label: (stat: string) => string
  stat_rows: readonly ItemStatRow[]
}>

const header_editors = ({ category, category_name, edit, level, name }: AuthoringInput) => ({
  name: {
    label: 'item name',
    editor: (
      <input
        aria-label="Item name"
        autoFocus
        className={`${input_class} w-full`}
        onChange={(event) => edit.change(['name'], event.target.value)}
        value={name}
      />
    ),
  },
  level: {
    label: 'item level',
    editor: (
      <input
        aria-label="Item level"
        autoFocus
        className={`${input_class} w-20 text-right`}
        onChange={(event) => edit.change(['level'], Number(event.target.value))}
        type="number"
        value={level}
      />
    ),
  },
  category: {
    label: 'item category',
    editor: (
      <select
        aria-label="Item category"
        autoFocus
        className={`${input_class} w-44`}
        onChange={(event) => edit.change(['category'], event.target.value)}
        value={category}
      >
        {item_categories.map((item_category) => (
          <option key={item_category} value={item_category}>
            {category_name(item_category)}
          </option>
        ))}
      </select>
    ),
  },
})

/** Authoring wraps each displayed value with its click-to-edit field and adds the row controls. */
const item_authoring = (input: AuthoringInput): Authoring => {
  const { allow_damage_add, damages, edit, range_to, stat_label, stat_rows } = input
  const editors: Readonly<Record<string, Readonly<{ editor: ReactNode; label: string }>>> = {
    ...header_editors(input),
    ...Object.fromEntries(
      stat_rows.map((row) => [`stat:${row.key}`, { label: stat_label(row.key), editor: stat_editor(row, edit) }])
    ),
    ...Object.fromEntries(
      damages.map((damage, index) => [
        `damage:${index}`,
        { label: `damage ${index + 1}`, editor: damage_editor(damage, index, edit) },
      ])
    ),
  }
  const field: ItemSheetField = ({ slot, display, class_name }) => {
    const entry = editors[slot]
    return entry ? (
      <InlineField class_name={class_name} display={display} edit={edit} editor={entry.editor} label={entry.label} />
    ) : (
      display
    )
  }
  const inactive = stat_rows.filter((row) => !stat_is_defined(row))
  return {
    field,
    damage_action: (index) => (
      <button
        className={action_class}
        onClick={() =>
          edit.change(
            ['damages'],
            damages.filter((_, row) => row !== index)
          )
        }
        type="button"
      >
        Remove
      </button>
    ),
    damages_footer: allow_damage_add && (
      <button
        className={`${action_class} w-fit`}
        onClick={() =>
          edit.change(['damages'], [...damages, { from: 1, to: 1, damage_type: 'weapon', element: 'earth' }])
        }
        type="button"
      >
        + Damage line
      </button>
    ),
    stat_action: (stat) => (stat_is_defined(stat) ? remove_stat_action(stat, edit) : null),
    stats_footer: inactive.length > 0 && (
      <div className="mt-2 border-t border-white/6 pt-2" data-inactive-item-stats="">
        <p className="mb-1 text-[7px] tracking-[0.15em] text-faint uppercase">Available characteristics</p>
        <div className="grid gap-x-5 lg:grid-cols-2">
          {inactive.map((row) => (
            <ItemStatLine
              field={field}
              key={row.key}
              range_to={range_to}
              stat={{ ...row, label: stat_label(row.key) }}
            />
          ))}
        </div>
      </div>
    ),
  }
}

const READ_ONLY: Authoring = Object.freeze({})

export const ItemDetailBody = ({
  allow_damage_add = false,
  category,
  comparison,
  children,
  damages,
  description,
  edit,
  item_type,
  labels,
  level,
  name,
  obtention,
  stat_budget,
  stats,
}: ItemDetailProps) => {
  const category_name = useItemCategoryName()
  const vocabulary = useVocabulary()
  const values = comparison_values(stats, comparison)
  const { deltas } = values
  const stat_rows = item_stat_rows(values.stats, Boolean(edit) || Boolean(comparison))
  const rune = rune_effect(item_type)
  const authoring = edit
    ? item_authoring({
        allow_damage_add,
        category,
        category_name,
        damages,
        edit,
        level,
        name,
        range_to: labels.range_to,
        stat_label: vocabulary.stat,
        stat_rows,
      })
    : READ_ONLY

  return (
    <ItemSheet
      {...authoring}
      category={{ label: category_name(category), color: item_category_colors[category] ?? '#6b7280' }}
      damages={damages.map((damage) => ({
        from: damage.from,
        to: damage.to,
        color: element_colors[damage.element] ?? '#ffffff',
        element: vocabulary.element(damage.element),
      }))}
      description={description}
      editable={Boolean(edit)}
      heading={comparison && <ComparisonHeading comparison={comparison} />}
      icon={item_detail_icon(item_type)}
      labels={labels}
      level_label={edit || level > 0 ? labels.level_short : undefined}
      name={name}
      obtention={obtention}
      rune={rune && { stat: rune.stat, amount: rune.amount, label: vocabulary.stat(rune.stat) }}
      stats={stat_rows
        .filter((row) => stat_is_defined(row) || deltas[row.key] !== undefined)
        .map((row) => ({ ...row, delta: deltas[row.key], label: vocabulary.stat(row.key) }))}
      stats_footer={
        stat_rows.length > 0 && (
          <>
            {stat_budget}
            {authoring.stats_footer}
          </>
        )
      }
    >
      {children}
    </ItemSheet>
  )
}

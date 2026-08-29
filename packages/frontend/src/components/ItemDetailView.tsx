// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { element_names, item_categories, rune_effect, stat_names } from '@aresrpg/immutable'
import { useState, type FocusEvent, type ReactNode } from 'react'

import { item_detail_icon } from '../content/item_detail_assets.ts'
import { element_colors, item_category_colors, stat_colors, stat_identities } from '../visual_identity.ts'

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

export const item_stat_display_range = ({ minimum, maximum }: ItemStatRow): readonly [number, number] =>
  minimum < 0 && maximum < 0 ? [maximum, minimum] : [minimum, maximum]

const input_class =
  'h-8 border border-white/12 bg-bg px-2 text-[10px] text-[#e8e4dc] outline-none focus:border-[#c8963c]/60'
const action_class =
  'h-7 border border-white/12 bg-white/[0.025] px-2 text-[8px] tracking-[0.12em] text-[#8c919c] uppercase hover:border-[#c8963c]/50 hover:text-[#efbd45]'

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

const StatIdentity = ({ stat }: Readonly<{ stat: string }>) => {
  const identity = stat_identities[stat]
  const color = stat_colors[stat] ?? '#e8e4dc'
  return (
    <span className="grid size-6 shrink-0 place-items-center" style={{ color }}>
      {identity ? (
        <img alt="" className="size-5 object-contain" src={identity.icon} />
      ) : (
        <span className="size-2" style={{ background: color }} />
      )}
    </span>
  )
}

const RuneEffectLine = ({ item_type }: Readonly<{ item_type: string }>) => {
  const rune = rune_effect(item_type)
  if (!rune) return null
  return (
    <div className="flex min-h-9 items-center gap-2 px-2 text-[10px] tracking-wide" data-rune-effect="">
      <StatIdentity stat={rune.stat} />
      <span className="font-semibold tabular-nums" style={{ color: stat_colors[rune.stat] }}>
        +{rune.amount}
      </span>
      <span className="min-w-0 flex-1 truncate" style={{ color: stat_colors[rune.stat] }}>
        {titleize(rune.stat)}
      </span>
    </div>
  )
}

const item_has_characteristics = (
  item_type: string,
  damages: readonly ItemDamage[],
  stat_rows: readonly ItemStatRow[]
): boolean => rune_effect(item_type) !== null || damages.length > 0 || stat_rows.length > 0

const StatLine = ({
  edit,
  labels,
  row,
}: Readonly<{ edit?: ItemDetailEdit; labels: ItemDetailProps['labels']; row: ItemStatRow }>) => {
  const color = stat_colors[row.key] ?? '#e8e4dc'
  const signed = (value: number): string => `${value < 0 ? '' : '+'}${value}`
  const defined = stat_is_defined(row)
  const [display_minimum, display_maximum] = item_stat_display_range(row)
  const reverse_negative_range = row.minimum < 0 && row.maximum < 0
  const values = (
    <span className="whitespace-nowrap">
      <span style={{ color: display_minimum < 0 ? '#ff5555' : color }}>{signed(display_minimum)}</span>
      {display_minimum !== display_maximum && (
        <>
          <span className="text-[#aaa]"> {labels.range_to} </span>
          <span style={{ color: display_maximum < 0 ? '#ff5555' : color }}>{display_maximum}</span>
        </>
      )}
    </span>
  )
  const value_editor = (
    <span className="flex items-center gap-2">
      <input
        aria-label={`${row.key} from`}
        autoFocus
        className={`${input_class} w-16 text-right tabular-nums`}
        onChange={(event) =>
          edit?.change(['stats', reverse_negative_range ? 'max' : 'min', row.key], Number(event.target.value))
        }
        type="number"
        value={display_minimum}
      />
      <span className="text-[7px] text-[#555b66] uppercase">to</span>
      <input
        aria-label={`${row.key} to`}
        className={`${input_class} w-16 text-right tabular-nums`}
        onChange={(event) =>
          edit?.change(['stats', reverse_negative_range ? 'min' : 'max', row.key], Number(event.target.value))
        }
        type="number"
        value={display_maximum}
      />
    </span>
  )
  return (
    <div
      className={`flex min-h-9 items-center gap-2 px-2 text-[10px] tracking-wide ${defined ? '' : 'opacity-55'}`}
      data-item-stat={row.key}
    >
      <StatIdentity stat={row.key} />
      {defined ? (
        <>
          <InlineField display={values} edit={edit} editor={value_editor} label={titleize(row.key)} />
          <span className="min-w-0 flex-1 truncate" style={{ color }}>
            {titleize(row.key)}
          </span>
        </>
      ) : (
        <InlineField
          class_name="flex min-w-0 flex-1 items-center gap-2"
          display={
            <>
              <span className="min-w-0 flex-1 truncate" style={{ color }}>
                {titleize(row.key)}
              </span>
              <span className="text-[#65c993]">+</span>
            </>
          }
          edit={edit}
          editor={value_editor}
          label={titleize(row.key)}
        />
      )}
      {edit && defined && (
        <button
          aria-label={`Remove ${row.key}`}
          className="grid size-7 shrink-0 cursor-pointer place-items-center text-[#555b66] hover:text-[#ff6b86]"
          onClick={() => {
            edit.change(['stats', 'min', row.key], 0)
            edit.change(['stats', 'max', row.key], 0)
          }}
          type="button"
        >
          ×
        </button>
      )}
    </div>
  )
}

const DamageLine = ({
  damage,
  edit,
  index,
  labels,
  damages,
}: Readonly<{
  damage: ItemDamage
  edit?: ItemDetailEdit
  index: number
  labels: ItemDetailProps['labels']
  damages: readonly ItemDamage[]
}>) => {
  const color = element_colors[damage.element] ?? '#ffffff'
  const display = (
    <span className="block px-2 py-2 text-[10px] tracking-wide">
      <span style={{ color }}>{damage.from}</span>
      <span className="text-[#aaa]"> - </span>
      <span style={{ color }}>{damage.to}</span>
      <span className="text-[#aaa]"> {labels.damages} </span>
      <span style={{ color }}>{titleize(damage.element)}</span>
    </span>
  )
  return (
    <div className="flex items-center gap-2" data-item-damage={index}>
      <InlineField
        class_name="block min-w-0 flex-1"
        display={display}
        edit={edit}
        editor={
          <span className="flex min-h-10 w-full flex-wrap items-center gap-2 px-2">
            <input
              aria-label={`Damage ${index + 1} from`}
              autoFocus
              className={`${input_class} w-16 text-right`}
              onChange={(event) => edit?.change(['damages', index, 'from'], Number(event.target.value))}
              type="number"
              value={damage.from}
            />
            <span className="text-[7px] text-[#555b66] uppercase">to</span>
            <input
              aria-label={`Damage ${index + 1} to`}
              className={`${input_class} w-16 text-right`}
              onChange={(event) => edit?.change(['damages', index, 'to'], Number(event.target.value))}
              type="number"
              value={damage.to}
            />
            <select
              aria-label={`Damage ${index + 1} element`}
              className={`${input_class} w-28`}
              onChange={(event) => edit?.change(['damages', index, 'element'], event.target.value)}
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
              onChange={(event) => edit?.change(['damages', index, 'damage_type'], event.target.value)}
              value={damage.damage_type}
            />
          </span>
        }
        label={`damage ${index + 1}`}
      />
      {edit && (
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
      )}
    </div>
  )
}

type ItemDetailProps = Readonly<{
  allow_damage_add?: boolean
  category: string
  children?: ReactNode
  damages: readonly ItemDamage[]
  description?: string | null
  edit?: ItemDetailEdit
  item_type: string
  labels: Readonly<{ characteristics: string; damages: string; level_short: string; range_to: string }>
  level: number
  name: string
  obtention?: string | null
  stat_budget?: ReactNode
  stats?: ItemStats
}>

export const ItemDetailView = ({
  allow_damage_add = false,
  category,
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
  const icon = item_detail_icon(item_type)
  const stat_rows = stats ? item_stat_rows(stats, Boolean(edit)) : []
  const defined_stats = stat_rows.filter(stat_is_defined)
  const undefined_stats = stat_rows.filter((row) => !stat_is_defined(row))
  const has_characteristics = item_has_characteristics(item_type, damages, stat_rows)

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col gap-4"
      data-item-detail-editable={edit ? '' : undefined}
      data-item-detail-view=""
    >
      <header className="flex items-start gap-4">
        {icon && (
          <img
            alt=""
            className="size-[94px] shrink-0 object-contain drop-shadow-[0_0_8px_rgba(200,150,60,0.3)]"
            src={icon}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-3">
            <InlineField
              class_name="min-w-0 flex-1"
              display={
                <span className="block truncate text-[13px] font-semibold tracking-[0.15em] text-[#c8963c] uppercase">
                  {name}
                </span>
              }
              edit={edit}
              editor={
                <input
                  aria-label="Item name"
                  autoFocus
                  className={`${input_class} w-full`}
                  onChange={(event) => edit?.change(['name'], event.target.value)}
                  value={name}
                />
              }
              label="item name"
            />
            {(edit || level > 0) && (
              <InlineField
                class_name="ml-auto shrink-0"
                display={
                  <span className="block border border-[#c8963c]/35 bg-[#c8963c]/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.1em] whitespace-nowrap text-[#c8963c] uppercase">
                    {labels.level_short}
                  </span>
                }
                edit={edit}
                editor={
                  <input
                    aria-label="Item level"
                    autoFocus
                    className={`${input_class} w-20 text-right`}
                    onChange={(event) => edit?.change(['level'], Number(event.target.value))}
                    type="number"
                    value={level}
                  />
                }
                label="item level"
              />
            )}
          </div>
          <InlineField
            class_name="w-fit"
            display={
              <span
                className="block text-[10px] tracking-[0.15em] uppercase"
                style={{ color: item_category_colors[category] ?? '#6b7280' }}
              >
                {titleize(category)}
              </span>
            }
            edit={edit}
            editor={
              <select
                aria-label="Item category"
                autoFocus
                className={`${input_class} w-44`}
                onChange={(event) => edit?.change(['category'], event.target.value)}
                value={category}
              >
                {item_categories.map((item_category) => (
                  <option key={item_category} value={item_category}>
                    {titleize(item_category)}
                  </option>
                ))}
              </select>
            }
            label="item category"
          />
          {description && <span className="mt-1 text-[9px] leading-relaxed text-[#777] italic">{description}</span>}
        </div>
      </header>

      {obtention && <p className="text-[9px] tracking-[0.05em] text-[#6b7280]">{obtention}</p>}

      {(has_characteristics || children) && <div className="h-px w-full bg-white/6" />}
      {has_characteristics && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[9px] font-semibold tracking-[0.25em] text-[#6b7280] uppercase">
            {labels.characteristics}
          </h3>
          <RuneEffectLine item_type={item_type} />
          {(damages.length > 0 || allow_damage_add) && (
            <div className="flex flex-col gap-1" data-item-damages="">
              {damages.map((damage, index) => (
                <DamageLine
                  damage={damage}
                  damages={damages}
                  edit={edit}
                  index={index}
                  key={`${damage.element}-${index}`}
                  labels={labels}
                />
              ))}
              {edit && allow_damage_add && (
                <button
                  className={`${action_class} w-fit`}
                  onClick={() =>
                    edit.change(['damages'], [...damages, { from: 1, to: 1, damage_type: 'weapon', element: 'earth' }])
                  }
                  type="button"
                >
                  + Damage line
                </button>
              )}
            </div>
          )}
          {stat_rows.length > 0 && (
            <div className="flex flex-col gap-0.5" data-item-stats="">
              <div data-active-item-stats="">
                {defined_stats.map((row, index) => (
                  <div key={row.key} style={{ background: index % 2 === 1 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                    <StatLine edit={edit} labels={labels} row={row} />
                  </div>
                ))}
              </div>
              {stat_budget}
              {edit && undefined_stats.length > 0 && (
                <div className="mt-2 border-t border-white/6 pt-2" data-inactive-item-stats="">
                  <p className="mb-1 text-[7px] tracking-[0.15em] text-[#555b66] uppercase">
                    Available characteristics
                  </p>
                  <div className="grid gap-x-5 lg:grid-cols-2">
                    {undefined_stats.map((row) => (
                      <StatLine edit={edit} key={row.key} labels={labels} row={row} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {children}
    </div>
  )
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { class_names, element_names, item_categories, job_slugs } from '@aresrpg/immutable'

import { item_stat_weight } from './item_power.ts'
import type { JsonPath, JsonValue } from './seed_editor.ts'

const base_input =
  'h-8 border border-white/12 bg-bg px-2 text-[10px] text-[#e3dfd7] outline-none transition-colors focus:border-[#4a9eff]/70 disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.025] disabled:text-[#737781]'
const small_button =
  'h-7 cursor-pointer border border-white/12 bg-white/[0.035] px-2 text-[8px] tracking-[0.12em] text-[#9da1ab] uppercase hover:border-[#c8963c]/50 hover:text-[#efbd45]'
const never_readonly = (): boolean => false

const humanize = (value: string): string =>
  value.replaceAll('_', ' ').replace(/\b(?:ap|hp|mp|xp)\b/gi, (word) => word.toUpperCase())

const options_for = (key: string): readonly string[] | null => {
  if (key === 'category') return item_categories
  if (key === 'element') return Object.freeze(['', ...element_names])
  if (key === 'classe') return class_names
  if (key === 'job') return job_slugs
  if (key === 'damage_type') return Object.freeze(['weapon'])
  return null
}

const element_swatch = (value: string): string => {
  if (value === 'fire') return 'bg-[#ef674d]'
  if (value === 'water') return 'bg-[#4a9eff]'
  if (value === 'earth') return 'bg-[#b58a55]'
  if (value === 'air') return 'bg-[#65c993]'
  if (value === 'neutral') return 'bg-[#b9b4aa]'
  return 'bg-white/15'
}

const field_width = (key: string, value: JsonValue, compact: boolean): string => {
  if (compact) return 'w-20'
  if (typeof value === 'number') return 'w-28'
  if (options_for(key)) return 'w-48 max-w-full'
  if (/^(?:name|seed|note|ledger|glb|icon)$/.test(key)) return 'w-full max-w-xl'
  if (/(?:_type|^id$|^world$|^protector$|^key$)/.test(key)) return 'w-72 max-w-full'
  return 'w-48 max-w-full'
}

const field_hint = (key: string): string | null => {
  if (key.endsWith('_bp')) return '10,000 = 100%'
  if (key === 'item_type') return 'content reference'
  if (key === 'mob_type') return 'mob reference'
  if (key === 'crit_1_in') return '1 in N · 0 disables'
  if (key === 'turns') return '0 = immediate'
  return null
}

const clone_json = (value: JsonValue): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

const empty_array_row = (key: string): JsonValue => {
  if (key === 'effects' || key === 'crit_effects')
    return Object.freeze({
      kind: 0,
      element: '',
      value: 0,
      value_max: 0,
      chance_bp: 10000,
      turns: 0,
      area_shape: 0,
      area_size: 0,
      target_filter: 0,
      stat: 0,
    })
  if (key === 'damages') return Object.freeze({ damage_type: 'weapon', element: 'earth', from: 1, to: 1 })
  if (key === 'loot') return Object.freeze({ item_type: '', chance_bp: 10000, min_qty: 1, max_qty: 1 })
  if (key === 'rewards') return Object.freeze({ item_type: '', weight: 1, amount: 1 })
  if (key === 'levels')
    return Object.freeze({
      ap_cost: 1,
      range_min: 0,
      range_max: 1,
      modifiable_range: false,
      line_of_sight: true,
      line_launch: false,
      free_cell: false,
      casts_per_turn: 0,
      casts_per_target: 0,
      cooldown_turns: 0,
      crit_1_in: 0,
      effects: Object.freeze([]),
      crit_effects: Object.freeze([]),
    })
  if (key === 'mobs') return Object.freeze({ mob_type: '', weight_bp: 1, biomes: Object.freeze([]) })
  if (key === 'resources') return Object.freeze({ item_type: '', biomes: Object.freeze([]) })
  if (key === 'whitelist' || key === 'biomes') return ''
  if (key === 'rooms') return Object.freeze([])
  return null
}

const PrimitiveEditor = ({
  field_key,
  value,
  read_only = false,
  compact = false,
  on_change,
}: Readonly<{
  field_key: string
  value: JsonValue
  read_only?: boolean
  compact?: boolean
  on_change: (value: JsonValue) => void
}>) => {
  if (typeof value === 'boolean')
    return (
      <label
        className={`inline-flex h-8 items-center gap-2 border px-2.5 text-[9px] ${
          value ? 'border-[#55c98b]/35 bg-[#55c98b]/8 text-[#82dba8]' : 'border-white/10 bg-black/20 text-[#777b86]'
        } ${read_only ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'}`}
      >
        <input
          checked={value}
          className="accent-[#55c98b]"
          disabled={read_only}
          onChange={(event) => on_change(event.target.checked)}
          type="checkbox"
        />
        {value ? 'Enabled' : 'Disabled'}
      </label>
    )
  if (typeof value === 'number')
    return (
      <input
        className={`${base_input} ${field_width(field_key, value, compact)} text-right tabular-nums`}
        disabled={read_only}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) on_change(next)
        }}
        step={Number.isInteger(value) ? 1 : 0.01}
        type="number"
        value={value}
      />
    )
  if (value === null)
    return (
      <button className={small_button} disabled={read_only} onClick={() => on_change('')} type="button">
        null · set value
      </button>
    )
  if (typeof value !== 'string') throw new TypeError(`Primitive editor received compound ${field_key}`)
  const options = options_for(field_key)
  if (options)
    return (
      <div className="flex items-center gap-2">
        {field_key === 'element' && <span className={`size-2.5 shrink-0 ${element_swatch(value)}`} />}
        <select
          className={`${base_input} ${field_width(field_key, value, compact)}`}
          disabled={read_only}
          onChange={(event) => on_change(event.target.value)}
          value={value}
        >
          {!options.includes(value) && <option value={value}>{value}</option>}
          {options.map((option) => (
            <option className="bg-bg" key={option} value={option}>
              {option || 'none'}
            </option>
          ))}
        </select>
      </div>
    )
  if (/^#[0-9a-f]{6}$/i.test(value))
    return (
      <div className="flex items-center gap-2">
        <input
          className="h-8 w-10 cursor-pointer border border-white/12 bg-transparent p-0.5 disabled:cursor-not-allowed"
          disabled={read_only}
          onChange={(event) => on_change(event.target.value)}
          type="color"
          value={value}
        />
        <input
          className={`${base_input} w-28 font-mono uppercase`}
          disabled={read_only}
          onChange={(event) => on_change(event.target.value)}
          spellCheck={false}
          value={value}
        />
      </div>
    )
  return value.length > 100 ? (
    <textarea
      className="min-h-20 w-full max-w-3xl resize-y border border-white/12 bg-bg p-2 text-[10px] leading-5 text-[#e3dfd7] outline-none focus:border-[#4a9eff]/70 disabled:opacity-55"
      disabled={read_only}
      onChange={(event) => on_change(event.target.value)}
      value={value}
    />
  ) : (
    <input
      className={`${base_input} ${field_width(field_key, value, compact)}`}
      disabled={read_only}
      onChange={(event) => on_change(event.target.value)}
      spellCheck={false}
      value={value}
    />
  )
}

const json_record = (value: JsonValue): Readonly<Record<string, JsonValue>> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

const stat_color = (stat: string): string => {
  if (stat === 'vitality') return 'bg-[#e86a73]'
  if (stat === 'strength' || stat === 'earth_resistance') return 'bg-[#b58a55]'
  if (stat === 'intelligence' || stat === 'fire_resistance') return 'bg-[#ef674d]'
  if (stat === 'chance' || stat === 'water_resistance') return 'bg-[#4a9eff]'
  if (stat === 'agility' || stat === 'air_resistance') return 'bg-[#65c993]'
  if (stat === 'wisdom') return 'bg-[#b584e8]'
  return 'bg-[#c8963c]'
}

const StatsEditor = ({
  value,
  path,
  on_change,
  is_readonly,
}: Readonly<{
  value: Readonly<Record<string, JsonValue>>
  path: JsonPath
  on_change: (path: JsonPath, value: JsonValue) => void
  is_readonly: (path: JsonPath) => boolean
}>) => {
  const minimum = json_record(value.min)
  const maximum = json_record(value.max)
  if (!minimum || !maximum) return null
  const stats = [...new Set([...Object.keys(minimum), ...Object.keys(maximum)])]
  return (
    <div className="grid gap-px overflow-hidden border border-white/8 bg-white/8 sm:grid-cols-2 xl:grid-cols-3">
      {stats.map((stat) => (
        <div className="bg-surface-low p-2.5" key={stat}>
          <div className="mb-2 flex items-center gap-2">
            <span className={`size-2 ${stat_color(stat)}`} />
            <span className="text-[8px] tracking-[0.1em] text-[#a7aab2] uppercase">{humanize(stat)}</span>
            <span className="ml-auto border border-white/7 bg-white/[0.025] px-1.5 py-0.5 text-[7px] tabular-nums text-[#777d88]">
              {item_stat_weight(stat, typeof maximum[stat] === 'number' ? maximum[stat] : 0)} weight
            </span>
          </div>
          <div className="flex items-center gap-2">
            <PrimitiveEditor
              compact
              field_key={stat}
              on_change={(next) => on_change([...path, 'min', stat], next)}
              read_only={is_readonly([...path, 'min', stat])}
              value={minimum[stat] ?? 0}
            />
            <span className="text-[8px] text-[#555b66] uppercase">to</span>
            <PrimitiveEditor
              compact
              field_key={stat}
              on_change={(next) => on_change([...path, 'max', stat], next)}
              read_only={is_readonly([...path, 'max', stat])}
              value={maximum[stat] ?? 0}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

const RangeEditor = ({
  value,
  path,
  on_change,
  is_readonly,
}: Readonly<{
  value: Readonly<Record<string, JsonValue>>
  path: JsonPath
  on_change: (path: JsonPath, value: JsonValue) => void
  is_readonly: (path: JsonPath) => boolean
}>) => {
  const from_key = 'from' in value ? 'from' : 'value'
  const to_key = 'to' in value ? 'to' : 'value_max'
  const excluded = new Set([from_key, to_key, 'element'])
  const rest = Object.entries(value).filter(([key]) => !excluded.has(key))
  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 border-l-2 border-[#4a9eff]/55 bg-[#4a9eff]/[0.035] p-2.5">
        <div>
          <p className="mb-1 text-[7px] tracking-[0.12em] text-[#666d78] uppercase">From</p>
          <PrimitiveEditor
            compact
            field_key={from_key}
            on_change={(next) => on_change([...path, from_key], next)}
            read_only={is_readonly([...path, from_key])}
            value={value[from_key] ?? 0}
          />
        </div>
        <span className="mb-2 text-[8px] text-[#59606b] uppercase">to</span>
        <div>
          <p className="mb-1 text-[7px] tracking-[0.12em] text-[#666d78] uppercase">To</p>
          <PrimitiveEditor
            compact
            field_key={to_key}
            on_change={(next) => on_change([...path, to_key], next)}
            read_only={is_readonly([...path, to_key])}
            value={value[to_key] ?? 0}
          />
        </div>
        {'element' in value && (
          <div>
            <p className="mb-1 text-[7px] tracking-[0.12em] text-[#666d78] uppercase">Element</p>
            <PrimitiveEditor
              field_key="element"
              on_change={(next) => on_change([...path, 'element'], next)}
              read_only={is_readonly([...path, 'element'])}
              value={value.element}
            />
          </div>
        )}
      </div>
      {rest.length > 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map(([key, child]) => (
            <Field
              key={key}
              field_key={key}
              is_readonly={is_readonly}
              on_change={on_change}
              path={[...path, key]}
              value={child}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type SectionId = 'identity' | 'progression' | 'combat' | 'economy' | 'world' | 'presentation' | 'other'

const section_for = (key: string): SectionId => {
  if (/^(?:item_type|mob_type|world|id|name|category|classe|job|role|element|kind|output_type|key)$/.test(key))
    return 'identity'
  if (/^(?:level|level_min|level_max|unlock_level|tier|xp)$/.test(key)) return 'progression'
  if (/^(?:stats|damages|resistances|spells|levels|hp|ap|mp|agility|wisdom)$/.test(key)) return 'combat'
  if (/^(?:inputs|loot|rewards|price|supply|consumable)$/.test(key)) return 'economy'
  if (/^(?:terrain|mobs|resources|dungeon|biomes)$/.test(key)) return 'world'
  if (/^(?:art|art_status|color|status|aura|aura_pending)$/.test(key)) return 'presentation'
  return 'other'
}

const sections = Object.freeze([
  Object.freeze({
    id: 'identity',
    label: 'Identity',
    note: 'Names, stable references, and classification',
    tone: 'border-[#c8963c]/45 text-[#efbd45] bg-[#c8963c]/[0.035]',
  }),
  Object.freeze({
    id: 'progression',
    label: 'Progression',
    note: 'Level, tier, and experience values',
    tone: 'border-[#b584e8]/40 text-[#cda5ef] bg-[#b584e8]/[0.035]',
  }),
  Object.freeze({
    id: 'combat',
    label: 'Combat',
    note: 'Stats, ranges, resistances, and spell behavior',
    tone: 'border-[#e86a73]/40 text-[#ef8e96] bg-[#e86a73]/[0.03]',
  }),
  Object.freeze({
    id: 'economy',
    label: 'Economy & rewards',
    note: 'Costs, supply, crafting, loot, and consumables',
    tone: 'border-[#65c993]/40 text-[#82dba8] bg-[#65c993]/[0.03]',
  }),
  Object.freeze({
    id: 'world',
    label: 'World population',
    note: 'Terrain, biomes, mobs, resources, and dungeons',
    tone: 'border-[#4a9eff]/40 text-[#78b7ff] bg-[#4a9eff]/[0.03]',
  }),
  Object.freeze({
    id: 'presentation',
    label: 'Presentation',
    note: 'Models, art, colors, and authored status',
    tone: 'border-[#e5a85b]/40 text-[#efbd7a] bg-[#e5a85b]/[0.03]',
  }),
  Object.freeze({
    id: 'other',
    label: 'Additional data',
    note: 'Fields preserved directly from the JSON corpus',
    tone: 'border-white/15 text-[#a7aab2] bg-white/[0.018]',
  }),
] as const)

const array_row_label = (field_key: string, index: number): string => {
  const singular = field_key.endsWith('ies')
    ? `${field_key.slice(0, -3)}y`
    : field_key.endsWith('s')
      ? field_key.slice(0, -1)
      : 'row'
  return `${humanize(singular)} ${index + 1}`
}

const Field = ({
  field_key,
  value,
  path,
  depth = 0,
  on_change,
  is_readonly,
}: Readonly<{
  field_key: string
  value: JsonValue
  path: JsonPath
  depth?: number
  on_change: (path: JsonPath, value: JsonValue) => void
  is_readonly: (path: JsonPath) => boolean
}>) => {
  const compound = value !== null && typeof value === 'object'
  if (compound) {
    const stats =
      field_key === 'stats' ? StatsEditor({ value: json_record(value) ?? {}, path, on_change, is_readonly }) : null
    if (stats) return <div className="col-span-full">{stats}</div>
    return (
      <details className="col-span-full border border-white/10 bg-black/15" open={depth < 2}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-l-2 border-[#4a9eff]/45 px-3 py-2.5">
          <span className="text-[9px] tracking-[0.13em] text-[#d6d1c8] uppercase">{humanize(field_key)}</span>
          <span className="text-[8px] tabular-nums text-[#656a74]">
            {Array.isArray(value) ? value.length : Object.keys(value).length} {Array.isArray(value) ? 'rows' : 'fields'}
          </span>
        </summary>
        <div className="border-t border-white/8 p-3">
          <JsonEditor
            depth={depth + 1}
            field_key={field_key}
            is_readonly={is_readonly}
            on_change={on_change}
            path={path}
            value={value}
          />
        </div>
      </details>
    )
  }
  const read_only = is_readonly(path)
  const hint = field_hint(field_key)
  return (
    <div
      className={`min-w-0 border-l-2 p-2.5 ${read_only ? 'border-[#c8963c]/55 bg-[#c8963c]/[0.035]' : 'border-white/8 bg-black/15'}`}
    >
      <div className="mb-2 flex min-h-3 items-center gap-2">
        <span className="text-[8px] tracking-[0.1em] text-[#a7aab2] uppercase">{humanize(field_key)}</span>
        {hint && <span className="text-[7px] text-[#555b66]">{hint}</span>}
        {read_only && (
          <span className="ml-auto text-[7px] tracking-[0.1em] text-[#c8963c] uppercase">Locked identity</span>
        )}
      </div>
      <PrimitiveEditor
        field_key={field_key}
        on_change={(next) => on_change(path, next)}
        read_only={read_only}
        value={value}
      />
    </div>
  )
}

export const JsonEditor = ({
  value,
  path = [],
  field_key = 'root',
  depth = 0,
  on_change,
  is_readonly = never_readonly,
}: Readonly<{
  value: JsonValue
  path?: JsonPath
  field_key?: string
  depth?: number
  on_change: (path: JsonPath, value: JsonValue) => void
  is_readonly?: (path: JsonPath) => boolean
}>) => {
  if (value === null || typeof value !== 'object')
    return (
      <PrimitiveEditor
        field_key={field_key}
        on_change={(next) => on_change(path, next)}
        read_only={is_readonly(path)}
        value={value}
      />
    )
  if (Array.isArray(value))
    return (
      <div className="space-y-2">
        {value.map((row, index) => (
          <div className="border border-white/9 bg-bg" key={`${path.join('.')}-${index}`}>
            <div className="flex items-center justify-between gap-2 border-b border-white/7 px-2.5 py-2">
              <span className="text-[8px] tracking-[0.12em] text-[#7f8490] uppercase">
                {array_row_label(field_key, index)}
              </span>
              <button
                className={small_button}
                onClick={() => on_change(path, Object.freeze(value.filter((_, row_index) => row_index !== index)))}
                type="button"
              >
                Remove
              </button>
            </div>
            <div className="p-2.5">
              <JsonEditor
                depth={depth + 1}
                field_key={field_key}
                is_readonly={is_readonly}
                on_change={on_change}
                path={[...path, index]}
                value={row}
              />
            </div>
          </div>
        ))}
        <button
          className={small_button}
          onClick={() =>
            on_change(
              path,
              Object.freeze([...value, clone_json(value[value.length - 1] ?? empty_array_row(field_key))])
            )
          }
          type="button"
        >
          Add {array_row_label(field_key, 0).replace(/ 1$/, '')}
        </button>
      </div>
    )
  const record = value as Readonly<Record<string, JsonValue>>
  if (
    (typeof record.from === 'number' && typeof record.to === 'number') ||
    (typeof record.value === 'number' && typeof record.value_max === 'number')
  )
    return <RangeEditor is_readonly={is_readonly} on_change={on_change} path={path} value={record} />
  const entries = Object.entries(record)
  if (depth === 0)
    return (
      <div className="space-y-4">
        {sections.map((section) => {
          const section_entries = entries.filter(([key]) => section_for(key) === section.id)
          if (section_entries.length === 0) return null
          return (
            <section className={`border ${section.tone}`} key={section.id}>
              <header className="border-b border-current/15 px-3 py-2.5">
                <h2 className="text-[9px] tracking-[0.16em] uppercase">{section.label}</h2>
                <p className="mt-1 text-[7px] normal-case text-[#666b75]">{section.note}</p>
              </header>
              <div className="grid gap-2 p-3 sm:grid-cols-2 2xl:grid-cols-3">
                {section_entries.map(([key, child]) => (
                  <Field
                    depth={depth}
                    field_key={key}
                    is_readonly={is_readonly}
                    key={key}
                    on_change={on_change}
                    path={[...path, key]}
                    value={child}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    )
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map(([key, child]) => (
        <Field
          depth={depth}
          field_key={key}
          is_readonly={is_readonly}
          key={key}
          on_change={on_change}
          path={[...path, key]}
          value={child}
        />
      ))}
    </div>
  )
}

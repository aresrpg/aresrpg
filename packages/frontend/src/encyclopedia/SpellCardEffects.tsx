// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable complexity, max-lines -- this exhaustive effect presenter keeps the effect-kind mapping in one visible home. */
import { AREA_SHAPES, CHANNELS, EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'
import { element_names } from '@aresrpg/immutable'
import { Crosshair, Footprints, Sparkles, Zap, type LucideIcon } from 'lucide-react'
import { useState, type FocusEvent, type ReactNode } from 'react'

import type { EffectLineView } from '../components/EffectLine.tsx'
import type { SpellEffect, SpellLevel } from '../content/catalog.ts'
import { titleize } from '../content/catalog.ts'
import { element_colors, stat_colors, stat_identities } from '../visual_identity.ts'
export type SpellCardPath = readonly (string | number)[]
export type SpellCardValue =
  string | number | boolean | null | readonly SpellCardValue[] | Readonly<{ [key: string]: SpellCardValue }>
export type SpellCardEdit = Readonly<{
  change: (path: SpellCardPath, value: SpellCardValue) => void
  save: () => void
}>
const field_class =
  'h-7 border border-white/12 bg-[#090a10] px-1.5 text-[9px] text-[#e8e4dc] outline-none focus:border-[#c8963c]/60'
const reverse = (values: Readonly<Record<string, bigint>>): Readonly<Record<number, string>> =>
  Object.freeze(Object.fromEntries(Object.entries(values).map(([name, value]) => [Number(value), name])))
const effect_kinds = reverse(EFFECT_KINDS)
const area_shapes = reverse(AREA_SHAPES)
const channels = reverse(CHANNELS)
const target_filters = reverse(TARGET_FILTERS)
const effect_options = Object.entries(EFFECT_KINDS).map(([name, value]) => [titleize(name), Number(value)] as const)
const shape_options = Object.entries(AREA_SHAPES).map(([name, value]) => [titleize(name), Number(value)] as const)
const target_options = Object.entries(TARGET_FILTERS).map(([name, value]) => [titleize(name), Number(value)] as const)
const stat_options = Object.entries(CHANNELS).map(([name, value]) => [titleize(name), Number(value)] as const)
const element_options = ['', ...element_names].map((value) => [value ? titleize(value) : 'None', value] as const)
export const effect_color = (element: string): string => element_colors[element] ?? '#b8b4ac'
const element_stats: Readonly<Record<string, string>> = Object.freeze({
  earth: 'strength',
  fire: 'intelligence',
  water: 'chance',
  air: 'agility',
})
const channel_icons: Readonly<Record<string, LucideIcon>> = Object.freeze({
  ap: Zap,
  mp: Footprints,
  range: Crosshair,
  critical: Sparkles,
})
const area_masks: Readonly<Record<string, readonly string[]>> = Object.freeze({
  circle: Object.freeze(['00100', '01110', '11111', '01110', '00100']),
  cross: Object.freeze(['00100', '00100', '11111', '00100', '00100']),
  line: Object.freeze(['00100', '00100', '00100', '00100', '00100']),
  tbar: Object.freeze(['00000', '01110', '00100', '00100', '00100']),
  ring: Object.freeze(['11111', '10001', '10001', '10001', '11111']),
  allmap: Object.freeze(['11111', '11111', '11111', '11111', '11111']),
  cone: Object.freeze(['00100', '01110', '11111', '00000', '00000']),
  podium: Object.freeze(['00100', '00100', '01110', '11111', '00000']),
  blob: Object.freeze(['00100', '01110', '01110', '00100', '00000']),
})
const NumberField = ({
  value,
  change,
  label,
  auto_focus = true,
  width = 'w-12',
}: Readonly<{
  value: number
  change: (value: number) => void
  label: string
  auto_focus?: boolean
  width?: string
}>) => (
  <input
    aria-label={label}
    autoFocus={auto_focus}
    className={`${field_class} ${width} tabular-nums`}
    onChange={(event) => change(Number(event.target.value))}
    type="number"
    value={value}
  />
)

const SelectField = ({
  value,
  options,
  change,
  label,
  width = 'w-28',
}: Readonly<{
  value: string | number
  options: readonly (readonly [string, string | number])[]
  change: (value: string | number) => void
  label: string
  width?: string
}>) => (
  <select
    aria-label={label}
    autoFocus
    className={`${field_class} ${width}`}
    onChange={(event) => {
      const option = options.find(([, option_value]) => String(option_value) === event.target.value)
      if (option) change(option[1])
    }}
    value={value}
  >
    {options.map(([option_label, option_value]) => (
      <option key={String(option_value)} value={option_value}>
        {option_label}
      </option>
    ))}
  </select>
)

const InlineEffectField = ({
  label,
  edit,
  display,
  editor,
  class_name = '',
}: Readonly<{
  label: string
  edit?: SpellCardEdit
  display: ReactNode
  editor: ReactNode
  class_name?: string
}>) => {
  const [editing, set_editing] = useState(false)
  const finish = (event: Readonly<FocusEvent<HTMLSpanElement>>): void => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return
    set_editing(false)
    edit?.save()
  }
  if (!edit) return class_name ? <span className={class_name}>{display}</span> : display
  if (editing)
    return (
      <span className={`inline-flex items-center gap-1 ${class_name}`} onBlur={finish}>
        {editor}
      </span>
    )
  return (
    <button
      aria-label={`Edit ${label}`}
      className={`inline-flex cursor-text items-center gap-1 text-left hover:bg-white/[0.05] ${class_name}`}
      data-spell-effect-field={label}
      onClick={() => set_editing(true)}
      type="button"
    >
      {display}
    </button>
  )
}

const AreaGlyph = ({ shape, size }: Readonly<{ shape: number; size: number }>) => {
  const name = area_shapes[shape]
  const mask = name ? area_masks[name] : null
  if (!mask || (name !== 'allmap' && size <= 0)) return null
  return (
    <span className="inline-flex items-center gap-1" title={titleize(name)}>
      <span aria-hidden="true" className="grid grid-cols-5 gap-px">
        {mask.flatMap((row, row_index) =>
          [...row].map((cell, column_index) => (
            <span
              className={`size-1 ${cell === '1' ? 'bg-[#8fc4ff]' : 'bg-white/8'}`}
              key={`${column_index}:${row_index}`}
            />
          ))
        )}
      </span>
      <span className="text-[9px] font-semibold tabular-nums text-[#8fc4ff]">{size}</span>
    </span>
  )
}

const effect_identity = (effect: SpellEffect): Readonly<{ icon: string; label: string; tint: string }> | null => {
  const channel = channels[effect.stat]
  const identity = stat_identities[element_stats[effect.element] ?? channel]
  return identity
    ? Object.freeze({
        icon: identity.icon,
        label: effect.element || titleize(channel ?? ''),
        tint: effect.element ? effect_color(effect.element) : (stat_colors[channel] ?? identity.tint),
      })
    : null
}

const effect_range = ({ value, value_max }: SpellEffect): string =>
  value === value_max ? String(value) : `${value} to ${value_max}`

// Percent-valued effects: %-of-max-hp damage, and resistance rows (resistance IS a percent
// reduction of final damage) — the suffix states the unit wherever the number shows.
const effect_value_suffix = (effect: SpellEffect): string =>
  effect_kinds[effect.kind] === 'pct_life' || channels[effect.stat] === 'resist' ? '%' : ''

const effect_words = (
  effect: SpellEffect
): Readonly<{ action: string; suffix: string; amount: boolean; stat: boolean }> => {
  const kind = effect_kinds[effect.kind] ?? `effect ${effect.kind}`
  if (kind === 'damage') return { action: 'Deals', suffix: 'damage', amount: true, stat: false }
  if (kind === 'pct_life')
    return { action: 'Deals', suffix: "of the target's maximum HP as damage", amount: true, stat: false }
  if (kind === 'caster_damage') return { action: 'Inflicts', suffix: 'damage on yourself', amount: true, stat: false }
  if (kind === 'punishment')
    return { action: 'Deals', suffix: 'damage, increased by missing HP', amount: true, stat: false }
  if (kind === 'add' && channels[effect.stat] === 'hp')
    return { action: 'Heals', suffix: 'HP', amount: true, stat: false }
  if (kind === 'add') return { action: 'Adds', suffix: '', amount: true, stat: true }
  if (kind === 'remove' && channels[effect.stat] === 'hp')
    return { action: 'Deals', suffix: 'damage', amount: true, stat: false }
  if (kind === 'remove') return { action: 'Removes', suffix: '', amount: true, stat: true }
  if (kind === 'steal') return { action: 'Steals', suffix: '', amount: true, stat: true }
  if (kind === 'reduce') return { action: 'Reduces damage by', suffix: '', amount: true, stat: false }
  if (kind === 'reflect') return { action: 'Reflects', suffix: 'damage', amount: true, stat: false }
  if (kind === 'push') return { action: 'Pushes', suffix: 'cells', amount: true, stat: false }
  if (kind === 'pull') return { action: 'Pulls', suffix: 'cells', amount: true, stat: false }
  if (kind === 'teleport') return { action: 'Teleports', suffix: 'cells', amount: true, stat: false }
  if (kind === 'swap') return { action: 'Swaps positions', suffix: '', amount: false, stat: false }
  if (kind === 'trap') return { action: 'Places a trap', suffix: '', amount: false, stat: false }
  if (kind === 'glyph') return { action: 'Places a glyph', suffix: '', amount: false, stat: false }
  if (kind === 'dispel') return { action: 'Dispels effects', suffix: '', amount: false, stat: false }
  if (kind === 'invis') return { action: 'Makes the target invisible', suffix: '', amount: false, stat: false }
  // the threshold derives from the invested level at cast time — the authored value is unused
  if (kind === 'return')
    return { action: "Returns spells (up to this spell's level)", suffix: '', amount: false, stat: false }
  return { action: titleize(kind), suffix: '', amount: true, stat: false }
}

const target_note = (filter: number): string | null => {
  const target = target_filters[filter]
  if (target === 'not_team') return 'enemies only'
  if (target === 'not_enemy') return 'allies only'
  if (target === 'not_self') return 'others only'
  if (target === 'only_caster') return 'caster only'
  return null
}

const critical_delta = (normal: SpellEffect, critical: SpellEffect): string | null => {
  const critical_range = `${effect_range(critical)}${effect_value_suffix(critical)}`
  const changes = [
    (normal.value !== critical.value || normal.value_max !== critical.value_max) && critical_range,
    normal.turns !== critical.turns && `${critical.turns} turn${critical.turns === 1 ? '' : 's'}`,
    normal.chance_bp !== critical.chance_bp && `${critical.chance_bp / 100}%`,
    normal.area_size !== critical.area_size && `area ${critical.area_size}`,
    normal.area_shape !== critical.area_shape && titleize(area_shapes[critical.area_shape] ?? ''),
    normal.kind !== critical.kind && titleize(effect_kinds[critical.kind] ?? ''),
    normal.element !== critical.element && titleize(critical.element),
    normal.stat !== critical.stat && titleize(channels[critical.stat] ?? ''),
  ].filter(Boolean)
  return changes.length > 0 ? changes.join(' · ') : null
}

type EffectUpdate = (field: keyof SpellEffect, value: SpellCardValue) => void

const CriticalEditor = ({
  normal,
  critical,
  update,
}: Readonly<{ normal: SpellEffect; critical: SpellEffect; update: EffectUpdate }>) => (
  <>
    {(normal.value !== critical.value || normal.value_max !== critical.value_max) && (
      <>
        <NumberField change={(value) => update('value', value)} label="Critical power from" value={critical.value} />
        <span className="text-[#777b86]">to</span>
        <NumberField
          auto_focus={false}
          change={(value) => update('value_max', value)}
          label="Critical power to"
          value={critical.value_max}
        />
      </>
    )}
    {normal.turns !== critical.turns && (
      <NumberField change={(value) => update('turns', value)} label="Critical turns" value={critical.turns} />
    )}
    {normal.chance_bp !== critical.chance_bp && (
      <NumberField
        change={(value) => update('chance_bp', value)}
        label="Critical chance basis points"
        value={critical.chance_bp}
        width="w-16"
      />
    )}
    {normal.area_shape !== critical.area_shape && (
      <SelectField
        change={(value) => update('area_shape', value)}
        label="Critical area shape"
        options={shape_options}
        value={critical.area_shape}
      />
    )}
    {normal.area_size !== critical.area_size && (
      <NumberField
        change={(value) => update('area_size', value)}
        label="Critical area size"
        value={critical.area_size}
      />
    )}
    {normal.kind !== critical.kind && (
      <SelectField
        change={(value) => update('kind', value)}
        label="Critical effect kind"
        options={effect_options}
        value={critical.kind}
      />
    )}
    {normal.element !== critical.element && (
      <SelectField
        change={(value) => update('element', value)}
        label="Critical element"
        options={element_options}
        value={critical.element}
      />
    )}
    {normal.stat !== critical.stat && (
      <SelectField
        change={(value) => update('stat', value)}
        label="Critical stat"
        options={stat_options}
        value={critical.stat}
      />
    )}
  </>
)
type SpellEffectLineProps = Readonly<{
  effect: SpellEffect
  critical?: SpellEffect
  critical_only?: boolean
  edit?: SpellCardEdit
  update: EffectUpdate
  update_critical?: EffectUpdate
}>
export const spell_effect_line_view = (effect: SpellEffect, critical_only = false): EffectLineView => {
  const identity = effect_identity(effect)
  const channel = channels[effect.stat] ?? ''
  const ChannelIcon = channel_icons[channel]
  const color = identity?.tint ?? stat_colors[channel] ?? effect_color(effect.element)
  const words = effect_words(effect)
  const kind = effect_kinds[effect.kind]
  const target = kind === 'caster_damage' ? null : target_note(effect.target_filter)
  const meta = [
    effect.turns > 0 ? `${effect.turns} turn${effect.turns === 1 ? '' : 's'}` : null,
    effect.chance_bp < 10000 ? `${effect.chance_bp / 100}%` : null,
    critical_only ? 'critical only' : null,
  ].filter(Boolean)
  return Object.freeze({
    ...(effect.element ? { dot: color } : identity ? { icon: identity.icon } : {}),
    ...(effect.element || identity || !ChannelIcon ? {} : { glyph: <ChannelIcon size={15} strokeWidth={1.6} /> }),
    pre: `${words.action}${words.amount ? ' ' : ''}`,
    value: words.amount ? `${effect_range(effect)}${effect_value_suffix(effect)}` : null,
    tone: color,
    post: [words.suffix, words.stat ? titleize(channel) : '', target ? `(${target})` : '']
      .filter(Boolean)
      .map((part) => ` ${part}`)
      .join(''),
    meta: meta.length > 0 ? meta.join(' · ') : null,
  })
}

export const SpellEffectLine = ({
  effect,
  critical,
  critical_only = false,
  edit,
  update,
  update_critical,
}: SpellEffectLineProps) => {
  const identity = effect_identity(effect)
  const channel = channels[effect.stat] ?? ''
  const ChannelIcon = channel_icons[channel]
  const color = identity?.tint ?? stat_colors[channel] ?? effect_color(effect.element)
  const words = effect_words(effect)
  const kind = effect_kinds[effect.kind]
  const target_editable = kind !== 'caster_damage'
  const target = target_editable ? target_note(effect.target_filter) : null
  const difference = critical ? critical_delta(effect, critical) : null
  const icon = identity ? (
    <img alt="" className="size-5 object-contain" src={identity.icon} title={identity.label} />
  ) : ChannelIcon ? (
    <span className="grid size-5 place-items-center" style={{ color }} title={titleize(channel)}>
      <ChannelIcon size={15} strokeWidth={1.6} />
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="size-2 rounded-full"
      style={{ backgroundColor: effect_color(effect.element) }}
    />
  )
  return (
    <div className="flex min-h-11 w-full flex-wrap items-center gap-2 border-b border-white/6 px-1 py-2.5 text-[10px] last:border-b-0">
      <InlineEffectField
        display={icon}
        edit={edit}
        editor={
          <SelectField
            change={(value) => update('element', value)}
            label="Element"
            options={element_options}
            value={effect.element}
          />
        }
        label="element"
      />
      <span className="inline-flex items-center gap-1 text-[#bbb7b0]">
        <InlineEffectField
          display={words.action}
          edit={edit}
          editor={
            <SelectField
              change={(value) => update('kind', value)}
              label="Effect kind"
              options={effect_options}
              value={effect.kind}
            />
          }
          label="effect kind"
        />
        {words.amount && (
          <InlineEffectField
            class_name="font-semibold"
            display={
              <span style={{ color }}>
                {effect_range(effect)}
                {effect_value_suffix(effect)}
              </span>
            }
            edit={edit}
            editor={
              <>
                <NumberField change={(value) => update('value', value)} label="Power from" value={effect.value} />
                <span className="font-normal text-[#777b86]">to</span>
                <NumberField
                  auto_focus={false}
                  change={(value) => update('value_max', value)}
                  label="Power to"
                  value={effect.value_max}
                />
              </>
            }
            label="effect power"
          />
        )}
        {words.suffix && (
          <InlineEffectField
            display={words.suffix}
            edit={edit}
            editor={
              <SelectField
                change={(value) => update('kind', value)}
                label="Effect kind"
                options={effect_options}
                value={effect.kind}
              />
            }
            label="effect kind"
          />
        )}
        {words.stat && (
          <InlineEffectField
            display={titleize(channel)}
            edit={edit}
            editor={
              <SelectField
                change={(value) => update('stat', value)}
                label="Stat"
                options={stat_options}
                value={effect.stat}
              />
            }
            label="stat"
          />
        )}
      </span>
      {(edit || effect.area_size > 0 || area_shapes[effect.area_shape] === 'allmap') &&
        area_masks[area_shapes[effect.area_shape] ?? ''] && (
          <InlineEffectField
            display={<AreaGlyph shape={effect.area_shape} size={effect.area_size} />}
            edit={edit}
            editor={
              <>
                <SelectField
                  change={(value) => update('area_shape', value)}
                  label="Area shape"
                  options={shape_options}
                  value={effect.area_shape}
                />
                <NumberField
                  change={(value) => update('area_size', value)}
                  label="Area size"
                  value={effect.area_size}
                />
              </>
            }
            label="area"
          />
        )}
      {target_editable && (target || edit) && (
        <InlineEffectField
          class_name="text-[8px] text-[#858994]"
          display={`(${target ?? 'any target'})`}
          edit={edit}
          editor={
            <SelectField
              change={(value) => update('target_filter', value)}
              label="Target"
              options={target_options}
              value={effect.target_filter}
            />
          }
          label="target"
        />
      )}
      {effect.turns > 0 && (
        <InlineEffectField
          class_name="text-[9px] font-semibold text-[#d9b86c]"
          display={`for ${effect.turns} turn${effect.turns === 1 ? '' : 's'}`}
          edit={edit}
          editor={<NumberField change={(value) => update('turns', value)} label="Turns" value={effect.turns} />}
          label="duration"
        />
      )}
      {effect.chance_bp < 10000 && (
        <InlineEffectField
          class_name="text-[8px] text-[#858994]"
          display={`· ${effect.chance_bp / 100}%`}
          edit={edit}
          editor={
            <NumberField
              change={(value) => update('chance_bp', value)}
              label="Chance basis points"
              value={effect.chance_bp}
              width="w-16"
            />
          }
          label="chance"
        />
      )}
      {(critical_only || difference) && (
        <InlineEffectField
          display={
            <span className="inline-flex min-h-8 items-center gap-2 border border-[#e8b44f]/35 bg-[linear-gradient(90deg,rgba(232,180,79,0.12),rgba(232,180,79,0.03))] px-2.5 py-1">
              <span className="text-[7px] font-semibold tracking-[0.12em] text-[#e8b44f] uppercase">Critical</span>
              <span className="text-[9px] font-semibold text-[#f2cf84]">{difference ?? 'Only'}</span>
            </span>
          }
          edit={critical && update_critical ? edit : undefined}
          editor={
            critical && update_critical ? (
              <CriticalEditor critical={critical} normal={effect} update={update_critical} />
            ) : null
          }
          label="critical effect"
        />
      )}
    </div>
  )
}

export const EffectLines = ({
  effects,
  critical_effects,
  level_index,
  compact = false,
  edit,
}: Readonly<{
  effects: SpellLevel['effects']
  critical_effects: SpellLevel['crit_effects']
  level_index: number
  compact?: boolean
  edit?: SpellCardEdit
}>) => {
  const update =
    (key: 'effects' | 'crit_effects', index: number): EffectUpdate =>
    (field, value) => {
      edit?.change(['levels', level_index, key, index, field], value)
      if (
        key === 'effects' &&
        field === 'target_filter' &&
        effects.length === critical_effects.length &&
        critical_effects[index]
      )
        edit?.change(['levels', level_index, 'crit_effects', index, field], value)
    }
  return (
    <div
      className={compact ? 'space-y-0.5 [&>div]:!min-h-0 [&>div]:!border-b-0 [&>div]:!py-1' : 'space-y-2'}
      {...(compact ? { 'data-spell-effects-compact': '' } : {})}
    >
      {effects.map((effect, index) => (
        <SpellEffectLine
          critical={critical_effects[index]}
          edit={edit}
          effect={effect}
          key={`effect-${index}`}
          update={update('effects', index)}
          update_critical={critical_effects[index] ? update('crit_effects', index) : undefined}
        />
      ))}
      {critical_effects.slice(effects.length).map((effect, offset) => {
        const index = effects.length + offset
        return (
          <SpellEffectLine
            critical_only
            edit={edit}
            effect={effect}
            key={`critical-${index}`}
            update={update('crit_effects', index)}
          />
        )
      })}
    </div>
  )
}

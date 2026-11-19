// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Spell effect authoring: the content editor's field editors and line controls.

import { AREA_SHAPES, CHANNELS, CONTRACT_CONSTANTS, EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'
import { element_names } from '@aresrpg/immutable'
import { useState, type FocusEvent, type ReactNode } from 'react'

import type { SpellEffect, SpellLevel } from '../content/catalog.ts'
import { titleize } from '../content/catalog.ts'

export type SpellCardPath = readonly (string | number)[]
export type SpellCardValue =
  string | number | boolean | null | readonly SpellCardValue[] | Readonly<{ [key: string]: SpellCardValue }>
export type SpellCardEdit = Readonly<{
  change: (path: SpellCardPath, value: SpellCardValue) => void
  save: () => void
}>
const field_class = 'h-7 border border-white/12 bg-bg px-1.5 text-[9px] text-text outline-none focus:border-gold/60'
const effect_options = Object.entries(EFFECT_KINDS).map(([name, value]) => [titleize(name), Number(value)] as const)
const shape_options = Object.entries(AREA_SHAPES).map(([name, value]) => [titleize(name), Number(value)] as const)
const target_options = Object.entries(TARGET_FILTERS).map(([name, value]) => [titleize(name), Number(value)] as const)
const stat_options = Object.entries(CHANNELS).map(([name, value]) => [titleize(name), Number(value)] as const)
const element_options = ['', ...element_names].map((value) => [value ? titleize(value) : 'None', value] as const)
const CHATIMENT_TURNS = Number(CONTRACT_CONSTANTS.chatiment_turns)
const instant_effect_kinds = Object.freeze([
  Number(EFFECT_KINDS.damage),
  Number(EFFECT_KINDS.pct_life),
  Number(EFFECT_KINDS.caster_damage),
  Number(EFFECT_KINDS.punishment),
  Number(EFFECT_KINDS.push),
  Number(EFFECT_KINDS.pull),
  Number(EFFECT_KINDS.teleport),
  Number(EFFECT_KINDS.swap),
  Number(EFFECT_KINDS.trap),
  Number(EFFECT_KINDS.dispel),
])
const timed_effect_kinds = Object.freeze([
  Number(EFFECT_KINDS.chatiment),
  Number(EFFECT_KINDS.glyph),
  Number(EFFECT_KINDS.reduce),
  Number(EFFECT_KINDS.reflect),
  Number(EFFECT_KINDS.invis),
  Number(EFFECT_KINDS.return),
  Number(EFFECT_KINDS.redirect),
])
const element_options_for = (kind: number): readonly (readonly [string, string])[] =>
  kind === Number(EFFECT_KINDS.reduce)
    ? element_options.map(([label, value]) => [value === '' ? 'All elements' : label, value] as const)
    : element_options
export const duration_editable_for = (kind: number): boolean =>
  kind !== Number(EFFECT_KINDS.chatiment) && !instant_effect_kinds.includes(kind)
const blank_effect: SpellEffect = Object.freeze({
  kind: Number(EFFECT_KINDS.damage),
  element: 'earth',
  value: 1,
  value_max: 1,
  area_shape: Number(AREA_SHAPES.point),
  area_size: 0,
  target_filter: Number(TARGET_FILTERS.not_team),
  chance_bp: 10_000,
  turns: 0,
  stat: 0,
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

export const InlineEffectField = ({
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
  if (!edit) return <span className={class_name || undefined}>{display}</span>
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

export type EffectUpdate = (field: keyof SpellEffect, value: SpellCardValue) => void

/** A kind change also normalises the duration the new kind requires. */
const kind_change =
  (update: EffectUpdate, turns: number) =>
  (value: string | number): void => {
    const next = Number(value)
    update('kind', next)
    if (instant_effect_kinds.includes(next) && turns !== 0) update('turns', 0)
    if (next === Number(EFFECT_KINDS.chatiment) && turns !== CHATIMENT_TURNS) update('turns', CHATIMENT_TURNS)
    else if (timed_effect_kinds.includes(next) && turns === 0) update('turns', 1)
  }

const CriticalEditor = ({ critical, update }: Readonly<{ critical: SpellEffect; update: EffectUpdate }>) => (
  <>
    <SelectField
      change={kind_change(update, critical.turns)}
      label="Critical effect kind"
      options={effect_options}
      value={critical.kind}
    />
    <SelectField
      change={(value) => update('element', value)}
      label="Critical element"
      options={element_options}
      value={critical.element}
    />
    <NumberField change={(value) => update('value', value)} label="Critical power from" value={critical.value} />
    <span className="text-faint">to</span>
    <NumberField
      auto_focus={false}
      change={(value) => update('value_max', value)}
      label="Critical power to"
      value={critical.value_max}
    />
    <SelectField
      change={(value) => update('stat', value)}
      label="Critical stat"
      options={stat_options}
      value={critical.stat}
    />
    <SelectField
      change={(value) => update('area_shape', value)}
      label="Critical area shape"
      options={shape_options}
      value={critical.area_shape}
    />
    <NumberField change={(value) => update('area_size', value)} label="Critical area size" value={critical.area_size} />
    {duration_editable_for(critical.kind) && (
      <NumberField change={(value) => update('turns', value)} label="Critical turns" value={critical.turns} />
    )}
    <NumberField
      change={(value) => update('chance_bp', value)}
      label="Critical chance basis points"
      value={critical.chance_bp}
      width="w-16"
    />
  </>
)

export type EffectEditor = Readonly<{ label: string; editor: ReactNode; editable?: boolean }>

export const effect_editors = (
  { key, effect, critical }: Readonly<{ key: string; effect: SpellEffect; critical?: SpellEffect }>,
  update: EffectUpdate,
  update_critical: EffectUpdate | undefined
): Readonly<Record<string, EffectEditor>> => {
  const kind = (
    <SelectField
      change={kind_change(update, effect.turns)}
      label="Effect kind"
      options={effect_options}
      value={effect.kind}
    />
  )
  return {
    [`${key}:element`]: {
      label: 'element',
      editor: (
        <SelectField
          change={(value) => update('element', value)}
          label="Element"
          options={element_options_for(effect.kind)}
          value={effect.element}
        />
      ),
    },
    [`${key}:kind`]: { label: 'effect kind', editor: kind },
    [`${key}:suffix`]: { label: 'effect kind', editor: kind },
    [`${key}:power`]: {
      label: 'effect power',
      editor: (
        <>
          <NumberField change={(value) => update('value', value)} label="Power from" value={effect.value} />
          <span className="font-normal text-faint">to</span>
          <NumberField
            auto_focus={false}
            change={(value) => update('value_max', value)}
            label="Power to"
            value={effect.value_max}
          />
        </>
      ),
    },
    [`${key}:stat`]: {
      label: 'stat',
      editor: (
        <SelectField
          change={(value) => update('stat', value)}
          label="Stat"
          options={stat_options}
          value={effect.stat}
        />
      ),
    },
    [`${key}:area`]: {
      label: 'area',
      editor: (
        <>
          <SelectField
            change={(value) => update('area_shape', value)}
            label="Area shape"
            options={shape_options}
            value={effect.area_shape}
          />
          <NumberField change={(value) => update('area_size', value)} label="Area size" value={effect.area_size} />
        </>
      ),
    },
    [`${key}:target`]: {
      label: 'target',
      editor: (
        <SelectField
          change={(value) => update('target_filter', value)}
          label="Target"
          options={target_options}
          value={effect.target_filter}
        />
      ),
    },
    [`${key}:duration`]: {
      label: 'duration',
      editable: duration_editable_for(effect.kind),
      editor: <NumberField change={(value) => update('turns', value)} label="Turns" value={effect.turns} />,
    },
    [`${key}:chance`]: {
      label: 'chance',
      editor: (
        <NumberField
          change={(value) => update('chance_bp', value)}
          label="Chance basis points"
          value={effect.chance_bp}
          width="w-16"
        />
      ),
    },
    [`${key}:critical`]: {
      label: 'critical effect',
      editable: Boolean(critical && update_critical),
      editor: critical && update_critical ? <CriticalEditor critical={critical} update={update_critical} /> : null,
    },
  }
}

export const RowActions = ({
  critical_only,
  add_critical,
  remove,
}: Readonly<{ critical_only: boolean; add_critical?: () => void; remove: () => void }>) => (
  <>
    {add_critical && (
      <button
        className="h-7 border border-gold/30 bg-gold/5 px-2 text-[7px] tracking-[0.1em] text-gold uppercase hover:border-gold/60"
        data-spell-add-critical-for=""
        onClick={add_critical}
        type="button"
      >
        + Crit
      </button>
    )}
    <button
      aria-label={critical_only ? 'Remove critical effect' : 'Remove effect'}
      className="ml-auto grid size-7 shrink-0 place-items-center text-[#873f55] hover:text-[#ff5a8b]"
      onClick={remove}
      type="button"
    >
      ×
    </button>
  </>
)

export const AddEffects = ({
  effects,
  critical_effects,
  level_index,
  edit,
}: Readonly<{
  effects: SpellLevel['effects']
  critical_effects: SpellLevel['crit_effects']
  level_index: number
  edit: SpellCardEdit
}>) => (
  <div className="flex items-center gap-2 border-t border-dashed border-white/8 pt-2">
    <button
      className="h-8 border border-cyan/25 bg-cyan/5 px-3 text-[8px] tracking-[0.12em] text-cyan uppercase hover:border-cyan/55"
      data-spell-add-effect=""
      onClick={() => edit.change(['levels', level_index, 'effects'], [...effects, blank_effect])}
      type="button"
    >
      + Effect
    </button>
    <button
      className="h-8 border border-gold/25 bg-gold/5 px-3 text-[8px] tracking-[0.12em] text-gold uppercase hover:border-gold/55"
      data-spell-add-critical-effect=""
      onClick={() => {
        const source = effects[critical_effects.length] ?? blank_effect
        edit.change(['levels', level_index, 'crit_effects'], [...critical_effects, { ...source }])
      }}
      type="button"
    >
      + Critical effect
    </button>
  </div>
)

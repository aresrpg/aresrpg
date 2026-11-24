// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { class_names } from '@aresrpg/immutable'
import { SpellCard as SpellCardView, type ItemSheetField, type SpellCardIcons, type SpellCardLabels } from '@aresrpg/ui'
import { Check, Crosshair, Sparkles, X, Zap } from 'lucide-react'
import { useState, type FocusEvent, type ReactNode } from 'react'

import { spell_icon } from '../content/assets.ts'
import type { SpellLevel } from '../content/catalog.ts'
import { useText } from '../i18n/useText.ts'
import type { CopyText } from '../i18n/copy.ts'
import { titleize } from '../content/titles.ts'

import { EntityIcon } from './components.tsx'
import type { EncyclopediaText } from './copy.ts'
import { effect_color, useSpellEffects, type SpellCardEdit, type SpellCardValue } from './SpellCardEffects.tsx'

export type { SpellCardEdit, SpellCardPath, SpellCardValue } from './SpellCardEffects.tsx'

export type SpellCardLevel = SpellLevel & Readonly<{ mp_cost?: number }>
export type SpellCardSpell = Readonly<{
  classe: string
  name: string
  unlock_level?: number
  levels: readonly SpellCardLevel[]
}>

const field_class = 'h-8 border border-white/12 bg-bg px-2 text-[10px] text-text outline-none focus:border-gold/60'

const NumberField = ({
  value,
  change,
  width = 'w-16',
  label,
  auto_focus = true,
}: Readonly<{
  value: number
  change: (value: number) => void
  width?: string
  label: string
  auto_focus?: boolean
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
}: Readonly<{
  value: string | number
  options: readonly (readonly [string, string | number])[]
  change: (value: string | number) => void
  label: string
}>) => (
  <select
    aria-label={label}
    autoFocus
    className={`${field_class} w-36`}
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

const InlineField = ({
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
      data-spell-inline-edit={label}
      onClick={() => set_editing(true)}
      type="button"
    >
      {display}
    </button>
  )
}

type SpellEditor = Readonly<{ label: string; editor: ReactNode }>

const rule_editor = (label: string, value: boolean, change: (value: boolean) => void): SpellEditor => ({
  label,
  editor: (
    <>
      <span className="text-[9px] text-muted">{label}</span>
      <input
        aria-label={label}
        autoFocus
        checked={value}
        className="accent-[#68d391]"
        onChange={(event) => change(event.target.checked)}
        type="checkbox"
      />
    </>
  ),
})

const number_editor = (label: string, value: number, change: (value: number) => void, width?: string): SpellEditor => ({
  label,
  editor: <NumberField change={change} label={label} value={value} width={width} />,
})

/** Authoring wraps each displayed card value with its click-to-edit field. */
const spell_card_field = (
  spell: SpellCardSpell,
  level: SpellCardLevel,
  level_index: number,
  labels: SpellCardLabels,
  edit: SpellCardEdit
): ItemSheetField => {
  const change_level = (field: keyof SpellLevel, value: SpellCardValue): void =>
    edit.change(['levels', level_index, field], value)
  const editors: Readonly<Record<string, SpellEditor>> = {
    name: {
      label: 'spell name',
      editor: (
        <input
          aria-label="Spell name"
          autoFocus
          className={`${field_class} w-full max-w-72 font-semibold text-gold`}
          onChange={(event) => edit.change(['name'], event.target.value)}
          value={spell.name}
        />
      ),
    },
    classe: {
      label: 'class',
      editor: (
        <SelectField
          change={(value) => edit.change(['classe'], value)}
          label="Class"
          options={class_names.map((value) => [titleize(value), value] as const)}
          value={spell.classe}
        />
      ),
    },
    ap_cost: number_editor(labels.ap_cost, level.ap_cost, (value) => change_level('ap_cost', value), 'w-14'),
    range: {
      label: labels.range,
      editor: (
        <>
          <NumberField
            change={(value) => change_level('range_min', value)}
            label="Minimum range"
            value={level.range_min}
            width="w-12"
          />
          <span className="text-faint">to</span>
          <NumberField
            auto_focus={false}
            change={(value) => change_level('range_max', value)}
            label="Maximum range"
            value={level.range_max}
            width="w-12"
          />
        </>
      ),
    },
    crit_1_in: number_editor(labels.crit_chance, level.crit_1_in, (value) => change_level('crit_1_in', value), 'w-14'),
    modifiable_range: rule_editor(labels.range_modifiability, level.modifiable_range, (value) =>
      change_level('modifiable_range', value)
    ),
    line_of_sight: rule_editor(labels.line_of_sight, level.line_of_sight, (value) =>
      change_level('line_of_sight', value)
    ),
    line_launch: rule_editor(labels.cast_line, level.line_launch, (value) => change_level('line_launch', value)),
    free_cell: rule_editor(labels.target_cell_empty, level.free_cell, (value) => change_level('free_cell', value)),
    casts_per_turn: number_editor(labels.casts_per_turn, level.casts_per_turn, (value) =>
      change_level('casts_per_turn', value)
    ),
    casts_per_target: number_editor(labels.casts_per_target, level.casts_per_target, (value) =>
      change_level('casts_per_target', value)
    ),
    cooldown_turns: number_editor(labels.cooldown, level.cooldown_turns, (value) =>
      change_level('cooldown_turns', value)
    ),
  }
  return ({ slot, display, class_name }) => {
    const entry = editors[slot]
    return entry ? (
      <InlineField class_name={class_name} display={display} edit={edit} editor={entry.editor} label={entry.label} />
    ) : (
      display
    )
  }
}

/** The class colour follows the level's first elemental effect. */
const caster_color = (level: SpellCardLevel): string =>
  effect_color(level.effects.find(({ element }) => element)?.element ?? '')

const unlock_text = (spell: SpellCardSpell, app_text: CopyText): string | undefined =>
  spell.unlock_level === undefined
    ? undefined
    : app_text('characters_page.spells.unlocks_at', { level: spell.unlock_level })

const SPELL_ICONS: SpellCardIcons = Object.freeze({ ap: Zap, range: Crosshair, critical: Sparkles, yes: Check, no: X })

const card_labels = (text: EncyclopediaText): SpellCardLabels => ({
  ap_cost: text('ap_cost'),
  range: text('range'),
  crit_chance: text('crit_chance'),
  effects: text('effects'),
  range_modifiability: text('range_modifiability'),
  line_of_sight: text('line_of_sight'),
  cast_line: text('cast_line'),
  target_cell_empty: text('target_cell_empty'),
  casts_per_turn: text('casts_per_turn'),
  casts_per_target: text('casts_per_target'),
  cooldown: text('cooldown'),
  unlimited: text('unlimited'),
  cooldown_none: text('cooldown_none'),
})

type SpellCardProps = Readonly<{
  spell: SpellCardSpell
  text?: EncyclopediaText
  edit?: SpellCardEdit
  initial_level?: number
  small?: boolean
  display_name?: string
  show_icon?: boolean
}>

const LevelCard = ({
  spell,
  text: provided_text,
  edit,
  small = false,
  display_name,
  show_icon,
  level,
  level_index,
  select,
}: SpellCardProps & Readonly<{ level: SpellCardLevel; level_index: number; select: (index: number) => void }>) => {
  const app_text = useText()
  const text: EncyclopediaText = provided_text ?? ((key, values) => app_text(`encyclopedia_page.${key}`, values))
  const effects = useSpellEffects({
    effects: level.effects,
    critical_effects: level.crit_effects,
    level_index,
    compact: small,
    edit,
  })
  const name = display_name ?? spell.name
  const labels = card_labels(text)
  return (
    <SpellCardView
      art={
        show_icon === false ? undefined : (
          <EntityIcon label={name} size="size-18" src={spell_icon(spell.classe, spell.name)} />
        )
      }
      caster={{ label: titleize(spell.classe), color: caster_color(level) }}
      effects={effects}
      field={edit && spell_card_field(spell, level, level_index, labels, edit)}
      icons={SPELL_ICONS}
      labels={labels}
      level={level}
      name={name}
      rank={{
        index: level_index,
        label: app_text('ui.spell_level', { level: level_index + 1 }),
        unlock: unlock_text(spell, app_text),
      }}
      ranks={{
        labels: spell.levels.map((_, index) => app_text('ui.spell_level', { level: index + 1 })),
        select,
      }}
      small={small}
    />
  )
}

/** The rank selection is local to the card; callers re-key it to reopen on another level. */
export const SpellCard = (props: SpellCardProps) => {
  const [level_index, set_level_index] = useState(Math.max(0, (props.initial_level ?? 1) - 1))
  const safe_index = Math.min(level_index, props.spell.levels.length - 1)
  const level = props.spell.levels[safe_index]
  return level ? <LevelCard {...props} level={level} level_index={safe_index} select={set_level_index} /> : null
}

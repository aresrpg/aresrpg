// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Maps seed spell effects to the shared effect list: player prose, or authoring lines with their editors.

import { AREA_SHAPES, CHANNELS, EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'
import {
  SpellEffectList,
  type SpellArea,
  type SpellCritical,
  type SpellEffectDraft,
  type SpellEffectIcon,
  type SpellEffectListProps,
  type SpellEffectRead,
} from '@aresrpg/ui'
import { Crosshair, Footprints, Shield, Sparkles, Zap, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { useText } from '../i18n/useText.ts'
import type { CopyText } from '../i18n/copy.ts'
import type { EffectLineView } from '../components/EffectLine.tsx'
import type { SpellEffect, SpellLevel } from '../content/catalog.ts'
import { titleize } from '../content/catalog.ts'
import { element_colors, stat_colors, stat_identities } from '../visual_identity.ts'

import { critical_effect_text, effect_target_text, spell_effect_text } from './spell_effect_text.ts'
import {
  AddEffects,
  duration_editable_for,
  effect_editors,
  InlineEffectField,
  RowActions,
  type EffectEditor,
  type EffectUpdate,
  type SpellCardEdit,
} from './SpellCardEditors.tsx'

export type { SpellCardEdit, SpellCardPath, SpellCardValue } from './SpellCardEditors.tsx'

const reverse = (values: Readonly<Record<string, bigint>>): Readonly<Record<number, string>> =>
  Object.freeze(Object.fromEntries(Object.entries(values).map(([name, value]) => [Number(value), name])))
const effect_kinds = reverse(EFFECT_KINDS)
const area_shapes = reverse(AREA_SHAPES)
const channels = reverse(CHANNELS)
const target_filters = reverse(TARGET_FILTERS)
const stat_effect_kinds = Object.freeze([
  Number(EFFECT_KINDS.add),
  Number(EFFECT_KINDS.remove),
  Number(EFFECT_KINDS.steal),
  Number(EFFECT_KINDS.chatiment),
  Number(EFFECT_KINDS.fixed_remove),
])
const effect_channel = (effect: SpellEffect): string =>
  stat_effect_kinds.includes(effect.kind) ? (channels[effect.stat] ?? '') : ''
const universal_shield = (effect: SpellEffect): boolean =>
  effect.kind === Number(EFFECT_KINDS.reduce) && effect.element === ''
const effect_icon = (effect: SpellEffect, channel: string): LucideIcon | undefined =>
  universal_shield(effect) ? Shield : channel_icons[channel]
const effect_icon_title = (effect: SpellEffect, channel: string): string =>
  universal_shield(effect) ? 'All elements' : titleize(channel)
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
const effect_identity = (effect: SpellEffect): Readonly<{ icon: string; label: string; tint: string }> | null => {
  const channel = effect_channel(effect)
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

const remove_words = (kind: string): Readonly<{ action: string; suffix: string; amount: boolean; stat: boolean }> => ({
  action: kind === 'fixed_remove' ? 'Removes (undodgeable)' : 'Removes',
  suffix: '',
  amount: true,
  stat: true,
})

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
  if (['remove', 'fixed_remove'].includes(kind)) return remove_words(kind)
  if (kind === 'steal') return { action: 'Steals', suffix: '', amount: true, stat: true }
  if (kind === 'chatiment')
    return { action: 'Gains up to', suffix: 'from damage received each turn', amount: true, stat: true }
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

export const spell_effect_line_view = (effect: SpellEffect, text: CopyText, critical_only = false): EffectLineView => {
  const identity = effect_identity(effect)
  const channel = effect_channel(effect)
  const ChannelIcon = effect_icon(effect, channel)
  const color = identity?.tint ?? stat_colors[channel] ?? effect_color(effect.element)
  return Object.freeze({
    ...(effect.element ? { dot: color } : identity ? { icon: identity.icon } : {}),
    ...(effect.element || identity || !ChannelIcon ? {} : { glyph: <ChannelIcon size={15} strokeWidth={1.6} /> }),
    tone: color,
    ...spell_effect_text(effect, text, critical_only),
  })
}

const effect_tone = (effect: SpellEffect): string =>
  effect_identity(effect)?.tint ?? stat_colors[effect_channel(effect)] ?? effect_color(effect.element)

const effect_icon_view = (effect: SpellEffect): SpellEffectIcon => {
  const identity = effect_identity(effect)
  const channel = effect_channel(effect)
  const glyph = effect_icon(effect, channel)
  if (identity) return { kind: 'art', src: identity.icon, title: identity.label }
  if (glyph) return { kind: 'glyph', glyph, color: effect_tone(effect), title: effect_icon_title(effect, channel) }
  return { kind: 'dot', color: effect_color(effect.element) }
}

const shows_area = (effect: SpellEffect): boolean => effect.area_size > 0 || area_shapes[effect.area_shape] === 'allmap'

const area_view = ({ area_shape, area_size }: SpellEffect, text: CopyText): SpellArea => {
  const name = area_shapes[area_shape]
  const mask = name ? area_masks[name] : undefined
  return {
    label: text(`spell_effects.shape_${name ?? 'point'}`, { size: area_size }),
    size: area_size,
    mask: mask && (name === 'allmap' || area_size > 0) ? mask : null,
  }
}

/** One displayed effect: a normal row with its aligned critical, or a critical-only row. */
type EffectSource = Readonly<{
  key: string
  list: 'effects' | 'crit_effects'
  index: number
  effect: SpellEffect
  critical?: SpellEffect
  critical_only: boolean
}>

const effect_sources = (
  effects: SpellLevel['effects'],
  critical_effects: SpellLevel['crit_effects']
): readonly EffectSource[] => [
  ...effects.map((effect, index) => ({
    key: `effect-${index}`,
    list: 'effects' as const,
    index,
    effect,
    critical: critical_effects[index],
    critical_only: false,
  })),
  ...critical_effects.slice(effects.length).map((effect, offset) => ({
    key: `critical-${effects.length + offset}`,
    list: 'crit_effects' as const,
    index: effects.length + offset,
    effect,
    critical_only: true,
  })),
]

const read_row = ({ key, effect, critical, critical_only }: EffectSource, text: CopyText): SpellEffectRead => {
  const view = spell_effect_line_view(effect, text)
  const difference = critical ? critical_effect_text(effect, critical, text) : null
  return {
    kind: 'read',
    key,
    icon: effect_icon_view(effect),
    pre: view.pre,
    value: view.value,
    tone: view.tone,
    post: view.post,
    area: shows_area(effect) ? area_view(effect, text) : null,
    target: effect_target_text(effect, text),
    turns: effect.turns > 0 ? text('spell_effects.turns', { count: effect.turns }) : null,
    chance: effect.chance_bp < 10000 ? effect.chance_bp / 100 : null,
    critical: critical_only
      ? { label: text('spell_effects.critical_only') }
      : difference
        ? { label: text('encyclopedia_page.critical'), value: difference }
        : null,
  }
}

const draft_critical = ({ effect, critical, critical_only }: EffectSource, text: CopyText): SpellCritical | null => {
  const difference = critical ? critical_effect_text(effect, critical, text) : null
  return critical_only || difference || critical
    ? { label: 'Critical', value: difference ?? (critical_only ? 'Only' : 'Same') }
    : null
}

/** A timed effect states its turns; an instant one stays authorable when its kind allows a duration. */
const draft_duration = ({ kind, turns }: SpellEffect): SpellEffectDraft['duration'] =>
  turns > 0 || duration_editable_for(kind)
    ? { text: turns > 0 ? `for ${turns} turn${turns === 1 ? '' : 's'}` : 'Instant', active: turns > 0 }
    : null

const draft_row = (source: EffectSource, text: CopyText): SpellEffectDraft => {
  const { key, effect } = source
  const words = effect_words(effect)
  const target_editable = effect_kinds[effect.kind] !== 'caster_damage'
  return {
    kind: 'draft',
    key,
    icon: effect_icon_view(effect),
    action: words.action,
    amount: words.amount
      ? { text: `${effect_range(effect)}${effect_value_suffix(effect)}`, color: effect_tone(effect) }
      : null,
    stat: words.stat ? titleize(effect_channel(effect)) : null,
    suffix: words.suffix || null,
    area: area_view(effect, text),
    target: target_editable ? `(${target_note(effect.target_filter) ?? 'any target'})` : null,
    duration: draft_duration(effect),
    chance: `· ${effect.chance_bp / 100}%`,
    critical: draft_critical(source, text),
  }
}

type EffectLinesProps = Readonly<{
  effects: SpellLevel['effects']
  critical_effects: SpellLevel['crit_effects']
  level_index: number
  compact?: boolean
  edit?: SpellCardEdit
}>

/** Authoring commands of one line: field updates, critical alignment and removal. */
const source_commands = (props: EffectLinesProps & { edit: SpellCardEdit }, source: EffectSource) => {
  const { effects, critical_effects, level_index, edit } = props
  const update =
    (list: EffectSource['list'], index: number): EffectUpdate =>
    (field, value) => {
      edit.change(['levels', level_index, list, index, field], value)
      if (
        list === 'effects' &&
        field === 'target_filter' &&
        effects.length === critical_effects.length &&
        critical_effects[index]
      )
        edit.change(['levels', level_index, 'crit_effects', index, field], value)
    }
  const without = (list: EffectSource['list']) =>
    (list === 'effects' ? effects : critical_effects).filter((_, index) => index !== source.index)
  return {
    update: update(source.list, source.index),
    update_critical: source.critical ? update('crit_effects', source.index) : undefined,
    add_critical:
      source.list === 'effects' && !source.critical
        ? () =>
            edit.change(
              ['levels', level_index, 'crit_effects'],
              [
                ...critical_effects,
                ...effects.slice(critical_effects.length, source.index + 1).map((normal) => ({ ...normal })),
              ]
            )
        : undefined,
    remove: () => {
      edit.change(['levels', level_index, source.list], without(source.list))
      if (source.list === 'effects' && source.critical)
        edit.change(['levels', level_index, 'crit_effects'], without('crit_effects'))
    },
  }
}

const effect_authoring = (
  props: EffectLinesProps & { edit: SpellCardEdit },
  sources: readonly EffectSource[],
  text: CopyText
): SpellEffectListProps => {
  const { edit, compact = false } = props
  const lines = sources.map((source) => ({ source, commands: source_commands(props, source) }))
  const editors: Readonly<Record<string, EffectEditor>> = Object.fromEntries(
    lines.flatMap(({ source, commands }) =>
      Object.entries(effect_editors(source, commands.update, commands.update_critical))
    )
  )
  const actions: Readonly<Record<string, ReactNode>> = Object.fromEntries(
    lines.map(({ source, commands }) => [
      source.key,
      <RowActions add_critical={commands.add_critical} critical_only={source.critical_only} remove={commands.remove} />,
    ])
  )
  return {
    compact,
    rows: sources.map((source) => draft_row(source, text)),
    field: ({ slot, display, class_name }) => {
      const entry = editors[slot]
      return entry ? (
        <InlineEffectField
          class_name={class_name}
          display={display}
          edit={entry.editable === false ? undefined : edit}
          editor={entry.editor}
          label={entry.label}
        />
      ) : (
        display
      )
    },
    row_action: (key) => actions[key],
    footer: compact ? undefined : <AddEffects {...props} />,
  }
}

/** The effect list of one spell level, read-only or authored through `edit`. */
export const useSpellEffects = (props: EffectLinesProps): SpellEffectListProps => {
  const text = useText()
  const sources = effect_sources(props.effects, props.critical_effects)
  return props.edit
    ? effect_authoring({ ...props, edit: props.edit }, sources, text)
    : { compact: props.compact, rows: sources.map((source) => read_row(source, text)) }
}

export const EffectLines = (props: EffectLinesProps) => <SpellEffectList {...useSpellEffects(props)} />

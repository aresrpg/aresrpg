// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { AREA_SHAPES, CHANNELS, EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'

import type { SpellEffect } from '../content/catalog.ts'
import type { CopyText } from '../i18n/copy.ts'

const channel_names = Object.fromEntries(Object.entries(CHANNELS).map(([name, value]) => [Number(value), name]))
const target_keys = Object.fromEntries(
  Object.entries(TARGET_FILTERS)
    .filter(([name]) => name !== 'none')
    .map(([name, value]) => [Number(value), `spell_effects.target_${name}`])
)
const effect_names = Object.fromEntries(Object.entries(EFFECT_KINDS).map(([name, value]) => [Number(value), name]))
const channel_keys: Readonly<Record<string, string>> = {
  ap: 'fight_hud.unit_ap',
  mp: 'fight_hud.unit_mp',
  hp: 'ui.hp',
  any: 'spell_effects.any_stat',
  resist: 'simulator_page.stat_resistance',
}

export const effect_stat_text = (stat: number, text: CopyText): string => {
  const name = channel_names[stat] ?? 'any'
  return text(channel_keys[name] ?? `simulator_page.stat_${name}`)
}

const effect_phrase = (effect: SpellEffect): string => {
  const kind = effect_names[effect.kind] ?? 'unknown'
  if (effect.stat !== Number(CHANNELS.hp)) return kind
  if (kind === 'add') return 'heal'
  return kind === 'remove' ? 'damage' : kind
}

const effect_magnitude = (effect: SpellEffect, text: CopyText, percent_life = false): string => {
  const value =
    effect.value === effect.value_max
      ? String(effect.value)
      : text('spell_effects.range', { minimum: effect.value, maximum: effect.value_max })
  const percentage =
    effect.stat === Number(CHANNELS.resist) || (percent_life && effect.kind === Number(EFFECT_KINDS.pct_life))
  return `${value}${percentage ? '%' : ''}`
}

export const active_duration_text = (turns: number, text: CopyText): string =>
  turns === 0 ? text('spell_effects.expires_next_turn') : text('spell_effects.active_turns', { count: turns })

const effect_sentence = (effect: SpellEffect, text: CopyText, key: string, stat: string) => {
  const marker = '\u0000'
  const sentence = text(key, {
    value: marker,
    stat,
    turns: effect.turns,
    duration: active_duration_text(effect.turns, text),
  })
  const [pre, post] = sentence.split(marker)
  return { pre, value: post === undefined ? null : effect_magnitude(effect, text), post: post ?? '' }
}

const SHORT_STATS = new Set([
  'strength',
  'intelligence',
  'chance',
  'agility',
  'wisdom',
  'range',
  'power',
  'raw_damage',
  'critical',
])
const active_keys: Readonly<Record<number, string>> = {
  [Number(EFFECT_KINDS.add)]: 'active_add',
  [Number(EFFECT_KINDS.remove)]: 'active_remove',
  [Number(EFFECT_KINDS.steal)]: 'active_remove',
  [Number(EFFECT_KINDS.invis)]: 'active_invis',
  [Number(EFFECT_KINDS.chatiment)]: 'active_chatiment',
}
const short_stat = (stat: number, text: CopyText): string => {
  const name = channel_names[stat] ?? 'stat'
  return text(`spell_effects.short_${SHORT_STATS.has(name) ? name : 'stat'}`)
}

/** Active effects describe retained state, rather than repeating the spell's casting action. */
export const active_effect_text = (effect: SpellEffect, text: CopyText) => {
  const key =
    effect.stat === Number(CHANNELS.hp)
      ? effect.kind === Number(EFFECT_KINDS.add)
        ? undefined
        : 'active_damage'
      : active_keys[effect.kind]
  const stat =
    effect.kind === Number(EFFECT_KINDS.chatiment) ? short_stat(effect.stat, text) : effect_stat_text(effect.stat, text)
  return key ? effect_sentence(effect, text, `spell_effects.${key}`, stat) : null
}

export const effect_target_text = (effect: SpellEffect, text: CopyText): string | null => {
  if (effect.kind === Number(EFFECT_KINDS.caster_damage)) return null
  const key = target_keys[effect.target_filter]
  return key ? text(key) : null
}

export const spell_effect_text = (effect: SpellEffect, text: CopyText, critical_only?: boolean) => {
  const target = effect_target_text(effect, text)
  const meta = [
    target ?? '',
    effect.turns > 0 ? text('spell_effects.turns', { count: effect.turns }) : '',
    effect.chance_bp < 10_000 ? `${effect.chance_bp / 100}%` : '',
    critical_only ? text('spell_effects.critical_only') : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    ...effect_sentence(effect, text, `spell_effects.${effect_phrase(effect)}`, effect_stat_text(effect.stat, text)),
    meta,
  }
}

const shape_names = Object.fromEntries(Object.entries(AREA_SHAPES).map(([name, value]) => [Number(value), name]))

/** Inline critical badges describe only differences, never repeat an identical effect. */
export const critical_effect_text = (normal: SpellEffect, critical: SpellEffect, text: CopyText): string | null => {
  const type_changed = normal.kind !== critical.kind || normal.stat !== critical.stat
  const phrase = spell_effect_text(critical, text)
  const value = effect_magnitude(critical, text, true)
  const changes = [
    [!type_changed && (normal.value !== critical.value || normal.value_max !== critical.value_max), value],
    [normal.turns !== critical.turns, text('spell_effects.turns', { count: critical.turns })],
    [normal.chance_bp !== critical.chance_bp, `${critical.chance_bp / 100}%`],
    [
      normal.area_size !== critical.area_size || normal.area_shape !== critical.area_shape,
      text(`spell_effects.shape_${shape_names[critical.area_shape]}`, { size: critical.area_size }),
    ],
    [type_changed, [phrase.pre, phrase.value, phrase.post].join('')],
    [
      normal.element !== critical.element,
      critical.element ? text(`encyclopedia_page.element.${critical.element}`) : text('demo_page.none'),
    ],
  ] as const
  const visible = changes.filter(([changed]) => changed).map(([, label]) => label)
  return visible.length ? visible.join(' · ') : null
}

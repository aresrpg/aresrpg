// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One adapter from live fight effects to the shared spell-effect line used by every fight surface.

import type { ActiveEffect } from '@aresrpg/fight'
import { CHANNELS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import { EffectLine } from '../../components/EffectLine.tsx'
import type { SpellEffect } from '../../content/catalog.ts'
import { spell_effect_line_view } from '../../encyclopedia/SpellCardEffects.tsx'

export type FightEffectLineView = Readonly<{
  kind: bigint
  element: string
  value: bigint
  turns: bigint
  stat: bigint
  key: string
  turns_max?: bigint
  breakdown?: string
}>

export const active_effect_lines = (effects: readonly ActiveEffect[]): readonly FightEffectLineView[] =>
  Object.freeze(
    effects.map((effect, index) =>
      Object.freeze({
        kind: effect.kind,
        element: effect.element,
        value: effect.value,
        turns: effect.turns_left > 0n ? effect.turns_left : 1n,
        stat: effect.stat,
        key: `${effect.source}:${effect.kind}:${effect.stat}:${index}`,
      })
    )
  )

const spell_effect = (effect: Readonly<FightEffectLineView>): SpellEffect =>
  Object.freeze({
    kind: Number(effect.kind),
    element:
      effect.element === 'earth' || effect.element === 'fire' || effect.element === 'water' || effect.element === 'air'
        ? effect.element
        : '',
    value: Number(effect.value),
    value_max: Number(effect.value),
    area_shape: 0,
    area_size: 0,
    target_filter: 0,
    chance_bp: 10_000,
    turns: Number(effect.turns),
    stat: Number(effect.stat),
  })

const stackable_kind = (kind: bigint): boolean =>
  kind === EFFECT_KINDS.add ||
  kind === EFFECT_KINDS.remove ||
  kind === EFFECT_KINDS.steal ||
  kind === EFFECT_KINDS.chatiment

const signed_value = (kind: bigint, value: bigint): string =>
  `${kind === EFFECT_KINDS.remove || kind === EFFECT_KINDS.steal ? '−' : '+'}${value}`

const grouped_effect_lines = (effects: readonly FightEffectLineView[]): readonly FightEffectLineView[] => {
  const groups = effects.reduce<readonly (readonly FightEffectLineView[])[]>((result, effect) => {
    if (!stackable_kind(effect.kind)) return [...result, [effect]]
    const existing = result.findIndex(
      ([candidate]) =>
        candidate.kind === effect.kind && candidate.stat === effect.stat && candidate.element === effect.element
    )
    if (existing < 0) return [...result, [effect]]
    return result.map((group, index) => (index === existing ? [...group, effect] : group))
  }, [])

  return groups.map((rows) => {
    const [first] = rows
    if (rows.length === 1) return first
    const duration_totals = rows
      .reduce<readonly { turns: bigint; value: bigint }[]>((result, row) => {
        const existing = result.findIndex(({ turns }) => turns === row.turns)
        if (existing < 0) return [...result, { turns: row.turns, value: row.value }]
        return result.map((duration, index) =>
          index === existing ? { ...duration, value: duration.value + row.value } : duration
        )
      }, [])
      .toSorted((left, right) => Number(left.turns - right.turns))
    return Object.freeze({
      ...first,
      value: rows.reduce((total, row) => total + row.value, 0n),
      turns: duration_totals[0].turns,
      turns_max: duration_totals.at(-1)?.turns ?? duration_totals[0].turns,
      key: rows.map(({ key }) => key).join('|'),
      breakdown: duration_totals
        .map(({ turns, value }) => `${signed_value(first.kind, value)} / ${turns}T`)
        .join(' · '),
    })
  })
}

const chatiment_stat = (stat: bigint): string => {
  if (stat === CHANNELS.strength) return 'STR'
  if (stat === CHANNELS.intelligence) return 'INT'
  if (stat === CHANNELS.chance) return 'CHA'
  if (stat === CHANNELS.agility) return 'AGI'
  if (stat === CHANNELS.wisdom) return 'WIS'
  if (stat === CHANNELS.range) return 'RNG'
  if (stat === CHANNELS.power) return 'POW'
  if (stat === CHANNELS.raw_damage) return 'DMG'
  if (stat === CHANNELS.critical) return 'CRIT'
  return 'STAT'
}

const compact_effect_line = (effect: Readonly<FightEffectLineView>): ReturnType<typeof spell_effect_line_view> => {
  const view = spell_effect_line_view(spell_effect(effect))
  if (effect.kind === EFFECT_KINDS.chatiment)
    return Object.freeze({
      ...view,
      pre: 'CHÂTIMENT · ',
      value: effect.value.toString(),
      post: ` ${chatiment_stat(effect.stat)}/TURN · ${effect.turns}T`,
      meta: null,
      title: `Turn cap${effect.breakdown ? ` · ${effect.breakdown}` : ''}`,
    })
  const action = view.pre.trim()
  const label = view.post.trim()
  const compact_label = ['ap', 'mp', 'hp'].includes(label.toLowerCase()) ? label.toUpperCase() : label
  const damage_over_time = effect.stat === CHANNELS.hp && effect.kind !== EFFECT_KINDS.add
  return Object.freeze({
    ...view,
    pre: damage_over_time
      ? ''
      : effect.kind === EFFECT_KINDS.invis
        ? 'Invisible'
        : action === 'Adds'
          ? '+'
          : action === 'Removes' || action === 'Steals'
            ? '−'
            : view.pre,
    value: effect.kind === EFFECT_KINDS.invis ? null : view.value,
    post: ` ${damage_over_time || compact_label.toLowerCase() === 'raw damage' ? 'damages' : compact_label}`,
    meta: effect.breakdown
      ? effect.turns === effect.turns_max
        ? `${effect.turns}T`
        : `${effect.turns}–${effect.turns_max}T`
      : view.meta,
    title: effect.breakdown,
  })
}

export const FightEffectLines = ({ effects }: Readonly<{ effects: readonly FightEffectLineView[] }>) => {
  if (effects.length === 0) return null
  const grouped = grouped_effect_lines(effects)
  return (
    <div className="fight-effect-lines">
      {grouped.map((effect) => (
        <EffectLine compact key={effect.key} view={compact_effect_line(effect)} />
      ))}
    </div>
  )
}

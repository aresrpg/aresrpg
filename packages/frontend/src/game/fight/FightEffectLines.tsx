// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One adapter from live fight effects to the shared spell-effect line used by every fight surface.

import type { ActiveEffect } from '@aresrpg/fight'
import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import { useText } from '../../i18n/useText.ts'
import type { CopyText } from '../../i18n/copy.ts'
import { active_effect_text, effect_stat_text } from '../../encyclopedia/spell_effect_text.ts'
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

const grouped_effect_lines = (
  effects: readonly FightEffectLineView[],
  text: CopyText
): readonly FightEffectLineView[] => {
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
        .map(
          ({ turns, value }) =>
            `${signed_value(first.kind, value)} / ${text('spell_effects.active_turns', { count: Number(turns) })}`
        )
        .join(' · '),
    })
  })
}

const compact_effect_line = (
  effect: Readonly<FightEffectLineView>,
  text: CopyText
): ReturnType<typeof spell_effect_line_view> => {
  const view = spell_effect_line_view(spell_effect(effect), text)
  return {
    ...view,
    ...active_effect_text(spell_effect(effect), text),
    meta:
      effect.kind === EFFECT_KINDS.chatiment
        ? null
        : effect.turns_max && effect.turns_max !== effect.turns
          ? text('spell_effects.active_turn_range', {
              minimum: Number(effect.turns),
              maximum: Number(effect.turns_max),
            })
          : text('spell_effects.active_turns', { count: Number(effect.turns) }),
    title:
      [
        effect.kind === EFFECT_KINDS.chatiment
          ? text('spell_effects.turn_cap', { stat: effect_stat_text(Number(effect.stat), text) })
          : '',
        effect.breakdown,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
  }
}

export const FightEffectLines = ({ effects }: Readonly<{ effects: readonly FightEffectLineView[] }>) => {
  const text = useText()
  if (effects.length === 0) return null
  const grouped = grouped_effect_lines(effects, text)
  return (
    <div className="fight-effect-lines">
      {grouped.map((effect) => (
        <EffectLine compact key={effect.key} view={compact_effect_line(effect, text)} />
      ))}
    </div>
  )
}

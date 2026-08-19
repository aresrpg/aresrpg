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

const compact_effect_line = (effect: Readonly<FightEffectLineView>): ReturnType<typeof spell_effect_line_view> => {
  const view = spell_effect_line_view(spell_effect(effect))
  const action = view.pre.trim()
  const label = view.post.trim()
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
    post: ` ${damage_over_time || label === 'Raw Damage' ? 'damages' : label}`,
  })
}

export const FightEffectLines = ({ effects }: Readonly<{ effects: readonly FightEffectLineView[] }>) => {
  if (effects.length === 0) return null
  return (
    <div className="fight-effect-lines">
      {effects.map((effect) => (
        <EffectLine compact key={effect.key} view={compact_effect_line(effect)} />
      ))}
    </div>
  )
}

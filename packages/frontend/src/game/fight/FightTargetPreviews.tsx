// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The legacy fight nametag, fed by exact disposable runs through the current fight resolver.

import type { EntityScreenAnchor } from '@aresrpg/engine'
import {
  FIGHT_ELEMENTS,
  type ActiveEffect,
  type FighterResistances,
  type FightElement,
  type SpellTargetPreview,
} from '@aresrpg/fight'
import { CHANNELS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'
import type { StatName } from '@aresrpg/immutable'
import { Droplets, Flame, Mountain, Wind, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

import { stat_name, type AppCopy } from '../../i18n/copy.ts'
import { element_colors } from '../../visual_identity.ts'
import { active_effect_lines, FightEffectLines, type FightEffectLineView } from './FightEffectLines.tsx'

import './fight_target_previews.css'

export type FightTargetPreviewView = SpellTargetPreview &
  Readonly<{
    active_effects: readonly ActiveEffect[]
    allied: boolean
    entity_id: string
    name: string
    resistances: FighterResistances
  }>

const RESISTANCE_ICONS: Readonly<Record<FightElement, LucideIcon>> = Object.freeze({
  earth: Mountain,
  fire: Flame,
  water: Droplets,
  air: Wind,
})
const RESISTANCE_STATS: Readonly<Record<FightElement, StatName>> = Object.freeze({
  earth: 'earth_resistance',
  fire: 'fire_resistance',
  water: 'water_resistance',
  air: 'air_resistance',
})

const resistance_value = (value: bigint): string => `${value < 0n ? '−' : ''}${value < 0n ? -value : value}%`

const FightResistanceRow = ({ copy, values }: Readonly<{ copy: AppCopy; values: FighterResistances }>) => (
  <div className="ent-tt__resists" data-fight-resistances>
    {FIGHT_ELEMENTS.map((element) => {
      const Icon = RESISTANCE_ICONS[element]
      const label = stat_name(copy, RESISTANCE_STATS[element])
      return (
        <span
          aria-label={`${label}: ${resistance_value(values[element])}`}
          className="ent-tt__resist"
          data-element={element}
          key={element}
          style={{ '--resist-color': element_colors[element] } as CSSProperties}
          title={label}
        >
          <Icon aria-hidden="true" size={11} strokeWidth={2} />
          <span>{resistance_value(values[element])}</span>
        </span>
      )
    })}
  </div>
)

const delta = (before: bigint, after: bigint): string | null => {
  const difference = after - before
  if (difference === 0n) return null
  return `${difference > 0n ? '+' : '−'}${difference < 0n ? -difference : difference}`
}

const point_effect = (stat: bigint, amount: bigint, key: string): FightEffectLineView =>
  Object.freeze({
    kind: amount > 0n ? EFFECT_KINDS.add : EFFECT_KINDS.remove,
    element: '',
    value: amount < 0n ? -amount : amount,
    turns: 0n,
    stat,
    key,
  })

const movement_effect = (
  movement: Readonly<SpellTargetPreview['movements'][number]>,
  index: number
): FightEffectLineView =>
  Object.freeze({
    kind:
      movement.mode === 'push'
        ? EFFECT_KINDS.push
        : movement.mode === 'pull'
          ? EFFECT_KINDS.pull
          : movement.mode === 'teleport'
            ? EFFECT_KINDS.teleport
            : EFFECT_KINDS.swap,
    element: '',
    value: movement.cells,
    turns: 0n,
    stat: 0n,
    key: `${movement.mode}:${index}`,
  })

const is_damage_effect = ({ kind, channel }: Readonly<SpellTargetPreview['effects'][number]>): boolean =>
  kind === EFFECT_KINDS.damage ||
  kind === EFFECT_KINDS.pct_life ||
  kind === EFFECT_KINDS.caster_damage ||
  kind === EFFECT_KINDS.punishment ||
  (channel === CHANNELS.hp && kind !== EFFECT_KINDS.add)

const preview_effect_lines = (target: Readonly<FightTargetPreviewView>): readonly FightEffectLineView[] => {
  const visible_effects = target.effects.filter((effect) => !is_damage_effect(effect))
  const applied_stats = new Set(visible_effects.map(({ channel }) => channel))
  return Object.freeze([
    ...visible_effects.map((effect, index) =>
      Object.freeze({
        kind: effect.kind,
        element: effect.element,
        value: effect.value,
        turns: effect.turns,
        stat: effect.channel,
        key: `${effect.kind}:${effect.channel}:${index}`,
      })
    ),
    ...(target.ap_delta !== 0n && !applied_stats.has(6n) ? [point_effect(6n, target.ap_delta, 'ap')] : []),
    ...(target.mp_delta !== 0n && !applied_stats.has(7n) ? [point_effect(7n, target.mp_delta, 'mp')] : []),
    ...target.movements.map(movement_effect),
  ])
}

export const FightTargetPreviews = ({
  anchors,
  copy,
  critical,
  targets,
}: Readonly<{
  anchors: Readonly<Record<string, EntityScreenAnchor>>
  copy: AppCopy
  critical: boolean
  targets: readonly FightTargetPreviewView[]
}>) => (
  <>
    {targets.flatMap((target) => {
      const anchor = anchors[target.entity_id]
      if (!anchor) return []
      const hp_delta = delta(target.hp_before, target.hp_after)
      const preview_effects = preview_effect_lines(target)
      return [
        <div
          className={`ent-tt ${target.allied ? 'ally' : 'enemy'}`}
          key={target.entity_id}
          style={{ left: anchor.x, top: anchor.y }}
        >
          <div className="ent-tt__head">
            <span aria-hidden="true" className="ent-tt__dot" />
            <span className="ent-tt__name">{target.name}</span>
            <span className="ent-tt__hp-paren">
              ({target.hp_before}
              {hp_delta && (
                <span
                  className={`ent-tt__delta ${target.hp_after < target.hp_before ? 'ent-tt__delta--dmg' : 'ent-tt__delta--heal'}${critical ? ' ent-tt__delta--crit' : ''}`}
                >
                  {' '}
                  {hp_delta}
                </span>
              )}
              )
            </span>
          </div>
          <FightResistanceRow copy={copy} values={target.resistances} />
          <FightEffectLines effects={active_effect_lines(target.active_effects)} />
          {preview_effects.length > 0 && (
            <div className="ent-tt__preview">
              <FightEffectLines effects={preview_effects} />
            </div>
          )}
        </div>,
      ]
    })}
  </>
)

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The legacy fight nametag, fed by exact disposable runs through the current fight resolver.

import type { EntityScreenAnchor } from '@aresrpg/engine'
import type { ActiveEffect } from '@aresrpg/fight'
import { CHANNELS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import type { SpellTargetPreview } from '@aresrpg/fight'

import { active_effect_lines, FightEffectLines, type FightEffectLineView } from './FightEffectLines.tsx'

import './fight_target_previews.css'

export type FightTargetPreviewView = SpellTargetPreview &
  Readonly<{ active_effects: readonly ActiveEffect[]; allied: boolean; entity_id: string; name: string }>

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
  critical,
  targets,
}: Readonly<{
  anchors: Readonly<Record<string, EntityScreenAnchor>>
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

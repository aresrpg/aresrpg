// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- Refs retain pending pointer gestures at this DOM input boundary. */

import { useText } from '../../i18n/useText.ts'

import { Text } from '../../i18n/Text.tsx'

import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { character_icon } from '../../content/assets.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import type { FightFighterView } from './fight_projection.ts'
import { active_effect_lines, FightEffectLines } from './FightEffectLines.tsx'
import { FightResistanceRow } from './FightResistanceRow.tsx'

export type MobIconLookup = (mob_type: string) => string | null
type TimelineFighter = Pick<FightFighterView, 'cell' | 'seat'>

const percent = (value: bigint, maximum: bigint): number =>
  maximum <= 0n ? 0 : Math.max(0, Math.min(100, Number((value * 10_000n) / maximum) / 100))

export const fight_portrait_source = (
  { mob_type, character_portrait }: Pick<FightFighterView, 'mob_type' | 'character_portrait'>,
  mob_icon_for: MobIconLookup,
  character_icon_for: typeof character_icon = character_icon
): string | null => {
  if (mob_type) return mob_icon_for(mob_type)
  return character_portrait ? character_icon_for(character_portrait.classe, character_portrait.sex) : null
}

const timeline_card_class = (fighter: FightFighterView, targetable: boolean): string =>
  [
    'fight-hud__turn',
    fighter.team === 0n ? 'ally' : 'enemy',
    fighter.active ? 'active' : '',
    fighter.dead ? 'dead' : '',
    targetable ? 'targetable' : '',
  ]
    .filter(Boolean)
    .join(' ')

const can_target_fighter = (
  targeting: boolean,
  targetable_cells: ReadonlySet<bigint>,
  fighter: FightFighterView
): boolean => targeting && targetable_cells.has(fighter.cell) && !fighter.dead

const turn_time_label = (
  fighter: FightFighterView,
  turn_seconds: number | null,
  seconds: (value: number) => string
): string => (fighter.active && turn_seconds !== null ? ` · ${seconds(turn_seconds)}` : '')

export const FightTimeline = ({
  collapse_label,
  copy,
  expand_label,
  fighters,
  focus,
  label,
  mob_icon_for,
  target,
  targetable_cells,
  targeting,
  turn_progress,
  turn_seconds,
}: Readonly<{
  collapse_label: string
  copy: AppCopy
  expand_label: string
  fighters: readonly FightFighterView[]
  focus: (fighter: TimelineFighter | null) => void
  label: string
  mob_icon_for: MobIconLookup
  target: (fighter: TimelineFighter, pointer_type?: string) => void
  targetable_cells: readonly bigint[]
  targeting: boolean
  turn_progress: number | null
  turn_seconds: number | null
}>) => {
  const ui = useText()
  const pointer_type = useRef<string | undefined>(undefined)
  const targetable = new Set(targetable_cells)
  return (
    <details aria-label={label} className="fight-hud__turns" open>
      <summary className="fight-hud__turn-toggle">
        <span className="fight-hud__turn-toggle-copy collapse">{collapse_label}</span>
        <span className="fight-hud__turn-toggle-copy expand">{expand_label}</span>
        <ChevronRight aria-hidden="true" className="collapse" size={18} />
        <ChevronLeft aria-hidden="true" className="expand" size={18} />
      </summary>
      <div className="fight-hud__turn-list">
        {fighters.map((fighter) => {
          const portrait = fight_portrait_source(fighter, mob_icon_for)
          const can_target = can_target_fighter(targeting, targetable, fighter)
          const effects = active_effect_lines(fighter.effects)
          return (
            <button
              aria-disabled={targeting && !can_target}
              aria-label={`${fighter.name}, ${ui('ui.vitals', { current: String(fighter.hp), maximum: String(fighter.max_hp), unit: ui('ui.hp') })}`}
              className={timeline_card_class(fighter, can_target)}
              key={fighter.seat.toString()}
              onBlur={() => focus(null)}
              onPointerDown={(event) => {
                pointer_type.current = event.pointerType
              }}
              onPointerCancel={() => {
                pointer_type.current = undefined
              }}
              onPointerLeave={() => {
                pointer_type.current = undefined
              }}
              onClick={(event) => {
                const input = event.detail === 0 ? undefined : pointer_type.current
                pointer_type.current = undefined
                if (can_target) target(fighter, input)
              }}
              onFocus={() => focus(fighter)}
              onMouseEnter={() => focus(fighter)}
              onMouseLeave={() => focus(null)}
              type="button"
            >
              <span aria-hidden="true" className="fight-hud__portrait">
                {portrait ? <img alt="" src={portrait} /> : fighter.name.slice(0, 1).toUpperCase()}
              </span>
              <span aria-hidden="true" className="fight-hud__turn-hp">
                <span style={{ height: `${percent(fighter.hp, fighter.max_hp)}%` }} />
              </span>
              {fighter.active && turn_progress !== null && (
                <span aria-hidden="true" className="fight-hud__turn-time" style={{ height: `${turn_progress}%` }} />
              )}
              <span className="fight-hud__turn-tooltip" role="tooltip">
                <span className="fight-hud__turn-tooltip-title">
                  <strong>{fighter.name}</strong>
                  <small>
                    <Text path="encyclopedia_page.level_short" values={{ level: fighter.level.toString() }} /> ·{' '}
                    {fighter.hp.toString()} / {fighter.max_hp.toString()} <Text path="ui.hp" />
                    {turn_time_label(fighter, turn_seconds, (count) => ui('ui.seconds', { count }))}
                  </small>
                </span>
                <FightResistanceRow copy={copy} values={fighter.resistances} />
                {effects.length > 0 && <FightEffectLines effects={effects} />}
              </span>
            </button>
          )
        })}
      </div>
    </details>
  )
}

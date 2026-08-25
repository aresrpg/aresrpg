// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { FightFighterView } from './fight_projection.ts'
import { active_effect_lines, FightEffectLines } from './FightEffectLines.tsx'

export type MobIconLookup = (mob_type: string) => string | null

const percent = (value: bigint, maximum: bigint): number =>
  maximum <= 0n ? 0 : Math.max(0, Math.min(100, Number((value * 10_000n) / maximum) / 100))

export const fight_portrait_source = (
  { mob_type }: Pick<FightFighterView, 'mob_type'>,
  mob_icon_for: MobIconLookup
): string | null => (mob_type ? mob_icon_for(mob_type) : null)

export const FightTimeline = ({
  fighters,
  label,
  focus,
  turn_seconds,
  mob_icon_for,
}: Readonly<{
  fighters: readonly FightFighterView[]
  label: string
  focus: (fighter: bigint | null) => void
  turn_seconds: number | null
  mob_icon_for: MobIconLookup
}>) => (
  <aside aria-label={label} className="fight-hud__turns">
    {fighters.map((fighter) => {
      const portrait = fight_portrait_source(fighter, mob_icon_for)
      return (
        <article
          className={`fight-hud__turn ${fighter.team === 0n ? 'ally' : 'enemy'}${fighter.active ? ' active' : ''}${fighter.dead ? ' dead' : ''}`}
          key={fighter.seat.toString()}
          onBlur={() => focus(null)}
          onFocus={() => focus(fighter.seat)}
          onMouseEnter={() => focus(fighter.seat)}
          onMouseLeave={() => focus(null)}
          tabIndex={0}
        >
          <div aria-hidden="true" className="fight-hud__portrait">
            {portrait ? <img alt="" src={portrait} /> : fighter.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="fight-hud__turn-body">
            <div className="fight-hud__turn-id">
              <span className="fight-hud__turn-name">{fighter.name}</span>
              <span className="fight-hud__turn-level">
                {fighter.active && turn_seconds !== null ? `${turn_seconds}s` : `Lv ${fighter.level}`}
              </span>
            </div>
            <div className="fight-hud__turn-hp" title={`${fighter.hp} / ${fighter.max_hp} HP`}>
              <span style={{ width: `${percent(fighter.hp, fighter.max_hp)}%` }} />
              <b>{fighter.hp.toString()}</b>
            </div>
            {fighter.effects.length > 0 && <FightEffectLines effects={active_effect_lines(fighter.effects)} />}
          </div>
        </article>
      )
    })}
  </aside>
)

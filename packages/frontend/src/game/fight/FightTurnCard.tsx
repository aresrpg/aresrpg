// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { UserRound } from 'lucide-react'

import type { FightFighterView } from './fight_projection.ts'
import { fight_portrait_source, type MobIconLookup } from './FightTimeline.tsx'

export type FightTurnCardView = Readonly<{ key: string; fighter: FightFighterView }>

export const fight_turn_card_view = (
  fighters: readonly FightFighterView[],
  presented_turn_seat: bigint | null,
  canonical_turn_key: string | null
): FightTurnCardView | null => {
  if (canonical_turn_key === null) return null
  const fighter =
    presented_turn_seat === null
      ? fighters.find(({ active }) => active)
      : fighters.find(({ seat }) => seat === presented_turn_seat)
  return fighter ? Object.freeze({ key: `${canonical_turn_key}:${fighter.seat}`, fighter }) : null
}

export const fight_turn_card_after_observation = (
  current: FightTurnCardView | null,
  fighters: readonly FightFighterView[],
  presented_turn_seat: bigint | null,
  canonical_turn_key: string | null,
  presentation_queued: boolean
): FightTurnCardView | null => {
  if (presented_turn_seat === null && presentation_queued) return current
  const next = fight_turn_card_view(fighters, presented_turn_seat, canonical_turn_key)
  return next?.key === current?.key ? current : next
}

export const FightTurnCard = ({
  fighter,
  level_label,
  mob_icon_for,
}: Readonly<{
  fighter: FightFighterView
  level_label: string
  mob_icon_for: MobIconLookup
}>) => {
  const portrait = fight_portrait_source(fighter, mob_icon_for)
  return (
    <article
      aria-live="polite"
      className={`fight-hud__turn-card ${fighter.team === 0n ? 'ally' : 'enemy'}`}
      role="status"
    >
      <div aria-hidden="true" className="fight-hud__turn-card-portrait">
        {portrait ? (
          <img alt="" src={portrait} />
        ) : (
          <UserRound data-character-placeholder="" size={148} strokeWidth={1.05} />
        )}
      </div>
      <div className="fight-hud__turn-card-body">
        <strong>{fighter.name}</strong>
        <span>{level_label}</span>
      </div>
    </article>
  )
}

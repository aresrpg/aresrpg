// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { UserRound } from 'lucide-react'
import type { FightPresentationCue } from '@aresrpg/engine'

import type { FightFighterView } from './fight_projection.ts'
import { fight_portrait_source, type MobIconLookup } from './FightTimeline.tsx'

export type FightTurnCardView = Readonly<{ key: string; fighter: FightFighterView }>
export type FightTurnAnnouncement = Readonly<{ key: string; seat: bigint }>

export const fight_turn_announcement_after_cue = (
  current: FightTurnAnnouncement | null,
  cue: Readonly<FightPresentationCue>,
  phase: 'start' | 'complete'
): FightTurnAnnouncement | null => {
  if (cue.type !== 'turn' || phase !== 'start') return current
  const seat = Number(cue.entity_id.split('_').at(-1))
  if (!Number.isInteger(seat)) return current
  return current?.key === cue.turn_key ? current : Object.freeze({ key: cue.turn_key, seat: BigInt(seat) })
}

export const fight_turn_announcement_after_submission = (
  current: FightTurnAnnouncement | null,
  submitted: boolean
): FightTurnAnnouncement | null => (submitted ? null : current)

export const fight_turn_card_view = (
  fighters: readonly FightFighterView[],
  announcement: FightTurnAnnouncement | null
): FightTurnCardView | null => {
  if (!announcement) return null
  const fighter = fighters.find(({ seat }) => seat === announcement.seat)
  return fighter ? Object.freeze({ key: announcement.key, fighter }) : null
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

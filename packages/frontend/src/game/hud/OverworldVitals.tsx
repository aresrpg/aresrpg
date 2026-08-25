// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'
import { experience_progress } from '@aresrpg/immutable'

import { action_points, character_max_hp, movement_points, projected_hp } from '../character_stats.ts'
import { useAppStore } from '../../store.ts'
import { ActionSlots } from './ActionSlots.tsx'
import { VitalsDisplay } from './VitalsDisplay.tsx'
import '../fight/fight_hud.css'

export const EmptyActionCells = () => <ActionSlots />

export const ExperienceBar = ({ experience }: Readonly<{ experience: string }>) => {
  const { into, span, percent } = experience_progress(Number(experience))
  const label = span === 0 ? 'MAX XP' : `${into.toLocaleString()} / ${span.toLocaleString()} XP`
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className="fight-hud__experience"
      role="progressbar"
    >
      <span aria-hidden="true" className="fight-hud__experience-fill" style={{ width: `${percent}%` }} />
      <span aria-hidden="true" className="fight-hud__experience-amount">
        {label}
      </span>
    </div>
  )
}

export const OverworldVitals = () => {
  const character = useAppStore(({ session }) =>
    session.characters.find(({ id }) => id === session.selected_character_id)
  )
  const [now, set_now] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => set_now(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  if (!character) return null
  return (
    <div className="fight-hud fight-hud--overworld">
      <div className="fight-hud__bottom">
        <div className="fight-hud__bar fight-hud__bar--overworld">
          <div className="fight-hud__overworld-row">
            <VitalsDisplay
              ap={BigInt(action_points(character))}
              hp={BigInt(projected_hp(character, now))}
              max_hp={BigInt(character_max_hp(character))}
              mp={BigInt(movement_points(character))}
            />
            <EmptyActionCells />
          </div>
          <ExperienceBar experience={character.experience} />
        </div>
      </div>
    </div>
  )
}

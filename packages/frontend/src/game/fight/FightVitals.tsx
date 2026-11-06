// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useAppStore } from '../../store.ts'
import { VitalsDisplay } from '../hud/VitalsDisplay.tsx'
import { select_fight_view, fight_view_with_display, type FightFighterDisplay } from './fight_projection.ts'

/** Read the same fight projection and presented HP as the interactive HUD, without its commands. */
export const FightVitals = ({ display_fighters }: Readonly<{ display_fighters: readonly FightFighterDisplay[] }>) => {
  const fight = useAppStore((state) => state.fight)
  const session = useAppStore((state) => state.session)
  if (!session.agent_view.request || !fight.checkpoint || !fight.mode) return null
  const view = fight_view_with_display(
    select_fight_view({
      checkpoint: fight.checkpoint,
      mode: fight.mode,
      owner: session.agent_view.request?.pairing.address ?? null,
      character_id: session.selected_character_id,
      canonical_ended: fight.canonical_ended,
      names: {},
    }),
    display_fighters
  )
  const fighter = view.selected
  return (
    fighter && (
      <div className="fight-hud agent-spectator-fight-vitals" data-agent-fight-vitals="">
        <div className="fight-hud__bottom">
          <div className="fight-hud__bar">
            <VitalsDisplay hp={fighter.hp} max_hp={fighter.max_hp} ap={fighter.ap} mp={fighter.mp} />
          </div>
        </div>
      </div>
    )
  )
}

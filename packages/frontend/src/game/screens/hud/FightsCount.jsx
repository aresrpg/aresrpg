// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Nearby-fights count card (Wave SPECTATE) — a small card showing how many fights are in range. Clicking it
// opens the fights modal (the full list with Join / Spectate). Sits near the craft-queue area (bottom-left,
// above the chat) without overlapping. Hidden when there are no fights in range or while I'm in my own fight.
// Pure render off state.visible_fights; clicking dispatches the modal flag (no gameplay).

import { useTranslation } from 'react-i18next'

import { use_game_state, context } from '../../store.js'
import { icon_fight } from '../icons.js'
import { Tooltip } from './Tooltip.jsx'

const open = () => context.dispatch('action/fights_modal', { focus_id: null })

/** @returns {import('react').JSX.Element | null} */
export function FightsCount() {
  const { t } = useTranslation()
  const count = use_game_state((s) => s.visible_fights.size)
  const in_fight = use_game_state((s) => s.fight_mode)
  if (count === 0 || in_fight) return null

  return (
    <Tooltip text={t('fights.see_nearby')}>
      <button
        type="button"
        className="hud-fights-count"
        onClick={open}
        aria-label={t('fights.fights_nearby', { count })}
      >
        <span className="hud-fights-count__icon" dangerouslySetInnerHTML={{ __html: icon_fight }} />
        {/* ONE count home (the badge digit was glued against a label that repeated the same number) — the
            digit lives ONLY here; the label never re-shows it, but it still PLURALIZES off it (#499): "Fight
            nearby" at 1, "Fights nearby" at N — a flat count-less label read as the ungrammatical "1Fights
            nearby". */}
        <span className="hud-fights-count__num hud-num">{count}</span>
        <span className="hud-fights-count__label">{t('fights.nearby_label', { count })}</span>
      </button>
    </Tooltip>
  )
}

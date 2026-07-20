// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Menu launcher dock — the icon cluster (bottom-right slots) that opens the one open panel. Owner
// law: the menu icons live in the BOTTOM-RIGHT slots (where spell icons were wrongly shown); spell
// icons NEVER appear outside a fight. Panels open as a RIGHT DRAWER. Fights START from the world
// (walk-into / clicking a mob group), never from this cluster — so there is no fight button here.
// The leave-combat control is the separate top-center button (Hud.jsx), so it can't overlap this dock.
//
// The dock is z-28 (hud.css) so the buttons stay ON TOP of every right drawer (z-26), never covered —
// even the ~fullscreen encyclopedia / wide map.

import {
  icon_inventory,
  icon_character,
  icon_jobs,
  icon_quests,
  icon_spells,
  icon_market,
  icon_characters,
  icon_encyclopedia,
  icon_leaderboards,
  icon_simulator,
  icon_map,
} from '../icons.js'
import { use_game_state } from '../../store.js'
import { count_actionable_quests } from './quests-data.js'
import { Tooltip } from './Tooltip.jsx'
import './top-launchers.css'

// Two tiers, two rows. PRIMARY = the gameplay launchers the player reaches constantly
// (inventory, character, characters, jobs, quests, spells, market) — louder: an accent ornament +
// higher contrast. SECONDARY = the non-gameplay reference/meta launchers (encyclopedia,
// leaderboards, simulator, map) — quieter/muted, a smaller row. Each row is its own glass
// strip so the two tiers read as distinct zones (and neither row overlaps the fast-slots, which sit
// in the bottom-center column, not here).
const PRIMARY = /** @type {const} */ ([
  { key: 'inventory', title: 'Inventory', icon: icon_inventory },
  { key: 'stats', title: 'Character', icon: icon_character },
  { key: 'characters', title: 'Characters', icon: icon_characters },
  { key: 'jobs', title: 'Jobs', icon: icon_jobs },
  { key: 'quests', title: 'Quests', icon: icon_quests },
  { key: 'spells', title: 'Spells', icon: icon_spells },
  { key: 'market', title: 'Market', icon: icon_market },
])

const SECONDARY = /** @type {const} */ ([
  { key: 'encyclopedia', title: 'Encyclopedia', icon: icon_encyclopedia },
  { key: 'leaderboards', title: 'Leaderboards', icon: icon_leaderboards },
  { key: 'simulator', title: 'Simulator', icon: icon_simulator },
  { key: 'map', title: 'Map', icon: icon_map },
])

/**
 * @param {{ key: string, title: string, icon: string, owner_only?: boolean }} l
 * @param {string | null} panel
 * @param {(p: string) => void} on_toggle
 * @param {'primary' | 'secondary'} tier
 * @param {number} badge actionable-count badge (0 = none)
 */
const launcher_button = ({ key, title, icon }, panel, on_toggle, tier, badge) => (
  <Tooltip key={key} text={badge > 0 ? `${title} (${badge} active)` : title}>
    <button
      type="button"
      className={`hud-lbtn hud-lbtn--${tier}${panel === key ? ' active' : ''}${badge > 0 ? ' has-badge' : ''}`}
      // stable hook for the first-time tutorial coachmarks to anchor a pointer to a specific launcher
      data-launcher={key}
      aria-label={badge > 0 ? `${title}, ${badge} active` : title}
      aria-pressed={panel === key}
      onClick={() => on_toggle(key)}
    >
      <span className="hud-lbtn__icon" dangerouslySetInnerHTML={{ __html: icon }} />
      {badge > 0 && <span className="hud-lbtn__badge">{badge > 9 ? '9+' : badge}</span>}
    </button>
  </Tooltip>
)

/**
 * @param {{ panel: string | null, on_toggle: (p: string) => void }} props
 */
export function TopLaunchers({ panel, on_toggle }) {
  // Honest, data-driven launcher badges (c149): real counts from the live store, 0 = no badge. Only
  // signals with a genuine actionable count are wired (YAGNI — no fake numbers on every icon).
  const quests = use_game_state((s) => s.quests)
  const badges = /** @type {Record<string, number>} */ ({
    quests: count_actionable_quests(quests),
  })

  return (
    <div className="hud-launchers">
      <div className="hud-launchers__row hud-launchers__row--primary">
        {PRIMARY.map((l) => launcher_button(l, panel, on_toggle, 'primary', badges[l.key] ?? 0))}
      </div>
      <div className="hud-launchers__row hud-launchers__row--secondary">
        {SECONDARY.map((l) => launcher_button(l, panel, on_toggle, 'secondary', badges[l.key] ?? 0))}
      </div>
    </div>
  )
}

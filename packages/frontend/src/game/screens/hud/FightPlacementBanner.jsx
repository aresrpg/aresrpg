// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Placement-phase banner — the prominent top-center prep prompt during the pre-fight placement window
// (no visible 60-SECOND placement timer). Shows the live countdown to the server's
// `placement_deadline_ms` (a wall-clock epoch the server stamps = now + 60s) + a one-line instruction so a
// first-time player instantly understands what to do (naive-user law). The actual READY / ABANDON actions
// live in FightControls (bottom-center, beside the vitals card); this banner is the timer + the call to act.
// Renders ONLY during placement of a fight I am actually fighting (never for a spectator — they place nothing).
//
// D242 rider (a silent no-op placement click, "clicking doesn't move"): a click off the start zone bumps
// use_dungeon_turn.placement_nudge → this banner SHAKES + swaps to a sharper "not a start cell" hint for ~1.2s, so
// a wrong click is never dead. (The 3D start-cell pulse is the engine polish track.)

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { use_dungeon_turn } from '../dungeon-turn.js'
import { use_fight_view } from '../../store.js'
import { use_mobile_input_mode } from '../../touch/mobile_input_mode.js'

// Recompute the remaining ms from the deadline each tick. The deadline is a server wall-clock epoch; the
// small client/server clock skew is irrelevant for a 60s human-facing countdown (the server is authoritative
// on the actual force-start). Clamps at 0 so it never shows a negative.
const remaining_seconds = (deadline) => (deadline > 0 ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0)

export function FightPlacementBanner() {
  const { t } = useTranslation()
  const mobile = use_mobile_input_mode()
  const fight = use_fight_view() // synchronous core view (S2 mirror kill)
  const nudge = use_dungeon_turn((s) => s.placement_nudge)
  const placement = !!fight?.placement && fight.winner === -1
  const spectator = !!fight?.spectator
  const deadline = fight?.placement_deadline_ms ?? 0

  // Re-render once a second while the banner is up so the countdown ticks. Bound only during placement.
  const [, set_tick] = useState(0)
  useEffect(() => {
    if (!placement || spectator) return
    const id = setInterval(() => set_tick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [placement, spectator])

  // D242 rider: flash a shake + the sharper hint for ~1.2s each time a wrong placement click bumps `nudge`. Skip
  // the initial mount (nudge starts at 0 — no click yet).
  const [wrong, set_wrong] = useState(false)
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    set_wrong(true)
    const id = setTimeout(() => set_wrong(false), 1200)
    return () => clearTimeout(id)
  }, [nudge])

  if (!placement || spectator) return null

  const secs = remaining_seconds(deadline)
  const urgent = deadline > 0 && secs <= 10
  const label = deadline > 0 ? `0:${String(secs).padStart(2, '0')}` : '--'

  return (
    <div className={`hud-placement${wrong ? ' is-wrong' : ''}`} role="status" aria-live="polite">
      <span className="hud-placement__title">{t('dungeons.placement_title')}</span>
      <span className={`hud-placement__timer hud-num${urgent ? ' is-urgent' : ''}`}>{label}</span>
      <span className="hud-placement__hint">
        {wrong
          ? t(mobile ? 'dungeons.placement_wrong_cell_touch' : 'dungeons.placement_wrong_cell')
          : t(mobile ? 'dungeons.placement_hint_touch' : 'dungeons.placement_hint')}
      </span>
    </div>
  )
}

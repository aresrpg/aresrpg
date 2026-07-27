// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DAY-NIGHT CYCLE — a small hud indicator with a progress line and shadows that follow it, presented as a
// subtle progress bar on the compass. The pure clock (day_cycle_tod, the hack-mode pin, game_clock, phase_key)
// lives in day_cycle.js — split out so it is testable headless (this file statically imports the voxel engine
// handle, whose graph is not importable without a fixture — see day_cycle.js's own header comment). This
// module owns the REACT-BOUND half:
//   • DayNightDriver   — the always-on (renderless) pusher: advances the engine's time_of_day on a paced
//     cadence so the sky sun moves, coupled terrain lights re-grade, and the shading sun / shadow frustum
//     re-aim (renderer.js sun-follow). Mounted unconditionally by GameWorldHud (keeps cycling behind fights).
//   • DayNightBar      — the visible indicator, now a SUBTLE progress line folded into the top compass strip
//     (CompassStrip mounts it inside `.gw-compass`; styles live in compass-strip.css). It replaced the old
//     top-right dome dial — one indicator, on the compass, not its own chip.
// The engine treats time_of_day as EXTERNALLY driven (sky_node.js: "the cycle drives this later"), so
// day_cycle_tod is that clock. Anchored at INITIAL_TOD so a fresh load always opens in daylight (the D177 boot).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { get_voxel_engine } from '../../../embed_voxel.js'
import { DAY_FRAC, DAY_SPLIT_PCT, day_cycle_tod, game_clock, phase_key } from './day_cycle.js'

/** Cadence (ms) the engine's tod is advanced. Paced (NOT per-frame): each push re-grades the coupled lights
 *  + triggers the atmosphere's cloud-shadow refresh, so a modest interval keeps the sky smooth while leaving
 *  the terrain-shadow re-aim to renderer.js's own ~2° angular gate. */
const PUSH_MS = 2000

/**
 * The always-on cycle DRIVER (renderless). Advances the engine's tod on the paced cadence for as long as the
 * world HUD is mounted — including during a fight, so the overworld sky keeps cycling behind the board (the
 * VISIBLE bar hides in fights, the clock does not). Mounted unconditionally by GameWorldHud.
 * @returns {null}
 */
export function DayNightDriver() {
  useEffect(() => {
    const push = () => get_voxel_engine()?.set_time_of_day?.(day_cycle_tod())
    let timer = 0
    const sync = () => {
      if (timer) clearInterval(timer)
      timer = 0
      if (document.hidden) return
      push()
      timer = window.setInterval(push, PUSH_MS)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  return null
}

/**
 * The day-night PROGRESS LINE — a thin two-tone line hugging the compass strip's bottom edge (a subtle
 * progress bar on the compass, replacing the old dome dial). A pure
 * reader of day_cycle_tod(): the strip's DAY fraction reads gold, the NIGHT fraction cyan (the track), and a
 * bright phase-coloured marker rides left→right to the current time-of-day (a marker, not a growing fill —
 * a single-colour fill would overpaint the two-tone track once past the day/night split). Mounted by
 * CompassStrip inside `.gw-compass`; its styles live in compass-strip.css (one home). Hidden in fights.
 * @returns {import('react').ReactElement}
 */
export function DayNightBar() {
  const { t } = useTranslation()
  const [tod, set_tod] = useState(day_cycle_tod)
  useEffect(() => {
    // ~1s cadence — the line creeps imperceptibly across the 20 min cycle; far cheaper than rAF.
    let timer = 0
    const update = () => set_tod(day_cycle_tod())
    const sync = () => {
      if (timer) clearInterval(timer)
      timer = 0
      if (document.hidden) return
      update()
      timer = window.setInterval(update, 1000)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  const is_night = tod >= DAY_FRAC
  const title = `${t('day_cycle.label')} · ${t(`day_cycle.${phase_key(tod)}`)} · ${game_clock(tod)}`
  return (
    <div
      className={`gw-compass__tod${is_night ? ' gw-compass__tod--night' : ''}`}
      title={title}
      role="img"
      aria-label={title}
      // the day/night split rides in from DAY_FRAC (one home) so the track's gold→cyan stop can't drift
      style={/** @type {any} */ ({ '--gw-tod-split': `${(DAY_SPLIT_PCT * 100).toFixed(1)}%` })}
    >
      <span className="gw-compass__tod-mark" style={{ left: `${(tod * 100).toFixed(2)}%` }} />
    </div>
  )
}

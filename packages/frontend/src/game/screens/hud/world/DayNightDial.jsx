// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DAY-NIGHT CYCLE — a small hud indicator with a progress line and shadows that follow it, presented as a
// subtle progress bar on the compass. This
// module owns the whole cycle:
//   • day_cycle_tod()  — the ONE source of truth: a pure wall-clock phase in [0,1). Both the driver and the
//     visible bar read it, so they can never drift.
//   • DayNightDriver   — the always-on (renderless) pusher: advances the engine's time_of_day on a paced
//     cadence so the sky sun moves, coupled terrain lights re-grade, and the shading sun / shadow frustum
//     re-aim (renderer.js sun-follow). Mounted unconditionally by GameWorldHud (keeps cycling behind fights).
//   • DayNightBar      — the visible indicator, now a SUBTLE progress line folded into the top compass strip
//     (CompassStrip mounts it inside `.gw-compass`; styles live in compass-strip.css). It replaced the old
//     top-right dome dial — one indicator, on the compass, not its own chip.
// The engine treats time_of_day as EXTERNALLY driven (sky_node.js: "the cycle drives this later"), so this
// module is that clock. Anchored at INITIAL_TOD so a fresh load always opens in daylight (the D177 boot).

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { get_voxel_engine } from '../../../embed_voxel.js'

/** Full cycle length (ms). SPEC §6.1 — 15 min day : 5 min night = a 20 min wall-clock cycle. */
const CYCLE_MS = 20 * 60 * 1000
/** Boot phase — the D177 daylight assert value, so a fresh page load always opens mid-morning (never a dark
 *  boot) and the sun visibly climbs → noon → dusk → night from there. */
const INITIAL_TOD = 0.28
/** Fraction of the cycle the sun is above the horizon (mirror of sky_node.DAY_FRAC — the 3:1 day:night). */
const DAY_FRAC = 0.75
/** Cadence (ms) the engine's tod is advanced. Paced (NOT per-frame): each push re-grades the coupled lights
 *  + triggers the atmosphere's cloud-shadow refresh, so a modest interval keeps the sky smooth while leaving
 *  the terrain-shadow re-aim to renderer.js's own ~2° angular gate. */
const PUSH_MS = 2000
/** Monotonic per-document anchor (navigation-relative), so the cycle survives across mounts within a session
 *  and resets to daylight on a fresh load. */
const T0 = typeof performance !== 'undefined' ? performance.now() : 0

/** @param {number} x @returns {number} wrap into [0,1) */
const wrap01 = (x) => ((x % 1) + 1) % 1

/** The live cycle phase in [0,1) from the wall clock — the ONE source both the driver and the bar read. */
export const day_cycle_tod = () => {
  // DEV harness / QA seam — pin a fixed phase for screenshots (morning vs night). The driver reads the SAME
  // source, so forcing this also snaps the sky to match. Tree-shaken from prod (import.meta.env.DEV).
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const forced = /** @type {any} */ (window).__ARES_TOD
    if (forced != null) return wrap01(Number(forced))
  }
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  return wrap01(INITIAL_TOD + (now - T0) / CYCLE_MS)
}

/**
 * Map a cycle phase → a believable 24h in-game clock "HH:MM": the day span [0,DAY_FRAC) reads 06:00→18:00,
 * the night span [DAY_FRAC,1) reads 18:00→06:00 — so noon (tod 0.375) is 12:00 and midnight is 00:00.
 * @param {number} tod @returns {string}
 */
export function game_clock(tod) {
  const hours = tod < DAY_FRAC ? 6 + (tod / DAY_FRAC) * 12 : 18 + ((tod - DAY_FRAC) / (1 - DAY_FRAC)) * 12
  const h = Math.floor(hours) % 24
  const m = Math.floor((hours - Math.floor(hours)) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** i18n phase key for the tooltip. @param {number} tod @returns {'dawn'|'day'|'dusk'|'night'} */
export function phase_key(tod) {
  if (tod >= DAY_FRAC) return 'night'
  const d = tod / DAY_FRAC
  if (d < 0.15) return 'dawn'
  if (d > 0.85) return 'dusk'
  return 'day'
}

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

/** Where the day fraction ends on the bar (0..1), exported so compass-strip.css and this stay one source. */
export const DAY_SPLIT_PCT = DAY_FRAC

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

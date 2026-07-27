// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE DAY-NIGHT CYCLE'S PURE CLOCK — split out of DayNightDial.jsx so it is testable headless. DayNightDial.jsx
// (the React-bound driver + the compass progress line) statically imports the voxel engine handle
// (embed_voxel.js), whose graph resolves a real character GLB fixture that is absent from every environment
// until #771 lands (see test_helpers/glb_fixture.js) — so a test file that imports DayNightDial.jsx directly
// cannot run. Nothing here needs the engine at all: `day_cycle_tod` is the ONE source of truth both the
// driver and the compass bar read, `game_clock`/`phase_key` are pure formatting, and this module's only
// "heavy" import (game/store.js) is the plain event-emitter core, not the voxel engine.

import { context } from '../../../store.js'
import { select_hack_presentation } from '../../../core/world_presentation.js'

/** Full cycle length (ms). SPEC §6.1 — 15 min day : 5 min night = a 20 min wall-clock cycle. */
export const CYCLE_MS = 20 * 60 * 1000
/** Boot phase — the D177 daylight assert value, so a fresh page load always opens mid-morning (never a dark
 *  boot) and the sun visibly climbs → noon → dusk → night from there. */
export const INITIAL_TOD = 0.28
/** Fraction of the cycle the sun is above the horizon (mirror of sky_node.DAY_FRAC — the 3:1 day:night). */
export const DAY_FRAC = 0.75
/** HACK MODE (owner ruling): the cycle is disabled and pinned at a fixed noon-ish daytime — no new flag, this
 *  reads the SAME `world_presentation` fact every other hack surface already gates on (select_hack_presentation).
 *  Derived from DAY_FRAC/game_clock's own mapping (day span [0,DAY_FRAC) → 06:00-18:00), not a magic number:
 *  the midpoint of the day span is exactly noon. World mode (terrain) is untouched — this only short-circuits
 *  day_cycle_tod's wall-clock read below. */
export const HACK_MODE_TOD = DAY_FRAC / 2
/** Monotonic per-document anchor (navigation-relative), so the cycle survives across mounts within a session
 *  and resets to daylight on a fresh load. */
const T0 = typeof performance !== 'undefined' ? performance.now() : 0

/** @param {number} x @returns {number} wrap into [0,1) */
const wrap01 = (x) => ((x % 1) + 1) % 1

/** The live cycle phase in [0,1) from the wall clock — the ONE source both the driver and the bar read. */
export const day_cycle_tod = () => {
  // DEV harness / QA seam — pin a fixed phase for screenshots (morning vs night). The driver reads the SAME
  // source, so forcing this also snaps the sky to match. Tree-shaken from prod (import.meta.env.DEV). Takes
  // priority over the hack-mode pin below — an explicit dev override always wins.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const forced = /** @type {any} */ (window).__ARES_TOD
    if (forced != null) return wrap01(Number(forced))
  }
  // HACK MODE (owner ruling): the cycle is disabled — pinned daytime, never the wall clock. World mode
  // (terrain) falls straight through to the cycle below, byte-for-byte unchanged.
  if (select_hack_presentation(context.get_state())) return HACK_MODE_TOD
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

/** Where the day fraction ends on the bar (0..1), exported so compass-strip.css and DayNightBar stay one source. */
export const DAY_SPLIT_PCT = DAY_FRAC

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// world-shell/fight_core_clock.js — THE FIGHT REDUCER'S CLOCK (#1993 WP2b item 5).
//
// Time is a reducer INPUT here, never a source of truth: one 4/s `{ type: 'tick' }` through the ONE input door
// is what lets `store_tick.reduce_tick_state` resolve the three transitions that nothing else can trigger —
// the TURN HANDOVER (#1808: the chain finishes spending this turn's mob-resolution budget while no input
// arrives), the deadline auto-commit, and the wave watchdog. All three are the CORE's; none of them is a
// rendering concern.
//
// That clock used to live in a `useEffect` inside `FightTimeline.jsx` — the turn-order card. A core time-driven
// transition whose liveness depends on one presentational component staying mounted is a lockout waiting for a
// layout change, and it was silently gated on that card's own `deadline > 0` guard too. It lives here instead,
// bound to the FIGHT: armed while a fight id is bound to the store, disarmed the moment it unbinds — the same
// lifetime `bind_fight_stream` already has, installed the same way `install_fight_trace_tee` is.
//
// One-reducer law: the subscriber below arms and disarms a timer and writes NOTHING; the tick re-enters through
// `store.input`, exactly like a receipt or a poll. Every seam is injected so this drives headless.

import { fight_store } from '@aresrpg/fight/store'

/** 4/s — the cadence the visible turn countdown was already repainting at, now driven from the fight's edge. */
export const FIGHT_CLOCK_MS = 250

/**
 * Keep exactly ONE reducer clock alive for whichever fight is bound to `store`.
 * @param {any} [store] the fight store to clock
 * @param {{ set_interval?: (fn: () => void, ms: number) => any, clear_interval?: (handle: any) => void,
 *   now?: () => number, period_ms?: number }} [seams]
 * @returns {() => void} uninstall — unsubscribes and stops the clock
 */
export const install_fight_clock = (
  store = fight_store,
  {
    set_interval = (fn, ms) => setInterval(fn, ms),
    clear_interval = (handle) => clearInterval(handle),
    now = () => Date.now(),
    period_ms = FIGHT_CLOCK_MS,
  } = {}
) => {
  let timer = null
  const stop = () => {
    if (timer == null) return
    clear_interval(timer)
    timer = null
  }
  // Idempotent per bound fight: the subscriber runs on EVERY notification — including the tick's own fold — so
  // arming has to be a no-op when a clock is already running, or a fight would accumulate one timer per input.
  const sync = () => {
    if (store.getState().fight_id == null) return stop()
    if (timer == null) timer = set_interval(() => store.getState().input({ type: 'tick' }, now()), period_ms)
  }
  sync()
  const unsubscribe = store.subscribe(sync)
  return () => {
    unsubscribe()
    stop()
  }
}

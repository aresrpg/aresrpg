// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2158 — ONE cross-module User Timing trace for a fast travel, in the engage_timing idiom (shared plumbing:
// user_timing.js). It answers the only question D51 asks of this interaction: between the click and the moment
// the dragon leaves the ground, WHICH leg holds the player.
//
// The trace follows the TRAVELER (the character the player is driving), so a follower's silent catch-up flight —
// the group loop steers those through the very same reducer — can neither start nor finish the player's trace.
//
// LEGS. Same-world (tx-free, the D51 subject): begin → route-read → model-wait → takeoff.
// Foreign-world adds the two tx legs between them: world-join (the join tx) and world-boot (the session swap).
// `model_wait` is the leg the preload exists to keep at zero: the dragon GLB is warmed at world-HUD boot, so a
// click that still has to fetch it is a measurable regression, not an invisible one.

import { timing_clear, timing_duration, timing_mark, timing_measure } from './user_timing.js'
import { game_log } from './log.js'

export const FT_MARK_NAMES = Object.freeze({
  begin: 'fast-travel:begin',
  route_resolved: 'fast-travel:route-resolved',
  model_ready: 'fast-travel:model-ready',
  join_started: 'fast-travel:join-started',
  world_joined: 'fast-travel:world-joined',
  boot_ready: 'fast-travel:boot-ready',
  flight_start: 'fast-travel:flight-start',
})

export const FT_MEASURE_NAMES = Object.freeze({
  route_read: 'fast-travel:route-read', // click → the /v1 route facts are in hand
  model_wait: 'fast-travel:model-wait', // route facts → warm dragon (ZERO when the preload did its job)
  world_join: 'fast-travel:world-join', // foreign world only — the join tx
  world_boot: 'fast-travel:world-boot', // foreign world only — the session swap
  takeoff: 'fast-travel:takeoff', // everything ready → the flight actually starts
  total: 'fast-travel:total', // click → flight start (the D51 number)
})

const mark_names = Object.values(FT_MARK_NAMES)
const measure_names = Object.values(FT_MEASURE_NAMES)

/** @type {{ traveler_id: string, foreign: boolean } | null} */
let active_trace = null

const is_traced = (traveler_id) => !!traveler_id && active_trace?.traveler_id === traveler_id

/** The accepted travel click: clear this trace's old entries, then start a fresh measurement. */
export function start_fast_travel_timing(traveler_id) {
  if (!traveler_id) return
  timing_clear(mark_names, measure_names)
  active_trace = { traveler_id, foreign: false }
  timing_mark(FT_MARK_NAMES.begin)
}

/** The /v1 route facts (target doc + my doc + the world gate) are in hand — close the read leg. */
export function mark_ft_route_resolved(traveler_id) {
  if (!is_traced(traveler_id)) return
  timing_mark(FT_MARK_NAMES.route_resolved)
  timing_measure(FT_MEASURE_NAMES.route_read, FT_MARK_NAMES.begin, FT_MARK_NAMES.route_resolved)
}

/** The dragon GLB is fetched+parsed in the warm cache — close the model leg (zero when preloaded). */
export function mark_ft_model_ready(traveler_id) {
  if (!is_traced(traveler_id)) return
  timing_mark(FT_MARK_NAMES.model_ready)
  timing_measure(FT_MEASURE_NAMES.model_wait, FT_MARK_NAMES.route_resolved, FT_MARK_NAMES.model_ready)
}

/** Foreign world: the join transaction left the client. */
export function mark_ft_join_started(traveler_id) {
  if (!is_traced(traveler_id)) return
  active_trace = { ...active_trace, foreign: true }
  timing_mark(FT_MARK_NAMES.join_started)
}

/** Foreign world: the join executed — close the tx leg. */
export function mark_ft_world_joined(traveler_id) {
  if (!is_traced(traveler_id)) return
  timing_mark(FT_MARK_NAMES.world_joined)
  timing_measure(FT_MEASURE_NAMES.world_join, FT_MARK_NAMES.join_started, FT_MARK_NAMES.world_joined)
}

/** Foreign world: the destination session booted — close the swap leg. */
export function mark_ft_boot_ready(traveler_id) {
  if (!is_traced(traveler_id)) return
  timing_mark(FT_MARK_NAMES.boot_ready)
  timing_measure(FT_MEASURE_NAMES.world_boot, FT_MARK_NAMES.world_joined, FT_MARK_NAMES.boot_ready)
}

/**
 * The flight phase entered — the dragon leaves the ground. Close the trace and emit the one-line perf idiom.
 * Returns the durations as a unit-test seam; production ignores them.
 */
export function finish_fast_travel_timing(traveler_id) {
  if (!is_traced(traveler_id)) return null
  const { foreign } = active_trace
  timing_mark(FT_MARK_NAMES.flight_start)
  timing_measure(
    FT_MEASURE_NAMES.takeoff,
    foreign ? FT_MARK_NAMES.boot_ready : FT_MARK_NAMES.model_ready,
    FT_MARK_NAMES.flight_start
  )
  timing_measure(FT_MEASURE_NAMES.total, FT_MARK_NAMES.begin, FT_MARK_NAMES.flight_start)

  const durations = Object.fromEntries(
    Object.entries(FT_MEASURE_NAMES).map(([leg, name]) => [leg, timing_duration(name)])
  )
  active_trace = null

  const ms = (leg) => `${durations[leg] == null ? '?' : Math.round(durations[leg])}ms`
  game_log(
    'fast-travel-perf',
    `${foreign ? 'foreign' : 'same-world'} travel legs: route-read ${ms('route_read')} · ` +
      `model-wait ${ms('model_wait')} · join ${ms('world_join')} · boot ${ms('world_boot')} · ` +
      `takeoff ${ms('takeoff')} · total ${ms('total')}`
  )
  return durations
}

/** A refused/cancelled travel never took off; leave its partial marks inspectable until the next click. */
export function cancel_fast_travel_timing(traveler_id) {
  if (!traveler_id || is_traced(traveler_id)) active_trace = null
}

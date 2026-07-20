// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The BOOT VEIL + daylight assert (split from embed_voxel.js at the 600-LoC law). One lifecycle: the
// D161 blur that melts when the world is honestly ready, the D205 focus signals that decide "ready",
// and the D177 time-of-day poke that survives the engine's silent pre-boot window. All timers are
// self-limiting (≤20 s) — no dispose needed; a session that dies mid-boot just lets them lapse.
//
// D161 (supersedes the loading screen): NO bar, NO veil — boot straight into the scene under a
// BLUR that melts to clarity; resident sessions share the same feet-column truth as movement.
// D205: at the 600 m map, "first chunk anywhere" would melt the blur onto a mostly-void world — the
// old signal was 'focus_ready' (the 5×5 neighborhood); Lane 66 narrows it to the feet column.
// D174: the event path historically dropped (emitter-identity) — the PULL belt polls reality instead:
// SPECTATE (small lite zone) waits for the first resident chunk; SESSION samples the SPAWN COLUMN
// (the same explicit column-residency truth the D188/Lane-66 physics gate reads).
// D177 (THE dark-app root): set_time_of_day pre-boot is a documented silent no-op and the default sky is
// NIGHT — poke until fps > 0 proves the sky exists, then stop.

/**
 * @param {{ engine: any, container: HTMLElement, spectate: boolean, world_spawn: () => [number, number, number], in_fight?: () => boolean }} args
 * @returns {{ ready: () => boolean }} `ready()` = the blur melted (diagnostic lifecycle surface).
 */
import { game_log } from '../core/log.js'

export function create_boot_veil({ engine, container, spectate, world_spawn, in_fight }) {
  const blur = document.createElement('div')
  blur.style.cssText =
    'position:absolute;inset:0;backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);' +
    'background:rgba(10,10,15,0.25);z-index:5;pointer-events:none;transition:opacity 1.2s ease-out'
  container.appendChild(blur)
  let world_ready = false
  const clear_blur = (/** @type {string} */ why) => {
    if (world_ready) return
    world_ready = true
    if (why !== 'first-chunk' && why !== 'focus-ready')
      game_log('voxel', `blur-boot cleared by ${why} — boot events incomplete (D155 cap)`)
    blur.style.opacity = '0'
    // P0 item 14 (don't blur anything as long as the chunk below the character is loaded) — the
    // melt is a FAST snap-to-clarity, not a lingering dissolve: the old 1300ms tail read as "blurriness when
    // refreshing" even though the gate had already passed. 300ms keeps the anti-flash easing, nothing more.
    setTimeout(() => blur.remove(), 300)
  }
  const cap = setTimeout(() => clear_blur('10s-cap'), 10_000)
  engine.on('load_progress', (/** @type {{loaded:number,total:number,phase:string}} */ p) => {
    if (p.phase === 'focus_ready' || p.phase === 'done' || p.phase === 'far') {
      clearTimeout(cap)
      clear_blur(p.phase === 'focus_ready' ? 'focus-ready' : 'first-chunk')
    }
  })
  // P0 item 14: the readiness gate is EXACTLY this — the chunk under the character (the D188/D259
  // physics+spiral truth). Check IMMEDIATELY (a refresh with the column already resident never shows blur at
  // all) and every 250ms after; the wider 5×5-neighborhood caution yields to the feet-column truth.
  const column_ready = () => {
    try {
      // P2 blur sweep (blurry loading in fight isn't useful, so it's skipped) — a live dungeon
      // context (entry / refresh-into-fight / resume / board-gen wait) counts as ready on EVERY path: the
      // creation-time synchronous clear AND the 250ms poll both route through here, so this one home covers
      // both. The veil's oracle samples the OVERWORLD spawn column a cave session never satisfies; the sword
      // ceremony is the fight's wait-cover.
      if (in_fight?.()) return true
      if (spectate) return (engine.get_stats?.().resident_chunks ?? 0) > 0
      const spawn = world_spawn()
      return engine.is_column_resident?.(Math.floor(spawn[0]), Math.floor(spawn[2])) ?? false
    } catch {
      return false /* boot races — next tick retries */
    }
  }
  const on_column_ready = () => {
    clearTimeout(cap)
    clearInterval(stats_poll)
    clear_blur('focus-ready')
  }
  const stats_poll = setInterval(() => {
    if (column_ready()) on_column_ready()
  }, 250)
  // Owner (item 14 confirm): "I already see the fight behind so it's not useful" — when the column is ALREADY
  // resident at veil-creation (a fight/world resume), never show the blur at all: clear synchronously (the div
  // goes opacity-0 before its first paint; the 300ms remove is invisible).
  if (column_ready()) {
    blur.style.transition = 'none'
    on_column_ready()
  }
  setTimeout(() => clearInterval(stats_poll), 12_000) // the poll never outlives the boot window

  engine.set_time_of_day(0.28)
  const tod_poke = setInterval(() => {
    try {
      engine.set_time_of_day(0.28)
      if ((engine.get_stats?.().fps ?? 0) > 0) {
        clearInterval(tod_poke)
        game_log('voxel', 'daylight asserted post-boot (D177 — the sky exists now)')
      }
    } catch {
      /* pre-boot races — next tick */
    }
  }, 300)
  setTimeout(() => clearInterval(tod_poke), 20_000) // never outlives the boot window

  return { ready: () => world_ready }
}

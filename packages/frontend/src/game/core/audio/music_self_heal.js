// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { configure_assets } from '@aresrpg/sdk/jobs'

import { MUSIC_MANIFEST_PROBE_KEY, is_music_asset_resolved, play_audio } from './audio_registry.js'

export const MUSIC_RETRY_DELAYS_MS = [750, 2_000, 5_000, 10_000, 30_000]

/** Saturating retry delay: retries continue at the final cadence instead of giving up. */
export function music_retry_delay(attempt, delays = MUSIC_RETRY_DELAYS_MS) {
  return delays[Math.min(Math.max(0, attempt), delays.length - 1)]
}

/** @param {unknown} error */
export function is_autoplay_block(error) {
  return typeof error === 'object' && error !== null && error.name === 'NotAllowedError'
}

export function is_music_manifest_ready() {
  return is_music_asset_resolved(MUSIC_MANIFEST_PROBE_KEY)
}

/** Re-fetch the boot manifest without a cached failure and configure the shared SDK resolver. */
export async function reload_music_manifest(fetch_fn = globalThis.fetch) {
  if (typeof fetch_fn !== 'function') return false
  try {
    const url = import.meta.env?.VITE_WALRUS_MANIFEST_URL || '/asset_manifest.json'
    const response = await fetch_fn(url, { cache: 'no-store' })
    if (!response.ok) return false
    configure_assets(await response.json())
    return is_music_manifest_ready()
  } catch {
    return false
  }
}

const GESTURE_EVENTS = ['pointerdown', 'touchstart', 'keydown']

/** Keep the assigned URL comparable: HTMLMediaElement.src expands relative URLs to absolute ones. */
function assigned_src(player) {
  return player.getAttribute?.('src') ?? player.src
}

/**
 * Recovery controller for two looping HTMLAudioElements. Dependencies are injected so the policy can be
 * exercised without Audio/DOM/network in Bun.
 * @param {{
 *   get_players: () => { roam: HTMLAudioElement | null, battle: HTMLAudioElement | null },
 *   get_active_players?: () => { roam: HTMLAudioElement | null, battle: HTMLAudioElement | null },
 *   get_tracks: () => { roam: string, battle: string } | null,
 *   is_active: () => boolean,
 *   manifest_ready?: () => boolean,
 *   reload_manifest?: () => Promise<boolean>,
 *   get_gesture_target?: () => EventTarget | null,
 *   set_timer?: typeof setTimeout,
 *   clear_timer?: typeof clearTimeout,
 *   quiet_log?: (line: string) => void,
 * }} options
 */
export function create_music_self_heal(options) {
  const manifest_ready = options.manifest_ready ?? is_music_manifest_ready
  const reload_manifest = options.reload_manifest ?? reload_music_manifest
  const get_gesture_target = options.get_gesture_target ?? (() => (typeof document === 'undefined' ? null : document))
  const set_timer = options.set_timer ?? setTimeout
  const clear_timer = options.clear_timer ?? clearTimeout
  const quiet_log = options.quiet_log ?? ((line) => console.info(line))
  const get_active_players = options.get_active_players ?? options.get_players

  let retry_timer = null
  let manifest_timer = null
  let retry_attempt = 0
  let manifest_attempt = 0
  let gesture_target = null
  let gesture_armed = false
  let accepting = false
  let play_gen = 0
  const pending_heals = new Set()
  let active_players = new Set()

  const active = () => accepting && options.is_active()

  function log_heal(kind) {
    const detail = {
      autoplay: 'autoplay resumed on user gesture',
      load: 'failed stream reloaded',
      manifest: 'late asset manifest applied',
    }[kind]
    quiet_log(`[music] self-heal: ${detail}`)
  }

  function disarm_gesture() {
    if (!gesture_armed || !gesture_target) return
    for (const event of GESTURE_EVENTS) gesture_target.removeEventListener(event, on_gesture, true)
    gesture_armed = false
    gesture_target = null
  }

  function cancel_retry() {
    if (retry_timer != null) clear_timer(retry_timer)
    retry_timer = null
  }

  function on_gesture() {
    disarm_gesture()
    play('autoplay')
  }

  function arm_gesture() {
    if (gesture_armed || !active()) return
    gesture_target = get_gesture_target()
    if (!gesture_target) return
    gesture_armed = true
    for (const event of GESTURE_EVENTS) gesture_target.addEventListener(event, on_gesture, true)
  }

  /** @param {'autoplay' | 'load' | 'manifest' | null} heal_kind */
  function play(heal_kind = null) {
    if (!active()) return
    const players = Object.values(get_active_players()).filter(Boolean)
    if (!players.length) return
    const next_players = new Set(players)
    for (const player of active_players) if (!next_players.has(player)) player.pause()
    active_players = next_players
    if (heal_kind) pending_heals.add(heal_kind)
    const my_gen = ++play_gen

    const attempts = players.map((player) => {
      try {
        if (player.paused === false) return Promise.resolve()
        return play_audio(player)
      } catch (error) {
        return Promise.reject(error)
      }
    })
    void Promise.all(attempts)
      .then(() => {
        if (my_gen !== play_gen) return
        cancel_retry()
        retry_attempt = 0
        for (const kind of pending_heals) log_heal(kind)
        pending_heals.clear()
      })
      .catch((error) => {
        if (my_gen !== play_gen) return
        if (is_autoplay_block(error)) arm_gesture()
        else schedule_retry()
      })
  }

  /** Re-resolve late-manifest URLs and optionally reload unchanged failed streams. */
  function retarget(force_load) {
    const tracks = options.get_tracks()
    if (!tracks) return false
    const players = options.get_players()
    let changed = false
    for (const key of ['roam', 'battle']) {
      const player = players[key]
      if (!player) continue
      const next_src = tracks[key]
      const source_changed = assigned_src(player) !== next_src
      if (source_changed) {
        player.src = next_src
        changed = true
      }
      if (source_changed || force_load) player.load()
    }
    return changed
  }

  function run_retry() {
    retry_timer = null
    if (!active()) return
    const ready = manifest_ready()
    const manifest_changed = retarget(true) && ready
    play(manifest_changed ? 'manifest' : 'load')
    if (!ready) watch_manifest()
  }

  function schedule_retry() {
    if (retry_timer != null || !active()) return
    const delay = music_retry_delay(retry_attempt++)
    retry_timer = set_timer(run_retry, delay)
  }

  async function check_manifest() {
    manifest_timer = null
    if (!active()) return
    const ready = manifest_ready() || (await reload_manifest())
    if (!active()) return
    if (ready) {
      manifest_attempt = 0
      if (retarget(false)) play('manifest')
      return
    }
    watch_manifest()
  }

  function watch_manifest() {
    if (manifest_ready() || manifest_timer != null || !active()) return
    const delay = music_retry_delay(manifest_attempt++)
    manifest_timer = set_timer(check_manifest, delay)
  }

  function start() {
    accepting = true
    play()
    watch_manifest()
  }

  function stop(pause_players = true) {
    accepting = false
    play_gen++
    if (pause_players) {
      for (const player of active_players) player.pause()
      active_players = new Set()
    }
    cancel_retry()
    if (manifest_timer != null) clear_timer(manifest_timer)
    manifest_timer = null
    retry_attempt = 0
    manifest_attempt = 0
    pending_heals.clear()
    disarm_gesture()
  }

  return { on_load_error: schedule_retry, play, start, stop, watch_manifest }
}

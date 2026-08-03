// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HACK MODE'S RADIO — the album stream's manifest door and its sequential engine, kept out of the component
// so the widget stays markup and this file stays the ONE place that knows how the radio gets its bytes.
//
// WHY OUR OWN FILES AND NOT AN EMBED: the tracks are served from our asset host beside every other music
// asset, so the radio is a plain HTMLAudioElement built through the house's ONE media door
// (audio_registry's create_audio) — no third-party iframe, no visible player region, no external script.
//
// THE HOST IS NEVER HARDCODED HERE. The manifest resolves through the SDK's asset resolver exactly like
// every other published class (`{host}/data/{class}.json` — the mapping law in sdk/src/jobs.js), and each
// track's manifest-relative path is re-homed onto that same origin. A manifest row therefore cannot point
// the browser anywhere but our own host, whatever it says: the manifest is untrusted DATA.

import { asset_url } from '@aresrpg/sdk/jobs'

import { MUSIC_VOLUME, create_audio } from '../../../core/audio/audio_registry.js'

/** The published asset class carrying the radio's manifest and its files. */
export const HACK_RADIO_CLASS = 'hack_radio'

/**
 * The radio manifest's URL, or null while the class is unpublished — the caller shows its error row rather
 * than inventing a host.
 * @returns {string | null}
 */
export const radio_manifest_url = () => asset_url(HACK_RADIO_CLASS, `${HACK_RADIO_CLASS}.json`)

/**
 * The manifest body → the ordered track list. PURE, and total: every malformed shape folds to `[]` and a
 * row with no `file` is dropped rather than becoming a track that can only fail. Each `file` is read as a
 * path relative to the manifest's own ORIGIN ROOT (a leading '/' is forced), so a row carrying an absolute
 * foreign URL or a `../` walk still lands on our host — host confinement by construction, not by trust.
 * @param {unknown} body the parsed manifest JSON
 * @param {string} manifest_url the URL it was fetched from — the origin every track is re-homed onto
 * @returns {ReadonlyArray<{ src: string, title: string }>}
 */
export function parse_radio_manifest(body, manifest_url) {
  const rows = /** @type {any} */ (body)?.tracks
  if (!Array.isArray(rows)) return []
  const root = new URL('/', manifest_url) // the host ROOT, not the manifest's own /data/ folder
  return rows.flatMap((row) => {
    const file = typeof row?.file === 'string' ? row.file : ''
    if (!file) return []
    // Resolve for its PATH only, then re-home that path on the root: an absolute foreign URL loses its
    // origin and a `../` walk cannot climb above `/`.
    const { pathname } = new URL(file, root)
    const src = new URL(pathname, root).href
    // A row may omit its display title; the filename stem is an honest fallback, never an empty line.
    const stem =
      pathname
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ?? ''
    return [{ src, title: typeof row.title === 'string' && row.title ? row.title : stem }]
  })
}

/**
 * Fetch the manifest and decode it. FAILURES FLOW AS DATA — an unpublished class, a dead request, a bad
 * body and an EMPTY list all return the same `{ tracks: [], error: true }` the widget renders as a visible
 * error row. It never throws and never resolves to a silent, empty radio.
 * @param {{ fetch_impl?: typeof fetch }} [deps] injectable so the suite needs no network
 * @returns {Promise<{ tracks: ReadonlyArray<{ src: string, title: string }>, error: boolean }>}
 */
export async function load_radio_tracks({ fetch_impl = globalThis.fetch } = {}) {
  const url = radio_manifest_url()
  if (!url) return { tracks: [], error: true }
  try {
    const response = await fetch_impl(url)
    if (!response.ok) return { tracks: [], error: true }
    const tracks = parse_radio_manifest(await response.json(), url)
    return { tracks, error: tracks.length === 0 }
  } catch {
    return { tracks: [], error: true }
  }
}

/**
 * The next track's index, looping at the end. Pure. An empty list can never index out of itself.
 * @param {number} index @param {number} count @returns {number}
 */
export const next_index = (index, count) => (count > 0 ? (index + 1) % count : 0)

/**
 * Next row not already known dead, wrapping once. `null` means every row failed.
 * @param {number} index @param {number} count @param {ReadonlySet<number>} dead_indices
 * @returns {number | null}
 */
export const next_playable_index = (index, count, dead_indices) => {
  const candidates = Array.from({ length: count }, (_, offset) => (index + offset + 1) % count)
  return candidates.find((candidate) => !dead_indices.has(candidate)) ?? null
}

/**
 * Build the radio: ONE audio element walking `tracks` in order, looping forever, announcing each track and
 * its play/pause state to the widget. Returns null when there is nothing to play or the environment has no
 * media (headless) — an absent radio, never a crashing one.
 *
 * IT STARTS ITSELF. Arming hack mode IS the intent to hear the album, so the build attempts play at once. A
 * browser that refuses because no gesture has happened yet (NotAllowedError) is POLICY, never an error row:
 * the widget keeps showing its play button and ONE armed listener retries on the next pointer/key event. Any
 * other rejection is a real failure and surfaces as one.
 *
 * A MANUAL PAUSE IS STICKY for the session — user intent outranks autoplay, so neither a later gesture nor a
 * track boundary ever restarts the album behind the player. Only the button brings it back.
 *
 * The cursor and that intent are closure locals rather than component state on purpose: "which track is
 * loaded" already has a home in the element's own `src`, and the widget only ever needs the TITLE to render.
 *
 * FIGHT-MUSIC HANDOFF (owner ruling): a fight in hack mode plays the SAME fight-music pool as the real world
 * — the album never sounds over it. `fight_active` starts the engine already suppressed (no autoplay attempt)
 * when hack mode is entered mid-fight; `set_fight_paused` pauses/resumes the SAME element on every later fight
 * edge — never a rebuild, so the album never loses its place. Distinct from the user's own pause: a manual
 * pause held INTO a fight stays paused after it, and the toggle control itself refuses to resume the album
 * while a fight owns the channel (see `toggle` below) — the suppression is not just a default, it is enforced.
 *
 * @param {ReadonlyArray<{ src: string, title: string }>} tracks in manifest order
 * @param {{ on_track?: (title: string) => void, on_playing?: (playing: boolean) => void,
 *           on_error?: () => void, make_audio?: typeof create_audio, fight_active?: boolean,
 *           gesture_target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null }} [handlers]
 * @returns {{ toggle: () => void, dismiss_gesture_retry: () => void, set_fight_paused: (active: boolean) => void,
 *             dispose: () => void } | null}
 */
export function create_radio(
  tracks,
  {
    on_track,
    on_playing,
    on_error,
    make_audio = create_audio,
    fight_active = false,
    gesture_target = globalThis.window,
  } = {}
) {
  if (tracks.length === 0) return null
  const player = make_audio(tracks[0].src, { preload: 'none', volume: MUSIC_VOLUME })
  if (!player) return null

  let cursor = 0
  let paused_by_user = false
  let armed = false
  let fight_paused = fight_active // suppressed by the CURRENT fight — never the user's own intent
  let dead_indices = new Set()
  const announce = () => on_track?.(tracks[cursor].title)

  // ONE shot: the listeners are gone the moment a gesture lands, whether or not the retry succeeded — a radio
  // that re-armed forever would fight the player on every click for the rest of the session.
  const on_gesture = () => {
    dismiss_gesture_retry()
    // play owns autoplay/media rejection handling through gesture retry or fail_track.
    if (!paused_by_user) void play()
  }
  const dismiss_gesture_retry = () => {
    if (!armed) return
    armed = false
    gesture_target?.removeEventListener('pointerdown', on_gesture)
    gesture_target?.removeEventListener('keydown', on_gesture)
  }
  const arm_gesture_retry = () => {
    if (armed || paused_by_user || !gesture_target) return
    armed = true
    gesture_target.addEventListener('pointerdown', on_gesture)
    gesture_target.addEventListener('keydown', on_gesture)
  }
  const advance = () => {
    const next = next_playable_index(cursor, tracks.length, dead_indices)
    if (next == null) {
      on_playing?.(false)
      on_error?.()
      return
    }
    cursor = next
    player.src = tracks[next].src
    announce()
    // play owns autoplay/media rejection handling through gesture retry or fail_track.
    if (!paused_by_user && !fight_paused) void play() // the boundary is exactly where the stream must NOT stall
  }
  const fail_track = (failed_cursor, error) => {
    if (dead_indices.has(failed_cursor)) return
    dead_indices = new Set([...dead_indices, failed_cursor])
    const failed_track = tracks[failed_cursor]
    console.error(`[hack-radio] skipping failed track "${failed_track.title}" (${failed_track.src})`, error)
    if (failed_cursor === cursor) advance()
  }
  const play = async () => {
    const playing_cursor = cursor
    try {
      await player.play()
    } catch (error) {
      if (error?.name === 'NotAllowedError') arm_gesture_retry()
      else fail_track(playing_cursor, error)
    }
  }
  const on_ended = advance
  const on_play = () => on_playing?.(true)
  const on_pause = () => on_playing?.(false)
  const on_media_error = (error) => fail_track(cursor, error)

  player.addEventListener('ended', on_ended)
  player.addEventListener('play', on_play)
  player.addEventListener('pause', on_pause)
  player.addEventListener('error', on_media_error)
  announce()
  // play owns autoplay/media rejection handling through gesture retry or fail_track.
  if (!fight_paused) void play() // a fight already live when the widget mounts never gets its opening beat

  return {
    toggle: () => {
      if (fight_paused) return undefined // the fight owns the channel — the control cannot resume the album
      paused_by_user = !player.paused
      return paused_by_user ? player.pause() : play()
    },
    // The control's own pointerdown calls this so the window retry cannot start playback a beat before the
    // click that follows would pause it — the button always does exactly what it says.
    dismiss_gesture_retry,
    // FIGHT EDGE (see the doc comment above `create_radio`): pause/resume the SAME element — never a rebuild,
    // so the cursor and the loaded track survive every fight. Idempotent; a manual pause held into the fight
    // stays paused once it ends (checked against `paused_by_user`, never overridden by the fight edge).
    set_fight_paused: (active) => {
      if (active === fight_paused) return
      fight_paused = active
      if (active) {
        dismiss_gesture_retry() // a fight starting mid-retry must not let a later gesture resume it anyway
        if (!player.paused) player.pause()
      } else if (!paused_by_user) {
        // play owns autoplay/media rejection handling through gesture retry or fail_track.
        void play()
      }
    },
    dispose: () => {
      // Unwire BEFORE pausing: a teardown must not push one last state change into a widget that is going away.
      dismiss_gesture_retry()
      player.removeEventListener('ended', on_ended)
      player.removeEventListener('play', on_play)
      player.removeEventListener('pause', on_pause)
      player.removeEventListener('error', on_media_error)
      player.pause()
    },
  }
}

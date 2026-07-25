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

import { walrus_asset_url } from '@aresrpg/sdk/jobs'

import { MUSIC_VOLUME, create_audio } from '../../../core/audio/audio_registry.js'

/** The published asset class carrying the radio's manifest and its files. */
export const HACK_RADIO_CLASS = 'hack_radio'

/**
 * The radio manifest's URL, or null while the class is unpublished — the caller shows its error row rather
 * than inventing a host.
 * @returns {string | null}
 */
export const radio_manifest_url = () => walrus_asset_url(HACK_RADIO_CLASS, `${HACK_RADIO_CLASS}.json`)

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
    const stem = pathname.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
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
 * Build the radio: ONE audio element walking `tracks` in order, looping forever, announcing each track and
 * its play/pause state to the widget. Returns null when there is nothing to play or the environment has no
 * media (headless) — an absent radio, never a crashing one.
 *
 * The cursor is a closure local rather than component state on purpose: "which track is loaded" already has
 * a home in the element's own `src`, and the widget only ever needs the TITLE to render.
 *
 * @param {ReadonlyArray<{ src: string, title: string }>} tracks in manifest order
 * @param {{ on_track?: (title: string) => void, on_playing?: (playing: boolean) => void,
 *           on_error?: () => void, make_audio?: typeof create_audio }} [handlers]
 * @returns {{ toggle: () => void, dispose: () => void } | null}
 */
export function create_radio(tracks, { on_track, on_playing, on_error, make_audio = create_audio } = {}) {
  if (tracks.length === 0) return null
  const player = make_audio(tracks[0].src, { preload: 'none', volume: MUSIC_VOLUME })
  if (!player) return null

  let cursor = 0
  const announce = () => on_track?.(tracks[cursor].title)
  const play = () => Promise.resolve(player.play()).catch(() => on_error?.())
  const on_ended = () => {
    cursor = next_index(cursor, tracks.length)
    player.src = tracks[cursor].src
    announce()
    play() // the boundary is exactly where the stream must NOT stall
  }
  const on_play = () => on_playing?.(true)
  const on_pause = () => on_playing?.(false)
  const on_media_error = () => on_error?.()

  player.addEventListener('ended', on_ended)
  player.addEventListener('play', on_play)
  player.addEventListener('pause', on_pause)
  player.addEventListener('error', on_media_error)
  announce()

  return {
    toggle: () => (player.paused ? play() : player.pause()),
    dispose: () => {
      // Unwire BEFORE pausing: a teardown must not push one last state change into a widget that is going away.
      player.removeEventListener('ended', on_ended)
      player.removeEventListener('play', on_play)
      player.removeEventListener('pause', on_pause)
      player.removeEventListener('error', on_media_error)
      player.pause()
    },
  }
}

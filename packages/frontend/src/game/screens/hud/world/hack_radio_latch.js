// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE HACK RADIO'S OWNER (#2260) — module-lifetime custody of the ONE album stream.
//
// WHAT BROKE: playback used to be owned by the widget's effects, so it fired on component ARRIVAL. Every
// canvas refresh (a settings flip re-creates the session in place, and the widget re-mounts with it) built a
// SECOND radio while tearing the first down mid-`play()`: the interrupted promise rejected with AbortError,
// the dying element skipped to the "next" track and kept playing as a ghost, and two starts raced for the
// channel — one `[hack-radio] skipping failed track … AbortError` line per refresh.
//
// THE LAW IT OBEYS (L-P6 — observe deltas, not arrivals): this module folds ONE PROJECTED SLICE of the engine
// state — `hack` (is the live session on the grid) and `fight` (does a fight own the channel), both plain
// booleans taken by value — and acts only on a real change. A re-mount re-observes the SAME slice and does
// exactly NOTHING; only the state that says "leave the grid" ever silences the album. The widget is markup plus
// a subscription; not one line of playback survives in it.
//
// WHY A STANDING OBSERVER AND NOT AN EFFECT: the state that silences the radio (`world_presentation` → terrain
// on session teardown) can land while the widget is already unmounted. Ownership therefore lives here, armed
// once per page load and never disarmed, reading the engine's own STATE_UPDATED door — so stopping is keyed to
// the STATE, exactly like starting, and never to a mount.
//
// AND WHY THE ELEMENT IS HELD, NEVER TORN DOWN: a session re-create dispatches 'terrain' (embed_voxel's
// cleanup) and immediately re-publishes 'hackgrid', so a dispose on that falling edge would restart the album
// at track one on every canvas refresh. The engine is built ONCE and only ever suppressed/released
// (`set_channel_held`) — a fight and being off the grid are the same fact to it: someone else owns the channel.

import { game_log } from '../../../../core/log.js'
import { set_music_stream_owned } from '../../../core/audio/ambient_music.js'
import { context } from '../../../core/game.js'
import { select_hack_presentation } from '../../../core/world_presentation.js'
import { create_radio, load_radio_tracks } from './hack_radio.js'

/** @typedef {{ track: string, playing: boolean, failed: boolean }} RadioSnapshot */

/** What the widget renders before anything has been observed — and what it falls back to off the grid. */
const SILENT = Object.freeze({ track: '', playing: false, failed: false })

/** @type {RadioSnapshot} */
let snapshot = SILENT
/** @type {Set<() => void>} */
let listeners = new Set()
/** @type {ReturnType<typeof create_radio>} */
let radio = null
/** The last OBSERVED slice — the accumulator this module diffs against, never a reference to live state. */
let slice = { hack: false, fight: false }
/** @type {ReadonlyArray<{ src: string, title: string }>} */
let tracks = []
/** @type {Promise<{ tracks: ReadonlyArray<{ src: string, title: string }>, error: boolean }> | null} */
let loading = null
let armed = false
/** Injected seams — the suite drives the latch with no media, no network and no engine. */
let deps = /** @type {{ make_audio?: any, gesture_target?: any, load_tracks?: any }} */ ({})

/** The engine's own state door: the standing observer reads truth here, not from a component. */
const engine_source = {
  /** @param {() => void} on_change */
  subscribe: (on_change) => context.events.on('STATE_UPDATED', on_change),
  get_state: () => context.get_state(),
}

/** The projection: two booleans BY VALUE, the whole input this module has. @returns {{hack: boolean, fight: boolean}} */
const project = (state) => ({ hack: select_hack_presentation(state ?? {}), fight: !!state?.fight_mode })

/** @param {Partial<RadioSnapshot>} patch */
const publish = (patch) => {
  snapshot = { ...snapshot, ...patch }
  for (const notify of [...listeners]) notify()
}

/** Who owns the music channel: the album owns it only ON the grid and OUT of a fight. */
const channel_held = () => !slice.hack || slice.fight

const start_radio = () => {
  if (radio || tracks.length === 0) return // ONE element, whatever the mount count — never a second engine
  radio = create_radio(tracks, {
    on_track: (title) => publish({ track: title }),
    on_playing: (playing) => publish({ playing }),
    on_error: () => publish({ failed: true }), // never a silent failure — the widget says so on its track line
    channel_held: channel_held(), // a fight already live when the grid is reached gets no opening beat
    make_audio: deps.make_audio,
    gesture_target: deps.gesture_target,
  })
}

// ONE fetch: the manifest is loaded on the first rising edge and CACHED for the page. Re-entering the grid
// replays the cached list (never a second request), and a failed load leaves the cache empty so the next
// rising edge — never a re-mount — may try again. Absence is never cached as success.
const arm_tracks = () => {
  if (tracks.length > 0) {
    start_radio()
    return
  }
  if (loading) return // a load already in flight owns the start
  loading = (deps.load_tracks ?? load_radio_tracks)()
  // The loader converts every failure into data, so this detached promise cannot reject.
  void loading.then((result) => {
    loading = null
    tracks = result.tracks
    publish({ failed: result.error })
    if (slice.hack) start_radio() // the grid may already be gone — a late manifest never starts a ghost
  })
}

/**
 * Fold one projected slice and act ONLY on a real delta. Idempotent by construction: called with an unchanged
 * slice — exactly what a re-mount produces — it changes nothing.
 * @param {{ hack: boolean, fight: boolean }} next
 * @returns {void}
 */
export function observe_radio(next) {
  const hack = !!next.hack
  const fight = !!next.fight
  if (hack === slice.hack && fight === slice.fight) return // the re-mount path: not one call further
  slice = { hack, fight }
  if (hack) arm_tracks() // the first grid arrival builds the ONE engine; every later one finds it already there
  // The SAME element is only ever HELD and RELEASED — never torn down. A session re-create blips the
  // presentation through 'terrain' (embed_voxel's cleanup) and straight back, so a dispose here would restart
  // the album at track one on every canvas refresh: exactly the symptom, one layer down (#2260).
  radio?.set_channel_held(channel_held())
  // The channel handoff (D226): our beds stand down for exactly as long as the album owns the channel, and a
  // fight gives the channel straight back so the world's own battle track plays. Delta-guarded downstream.
  set_music_stream_owned(!channel_held())
}

/**
 * Arm the standing observer. Idempotent and PERMANENT: the first mount wires it, every later mount is a no-op
 * and nothing ever disarms it — that is the whole fix for #2260.
 * @param {{ source?: typeof engine_source, make_audio?: any, gesture_target?: any, load_tracks?: any }} [options]
 * @returns {void}
 */
export function arm_radio_latch({ source = engine_source, make_audio, gesture_target, load_tracks } = {}) {
  if (armed) return
  armed = true
  deps = { make_audio, gesture_target, load_tracks }
  game_log('hack-radio', 'latch armed')
  source.subscribe(() => observe_radio(project(source.get_state())))
  observe_radio(project(source.get_state())) // the state we armed INTO, not just the edges that follow
}

/**
 * The widget's read door (useSyncExternalStore): the snapshot object is replaced only on a real change, so a
 * re-render never loops and a re-mount immediately sees the LIVE track instead of a loading line.
 * @param {() => void} notify @returns {() => void}
 */
export const subscribe_radio = (notify) => {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

/** @returns {RadioSnapshot} */
export const radio_snapshot = () => snapshot

/** The player's override — a no-op while nothing owns the channel. @returns {void} */
export const radio_toggle = () => void radio?.toggle()

/** The control's own pointerdown, so a pending autoplay retry cannot pre-empt the click. @returns {void} */
export const radio_dismiss_gesture_retry = () => void radio?.dismiss_gesture_retry()

/** Test seam: drop the element, the observer and every cached fact. @returns {void} */
export function _reset_radio_latch_for_test() {
  radio?.dispose()
  radio = null
  listeners = new Set()
  snapshot = SILENT
  slice = { hack: false, fight: false }
  tracks = []
  loading = null
  armed = false
  deps = {}
}

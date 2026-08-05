// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2260 — THE RADIO STARTED TWICE ON EVERY CANVAS REFRESH. Playback was owned by HackRadioPlayer's effects, so
// it fired on component ARRIVAL: a session re-create re-mounted the widget, built a SECOND radio, and disposed
// the first one mid-`play()`. `play()` settles only when playback really starts, so that dispose's `pause()`
// rejected the pending promise with AbortError — which the engine classified as a broken track: it logged
// `[hack-radio] skipping failed track … AbortError: The play() request was interrupted by a call to pause()`,
// buried a healthy row, and ADVANCED the torn-down element, which then played on as a ghost beside the new one.
//
// Two halves, one bug, one file:
//   (a) the engine must never read a teardown's interrupted play() as a dead track;
//   (b) ownership must sit behind a module-lifetime latch that observes STATE DELTAS (L-P6), so re-mounting
//       the widget with unchanged state starts nothing at all — while a real change still transitions the ONE
//       element.
//
// RED (origin/edge 18f01379, engine + ownership as shipped — the same claims driven against that engine, whose
// hold door was still named `set_fight_paused`): (a) `{ src: 'b.m4a', plays: 2, errors: 0, logged: 1 }` — the
// disposed element skipped to the next track and printed the AbortError line; (b) `{ elements: 2, plays: [2, 1] }`
// — two mounts built TWO audio elements. GREEN: below.
//
// Headless by construction — an injected audio factory, an injected manifest loader and an injected state
// source. No jsdom, no network, no `mock.module` (it is process-global in bun and three suites already own
// that door).
import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { install_browser_globals } from '../../../../../src/test_helpers/browser_globals.js'

beforeAll(() => install_browser_globals({ with_document: true }))

const { create_radio } = await import('../../../../../src/game/screens/hud/world/hack_radio.js')
const { _reset_radio_latch_for_test, arm_radio_latch, radio_snapshot, subscribe_radio } =
  await import('../../../../../src/game/screens/hud/world/hack_radio_latch.js')

const TRACKS = [
  { src: 'a.m4a', title: 'A' },
  { src: 'b.m4a', title: 'B' },
]

/**
 * A stand-in HTMLAudioElement holding the REAL browser contract this bug rides on: `play()` stays PENDING
 * until playback actually starts, and a `pause()` landing meanwhile rejects it with AbortError.
 */
function fake_audio(src) {
  const listeners = /** @type {Record<string, Function[]>} */ ({})
  let interrupt = null
  return {
    src,
    paused: true,
    volume: 1,
    preload: '',
    plays: 0,
    addEventListener: (type, fn) => (listeners[type] = [...(listeners[type] ?? []), fn]),
    removeEventListener: (type, fn) => (listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)),
    play() {
      this.plays += 1
      this.paused = false
      listeners.play?.forEach((fn) => fn())
      return new Promise((_resolve, reject) => {
        interrupt = () => {
          const error = new Error('The play() request was interrupted by a call to pause().')
          error.name = 'AbortError'
          reject(error)
        }
      })
    },
    pause() {
      this.paused = true
      listeners.pause?.forEach((fn) => fn())
      interrupt?.()
      interrupt = null
    },
    emit: (type, event) => listeners[type]?.forEach((fn) => fn(event)),
    listener_count: () => Object.values(listeners).reduce((n, fns) => n + fns.length, 0),
  }
}

/** A stand-in engine state door: the latch subscribes to it exactly as it subscribes to STATE_UPDATED. */
function fake_source(initial) {
  let state = initial
  const observers = []
  return {
    subscribe: (on_change) => observers.push(on_change),
    get_state: () => state,
    /** Publish a new engine state — including the SAME one again, which is what a canvas refresh does. */
    publish: (next = state) => {
      state = next
      observers.forEach((on_change) => on_change())
    },
    observer_count: () => observers.length,
  }
}

/** Let the pending play()/manifest promises settle — a rejection is only observable after its microtask. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => _reset_radio_latch_for_test())

describe('#2260 the engine, on teardown', () => {
  test('a dispose landing mid-play is NOT a dead track — no AbortError line, no ghost advance', async () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {})
    let audio
    let errors = 0
    const radio = create_radio(TRACKS, {
      on_error: () => errors++,
      gesture_target: null,
      make_audio: (src) => (audio = fake_audio(src)),
    })
    expect(audio.plays).toBe(1) // the normal autostart, its promise still pending

    radio.dispose() // the widget goes away — pause() interrupts that pending play()
    await settle()

    expect({ src: audio.src, plays: audio.plays, errors, logged: logged.mock.calls.length }).toEqual({
      src: 'a.m4a', // the torn-down element never advanced
      plays: 1, // and never played again
      errors: 0,
      logged: 0, // the console line from the issue is gone
    })
    logged.mockRestore()
  })

  test('a hold pausing a pending play never buries the track it interrupted', async () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {})
    let audio
    const radio = create_radio(TRACKS, { gesture_target: null, make_audio: (src) => (audio = fake_audio(src)) })
    radio.set_channel_held(true) // a fight (or leaving the grid) pauses the SAME element mid-play()
    await settle()
    expect({ src: audio.src, logged: logged.mock.calls.length }).toEqual({ src: 'a.m4a', logged: 0 })

    radio.set_channel_held(false) // and the track it was on is still the one that resumes
    expect({ src: audio.src, plays: audio.plays }).toEqual({ src: 'a.m4a', plays: 2 })
    radio.dispose()
    logged.mockRestore()
  })
})

describe('#2260 the latch, across mounts', () => {
  /** One widget mount: it arms the standing observer and subscribes to the snapshot. Nothing else. */
  const mount = (source, audios) => {
    arm_radio_latch({
      source,
      gesture_target: null,
      make_audio: (src) => {
        const audio = fake_audio(src)
        audios.push(audio)
        return audio
      },
      load_tracks: async () => ({ tracks: TRACKS, error: false }),
    })
    const unsubscribe = subscribe_radio(() => {})
    return () => unsubscribe() // the unmount — it must NOT stop the music
  }

  test('two mounts with unchanged state own ONE element and ONE play — a canvas refresh starts nothing', async () => {
    const audios = []
    const source = fake_source({ world_presentation: 'hackgrid', fight_mode: false })
    const unmount = mount(source, audios)
    await settle()
    expect({ elements: audios.length, plays: audios[0].plays }).toEqual({ elements: 1, plays: 1 })

    unmount() // the canvas refresh: the widget goes away…
    source.publish() // …the session republishes the SAME presentation…
    mount(source, audios) // …and the widget comes back
    await settle()

    expect({ elements: audios.length, plays: audios[0].plays, paused: audios[0].paused }).toEqual({
      elements: 1, // ONE audio element ever existed
      plays: 1, // started exactly once
      paused: false, // and the album never stopped for the re-mount
    })
    expect(source.observer_count()).toBe(1) // one standing observer, not one per mount
    expect(radio_snapshot().track).toBe('A') // the re-mounted widget reads the LIVE track, not a loading line

    // The FULL refresh, blip included: embed_voxel's cleanup dispatches 'terrain' before the fresh session
    // re-publishes 'hackgrid'. Still ONE element, still track one — held and released, never rebuilt.
    source.publish({ world_presentation: 'terrain', fight_mode: false })
    source.publish({ world_presentation: 'hackgrid', fight_mode: false })
    mount(source, audios)
    await settle()
    expect({ elements: audios.length, src: audios[0].src, paused: audios[0].paused }).toEqual({
      elements: 1,
      src: 'a.m4a',
      paused: false,
    })
  })

  test('a real state change still transitions the ONE element', async () => {
    const audios = []
    const source = fake_source({ world_presentation: 'hackgrid', fight_mode: false })
    mount(source, audios)
    await settle()

    audios[0].emit('ended') // the track boundary — a real change of what is playing
    expect({ src: audios[0].src, plays: audios[0].plays, track: radio_snapshot().track }).toEqual({
      src: 'b.m4a',
      plays: 2,
      track: 'B',
    })

    source.publish({ world_presentation: 'hackgrid', fight_mode: true }) // a fight takes the channel
    expect(audios[0].paused).toBe(true)
    source.publish({ world_presentation: 'hackgrid', fight_mode: false }) // and hands it back where it left off
    expect({ src: audios[0].src, paused: audios[0].paused }).toEqual({ src: 'b.m4a', paused: false })

    source.publish({ world_presentation: 'terrain', fight_mode: false }) // leaving the grid IS the stop signal
    expect({ elements: audios.length, paused: audios[0].paused }).toEqual({ elements: 1, paused: true })

    // …and a session re-create is exactly that same blip in reverse (embed_voxel's cleanup dispatches 'terrain',
    // the fresh session re-publishes 'hackgrid'): the album resumes on the track it was on, never at track one.
    source.publish({ world_presentation: 'hackgrid', fight_mode: false })
    expect({
      elements: audios.length,
      src: audios[0].src,
      paused: audios[0].paused,
      track: radio_snapshot().track,
    }).toEqual({ elements: 1, src: 'b.m4a', paused: false, track: 'B' })
  })
})

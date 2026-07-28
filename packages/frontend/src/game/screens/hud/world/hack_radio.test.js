// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The hack radio's manifest door and its sequential engine. Both halves are headless by construction — the
// parser is pure, the engine takes an injected audio factory — so this suite needs no jsdom and no network.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { configure_assets, reset_assets_for_test } from '@aresrpg/sdk/jobs'

import { create_radio, load_radio_tracks, next_index, parse_radio_manifest, radio_manifest_url } from './hack_radio.js'

const HOST = 'https://assets.aresrpg.world'
const publish = () => configure_assets({ aggregator: HOST, classes: { hack_radio: { published: true } } })

/**
 * A stand-in HTMLAudioElement: records listeners so a test can fire the real events the engine listens for.
 * `blocked` reproduces the browser autoplay policy — play() rejects with NotAllowedError until a gesture.
 */
function fake_audio(src, { blocked = false } = {}) {
  const listeners = /** @type {Record<string, Function[]>} */ ({})
  return {
    src,
    paused: true,
    volume: 1,
    preload: '',
    plays: 0,
    refusals: 0,
    blocked,
    addEventListener: (type, fn) => (listeners[type] = [...(listeners[type] ?? []), fn]),
    removeEventListener: (type, fn) => (listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)),
    play() {
      if (this.blocked) {
        this.refusals++
        const refusal = new Error("play() failed because the user didn't interact with the document first")
        refusal.name = 'NotAllowedError'
        return Promise.reject(refusal)
      }
      this.plays++
      this.paused = false
      listeners.play?.forEach((fn) => fn())
      return Promise.resolve()
    },
    pause() {
      this.paused = true
      listeners.pause?.forEach((fn) => fn())
    },
    emit: (type) => listeners[type]?.forEach((fn) => fn()),
    listener_count: () => Object.values(listeners).reduce((n, fns) => n + fns.length, 0),
  }
}

/** A stand-in window for the one-shot autoplay retry — the engine never touches the real one in this suite. */
function fake_gestures() {
  const listeners = /** @type {Record<string, Function[]>} */ ({})
  return {
    addEventListener: (type, fn) => (listeners[type] = [...(listeners[type] ?? []), fn]),
    removeEventListener: (type, fn) => (listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)),
    emit: (type) => [...(listeners[type] ?? [])].forEach((fn) => fn()),
    listener_count: () => Object.values(listeners).reduce((n, fns) => n + fns.length, 0),
  }
}

/** Let the play() promise settle — the autoplay refusal is only observable after its rejection lands. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const MANIFEST = {
  tracks: [
    { file: 'music/hack_radio/static.m4a', title: 'Static' },
    { file: 'music/hack_radio/on_the_run.m4a', title: 'On the Run' },
  ],
}

afterEach(() => reset_assets_for_test())

describe('the radio manifest', () => {
  test('resolves off the asset host as a data blob — never a hardcoded origin in our code', () => {
    publish()
    expect(radio_manifest_url()).toBe(`${HOST}/data/hack_radio.json`)
  })

  test('is null until the class is published — the caller shows its error row instead of guessing a host', () => {
    expect(radio_manifest_url()).toBeNull()
  })

  test('re-homes each track path onto the manifest ROOT, in manifest order', () => {
    const tracks = parse_radio_manifest(MANIFEST, `${HOST}/data/hack_radio.json`)
    expect(tracks).toEqual([
      { src: `${HOST}/music/hack_radio/static.m4a`, title: 'Static' },
      { src: `${HOST}/music/hack_radio/on_the_run.m4a`, title: 'On the Run' },
    ])
  })

  test('drops rows with no file and never throws on a malformed body — untrusted data, not instructions', () => {
    const base = `${HOST}/data/hack_radio.json`
    expect(parse_radio_manifest({ tracks: [{ title: 'orphan' }, ...MANIFEST.tracks] }, base)).toHaveLength(2)
    expect(parse_radio_manifest(null, base)).toEqual([])
    expect(parse_radio_manifest({ tracks: 'nope' }, base)).toEqual([])
    expect(parse_radio_manifest({ tracks: [{ file: 'a.m4a' }] }, base)[0].title).toBe('a')
  })

  test('a track path can never escape the asset host, whatever the manifest says', () => {
    const tracks = parse_radio_manifest(
      { tracks: [{ file: 'https://evil.example/x.m4a', title: 'x' }, { file: '../../etc/passwd', title: 'y' }] },
      `${HOST}/data/hack_radio.json`,
    )
    for (const track of tracks) expect(track.src.startsWith(`${HOST}/`)).toBe(true)
  })
})

describe('loading the tracks', () => {
  test('fetches the manifest and returns its tracks — the empty→populated transition', async () => {
    publish()
    const fetch_impl = mock(async () => ({ ok: true, json: async () => MANIFEST }))
    const result = await load_radio_tracks({ fetch_impl })
    expect(fetch_impl).toHaveBeenCalledTimes(1)
    expect(fetch_impl.mock.calls[0][0]).toBe(`${HOST}/data/hack_radio.json`)
    expect(result).toEqual({ tracks: parse_radio_manifest(MANIFEST, `${HOST}/data/hack_radio.json`), error: false })
  })

  test('a failed fetch is DATA, never a throw and never silence', async () => {
    publish()
    const dead = await load_radio_tracks({ fetch_impl: async () => ({ ok: false, status: 404 }) })
    expect(dead).toEqual({ tracks: [], error: true })
    const thrown = await load_radio_tracks({
      fetch_impl: async () => {
        throw new Error('offline')
      },
    })
    expect(thrown).toEqual({ tracks: [], error: true })
  })

  test('an EMPTY track list is an error row, not a radio that silently plays nothing', async () => {
    publish()
    expect(await load_radio_tracks({ fetch_impl: async () => ({ ok: true, json: async () => ({ tracks: [] }) }) })).toEqual({
      tracks: [],
      error: true,
    })
  })

  test('an unpublished class never fetches at all', async () => {
    const fetch_impl = mock(async () => ({ ok: true, json: async () => MANIFEST }))
    expect(await load_radio_tracks({ fetch_impl })).toEqual({ tracks: [], error: true })
    expect(fetch_impl).not.toHaveBeenCalled()
  })
})

describe('the sequential engine', () => {
  const tracks = [
    { src: 'a.m4a', title: 'A' },
    { src: 'b.m4a', title: 'B' },
    { src: 'c.m4a', title: 'C' },
  ]

  test('next_index walks forward and LOOPS at the end', () => {
    expect(next_index(0, 3)).toBe(1)
    expect(next_index(2, 3)).toBe(0)
    expect(next_index(0, 0)).toBe(0) // an empty list can never index out of itself
  })

  test('arms the first track, announces it and STARTS ITSELF — arming hack mode IS the intent to hear the album', () => {
    const titles = []
    const states = []
    let audio
    const radio = create_radio(tracks, {
      on_track: (x) => titles.push(x),
      on_playing: (x) => states.push(x),
      make_audio: (src) => (audio = fake_audio(src)),
    })
    expect(audio.src).toBe('a.m4a')
    expect(audio.paused).toBe(false)
    expect(audio.plays).toBe(1)
    expect(titles).toEqual(['A'])
    expect(states).toEqual([true])
    radio.dispose()
  })

  test('a refused autoplay is POLICY, not an error row: the control stays, and the first gesture retries once', async () => {
    const states = []
    let errors = 0
    let audio
    const gestures = fake_gestures()
    const radio = create_radio(tracks, {
      on_playing: (x) => states.push(x),
      on_error: () => errors++,
      gesture_target: gestures,
      make_audio: (src) => (audio = fake_audio(src, { blocked: true })),
    })
    await settle()
    expect(audio.refusals).toBe(1)
    expect(audio.paused).toBe(true) // the widget keeps showing its play button
    expect(errors).toBe(0) // an autoplay refusal must never disable the control
    expect(states).toEqual([])
    expect(gestures.listener_count()).toBe(2) // pointerdown + keydown, armed and waiting

    audio.blocked = false
    gestures.emit('keydown')
    expect(audio.paused).toBe(false)
    expect(states).toEqual([true])
    expect(gestures.listener_count()).toBe(0) // ONE shot — the retry never outlives the gesture that ran it
    radio.dispose()
  })

  test('a play() that fails for a REAL reason still surfaces as an error — only the policy refusal is silent', async () => {
    let errors = 0
    const radio = create_radio(tracks, {
      on_error: () => errors++,
      make_audio: () => ({
        src: 'a.m4a',
        paused: true,
        addEventListener() {},
        removeEventListener() {},
        play: () => Promise.reject(new Error('decode failed')),
        pause() {},
      }),
    })
    await settle()
    expect(errors).toBe(1)
    radio.dispose()
  })

  test('a manual pause is STICKY — no gesture and no track boundary ever restarts the album behind the player', async () => {
    const titles = []
    let audio
    const gestures = fake_gestures()
    const radio = create_radio(tracks, {
      on_track: (x) => titles.push(x),
      gesture_target: gestures,
      make_audio: (src) => (audio = fake_audio(src)),
    })
    radio.toggle() // the player's own pause
    expect(audio.paused).toBe(true)

    audio.emit('ended') // the boundary loads the next track but must NOT resume it
    expect(audio.src).toBe('b.m4a')
    expect(titles).toEqual(['A', 'B'])
    expect(audio.paused).toBe(true)
    expect(audio.plays).toBe(1) // the autostart, and nothing since

    gestures.emit('pointerdown')
    expect(audio.plays).toBe(1)
    radio.toggle() // only the button brings it back
    expect(audio.paused).toBe(false)
    radio.dispose()
  })

  test('the control cancels a pending retry on its own pointerdown, so the click that follows means what it says', async () => {
    let audio
    const gestures = fake_gestures()
    const radio = create_radio(tracks, {
      gesture_target: gestures,
      make_audio: (src) => (audio = fake_audio(src, { blocked: true })),
    })
    await settle()
    expect(gestures.listener_count()).toBe(2)

    radio.dismiss_gesture_retry() // the button's pointerdown, before the click reaches toggle
    audio.blocked = false
    gestures.emit('pointerdown')
    expect(audio.paused).toBe(true) // the retry did not fire — the click alone decides
    radio.toggle()
    expect(audio.paused).toBe(false)
    radio.dispose()
  })

  test('an ended track auto-advances in manifest order and LOOPS back to the first', () => {
    const titles = []
    let audio
    const radio = create_radio(tracks, { on_track: (x) => titles.push(x), make_audio: (src) => (audio = fake_audio(src)) })
    audio.emit('ended')
    expect(audio.src).toBe('b.m4a')
    audio.emit('ended')
    expect(audio.src).toBe('c.m4a')
    audio.emit('ended')
    expect(audio.src).toBe('a.m4a') // loop
    expect(titles).toEqual(['A', 'B', 'C', 'A'])
    expect(audio.plays).toBe(4) // the autostart + one per advance — the stream never stalls on a boundary
    radio.dispose()
  })

  test('a media error surfaces — no silent failure', () => {
    let audio
    let errors = 0
    const radio = create_radio(tracks, { on_error: () => errors++, make_audio: (src) => (audio = fake_audio(src)) })
    audio.emit('error')
    expect(errors).toBe(1)
    radio.dispose()
  })

  test('dispose stops the element and unwires every listener — a remount never leaves a ghost playing', async () => {
    let audio
    const gestures = fake_gestures()
    const radio = create_radio(tracks, { gesture_target: gestures, make_audio: (src) => (audio = fake_audio(src)) })
    radio.dispose()
    expect(audio.paused).toBe(true)
    expect(audio.listener_count()).toBe(0)
    expect(gestures.listener_count()).toBe(0)
  })

  test('a disposed radio leaves NO armed gesture behind — hack mode off can never start music later', async () => {
    let audio
    const gestures = fake_gestures()
    const radio = create_radio(tracks, {
      gesture_target: gestures,
      make_audio: (src) => (audio = fake_audio(src, { blocked: true })),
    })
    await settle()
    expect(gestures.listener_count()).toBe(2)
    radio.dispose()
    expect(gestures.listener_count()).toBe(0)
    audio.blocked = false
    gestures.emit('pointerdown')
    expect(audio.plays).toBe(0)
  })

  test('no tracks and no audio element both yield no radio at all', () => {
    expect(create_radio([], { make_audio: (src) => fake_audio(src) })).toBeNull()
    expect(create_radio(tracks, { make_audio: () => null })).toBeNull() // headless env — inert, never a crash
  })
})

// FIGHT-MUSIC HANDOFF (owner ruling): a fight in hack mode plays the SAME world fight-music pool, so the
// album must never sound over it. These pin set_fight_paused — the SAME element pauses/resumes, never a
// rebuild, so the album keeps its place across every fight.
describe('the fight-music handoff', () => {
  const tracks = [
    { src: 'a.m4a', title: 'A' },
    { src: 'b.m4a', title: 'B' },
  ]

  test('a fight already live when the widget mounts gets no opening beat at all', () => {
    let audio
    const radio = create_radio(tracks, { fight_active: true, make_audio: (src) => (audio = fake_audio(src)) })
    expect(audio.plays).toBe(0)
    expect(audio.paused).toBe(true)
    radio.dispose()
  })

  test('set_fight_paused pauses the SAME element on the fight edge — no rebuild, cursor preserved', () => {
    const titles = []
    let audio
    const radio = create_radio(tracks, {
      on_track: (x) => titles.push(x),
      make_audio: (src) => (audio = fake_audio(src)),
    })
    expect(audio.plays).toBe(1) // the normal autostart — no fight yet
    audio.emit('ended') // move off track A so the "cursor preserved" claim is meaningful
    expect(audio.src).toBe('b.m4a')

    radio.set_fight_paused(true)
    expect(audio.paused).toBe(true)
    expect(audio.src).toBe('b.m4a') // still the SAME element/track — never torn down and rebuilt

    radio.set_fight_paused(false)
    expect(audio.paused).toBe(false)
    expect(audio.src).toBe('b.m4a') // resumed exactly where the fight found it, not restarted at track one
    expect(titles).toEqual(['A', 'B']) // no extra announce/restart round-trip
    radio.dispose()
  })

  test('the control refuses to resume the album while a fight owns the channel', () => {
    let audio
    const radio = create_radio(tracks, { make_audio: (src) => (audio = fake_audio(src)) })
    radio.set_fight_paused(true)
    expect(audio.paused).toBe(true)
    radio.toggle() // the player clicking play mid-fight must be a no-op
    expect(audio.paused).toBe(true)
    expect(audio.plays).toBe(1) // the autostart only — the click never re-played it
    radio.dispose()
  })

  test('a manual pause held INTO a fight stays paused once the fight ends — the fight edge never overrides it', () => {
    let audio
    const radio = create_radio(tracks, { make_audio: (src) => (audio = fake_audio(src)) })
    radio.toggle() // the player's own pause, before any fight
    expect(audio.paused).toBe(true)

    radio.set_fight_paused(true)
    expect(audio.paused).toBe(true)
    radio.set_fight_paused(false) // fight ends — a manual pause outranks the fight edge
    expect(audio.paused).toBe(true) // still paused — only the button brings it back
    radio.dispose()
  })

  test('a track boundary reached while fight-paused does not resume the stream', () => {
    let audio
    const radio = create_radio(tracks, { make_audio: (src) => (audio = fake_audio(src)) })
    radio.set_fight_paused(true)
    expect(audio.paused).toBe(true)
    audio.emit('ended') // an ended event landing mid-fight must never restart playback
    expect(audio.paused).toBe(true)
    expect(audio.src).toBe('b.m4a') // the boundary still advances the cursor — only playback is suppressed
    radio.dispose()
  })

  test('set_fight_paused is idempotent — a repeated edge is a no-op, never a double pause/play', () => {
    let audio
    const radio = create_radio(tracks, { make_audio: (src) => (audio = fake_audio(src)) })
    radio.set_fight_paused(true)
    radio.set_fight_paused(true) // repeated true edge
    expect(audio.paused).toBe(true)
    radio.set_fight_paused(false)
    expect(audio.plays).toBe(2) // the autostart + the ONE resume — a repeated false edge would double this
    radio.set_fight_paused(false)
    expect(audio.plays).toBe(2)
    radio.dispose()
  })
})

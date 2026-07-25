// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The hack radio's manifest door and its sequential engine. Both halves are headless by construction — the
// parser is pure, the engine takes an injected audio factory — so this suite needs no jsdom and no network.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { configure_walrus_assets, reset_walrus_assets_for_test } from '@aresrpg/sdk/jobs'

import { create_radio, load_radio_tracks, next_index, parse_radio_manifest, radio_manifest_url } from './hack_radio.js'

const HOST = 'https://assets.aresrpg.world'
const publish = () => configure_walrus_assets({ aggregator: HOST, classes: { hack_radio: { published: true } } })

/** A stand-in HTMLAudioElement: records listeners so a test can fire the real events the engine listens for. */
function fake_audio(src) {
  const listeners = /** @type {Record<string, Function[]>} */ ({})
  return {
    src,
    paused: true,
    volume: 1,
    preload: '',
    plays: 0,
    addEventListener: (type, fn) => (listeners[type] = [...(listeners[type] ?? []), fn]),
    removeEventListener: (type, fn) => (listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)),
    play() {
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

const MANIFEST = {
  tracks: [
    { file: 'music/hack_radio/static.m4a', title: 'Static' },
    { file: 'music/hack_radio/on_the_run.m4a', title: 'On the Run' },
  ],
}

afterEach(() => reset_walrus_assets_for_test())

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

  test('arms the first track and announces it, paused — playback waits for the user gesture', () => {
    const titles = []
    let audio
    const radio = create_radio(tracks, { on_track: (x) => titles.push(x), make_audio: (src) => (audio = fake_audio(src)) })
    expect(audio.src).toBe('a.m4a')
    expect(audio.paused).toBe(true)
    expect(audio.plays).toBe(0)
    expect(titles).toEqual(['A'])
    radio.dispose()
  })

  test('toggle plays, then pauses, and reports both to the widget', () => {
    const states = []
    let audio
    const radio = create_radio(tracks, { on_playing: (x) => states.push(x), make_audio: (src) => (audio = fake_audio(src)) })
    radio.toggle()
    expect(audio.paused).toBe(false)
    radio.toggle()
    expect(audio.paused).toBe(true)
    expect(states).toEqual([true, false])
    radio.dispose()
  })

  test('an ended track auto-advances in manifest order and LOOPS back to the first', () => {
    const titles = []
    let audio
    const radio = create_radio(tracks, { on_track: (x) => titles.push(x), make_audio: (src) => (audio = fake_audio(src)) })
    radio.toggle()
    audio.emit('ended')
    expect(audio.src).toBe('b.m4a')
    audio.emit('ended')
    expect(audio.src).toBe('c.m4a')
    audio.emit('ended')
    expect(audio.src).toBe('a.m4a') // loop
    expect(titles).toEqual(['A', 'B', 'C', 'A'])
    expect(audio.plays).toBe(4) // the first toggle + one per advance — the stream never stalls on a boundary
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

  test('dispose stops the element and unwires every listener — a remount never leaves a ghost playing', () => {
    let audio
    const radio = create_radio(tracks, { make_audio: (src) => (audio = fake_audio(src)) })
    radio.toggle()
    radio.dispose()
    expect(audio.paused).toBe(true)
    expect(audio.listener_count()).toBe(0)
  })

  test('no tracks and no audio element both yield no radio at all', () => {
    expect(create_radio([], { make_audio: (src) => fake_audio(src) })).toBeNull()
    expect(create_radio(tracks, { make_audio: () => null })).toBeNull() // headless env — inert, never a crash
  })
})

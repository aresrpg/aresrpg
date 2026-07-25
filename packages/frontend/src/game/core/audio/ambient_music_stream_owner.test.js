// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HACK MODE — "start streaming this playlist instead of our musics": while the YouTube mini-player holds the
// music channel, the game's OWN beds must be silent AND unable to re-arm themselves. This pins the seam
// (ambient_music's `stream_owned` gate) at the three doors that can start audio: the zone arm (region
// follower / boot arm / follow.ts), the HUD unmute, and a world fight's self-arm — plus the restore when the
// channel comes back. One owner per channel is the same D226 law follow.ts already lives under.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../../test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals({ with_document: true })
const audio_descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Audio')
const players = []

class FakeAudio {
  constructor(src) {
    this.src = src
    this.paused = true
    this.play_calls = 0
    players.push(this)
  }

  addEventListener() {}

  getAttribute(name) {
    return name === 'src' ? this.src : null
  }

  load() {
    this.paused = true
  }

  pause() {
    this.paused = true
  }

  play() {
    this.play_calls++
    this.paused = false
    return Promise.resolve()
  }
}

Object.defineProperty(globalThis, 'Audio', { configurable: true, writable: true, value: FakeAudio })
const music = await import('./ambient_music.js')
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
const sounding = () => players.filter((player) => !player.paused)

beforeEach(() => {
  music.reset_ambient_music_for_test()
  players.length = 0
})

afterAll(() => {
  // bun shares ambient_music.js across every file in the run — this suite mutes and hands the channel away,
  // so hand the module back pristine or a later file inherits a muted/stream-owned module.
  music.reset_ambient_music_for_test()
  for (const player of players) player.pause()
  if (audio_descriptor) Object.defineProperty(globalThis, 'Audio', audio_descriptor)
  else delete globalThis.Audio
  restore_browser_globals()
})

describe('the music channel has ONE owner (hack mode streams instead of our musics)', () => {
  test('a zone arm while the stream owns the channel arms the zone but never sounds', async () => {
    music.set_music_stream_owned(true)
    music.set_zone_music('arctic')
    await flush()
    expect(sounding()).toHaveLength(0)
    expect(music.is_playing()).toBe(false)
  })

  test('taking the channel silences a live bed; giving it back restores the SAME armed zone', async () => {
    music.set_zone_music('arctic')
    await flush()
    expect(sounding()).toHaveLength(1)

    music.set_music_stream_owned(true)
    expect(sounding()).toHaveLength(0)
    expect(music.is_playing()).toBe(false)

    music.set_music_stream_owned(false)
    await flush()
    expect(sounding()).toHaveLength(1)
    expect(music.is_playing()).toBe(true)
  })

  test('the HUD unmute records the preference but conjures no sound while the stream owns the channel', async () => {
    music.set_zone_music('arctic')
    await flush()
    music.stop() // player muted
    music.set_music_stream_owned(true)

    music.start() // player unmutes mid-stream
    await flush()
    expect(sounding()).toHaveLength(0)
    expect(music.is_music_enabled()).toBe(true) // the preference is honest, the channel is just not ours
  })

  test('a world fight cannot self-arm a battle bed over the stream', async () => {
    music.set_music_stream_owned(true)
    music.set_combat(true) // no zone armed — the world-fight self-arm path
    await flush()
    expect(sounding()).toHaveLength(0)
  })

  test('the preference itself is untouched — releasing the channel respects a muted player', async () => {
    music.set_zone_music('arctic')
    await flush()
    music.stop()
    music.set_music_stream_owned(true)
    music.set_music_stream_owned(false)
    await flush()
    expect(sounding()).toHaveLength(0)
    expect(music.is_music_enabled()).toBe(false)
  })
})

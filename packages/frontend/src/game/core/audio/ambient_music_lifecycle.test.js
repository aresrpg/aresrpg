// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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

// bun shares ambient_music.js across every test file in the run — a prior file that armed a zone, entered
// combat or muted leaks that state here, so set_zone_music's "one active stream" assumption breaks (a muted
// module stays silent, an already-started one builds no new element). Reset to pristine before each test.
beforeEach(() => music.reset_ambient_music_for_test())

afterAll(() => {
  music.set_combat(false)
  music.stop_zone_music()
  for (const player of players) player.pause()
  if (audio_descriptor) Object.defineProperty(globalThis, 'Audio', audio_descriptor)
  else delete globalThis.Audio
  restore_browser_globals()
})

describe('ambient music stream lifecycle', () => {
  test('same-zone starts are idempotent, combat replaces roam, and stop leaves one-or-zero streams', async () => {
    music.set_zone_music('arctic')
    await flush()
    expect(players.filter((player) => !player.paused)).toHaveLength(1)

    const first = players.find((player) => !player.paused)
    const first_play_calls = first.play_calls
    music.set_zone_music('arctic')
    await flush()
    expect(players.filter((player) => !player.paused)).toEqual([first])
    expect(first.play_calls).toBe(first_play_calls)

    music.set_combat(true)
    await flush()
    expect(players.filter((player) => !player.paused)).toHaveLength(1)
    expect(players.find((player) => !player.paused)).not.toBe(first)

    music.stop_zone_music()
    expect(players.filter((player) => !player.paused)).toHaveLength(0)
  })

  test('bfcache suspend pauses the stream and repeated resume stays single-instance', async () => {
    music.set_combat(false)
    music.set_zone_music('arctic')
    await flush()
    expect(players.filter((player) => !player.paused)).toHaveLength(1)

    music.suspend_zone_music?.()
    expect(players.filter((player) => !player.paused)).toHaveLength(0)
    music.resume_zone_music?.()
    await flush()
    const active = players.find((player) => !player.paused)
    expect(active).toBeDefined()
    const play_calls = active.play_calls

    music.resume_zone_music?.()
    await flush()
    expect(players.filter((player) => !player.paused)).toEqual([active])
    expect(active.play_calls).toBe(play_calls)
    music.stop_zone_music()
  })
})

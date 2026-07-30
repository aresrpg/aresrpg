// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'

import { create_radio } from '../../../../../src/game/screens/hud/world/hack_radio.js'

test('#825 a dead track is reported and skipped without disabling the remaining radio', () => {
  const listeners = {}
  const audio = {
    src: '',
    paused: true,
    plays: 0,
    addEventListener: (type, listener) => {
      listeners[type] = listener
    },
    removeEventListener: () => {},
    play() {
      this.paused = false
      this.plays += 1
      return Promise.resolve()
    },
    pause() {
      this.paused = true
    },
    emit: (type, event) => listeners[type]?.(event),
  }
  const exhausted = []
  const logged = spyOn(console, 'error').mockImplementation(() => {})
  const radio = create_radio(
    [
      { src: 'dead.m4a', title: 'Dead' },
      { src: 'live.m4a', title: 'Live' },
    ],
    {
      make_audio: (src) => Object.assign(audio, { src }),
      on_error: () => exhausted.push(true),
    }
  )

  audio.emit('error', new Error('decode failed'))

  expect({ src: audio.src, plays: audio.plays, exhausted: exhausted.length, logged: logged.mock.calls.length }).toEqual(
    {
      src: 'live.m4a',
      plays: 2,
      exhausted: 0,
      logged: 1,
    }
  )
  radio.dispose()
  logged.mockRestore()
})

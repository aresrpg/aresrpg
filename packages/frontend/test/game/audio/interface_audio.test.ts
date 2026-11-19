// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { AUDIO_ASSETS } from '../../../src/game/audio/audio_registry.ts'
import { interface_cue } from '../../../src/game/audio/interface_audio.ts'

test('a surface that opens or closes outranks the control that caused it', () => {
  expect(interface_cue(0, 1, false).key).toBe('inventory_open')
  expect(interface_cue(2, 1, true).key).toBe('inventory_close')
})

test('toggles sound lighter than buttons when no surface changes', () => {
  expect(interface_cue(1, 1, true)).toEqual({ key: 'menu_button', volume: 0.25 })
  expect(interface_cue(1, 1, false)).toEqual({ key: 'button_confirm' })
})

test('every interface cue resolves to a shipped sound', () => {
  const cues = [
    interface_cue(0, 1, false),
    interface_cue(1, 0, false),
    interface_cue(0, 0, true),
    interface_cue(0, 0, false),
  ]
  cues.forEach(({ key }) => expect(AUDIO_ASSETS[key]).toBeString())
})

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2032 — a player toast printed `[object Object] Resetting the streams.` in a live session: a raw
// Error/object reached the toast door where a message string belongs, and the door's non-error branch
// stringified it with `String(input)`. The CLASS guard lives at the door itself (both of them: the app
// toast store and the game event-toast stack), never a sweep of every caller — a caller that hands the
// door an object gets its `.message`, and the raw shape still reaches the sanctioned error console.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import i18n from '../src/i18n'
import { use_toast } from '../src/toast'
import { event_toast_store, push_event_toast } from '../src/game/core/toast.js'

afterEach(() => {
  use_toast.setState({ toasts: [] })
})

const last_toast = () => [...use_toast.getState().toasts].pop()

describe('#2032 — no toast ever renders [object Object]', () => {
  test('an Error handed to the INFO channel renders its message, never the object tag', () => {
    use_toast.getState().add(new Error('Resetting the streams.'), 'info')
    expect(last_toast()?.message).toBe('Resetting the streams.')
    expect(last_toast()?.message).not.toContain('[object Object]')
  })

  test('a bare object with a message field renders that message', () => {
    use_toast.getState().add({ message: 'Presence link dropped' }, 'info')
    expect(last_toast()?.message).toBe('Presence link dropped')
  })

  test('a message-less object gets honest generic copy and its raw shape reaches the error console', () => {
    const console_error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      use_toast.getState().add({ code: 'STREAM_RESET' }, 'info')
      expect(last_toast()?.message).toBe(i18n.t('errors.request_failed'))
      expect(last_toast()?.message).not.toContain('[object Object]')
      expect(console_error).toHaveBeenCalled()
    } finally {
      console_error.mockRestore()
    }
  })

  test('a plain string still passes through the door untouched', () => {
    use_toast.getState().add('Resetting the streams.', 'info')
    expect(last_toast()?.message).toBe('Resetting the streams.')
  })

  // The SECOND door: the game event-toast stack takes a title + message pair, rendered adjacently — the
  // exact `<object> <copy>` shape the player reported. Both halves ride the same guard.
  test('the event-toast stack refuses an object title or message', () => {
    const console_error = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const id = push_event_toast({
        state: 'info',
        title: /** @type {any} */ (new Error('Presence link dropped')),
        message: 'Resetting the streams.',
      })
      const entry = event_toast_store.get().find((toast) => toast.id === id)
      expect(entry?.title).toBe('Presence link dropped')
      expect(entry?.message).toBe('Resetting the streams.')
      expect(`${entry?.title} ${entry?.message}`).not.toContain('[object Object]')
    } finally {
      console_error.mockRestore()
    }
  })
})

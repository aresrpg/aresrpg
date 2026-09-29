// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local activation feedback belongs to the shared app lifecycle, not account gameplay state.

import { audio_playback_revision, play_audio } from './audio_registry.ts'

const CONTROL_SELECTOR =
  'button, [role="button"], [role="tab"], [role="switch"], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"]'

const audible_control = (event: Readonly<MouseEvent>): boolean => {
  const control = event.composedPath().find((node) => node instanceof Element && node.matches(CONTROL_SELECTOR)) as
    Element | undefined
  return !!control && !control.closest(':disabled, [aria-disabled="true"], [aria-busy="true"], [inert]')
}

export const observe_interface_audio = (signal: Readonly<AbortSignal>): void => {
  if (typeof document === 'undefined') return
  const pending = new Set<ReturnType<typeof setTimeout>>()
  signal.addEventListener(
    'abort',
    () => {
      pending.forEach(clearTimeout)
      pending.clear()
    },
    { once: true }
  )
  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || !audible_control(event)) return
      const revision = audio_playback_revision()
      // A task boundary waits for the entire native dispatch, including React handlers.
      // Microtasks can run between capture and bubble listeners for trusted clicks.
      const timer = setTimeout(() => {
        pending.delete(timer)
        if (signal.aborted || audio_playback_revision() !== revision) return
        play_audio('button_confirm')
      }, 0)
      pending.add(timer)
    },
    { capture: true, signal }
  )
}

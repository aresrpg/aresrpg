// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local activation feedback belongs to the shared app lifecycle, not account gameplay state.

import { audio_playback_revision, play_audio, prime_carousel_audio } from './audio_registry.ts'

const CONTROL_SELECTOR =
  'button, [role="button"], [role="tab"], [role="switch"], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"]'

const TOGGLE_SELECTOR = '[role="tab"], [role="switch"], [aria-pressed], input[type="checkbox"], input[type="radio"]'
const SURFACE_SELECTOR = 'dialog[open], :popover-open'

type InterfaceCue = Readonly<{ key: string; volume?: number }>

// One activation makes one sound: a surface that opened or closed outranks the control that caused it.
export const interface_cue = (surfaces_before: number, surfaces_after: number, toggle: boolean): InterfaceCue => {
  if (surfaces_after > surfaces_before) return { key: 'inventory_open' }
  if (surfaces_after < surfaces_before) return { key: 'inventory_close' }
  return toggle ? { key: 'menu_button', volume: 0.25 } : { key: 'button_confirm' }
}

const audible_control = (event: Readonly<MouseEvent>): Element | null => {
  const control = event.composedPath().find((node) => node instanceof Element && node.matches(CONTROL_SELECTOR)) as
    Element | undefined
  return control && !control.closest(':disabled, [aria-disabled="true"], [aria-busy="true"], [inert]') ? control : null
}

const open_surfaces = (): number => document.querySelectorAll(SURFACE_SELECTOR).length

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
      const control = event.isTrusted ? audible_control(event) : null
      if (!control) return
      prime_carousel_audio()
      const revision = audio_playback_revision()
      const surfaces = open_surfaces()
      const toggle = control.matches(TOGGLE_SELECTOR)
      // A task boundary waits for the entire native dispatch, including React handlers.
      // Microtasks can run between capture and bubble listeners for trusted clicks.
      const timer = setTimeout(() => {
        pending.delete(timer)
        if (signal.aborted || audio_playback_revision() !== revision) return
        const cue = interface_cue(surfaces, open_surfaces(), toggle)
        play_audio(cue.key, cue.volume)
      }, 0)
      pending.add(timer)
    },
    { capture: true, signal }
  )
}

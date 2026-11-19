// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { start_landing_rain } from './landing_rain.ts'

/** Marks the mounted landing, starts the rain, and reveals each `[data-reveal]` block once it scrolls into the landing viewport. */
export const start_landing_motion = (root: Readonly<HTMLElement>): (() => void) => {
  const reduced =
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in globalThis)
  root.setAttribute('data-motion', reduced ? 'reduced' : 'on')
  if (reduced) return () => root.removeAttribute('data-motion')
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.setAttribute('data-in', '')
        observer.unobserve(entry.target)
      }
    },
    { root, rootMargin: '0px 0px -8% 0px' }
  )
  for (const block of root.querySelectorAll('[data-reveal]')) observer.observe(block)
  const canvas = root.querySelector<HTMLCanvasElement>('[data-landing-rain]')
  const stop_rain = canvas ? start_landing_rain(canvas) : () => undefined
  return () => {
    stop_rain()
    observer.disconnect()
    root.removeAttribute('data-motion')
  }
}

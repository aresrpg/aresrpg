// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useSyncExternalStore } from 'react'

/**
 * Touch INPUT-CAPABILITY hook — does this device expose a coarse pointer (finger / stylus)?
 *
 * DELIBERATELY DISTINCT from the VIEWPORT-WIDTH layout query (`max-width: 1023px`). The two answer
 * different questions and must never be conflated
 * (docs/MOBILE_SUPPORT_PLAN.md §3.1 — "one touch-input module, NOT a unified re-abstraction"):
 *   - iPad in landscape      → `is_touch && !is_mobile`  (touch controls + desktop layout)
 *   - narrow desktop window  → `is_mobile && !is_touch`  (mobile layout, no joystick)
 *
 * Detection = a coarse pointer exists among the device's pointers (`pointer:` OR `any-pointer:` — the
 * latter catches a touchscreen laptop whose PRIMARY pointer is the mouse), belted by
 * `navigator.maxTouchPoints > 0` (which also flags iPadOS-reports-as-Mac). Reactive to changes via the
 * media-query `change` event (attaching/detaching a pointer, DevTools device toggle).
 */

// Structural shape of the bits we probe — lets a fake window drive `detect_touch` under bun:test
// (no DOM there) with zero casts. `window` satisfies it (matchMedia + navigator.maxTouchPoints exist).
type TouchWin = {
  matchMedia?: (query: string) => { matches: boolean }
  navigator?: { maxTouchPoints?: number }
}

// Comma = OR in a media-query list; `.matches` is true if EITHER clause holds.
const query = '(pointer: coarse), (any-pointer: coarse)'

const global_win = (): TouchWin | undefined => (typeof window === 'undefined' ? undefined : window)

/**
 * Pure detector — exported for unit tests (the coarse/fine × touch-points matrix). Defaults to the
 * global `window`; pass a fake to test. Returns false when no window / no APIs (SSR-safe).
 */
export function detect_touch(win: TouchWin | undefined = global_win()): boolean {
  if (!win) return false
  const coarse = typeof win.matchMedia === 'function' && win.matchMedia(query).matches
  const touch_points = (win.navigator?.maxTouchPoints ?? 0) > 0
  return coarse || touch_points
}

/** Subscribe to coarse-pointer changes — exported so the reactive plumbing is unit-testable. No-op
 *  (never throws) when there is no `window`/`matchMedia` (SSR / test without a DOM stub). */
export function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(query)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function get_snapshot() {
  return detect_touch()
}

function get_server_snapshot() {
  return false
}

export function use_is_touch() {
  return useSyncExternalStore(subscribe, get_snapshot, get_server_snapshot)
}

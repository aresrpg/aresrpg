// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useSyncExternalStore } from 'react'

import { is_mobile, on_mobile_change } from '../../core/mobile_mode.js'

const subscribe_mobile = on_mobile_change
const server_mobile = () => false
const PORTRAIT_QUERY = '(orientation: portrait)'

/** React binding for the lead-owned mobile-mode source of truth. */
export function useMobileMode() {
  return useSyncExternalStore(subscribe_mobile, is_mobile, server_mobile)
}

/** One drawer at a time; tapping the active launcher closes it. */
export function next_mobile_drawer(current, requested) {
  return current === requested ? null : requested
}

/** A deliberate downward pull on the sheet handle dismisses it. */
export function mobile_swipe_dismisses(start_y, end_y, threshold = 48) {
  return Number.isFinite(start_y) && Number.isFinite(end_y) && end_y - start_y >= threshold
}

/**
 * A held touch stays a long-press only while it stays still; a real drag cancels it (drag-click gate
 * law — a human's press drifts a few px, so the tolerance must absorb that without arming a false
 * long-press-drag). Used by the simulator paperdoll's touch equivalent for "right-click to clear"
 * (MOBFIX defect #4). `start`/`current` are `{x, y}` client points; either being absent means no press
 * is in flight, so drift can't have been "exceeded".
 */
export function long_press_drift_exceeded(start, current, tolerance_px = 6) {
  if (!start || !current) return false
  return Math.hypot(current.x - start.x, current.y - start.y) > tolerance_px
}

/** Keep the legacy class bytes in the false branch; mobile only appends a modifier. */
export function world_hud_class(mobile, bottom_chrome) {
  return `gw-hud${bottom_chrome ? ' gw-hud--fight' : ''}${mobile ? ' gw-hud--mobile' : ''}`
}

/** Keep the legacy fight-layer class bytes in the false branch. */
export function fight_layer_class(mobile) {
  return `hud-root gw-tab gw-fight-layer${mobile ? ' gw-fight-layer--mobile' : ''}`
}

/**
 * Mobile chrome floats over content: the page switcher is a right-edge handle on EVERY
 * route, so there is no bottom bar to gate. The live game (`in_game`) is full-bleed canvas; meta pages
 * get the floating glass sheet + the re-skinned wallet pod. Desktop passes `mobile: false` (both false).
 */
export function mobile_shell_visibility(mobile, pathname) {
  const in_game = pathname === '/'
  return {
    in_game,
    show_wallet: mobile && !in_game,
  }
}

/** Shared companion-shell modifiers. The false branch adds markers only; mobile owns every compact override. */
export function app_mobile_classes(mobile) {
  return {
    shell: `app-shell${mobile ? ' app-shell--mobile' : ' app-shell--desktop'}`,
    page: `app-page${mobile ? ' app-page--mobile' : ''}`,
    page_header: `app-page-header${mobile ? ' app-page-header--compact' : ''}`,
    page_title: 'app-page-title',
    page_subtitle: `app-page-subtitle${mobile ? ' app-page-subtitle--hidden' : ''}`,
    page_status: `app-page-status${mobile ? ' app-page-status--hidden' : ''}`,
    page_tabs: `app-page-tabs${mobile ? ' app-page-tabs--compact overflow-x-auto overscroll-x-contain' : ''}`,
    stack: `app-mobile-stack flex flex-1 min-h-0${mobile ? ' app-mobile-stack--active flex-col' : ' flex-row'}`,
    chip_row: `app-mobile-chip-row${mobile ? ' app-mobile-chip-row--active' : ''}`,
  }
}

/** The viewport is the fallback truth because orientation lock is optional and may reject. */
export function is_mobile_portrait() {
  return typeof window !== 'undefined' && window.matchMedia?.(PORTRAIT_QUERY).matches === true
}

/** Subscribe to viewport orientation without guessing from a user agent. */
export function on_mobile_orientation_change(listener) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(PORTRAIT_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

// The mobile canvas is EDGE-TO-EDGE by construction (GameWorldHost's position:fixed 100lvw x 100dvh under
// viewport-fit=cover) — no JS viewport measurement. The old effect here sized the canvas from the visual-
// viewport API, whose reported size iOS Safari shrinks by the safe-area insets, letterboxing the game; it is
// deleted, not replaced. `100dvh` handles URL-bar collapse and `interactive-widget=resizes-content` the keyboard.

/**
 * Standards-backed mobile game entry: fullscreen must be requested from the gesture before landscape lock.
 * Both APIs are optional and rejection leaves the portrait overlay as the safe fallback.
 */
export async function request_mobile_landscape(document_ref, screen_ref) {
  const root = document_ref?.documentElement
  let fullscreen = !!document_ref?.fullscreenElement
  let locked = false

  if (!fullscreen && typeof root?.requestFullscreen === 'function') {
    try {
      await root.requestFullscreen({ navigationUI: 'hide' })
      fullscreen = true
    } catch {
      // Unsupported/denied fullscreen is expected on some mobile browsers.
    }
  }

  const orientation = screen_ref?.orientation
  if (typeof orientation?.lock === 'function') {
    try {
      await orientation.lock('landscape')
      locked = true
    } catch {
      // A viewport-driven blocker remains authoritative when lock is unavailable or rejected.
    }
  }

  return { fullscreen, locked }
}

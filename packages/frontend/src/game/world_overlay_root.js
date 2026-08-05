// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2170 — the ONE lifecycle boundary for every world-anchored DOM overlay. The resident engine session may
// survive a route change, but this root does not: route pause detaches the whole family and cancels its one
// shared projection frame. Re-entry reattaches the existing entity nodes and resumes their registered updates.

const ROOT_STYLE = 'position:fixed;inset:0;pointer-events:none;z-index:11'
const LAYER_STYLE = 'position:absolute;inset:0;pointer-events:none'

/**
 * @param {{
 *   request_frame?: (callback: FrameRequestCallback) => number,
 *   cancel_frame?: (handle: number) => void,
 * }} [options]
 */
export function create_world_overlay_root({
  request_frame = requestAnimationFrame,
  cancel_frame = cancelAnimationFrame,
} = {}) {
  const root = document.createElement('div')
  root.setAttribute('data-world-overlay-root', '')
  root.setAttribute('style', ROOT_STYLE)
  /** @type {Set<(now: number) => void>} */
  const frame_subscriptions = new Set()
  let active = false
  let frame_handle = 0

  const frame = (/** @type {number} */ now) => {
    // Schedule first, matching the old independent loops: one bad entity update cannot silently kill every
    // future world-overlay frame. Route pause still cancels this single pending handle synchronously.
    frame_handle = request_frame(frame)
    for (const update of frame_subscriptions) update(now)
  }

  const sync_frame = () => {
    if (active && frame_subscriptions.size && !frame_handle) frame_handle = request_frame(frame)
    else if ((!active || !frame_subscriptions.size) && frame_handle) {
      cancel_frame(frame_handle)
      frame_handle = 0
    }
  }

  return {
    /** A family-specific grouping layer; positioning/z-index live only on this shared root. */
    create_layer() {
      const layer = document.createElement('div')
      layer.setAttribute('data-world-overlay-layer', '')
      layer.setAttribute('style', LAYER_STYLE)
      root.appendChild(layer)
      return layer
    },
    /** Mark + mount a projected entity node through the family's one testable identity. */
    append_nametag(/** @type {HTMLElement} */ nametag, /** @type {HTMLElement} */ layer = root) {
      nametag.setAttribute('data-world-nametag', '')
      layer.appendChild(nametag)
    },
    /** Register projection/position work with the root's single route-bound animation frame. */
    subscribe_frame(/** @type {(now: number) => void} */ update) {
      frame_subscriptions.add(update)
      sync_frame()
      return () => {
        frame_subscriptions.delete(update)
        sync_frame()
      }
    },
    /** The GameWorldHost pause signal is the sole family mount/unmount door. */
    set_active(/** @type {boolean} */ next_active) {
      active = !!next_active
      if (active) document.body.appendChild(root)
      else root.remove()
      sync_frame()
    },
    /** Test/probe seam: registered callbacks are dormant, therefore not live, while the root is detached. */
    live_update_subscriptions() {
      return active ? frame_subscriptions.size : 0
    },
    dispose() {
      active = false
      sync_frame()
      frame_subscriptions.clear()
      root.remove()
    },
  }
}

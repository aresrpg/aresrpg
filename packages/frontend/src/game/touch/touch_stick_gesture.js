// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { clamp_stick_origin, compute_stick_vector, STICK_MAX_RADIUS_PX } from './touch_stick.js'
import { accepts_touch_pointer } from './touch_target.js'

/**
 * Pointer-capture state for the dynamic joystick, kept outside React so gesture arbitration can be
 * fixture-tested without a DOM. UI-owned events are rejected before any movement vector is emitted.
 * @param {{ on_vector: (vector: import('./touch_stick.js').StickVector) => void,
 *   on_visual: (visual: {x:number,y:number,dx:number,dy:number}|null) => void }} callbacks
 */
export function create_touch_stick_gesture({ on_vector, on_visual }) {
  let pointer_id = null
  let origin = { x: 0, y: 0 }
  let capture_target = null

  const release_capture = () => {
    if (pointer_id === null) return
    try {
      capture_target?.releasePointerCapture?.(pointer_id)
    } catch {
      // The browser may have released capture after pointercancel.
    }
  }

  const reset = () => {
    if (pointer_id === null) return false
    release_capture()
    pointer_id = null
    capture_target = null
    on_visual(null)
    on_vector(compute_stick_vector(0, 0))
    return true
  }

  const pointer_down = (event, rect) => {
    if (pointer_id !== null || !accepts_touch_pointer(event, { rect })) return false
    const spawn = clamp_stick_origin(event.clientX - rect.left, event.clientY - rect.top, {
      radius: STICK_MAX_RADIUS_PX,
      min_x: 0,
      min_y: 0,
      max_x: rect.width,
      max_y: rect.height,
    })
    pointer_id = event.pointerId
    origin = spawn
    capture_target = event.currentTarget ?? null
    try {
      capture_target?.setPointerCapture?.(pointer_id)
    } catch {
      // Capture is a resilience enhancement; the session still works without it.
    }
    event.preventDefault?.()
    on_visual({ x: spawn.x, y: spawn.y, dx: 0, dy: 0 })
    on_vector(compute_stick_vector(0, 0))
    return true
  }

  const pointer_move = (event, rect) => {
    if (pointer_id !== event.pointerId) return false
    const vector = compute_stick_vector(event.clientX - rect.left - origin.x, event.clientY - rect.top - origin.y)
    event.preventDefault?.()
    on_visual({ x: origin.x, y: origin.y, dx: vector.clamped_dx, dy: vector.clamped_dy })
    on_vector(vector)
    return true
  }

  const pointer_up = (event) => {
    if (pointer_id !== event.pointerId) return false
    event.preventDefault?.()
    return reset()
  }

  return { pointer_down, pointer_move, pointer_up, reset }
}

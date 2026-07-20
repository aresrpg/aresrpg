// TOUCH LOOK — the roam camera's touch driver. Binds POINTER events on
// the game canvas: a one-finger drag in the look region → look-delta (drained into cam.rotate by the frame
// loop), two fingers → pinch → dolly-delta (drained into cam.dolly). It only ACCUMULATES into touch_input;
// the engine's feed() owns the sensitivity + the actual cam.rotate/cam.dolly calls (one home for the apply).
//
// WHY pointer events, not the engine's own rig: the shoulder rig's PointerLockControls is MOUSE-only
// (mousedown/mousemove + requestPointerLock — pointer_lock.js:44-69) and pointer-lock never engages on
// touch, so the roam camera is dead on touch today (plan §1.2). This is the rescue seam. No engine change.
//
// COEXISTENCE:
//  - The HUD is z-12 and the controls/canvas are z-11; UI targets win hit-testing, while the stick zone owns
//    its admitted pointer through capture. Two thumbs (walk + look) compose without cross-writing.
//  - The FIGHT camera also binds pointer events on this same canvas (embed_voxel_fight_camera.js) but is
//    inert during roam; conversely this module is gated by touch_input.is_active(), which the frame loop
//    sets FALSE the instant a fight/menu/text-focus owns the scene — so exactly one driver is ever live.
//  - preventDefault() + the host's mobile touch-action:none class kill Safari's
//    page-scroll/zoom AND the synthetic compatibility mouse events that would otherwise wake the rig's
//    mouse listeners.
//
// Only touchscreen pointers are handled (pointerType === 'touch'); a stylus/mouse on the same canvas is left
// entirely to the existing desktop path (byte-identical), so an iPad with a trackpad keeps both.

import { add_look, add_pinch, is_active, subscribe_active } from './touch_input.js'
import { accepts_touch_pointer } from './touch_target.js'

/**
 * @param {HTMLCanvasElement | HTMLElement} canvas the game canvas (the rig / fight-cam target)
 * @returns {{ dispose: () => void }}
 */
export function create_touch_look(canvas) {
  /** live touch pointers on the canvas: pointerId → last {x,y}. Size 1 = look drag, 2 = pinch. */
  const pointers = new Map()
  /** last two-finger distance (px) — the pinch baseline; NaN when fewer than two fingers are down. */
  let pinch_prev = NaN

  const clear_pointers = () => {
    for (const pointer_id of pointers.keys()) {
      try {
        canvas.releasePointerCapture(pointer_id)
      } catch {
        // Capture may already have ended with pointercancel.
      }
    }
    pointers.clear()
    pinch_prev = NaN
  }

  /** current straight-line distance between the two live pointers (px). Assumes exactly two. */
  const two_finger_dist = () => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const on_down = (/** @type {PointerEvent} */ e) => {
    if (
      !accepts_touch_pointer(e, {
        active: is_active(),
        rect: canvas.getBoundingClientRect(),
        side: 'right',
      })
    )
      return
    if (pointers.size >= 2) return // one look pointer + one pinch pointer; extra fingers own no gesture
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // Second finger down → open a fresh pinch baseline (no dolly on the touchdown frame itself).
    if (pointers.size === 2) pinch_prev = two_finger_dist()
    try {
      canvas.setPointerCapture(e.pointerId) // survive the finger crossing the HUD / leaving the canvas (D250 idiom)
    } catch {
      /* some pointer types don't capture — harmless */
    }
    e.preventDefault()
  }

  const on_move = (/** @type {PointerEvent} */ e) => {
    const prev = pointers.get(e.pointerId)
    if (!prev) return // not a pointer we're tracking (started off-canvas / while inactive)
    if (!is_active()) {
      clear_pointers()
      return
    }
    const x = e.clientX
    const y = e.clientY
    if (pointers.size >= 2) {
      // PINCH: accumulate the raw px change in finger spread; the frame loop converts to dolly meters + sign
      // (spread-apart = zoom in). Update BOTH tracked points, then re-measure from the new positions.
      prev.x = x
      prev.y = y
      const dist = two_finger_dist()
      if (Number.isFinite(pinch_prev)) add_pinch(dist - pinch_prev)
      pinch_prev = dist
    } else {
      // LOOK: raw px drag delta since this pointer's last position → the rig's rotate accumulator.
      add_look(x - prev.x, y - prev.y)
      prev.x = x
      prev.y = y
    }
    e.preventDefault()
  }

  const release = (/** @type {PointerEvent} */ e) => {
    if (!pointers.delete(e.pointerId)) return
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    // Dropping below two fingers ends the pinch; a lone remaining finger must re-seed its look baseline
    // from its NEXT move (its stored point is stale relative to the just-lifted pinch), which on_move does
    // naturally (it reads prev, not a delta) — so only the pinch baseline needs clearing here.
    pinch_prev = pointers.size === 2 ? two_finger_dist() : NaN
  }

  canvas.addEventListener('pointerdown', on_down)
  canvas.addEventListener('pointermove', on_move)
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  const unsubscribe_active = subscribe_active(() => {
    if (!is_active()) clear_pointers()
  })

  return {
    dispose: () => {
      canvas.removeEventListener('pointerdown', on_down)
      canvas.removeEventListener('pointermove', on_move)
      canvas.removeEventListener('pointerup', release)
      canvas.removeEventListener('pointercancel', release)
      unsubscribe_active()
      clear_pointers()
    },
  }
}

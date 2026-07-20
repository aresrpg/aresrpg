// "Free mouse except when rotating" input scheme (ENG-8) — the exact interaction that was called out
// as "already implemented in the current game". Ported from packages/frontend player-camera.js's
// pointer-lock drag block (the LOCK_DRAG_PX gesture): the OS cursor is FREE and visible by default;
// holding the LEFT button and dragging past a small pixel threshold requests native Pointer Lock and,
// once the browser CONFIRMS it, feeds the raw `movementX/movementY` deltas to `on_rotate` (captured
// mouse, no screen-edge stop, cursor hidden). Releasing the button (or Esc / focus loss) exits the
// lock and restores the cursor. A clean CLICK (no drag past the threshold) never rotates and never
// locks — so click-to-interact stays possible. Wheel deltas go to `on_wheel` (dolly).
//
// This is a plain DOM helper (no three, no engine) so it's the single home for the scheme + trivially
// reusable. It gracefully degrades where Pointer Lock is unavailable (headless automation, some
// embeds): the request rejects, we swallow it, and `on_rotate` simply never fires from a lock — the
// bench drives the camera through the engine setters directly anyway.

/**
 * @typedef {object} PointerLockOptions
 * @property {(dx: number, dy: number) => void} on_rotate called with raw movementX/movementY each
 *   mousemove WHILE pointer-locked (i.e. while the user holds-drags to rotate). dx>0 = mouse right.
 * @property {(delta: number) => void} [on_wheel] called with wheel deltaY (dolly). Optional.
 * @property {number} [drag_threshold_px] pixels the mouse must move with LEFT held before it counts
 *   as a rotate-drag (and requests lock), so a click still fires. Default 6 (the dapp's LOCK_DRAG_PX).
 */

/**
 * @typedef {object} PointerLockControls
 * @property {(element: HTMLElement) => void} attach binds listeners to `element` (+ its document).
 * @property {() => void} detach removes all listeners and exits any active lock.
 * @property {() => boolean} is_locked true while a hold-drag rotate lock is active.
 */

/**
 * @param {PointerLockOptions} options
 * @returns {PointerLockControls}
 */
export function PointerLockControls({ on_rotate, on_wheel, drag_threshold_px = 6 }) {
  /** @type {HTMLElement | null} */
  let el = null
  let armed = false // LEFT button is currently down
  let requested = false // lock requested for this drag (don't spam requestPointerLock)
  let locked = false // lock CONFIRMED active (movementX/Y is now valid)
  let down_x = 0
  let down_y = 0

  const on_mousedown = (/** @type {MouseEvent} */ e) => {
    if (e.button !== 0) return // LEFT only (right = nothing, matching the dapp scheme)
    armed = true
    requested = false
    down_x = e.clientX
    down_y = e.clientY
  }

  const on_mousemove = (/** @type {MouseEvent} */ e) => {
    if (locked) {
      // captured: raw deltas drive rotation
      on_rotate(e.movementX || 0, e.movementY || 0)
      return
    }
    if (!armed || requested) return
    // not yet a drag — has it crossed the threshold?
    if (Math.abs(e.clientX - down_x) + Math.abs(e.clientY - down_y) < drag_threshold_px) return
    requested = true
    // request native lock (Promise rejects when unavailable — swallow so it never surfaces unhandled)
    try {
      const p = /** @type {any} */ (el)?.requestPointerLock?.()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch {
      /* older browsers throw synchronously — degrade to no rotate */
    }
  }

  const on_mouseup = (/** @type {MouseEvent} */ e) => {
    if (e.button !== 0) return
    armed = false
    // Capture BEFORE resetting: only release a lock THIS drag itself requested. `locked` can also be true
    // because some OTHER caller put the pointer in lock (e.g. the world canvas's double-click sticky lock —
    // embed_voxel_cursor_lock.js — which reads/writes the SAME document.pointerLockElement this module reads
    // in on_lock_change). Without this gate, releasing an ordinary gameplay click while that external lock is
    // up would silently kick the pointer back out on every click — the sticky lock owns its own exit instead.
    const self_requested = requested
    requested = false
    if (locked && self_requested && el?.ownerDocument.exitPointerLock) el.ownerDocument.exitPointerLock()
  }

  const on_lock_change = () => {
    locked = !!el && el.ownerDocument.pointerLockElement === el
  }

  const on_wheel_evt = (/** @type {WheelEvent} */ e) => {
    if (on_wheel) {
      e.preventDefault()
      on_wheel(e.deltaY)
    }
  }

  // Losing focus mid-drag must not leave us "armed" forever.
  const on_blur = () => {
    armed = false
    requested = false
  }

  return {
    attach(element) {
      el = element
      element.addEventListener('mousedown', on_mousedown)
      window.addEventListener('mousemove', on_mousemove)
      window.addEventListener('mouseup', on_mouseup)
      element.addEventListener('wheel', on_wheel_evt, { passive: false })
      element.ownerDocument.addEventListener('pointerlockchange', on_lock_change)
      window.addEventListener('blur', on_blur)
    },
    detach() {
      if (!el) return
      el.removeEventListener('mousedown', on_mousedown)
      window.removeEventListener('mousemove', on_mousemove)
      window.removeEventListener('mouseup', on_mouseup)
      el.removeEventListener('wheel', on_wheel_evt)
      el.ownerDocument.removeEventListener('pointerlockchange', on_lock_change)
      window.removeEventListener('blur', on_blur)
      if (locked && el.ownerDocument.exitPointerLock) el.ownerDocument.exitPointerLock()
      el = null
      armed = false
      locked = false
    },
    is_locked: () => locked,
  }
}

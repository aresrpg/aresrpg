// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// "Free mouse except when rotating": cursor free by default; holding LEFT and
// dragging past a small threshold requests native Pointer Lock and feeds raw movementX/Y to
// `on_rotate`; releasing (or Esc / focus loss) restores the cursor. A clean click never rotates.
// Degrades gracefully where Pointer Lock is unavailable (headless automation, embeds).

export type PointerLockOptions = Readonly<{
  on_rotate: (dx: number, dy: number) => void
  on_wheel?: (delta: number) => void
  drag_threshold_px?: number
}>

export type PointerLockControls = Readonly<{
  attach: (element: Readonly<HTMLElement>) => void
  detach: () => void
  is_locked: () => boolean
}>

export const create_pointer_lock_controls = ({
  on_rotate,
  on_wheel,
  drag_threshold_px = 6,
}: PointerLockOptions): PointerLockControls => {
  let el: Readonly<HTMLElement> | null = null
  let armed = false // LEFT button currently down
  let requested = false // lock requested for this drag
  let locked = false // lock CONFIRMED (movementX/Y now valid)
  let down_x = 0
  let down_y = 0

  const on_mousedown = (e: Readonly<MouseEvent>): void => {
    if (e.button !== 0) return
    armed = true
    requested = false
    down_x = e.clientX
    down_y = e.clientY
  }

  const on_mousemove = (e: Readonly<MouseEvent>): void => {
    if (locked) {
      on_rotate(e.movementX || 0, e.movementY || 0)
      return
    }
    if (!armed || requested) return
    if (Math.abs(e.clientX - down_x) + Math.abs(e.clientY - down_y) < drag_threshold_px) return
    requested = true
    try {
      const request = el?.requestPointerLock?.() as unknown
      if (request instanceof Promise) request.catch((error) => console.warn('Pointer lock request was refused.', error))
    } catch (error) {
      console.warn('Pointer lock is unavailable; drag rotation is disabled.', error)
    }
  }

  const on_mouseup = (e: Readonly<MouseEvent>): void => {
    if (e.button !== 0) return
    armed = false
    // Only release a lock THIS drag itself requested — an external sticky lock owns its own exit.
    const self_requested = requested
    requested = false
    if (locked && self_requested && el?.ownerDocument.exitPointerLock) el.ownerDocument.exitPointerLock()
  }

  const on_lock_change = (): void => {
    locked = !!el && el.ownerDocument.pointerLockElement === el
  }

  const on_wheel_evt = (e: Readonly<WheelEvent>): void => {
    if (on_wheel) {
      e.preventDefault()
      on_wheel(e.deltaY)
    }
  }

  const on_blur = (): void => {
    armed = false
    requested = false
  }

  return Object.freeze({
    attach: (element: Readonly<HTMLElement>) => {
      el = element
      element.addEventListener('mousedown', on_mousedown)
      globalThis.addEventListener('mousemove', on_mousemove)
      globalThis.addEventListener('mouseup', on_mouseup)
      element.addEventListener('wheel', on_wheel_evt, { passive: false })
      element.ownerDocument.addEventListener('pointerlockchange', on_lock_change)
      globalThis.addEventListener('blur', on_blur)
    },
    detach: () => {
      if (!el) return
      el.removeEventListener('mousedown', on_mousedown)
      globalThis.removeEventListener('mousemove', on_mousemove)
      globalThis.removeEventListener('mouseup', on_mouseup)
      el.removeEventListener('wheel', on_wheel_evt)
      el.ownerDocument.removeEventListener('pointerlockchange', on_lock_change)
      globalThis.removeEventListener('blur', on_blur)
      if (locked && el.ownerDocument.exitPointerLock) el.ownerDocument.exitPointerLock()
      el = null
      armed = false
      locked = false
    },
    is_locked: () => locked,
  })
}

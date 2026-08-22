// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/prefer-immutable-types -- pointer-lock controls consume mutable browser event and element handles. */
// THE ROTATE GESTURE — "free mouse except when rotating". The cursor is free and visible by
// default; holding LEFT and dragging past a small threshold turns the camera; releasing stops it.
// A clean click never rotates, so click-to-interact keeps working.
//
// ONE DELTA SOURCE: `movementX/movementY`. The browser fills those on EVERY mousemove, locked or
// not, so rotation is the same line of code on both sides of a lock — no branch, no coordinate
// bookkeeping, and no sensitivity jump when a lock lands mid-drag.
//
// POINTER LOCK IS AN UPGRADE, NEVER THE MECHANISM. Its only job is to hide the cursor and remove
// the screen-edge stop for the length of the drag. We ask once per drag and never wait on the
// answer: granted, the drag is unbounded; refused — headless, an embed, or Chromium's rate limit
// on rapid re-grabs — the drag still rotates and merely stops at the screen edge. That refusal is
// not a failure to report, it is the feature running without its comfort layer. A gesture that
// waits on the grant is a dead drag, which is the exact bug this file exists to not have.
//
// The live lock is read from `document.pointerLockElement`, never mirrored into a flag: one home
// for the fact, and an Esc mid-drag needs no handling because rotation never consulted it.

export type PointerLockOptions = Readonly<{
  on_rotate: (dx: number, dy: number) => void
  on_wheel?: (delta: number) => void
  drag_threshold_px?: number
}>

export type PointerLockControls = Readonly<{
  attach: (element: HTMLElement) => void
  detach: () => void
}>

export const create_pointer_lock_controls = ({
  on_rotate,
  on_wheel,
  drag_threshold_px = 6,
}: PointerLockOptions): PointerLockControls => {
  let el: HTMLElement | null = null
  let armed = false // LEFT went down on the element
  let rotating = false // the drag crossed the threshold — every delta now turns the camera
  let requested = false // WE asked for the lock this drag, so WE are the one allowed to exit it
  let down_x = 0
  let down_y = 0

  /** we hold the lock only when we asked for it AND the element that has it is ours */
  const owns_lock = (): boolean => requested && !!el && el.ownerDocument.pointerLockElement === el

  const release_lock = (): void => {
    if (owns_lock()) el?.ownerDocument.exitPointerLock()
  }

  const on_mousedown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    armed = true
    rotating = false
    requested = false
    down_x = e.clientX
    down_y = e.clientY
  }

  const on_mousemove = (e: MouseEvent): void => {
    if (!armed) return
    if (!rotating) {
      if (Math.abs(e.clientX - down_x) + Math.abs(e.clientY - down_y) < drag_threshold_px) return
      rotating = true
      requested = true
      // fire and forget — a rejection is expected on a rapid re-grab and costs the drag nothing
      // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- pointer lock is an optional comfort layer whose expected refusal leaves the drag fully functional
      void Promise.resolve(el?.requestPointerLock?.()).catch(() => {})
    }
    on_rotate(e.movementX || 0, e.movementY || 0)
  }

  const on_mouseup = (e: MouseEvent): void => {
    if (e.button !== 0) return
    release_lock()
    armed = false
    rotating = false
    requested = false
  }

  const on_wheel_evt = (e: WheelEvent): void => {
    if (on_wheel) {
      e.preventDefault()
      on_wheel(e.deltaY)
    }
  }

  // focus loss eats the mouseup, and the browser drops the lock itself — only the drag needs clearing
  const on_blur = (): void => {
    armed = false
    rotating = false
    requested = false
  }

  return Object.freeze({
    attach: (element: HTMLElement) => {
      el = element
      element.addEventListener('mousedown', on_mousedown)
      element.addEventListener('wheel', on_wheel_evt, { passive: false })
      // the drag lives on the WINDOW: it must survive the cursor leaving the canvas, and under a
      // live lock every mouse event is delivered against the locked element anyway
      globalThis.addEventListener('mousemove', on_mousemove)
      globalThis.addEventListener('mouseup', on_mouseup)
      globalThis.addEventListener('blur', on_blur)
    },
    detach: () => {
      if (!el) return
      release_lock()
      el.removeEventListener('mousedown', on_mousedown)
      el.removeEventListener('wheel', on_wheel_evt)
      globalThis.removeEventListener('mousemove', on_mousemove)
      globalThis.removeEventListener('mouseup', on_mouseup)
      globalThis.removeEventListener('blur', on_blur)
      el = null
      armed = false
      rotating = false
      requested = false
    },
  })
}

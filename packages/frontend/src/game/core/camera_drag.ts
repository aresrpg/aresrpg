// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The canvas owns mouse and touch drags; only a held mouse drag requests pointer lock.

export const create_camera_drag = ({
  on_rotate,
  on_wheel,
  drag_threshold_px = 6,
}: Readonly<{
  on_rotate: (dx: number, dy: number) => void
  on_wheel?: (delta: number) => void
  drag_threshold_px?: number
}>) => {
  let element: HTMLElement | null = null
  let pending: HTMLElement | null = null
  let previous_touch_action = ''
  let gesture: Readonly<{
    id: number
    x: number
    y: number
    start_x: number
    start_y: number
    rotating: boolean
  }> | null = null
  const release = (target: Readonly<HTMLElement> | null): void => {
    if (target?.ownerDocument.pointerLockElement === target && target) target.ownerDocument.exitPointerLock()
  }
  const stop = (): void => {
    const held = gesture
    gesture = null
    if (held && element?.hasPointerCapture(held.id)) element.releasePointerCapture(held.id)
    release(element)
  }
  const stop_listening = (document: Readonly<Document>): void => {
    document.removeEventListener('pointerlockchange', lock_changed)
    document.removeEventListener('pointerlockerror', lock_error)
  }
  const settle_pending = (): void => {
    const target = pending
    pending = null
    if (target && element?.ownerDocument !== target.ownerDocument) stop_listening(target.ownerDocument)
  }
  const capture_drag = (pointer_type: string): void => {
    const target = element
    if (pointer_type !== 'mouse' || !target || pending) return
    pending = target
    // Some browsers return void and report the eventual grant only through DOM events.
    void Promise.resolve(target.requestPointerLock()).catch((error: unknown) => {
      settle_pending()
      console.warn('Camera capture unavailable; using held drag.', error)
    })
  }
  const down = (event: Readonly<PointerEvent>): void => {
    if (gesture || (event.button !== 0 && event.button !== 2)) return
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start_x: event.clientX,
      start_y: event.clientY,
      rotating: false,
    }
    if (event.pointerType !== 'mouse') element?.setPointerCapture(event.pointerId)
  }
  const move = (event: Readonly<PointerEvent>): void => {
    if (gesture?.id !== event.pointerId) return
    const previous = gesture
    const rotating =
      previous.rotating ||
      Math.hypot(event.clientX - previous.start_x, event.clientY - previous.start_y) >= drag_threshold_px
    const locked = element?.ownerDocument.pointerLockElement === element
    gesture = { ...previous, x: event.clientX, y: event.clientY, rotating }
    if (!rotating) return
    const [dx, dy] = locked
      ? [event.movementX, event.movementY]
      : [event.clientX - previous.x, event.clientY - previous.y]
    on_rotate(dx!, dy!)
    if (!previous.rotating) capture_drag(event.pointerType)
  }
  const up = (event: Readonly<PointerEvent>): void => {
    if (gesture?.id === event.pointerId) stop()
  }
  const lock_changed = (): void => {
    const target = pending ?? element
    if (!target) return
    if (target.ownerDocument.pointerLockElement === target) {
      if (!gesture?.rotating || element !== target) release(target)
      settle_pending()
    } else if (!pending) gesture = null
  }
  const lock_error = settle_pending
  const wheel = (event: Readonly<WheelEvent>): void => {
    if (!on_wheel) return
    event.preventDefault()
    on_wheel(event.deltaY)
  }
  const detach = (): void => {
    stop()
    element?.removeEventListener('pointerdown', down)
    element?.removeEventListener('lostpointercapture', up)
    element?.style.setProperty('touch-action', previous_touch_action)
    element?.removeEventListener('wheel', wheel)
    if (element && !pending) stop_listening(element.ownerDocument)
    globalThis.removeEventListener('pointermove', move)
    globalThis.removeEventListener('pointerup', up)
    globalThis.removeEventListener('pointercancel', up)
    globalThis.removeEventListener('blur', stop)
    element = null
  }
  return {
    attach: (target: Readonly<HTMLElement>): void => {
      detach()
      element = target
      previous_touch_action = target.style.touchAction
      target.style.setProperty('touch-action', 'none')
      release(target)
      target.addEventListener('pointerdown', down)
      target.addEventListener('lostpointercapture', up)
      target.addEventListener('wheel', wheel, { passive: false })
      target.ownerDocument.addEventListener('pointerlockchange', lock_changed)
      target.ownerDocument.addEventListener('pointerlockerror', lock_error)
      globalThis.addEventListener('pointermove', move)
      globalThis.addEventListener('pointerup', up)
      globalThis.addEventListener('pointercancel', up)
      globalThis.addEventListener('blur', stop)
    },
    detach,
  }
}

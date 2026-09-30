// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** A canvas tap shares desktop picking; excursions and cancellation can never become taps. */
export const attach_context_menu_input = (
  canvas: Readonly<HTMLElement>,
  pick: (event: Readonly<MouseEvent>) => void
): (() => void) => {
  let touch: Readonly<{ id: number; x: number; y: number }> | null = null
  let tapped = false
  const clear = () => {
    touch = null
    tapped = false
  }
  const release = () => {
    touch = null
  }
  const click = (event: Readonly<MouseEvent>) => {
    const activate = tapped
    clear()
    if (activate) pick(event)
  }
  const down = (event: Readonly<PointerEvent>) => {
    tapped = false
    if (event.pointerType !== 'touch' || touch) return clear()
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
  const move = (event: Readonly<PointerEvent>) => {
    if (touch?.id === event.pointerId && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) >= 6) clear()
  }
  const up = (event: Readonly<PointerEvent>) => {
    move(event)
    tapped = touch?.id === event.pointerId
    release()
    // Open after the compatibility click, so it cannot activate a newly mounted menu row.
  }
  canvas.addEventListener('contextmenu', pick)
  canvas.addEventListener('click', click)
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', clear)
  canvas.addEventListener('lostpointercapture', release)
  globalThis.addEventListener('blur', clear)
  return () => {
    clear()
    canvas.removeEventListener('contextmenu', pick)
    canvas.removeEventListener('click', click)
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', clear)
    canvas.removeEventListener('lostpointercapture', release)
    globalThis.removeEventListener('blur', clear)
  }
}

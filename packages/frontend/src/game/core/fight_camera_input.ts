// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

type Pointer = Readonly<{ id: number; x: number; y: number; start_x: number; start_y: number; dragging: boolean }>
const distance = (a: Pointer, b: Pointer): number => Math.hypot(a.x - b.x, a.y - b.y)

/** The fight camera owns gestures on its canvas; HUD touches never enter this adapter. */
export const attach_fight_camera_input = (
  canvas: Readonly<HTMLElement>,
  pan: (dx: number, dy: number) => void,
  zoom: (steps: number) => void
): (() => void) => {
  let pointers: readonly Pointer[] = []
  const previous_touch_action = canvas.style.touchAction
  canvas.style.setProperty('touch-action', 'none')
  const down = (event: Readonly<PointerEvent>): void => {
    if (event.pointerType !== 'touch' && event.button !== 2) return
    event.preventDefault()
    pointers = [
      ...pointers,
      {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start_x: event.clientX,
        start_y: event.clientY,
        dragging: event.pointerType !== 'touch',
      },
    ]
    canvas.setPointerCapture(event.pointerId)
  }
  const move = (event: Readonly<PointerEvent>): void => {
    const previous = pointers.find(({ id }) => id === event.pointerId)
    if (!previous) return
    const next = {
      ...previous,
      x: event.clientX,
      y: event.clientY,
      dragging: previous.dragging || Math.hypot(event.clientX - previous.start_x, event.clientY - previous.start_y) > 8,
    }
    const updated = pointers.map((pointer) => (pointer.id === event.pointerId ? next : pointer))
    if (pointers.length === 2) {
      zoom((distance(pointers[0]!, pointers[1]!) - distance(updated[0]!, updated[1]!)) * 0.06)
      pan((next.x - previous.x) / 2, (next.y - previous.y) / 2)
    } else if (next.dragging) pan(next.x - previous.x, next.y - previous.y)
    pointers = updated
  }
  const up = (event: Readonly<PointerEvent>): void => {
    pointers = pointers.filter(({ id }) => id !== event.pointerId)
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  const clear = (): void => {
    const released = pointers
    pointers = []
    released.forEach(({ id }) => {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
    })
  }
  const wheel = (event: Readonly<WheelEvent>): void => {
    event.preventDefault()
    zoom(Math.sign(event.deltaY) * 0.8)
  }
  const context_menu = (event: Readonly<Event>): void => event.preventDefault()
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('lostpointercapture', up)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('contextmenu', context_menu)
  globalThis.addEventListener('pointermove', move)
  globalThis.addEventListener('pointerup', up)
  globalThis.addEventListener('pointercancel', up)
  globalThis.addEventListener('blur', clear)
  return () => {
    clear()
    canvas.style.setProperty('touch-action', previous_touch_action)
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('lostpointercapture', up)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('contextmenu', context_menu)
    globalThis.removeEventListener('pointermove', move)
    globalThis.removeEventListener('pointerup', up)
    globalThis.removeEventListener('pointercancel', up)
    globalThis.removeEventListener('blur', clear)
  }
}

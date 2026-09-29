// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- refs own disposable pointer/animation handles; selected IDs stay controlled by the caller. */
import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'

import {
  stroke_selection,
  point_inside,
  selection_edge_speed,
  type SelectionCell,
  type SelectionPoint,
} from './selection_geometry.ts'

type Gesture = Readonly<{
  pointer: number
  touch: boolean
  mode: 'pending' | 'scrolling' | 'selecting'
  client: SelectionPoint
  initial_client: SelectionPoint
  last_point: SelectionPoint
  scroll_origin: SelectionPoint
  before: readonly string[]
  painted: readonly string[]
  cells: readonly SelectionCell[]
  item: string | null
}>
const cell_id = (target: EventTarget | null): string | null =>
  target instanceof Element ? (target.closest<HTMLElement>('[data-selection-id]')?.dataset.selectionId ?? null) : null
const content_point = (root: Readonly<HTMLElement>, point: SelectionPoint): SelectionPoint => {
  const bounds = root.getBoundingClientRect()
  return { x: point.x - bounds.left + root.scrollLeft, y: point.y - bounds.top + root.scrollTop }
}
const cell_bounds = (root: Readonly<HTMLElement>): readonly SelectionCell[] => {
  const bounds = root.getBoundingClientRect()
  return [...root.querySelectorAll<HTMLElement>('[data-selection-id]:not(:disabled)')].map((cell) => {
    const box = cell.getBoundingClientRect()
    return {
      id: cell.dataset.selectionId!,
      left: box.left - bounds.left + root.scrollLeft,
      top: box.top - bounds.top + root.scrollTop,
      width: box.width,
      height: box.height,
    }
  })
}

/** A short tap stays a click; holding paints items, while an immediate touch swipe scrolls. */
export const SelectionGrid = ({
  children,
  className = '',
  selected,
  disabled = false,
  on_change,
  on_drag_item,
  on_item_drop,
}: Readonly<{
  children: ReactNode
  className?: string
  selected: readonly string[]
  disabled?: boolean
  on_change: (ids: readonly string[]) => void
  on_drag_item?: (id: string | null) => void
  on_item_drop?: (id: string, point: SelectionPoint) => boolean
}>) => {
  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const frame = useRef<number | null>(null)
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppress_click = useRef(false)

  const clear_hold = (): void => {
    if (hold.current !== null) clearTimeout(hold.current)
    hold.current = null
  }
  const stop = (): void => {
    clear_hold()
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    const pointer = gesture.current?.pointer
    gesture.current = null
    if (pointer !== undefined && root.current?.hasPointerCapture(pointer)) root.current.releasePointerCapture(pointer)
    on_drag_item?.(null)
  }
  const cancel = (): void => {
    const { current } = gesture
    if (current?.mode === 'selecting') on_change(current.before)
    suppress_click.current = true
    stop()
  }
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      if (hold.current !== null) clearTimeout(hold.current)
    },
    []
  )

  // Pending gestures do not capture the pointer: a short tap must retain its item click target.
  // Observe release outside the grid so the hold timer cannot outlive the pressed pointer.
  useEffect(() => {
    const release_pending = (event: Readonly<globalThis.PointerEvent>): void => {
      const { current } = gesture
      if (current?.pointer === event.pointerId && current.mode === 'pending') stop()
    }
    document.addEventListener('pointerup', release_pending)
    document.addEventListener('pointercancel', release_pending)
    return () => {
      document.removeEventListener('pointerup', release_pending)
      document.removeEventListener('pointercancel', release_pending)
    }
  })

  const paint = (): void => {
    const { current } = gesture,
      element = root.current
    if (current?.mode !== 'selecting' || !element) return
    if (!point_inside(current.client, element.getBoundingClientRect())) return
    const point = content_point(element, current.client)
    const painted = stroke_selection(current.last_point, point, current.cells, current.painted)
    gesture.current = { ...current, painted, last_point: point }
    if (painted.length !== current.painted.length) on_change(painted)
  }
  const scroll_edge = (): void => {
    const { current } = gesture,
      element = root.current
    if (current?.mode !== 'selecting' || !element) return
    const bounds = element.getBoundingClientRect()
    if (point_inside(current.client, bounds)) {
      const before_x = element.scrollLeft,
        before_y = element.scrollTop
      element.scrollLeft += selection_edge_speed(current.client.x - bounds.left, bounds.width)
      element.scrollTop += selection_edge_speed(current.client.y - bounds.top, bounds.height)
      if (before_x !== element.scrollLeft || before_y !== element.scrollTop) paint()
    }
    frame.current = requestAnimationFrame(scroll_edge)
  }
  const begin_selection = (): void => {
    const { current } = gesture,
      element = root.current
    if (current?.mode !== 'pending' || !element) return
    clear_hold()
    gesture.current = { ...current, mode: 'selecting' }
    suppress_click.current = true
    element.focus({ preventScroll: true })
    element.setPointerCapture(current.pointer)
    on_drag_item?.(current.item)
    paint()
    frame.current = requestAnimationFrame(scroll_edge)
  }
  const down = (event: Readonly<PointerEvent<HTMLDivElement>>): void => {
    suppress_click.current = false
    if (disabled || event.button !== 0) return
    event.stopPropagation()
    if (gesture.current) return cancel()
    const client = { x: event.clientX, y: event.clientY }
    gesture.current = {
      pointer: event.pointerId,
      touch: event.pointerType === 'touch',
      mode: 'pending',
      client,
      initial_client: client,
      last_point: content_point(event.currentTarget, client),
      scroll_origin: { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop },
      before: selected,
      painted: selected,
      cells: cell_bounds(event.currentTarget),
      item: event.pointerType === 'touch' ? null : cell_id(event.target),
    }
    hold.current = setTimeout(begin_selection, 350)
  }
  const move = (event: Readonly<PointerEvent<HTMLDivElement>>): void => {
    const { current } = gesture
    if (current?.pointer !== event.pointerId) return
    const client = { x: event.clientX, y: event.clientY }
    gesture.current = { ...current, client }
    if (
      Math.hypot(client.x - current.initial_client.x, client.y - current.initial_client.y) < 8 &&
      current.mode === 'pending'
    )
      return
    event.preventDefault()
    event.stopPropagation()
    if (current.mode === 'pending') {
      if (!current.touch) return begin_selection()
      clear_hold()
      gesture.current = { ...current, client, mode: 'scrolling' }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    suppress_click.current = true
    if (gesture.current?.mode === 'selecting') return paint()
    root.current!.scrollLeft = current.scroll_origin.x + current.initial_client.x - client.x
    root.current!.scrollTop = current.scroll_origin.y + current.initial_client.y - client.y
  }
  const up = (event: Readonly<PointerEvent<HTMLDivElement>>): void => {
    const { current } = gesture
    if (current?.pointer !== event.pointerId) return
    suppress_click.current = current.mode !== 'pending'
    if (current.mode === 'selecting') {
      if (current.item && on_item_drop?.(current.item, { x: event.clientX, y: event.clientY }))
        on_change(current.before)
      else paint()
    }
    stop()
  }
  return (
    <div
      ref={root}
      className={`aui-selection-grid ${className}`}
      tabIndex={-1}
      onPointerDownCapture={down}
      onPointerMoveCapture={move}
      onPointerUpCapture={up}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (gesture.current) cancel()
      }}
      onClickCapture={(event) => {
        if (suppress_click.current) {
          event.preventDefault()
          event.stopPropagation()
          suppress_click.current = false
        } else if (!disabled && !cell_id(event.target)) on_change([])
      }}
      onContextMenuCapture={(event) => {
        if (suppress_click.current) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && gesture.current) {
          event.preventDefault()
          event.stopPropagation()
          cancel()
        } else suppress_click.current = false
      }}
    >
      {children}
    </div>
  )
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- refs hold only the disposable pointer gesture and DOM handle. */
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'

const window_bounds = (root: Readonly<HTMLElement> | null, selector: string) => {
  const frame = root?.closest(selector)?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  }
  return {
    left: Math.max(0, frame.left),
    top: Math.max(0, frame.top),
    right: Math.min(window.innerWidth, frame.right),
    bottom: Math.min(window.innerHeight, frame.bottom),
  }
}

/** Position is presentation-only; pointer capture keeps a drag outside the title bar alive. */
export const useWindowDrag = (enabled: boolean, boundary_selector = 'dialog') => {
  const root = useRef<HTMLElement>(null)
  const [offset, set_offset] = useState({ x: 0, y: 0 })
  const rendered_offset = useRef(offset)
  useLayoutEffect(() => {
    rendered_offset.current = offset
  }, [offset])
  const moved = useRef(false)
  const gesture = useRef<Readonly<{
    id: number
    x: number
    y: number
    left: number
    top: number
    min_x: number
    max_x: number
    min_y: number
    max_y: number
  }> | null>(null)
  useEffect(() => {
    if (!enabled) return
    const constrain = () => {
      const box = root.current?.getBoundingClientRect()
      if (!box?.width || !box.height) return
      gesture.current = null
      const frame = window_bounds(root.current, boundary_selector)
      const dx = Math.max(frame.left - box.left, Math.min(0, frame.right - box.right))
      const dy = Math.max(frame.top - box.top, Math.min(0, frame.bottom - box.bottom))
      // Window resize and ResizeObserver can measure the same frame before React commits.
      // Project from the rendered position once; never accumulate the same correction twice.
      if (dx || dy) set_offset({ x: rendered_offset.current.x + dx, y: rendered_offset.current.y + dy })
    }
    const observer = new ResizeObserver(constrain)
    if (root.current) observer.observe(root.current)
    window.addEventListener('resize', constrain)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', constrain)
    }
  }, [enabled, boundary_selector])
  const down = (event: Readonly<PointerEvent<HTMLElement>>) => {
    if (!enabled || event.button !== 0 || !event.isPrimary) return
    moved.current = false
    const target = event.target as Element
    if (target.closest('button, input, select, a, label') && !target.closest('[data-window-drag-handle]')) return
    const box = root.current!.getBoundingClientRect()
    const { left, top, right, bottom } = window_bounds(root.current, boundary_selector)
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: offset.x,
      top: offset.y,
      min_x: offset.x + left - box.left,
      max_x: offset.x + Math.max(left, right - box.width) - box.left,
      min_y: offset.y + top - box.top,
      max_y: offset.y + Math.max(top, bottom - box.height) - box.top,
    }
    event.preventDefault()
    event.stopPropagation()
    const capture = target.closest<HTMLElement>('[data-window-drag-handle]') ?? event.currentTarget
    capture.setPointerCapture(event.pointerId)
  }
  const move = (event: Readonly<PointerEvent<HTMLElement>>) => {
    const { current } = gesture
    if (!current || current.id !== event.pointerId) return
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5 && !moved.current) return
    moved.current = true
    set_offset({
      x: Math.min(current.max_x, Math.max(current.min_x, current.left + event.clientX - current.x)),
      y: Math.min(current.max_y, Math.max(current.min_y, current.top + event.clientY - current.y)),
    })
  }
  const stop = (event: Readonly<PointerEvent<HTMLElement>>) => {
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return {
    root,
    offset,
    header: {
      onClickCapture: (event: Readonly<MouseEvent<HTMLElement>>) => {
        if (!moved.current || event.detail === 0) return
        moved.current = false
        event.preventDefault()
        event.stopPropagation()
      },
      onPointerDown: down,
      onPointerMove: move,
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: stop,
    },
  }
}

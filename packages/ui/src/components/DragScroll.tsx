// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- refs own only this rail's disposable mouse gesture. */
import { useRef, type ComponentProps } from 'react'

/** Native touch scrolling plus mouse-grab scrolling; a drag never activates its starting button. */
export const DragScroll = ({ children, className = '', ...props }: Readonly<ComponentProps<'div'>>) => {
  const gesture = useRef<{ pointer: number; x: number; scroll: number; dragging: boolean } | null>(null)
  const dragged = useRef(false)
  return (
    <div
      {...props}
      className={`aui-drag-scroll ${className}`}
      onPointerDown={(event) => {
        dragged.current = false
        if (event.pointerType !== 'mouse' || event.button !== 0) return
        gesture.current = {
          pointer: event.pointerId,
          x: event.clientX,
          scroll: event.currentTarget.scrollLeft,
          dragging: false,
        }
      }}
      onPointerMove={(event) => {
        const { current } = gesture
        if (!current || event.buttons !== 1) return
        const distance = event.clientX - current.x
        if (!current.dragging && Math.abs(distance) < 6) return
        current.dragging = true
        dragged.current = true
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const rail = event.currentTarget
        rail.scrollLeft = current.scroll - distance
      }}
      onPointerUp={(event) => {
        gesture.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => {
        gesture.current = null
      }}
      onPointerLeave={() => {
        if (!gesture.current?.dragging) gesture.current = null
      }}
      onLostPointerCapture={() => {
        gesture.current = null
      }}
      onClickCapture={(event) => {
        if (dragged.current) {
          event.preventDefault()
          event.stopPropagation()
          dragged.current = false
        }
      }}
      onDragStart={(event) => event.preventDefault()}
    >
      {children}
    </div>
  )
}

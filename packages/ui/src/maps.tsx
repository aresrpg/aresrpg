// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- pointer refs retain only the current disposable UI gesture. */
import { useRef, type ReactNode, type PointerEvent } from 'react'

import { Button } from './controls.tsx'
import { Workspace, type WorkspaceHeader } from './workspaces.tsx'

export const MinimapView = ({
  map,
  title,
  coordinates,
  open_label,
  open,
  controls,
}: Readonly<{
  map: ReactNode
  title: string
  coordinates: string
  open_label: string
  open: () => void
  controls?: ReactNode
}>) => (
  <section className="aui-minimap">
    <button type="button" className="aui-minimap-lens" aria-label={open_label} onClick={open}>
      {map}
    </button>
    <header>
      <strong>{title}</strong>
      <span>{coordinates}</span>
    </header>
    <div className="aui-minimap-controls">
      {controls}
      <Button onClick={open}>{open_label}</Button>
    </div>
    <span className="aui-map-north" aria-hidden="true">
      N
    </span>
  </section>
)

/** Pointer travel belongs to the surface; coordinates and navigation remain controller-owned. */
export const MapInteraction = ({
  children,
  pan,
  select,
  label,
}: Readonly<{
  children: ReactNode
  pan: (x: number, y: number) => void
  select: (x: number, y: number) => void
  label: string
}>) => {
  const gesture = useRef<{
    id: number
    x: number
    y: number
    start_x: number
    start_y: number
    at: number
    dragged: boolean
  } | null>(null)
  const move = (event: Readonly<PointerEvent<HTMLDivElement>>) => {
    const { current } = gesture
    if (!current || event.pointerId !== current.id) return
    const dx = event.clientX - current.x,
      dy = event.clientY - current.y
    const dragged = current.dragged || Math.hypot(event.clientX - current.start_x, event.clientY - current.start_y) > 6
    const bounds = event.currentTarget.getBoundingClientRect()
    if (dragged) pan(-dx / bounds.width, -dy / bounds.height)
    gesture.current = { ...current, x: event.clientX, y: event.clientY, dragged }
  }
  return (
    <div
      className="aui-map-interaction"
      role="application"
      tabIndex={0}
      onKeyDown={(event) => {
        const directions: Readonly<Record<string, readonly [number, number]>> = {
          ArrowLeft: [-0.1, 0],
          ArrowRight: [0.1, 0],
          ArrowUp: [0, -0.1],
          ArrowDown: [0, 0.1],
        }
        const direction = directions[event.key]
        if (direction) {
          event.preventDefault()
          pan(...direction)
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          select(0.5, 0.5)
        }
      }}
      aria-label={label}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        if (gesture.current || !event.isPrimary) {
          gesture.current = null
          return
        }
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          start_x: event.clientX,
          start_y: event.clientY,
          at: event.timeStamp,
          dragged: false,
        }
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        const { current } = gesture
        gesture.current = null
        if (!current || current.id !== event.pointerId) return
        if (!current.dragged && event.timeStamp - current.at < 350) {
          const bounds = event.currentTarget.getBoundingClientRect()
          select((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height)
        }
      }}
      onPointerCancel={() => {
        gesture.current = null
      }}
      onLostPointerCapture={() => {
        gesture.current = null
      }}
    >
      {children}
    </div>
  )
}

export const MapView = ({
  header,
  map,
  world,
  coordinates,
  legend,
  zoom_in,
  zoom_out,
  labels,
}: Readonly<{
  header: WorkspaceHeader
  map: ReactNode
  world: string
  coordinates: string
  legend: ReactNode
  zoom_in: () => void
  zoom_out: () => void
  labels: Readonly<{ zoom_in: string; zoom_out: string }>
}>) => (
  <Workspace {...header} className="aui-world-map">
    <div className="aui-map-viewport">
      {map}
      <div className="aui-map-readout">
        <strong>{world}</strong>
        <span>{coordinates}</span>
      </div>
      <div className="aui-map-zoom">
        <Button aria-label={labels.zoom_out} onClick={zoom_out}>
          −
        </Button>
        <Button aria-label={labels.zoom_in} onClick={zoom_in}>
          +
        </Button>
      </div>
      <div className="aui-map-legend">{legend}</div>
      <span className="aui-map-north" aria-hidden="true">
        N
      </span>
    </div>
  </Workspace>
)

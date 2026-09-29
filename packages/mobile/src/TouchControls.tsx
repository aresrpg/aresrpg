// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- pointer capture and refs belong to this DOM input adapter. */

import { ChevronsUp } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

import type { AppCopy } from '../../frontend/src/i18n/copy.ts'
import { dispatch_app } from '../../frontend/src/store.ts'

const stop = (): void => dispatch_app({ type: 'engine/movement', forward: 0, strafe: 0 })

export const TouchControls = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const pointer = useRef<Readonly<{ id: number; x: number; y: number }> | null>(null)
  const camera = useRef<Readonly<{ id: number; x: number; y: number }> | null>(null)
  const [offset, set_offset] = useState({ x: 0, y: 0 })
  const release = (): void => {
    pointer.current = null
    set_offset({ x: 0, y: 0 })
    stop()
  }
  const release_all = (): void => {
    camera.current = null
    release()
    dispatch_app({ type: 'engine/jump', down: false })
  }
  useEffect(() => {
    globalThis.addEventListener('blur', release_all)
    const hidden = (): void => {
      if (document.hidden) release_all()
    }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      globalThis.removeEventListener('blur', release_all)
      document.removeEventListener('visibilitychange', hidden)
      stop()
      dispatch_app({ type: 'engine/jump', down: false })
    }
  }, [])
  const release_pointer = (event: PointerEvent): void => {
    if (pointer.current?.id === event.pointerId) release()
  }
  const release_camera = (event: PointerEvent): void => {
    if (camera.current?.id === event.pointerId) camera.current = null
  }
  const move = (event: PointerEvent): void => {
    const held = pointer.current
    if (!held || held.id !== event.pointerId) return
    const x = event.clientX - held.x
    const y = event.clientY - held.y
    const length = Math.max(36, Math.hypot(x, y))
    set_offset({ x: (x / length) * 36, y: (y / length) * 36 })
    dispatch_app({ type: 'engine/movement', forward: -y / length, strafe: x / length })
  }
  return (
    <>
      <div
        className="mobile-camera"
        aria-hidden="true"
        onPointerDown={(event) => {
          if (camera.current) return
          camera.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const held = camera.current
          if (!held || held.id !== event.pointerId) return
          dispatch_app({ type: 'engine/camera', dx: event.clientX - held.x, dy: event.clientY - held.y })
          camera.current = { id: held.id, x: event.clientX, y: event.clientY }
        }}
        onPointerUp={release_camera}
        onPointerCancel={release_camera}
        onLostPointerCapture={release_camera}
      />
      <div
        className="mobile-joystick"
        role="group"
        aria-label={copy.ui.mobile_move}
        onPointerDown={(event) => {
          if (pointer.current) return
          pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
          move(event)
        }}
        onPointerMove={move}
        onPointerUp={release_pointer}
        onPointerCancel={release_pointer}
        onLostPointerCapture={release_pointer}
      >
        <span style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} />
      </div>
      <button
        className="mobile-jump"
        aria-label={copy.ui.mobile_jump}
        type="button"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          dispatch_app({ type: 'engine/jump', down: true })
        }}
        onPointerUp={() => dispatch_app({ type: 'engine/jump', down: false })}
        onPointerCancel={() => dispatch_app({ type: 'engine/jump', down: false })}
        onLostPointerCapture={() => dispatch_app({ type: 'engine/jump', down: false })}
        onKeyDown={(event) => {
          if ([' ', 'Enter'].includes(event.key)) dispatch_app({ type: 'engine/jump', down: true })
        }}
        onKeyUp={(event) => {
          if ([' ', 'Enter'].includes(event.key)) dispatch_app({ type: 'engine/jump', down: false })
        }}
      >
        <ChevronsUp />
      </button>
    </>
  )
}

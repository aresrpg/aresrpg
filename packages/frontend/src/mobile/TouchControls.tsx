// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- pointer capture and refs belong to this DOM input adapter. */

import { ChevronsUp } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app } from '../store.ts'
import type { create_world } from '../game/core/world.ts'
import './mobile.css'

export type TouchDevice = Pick<ReturnType<typeof create_world>, 'set_movement' | 'set_jump'>

const PLAYER_DEVICE: TouchDevice = {
  set_movement: (axes) => dispatch_app({ type: 'engine/movement', ...axes }),
  set_jump: (down) => dispatch_app({ type: 'engine/jump', down }),
}

export const TouchControls = ({ copy, device = PLAYER_DEVICE }: Readonly<{ copy: AppCopy; device?: TouchDevice }>) => {
  const pointer = useRef<Readonly<{ id: number; x: number; y: number }> | null>(null)
  const [offset, set_offset] = useState<Readonly<{ x: number; y: number }> | null>(null)
  const [jump_down, set_jump_down] = useState(false)
  // The actions change only with the device, so the window listeners below are bound once per device.
  const stop = useCallback((): void => device.set_movement({ forward: 0, strafe: 0 }), [device])
  const jump = useCallback(
    (down: boolean): void => {
      set_jump_down(down)
      device.set_jump(down)
    },
    [device]
  )
  const release = useCallback((): void => {
    pointer.current = null
    set_offset(null)
    stop()
  }, [stop])
  useEffect(() => {
    // Losing focus, resizing or hiding the page lets go of the stick and the jump.
    const release_all = (): void => {
      release()
      jump(false)
    }
    globalThis.addEventListener('blur', release_all)
    globalThis.addEventListener('resize', release_all)
    const hidden = (): void => {
      if (document.hidden) release_all()
    }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      globalThis.removeEventListener('blur', release_all)
      globalThis.removeEventListener('resize', release_all)
      document.removeEventListener('visibilitychange', hidden)
      stop()
      device.set_jump(false)
    }
  }, [device, jump, release, stop])
  const release_pointer = (event: PointerEvent): void => {
    if (pointer.current?.id === event.pointerId) release()
  }
  const move = (event: PointerEvent): void => {
    const held = pointer.current
    if (!held || held.id !== event.pointerId) return
    const x = event.clientX - held.x
    const y = event.clientY - held.y
    const length = Math.max(36, Math.hypot(x, y))
    set_offset({ x: (x / length) * 36, y: (y / length) * 36 })
    device.set_movement({ forward: -y / length, strafe: x / length })
  }
  return (
    <>
      <div
        className="mobile-joystick"
        data-active={offset !== null}
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
        <span style={{ transform: `translate(${offset?.x ?? 0}px, ${offset?.y ?? 0}px)` }} />
      </div>
      <button
        className="mobile-jump"
        data-active={jump_down}
        aria-label={copy.ui.mobile_jump}
        type="button"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          jump(true)
        }}
        onPointerUp={() => jump(false)}
        onPointerCancel={() => jump(false)}
        onLostPointerCapture={() => jump(false)}
        onKeyDown={(event) => {
          if ([' ', 'Enter'].includes(event.key)) jump(true)
        }}
        onKeyUp={(event) => {
          if ([' ', 'Enter'].includes(event.key)) jump(false)
        }}
      >
        <ChevronsUp />
      </button>
    </>
  )
}

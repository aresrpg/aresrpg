// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

/** Chat owns its requested size; CSS bounds it and shares its visible width with the world HUD. */
export const ChatResizeHandle = ({ label }: Readonly<{ label: string }>) => {
  const handle = useRef<HTMLButtonElement>(null)
  const [drag, set_drag] = useState<Readonly<{ x: number; y: number; width: number; height: number }> | null>(null)
  useLayoutEffect(() => {
    const frame = handle.current!.closest<HTMLElement>('[data-world-frame]')
    if (!frame) return
    const hud = frame.querySelector<HTMLElement>('.fight-hud--overworld .fight-hud__bar')
    const measure = () => {
      const { width, height } = frame.getBoundingClientRect()
      const hud_box = hud?.getBoundingClientRect()
      const stacked = width <= 400
      const max_width = stacked ? width - 20 : Math.min(640, width - (hud_box?.width ?? 0) - 30)
      const max_height = Math.min(600, height * 0.7, height - (stacked ? (hud_box?.height ?? 0) : 0) - 30)
      frame.style.setProperty('--world-chat-max-width', `${Math.max(0, max_width)}px`)
      frame.style.setProperty('--world-chat-max-height', `${Math.max(0, max_height)}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    if (hud) observer.observe(hud)
    measure()
    return () => {
      observer.disconnect()
      for (const property of ['max-width', 'max-height', 'requested-width', 'requested-height'])
        frame.style.removeProperty(`--world-chat-${property}`)
    }
  }, [])
  const resize = (width: number, height: number) => {
    const frame = handle.current!.closest<HTMLElement>('[data-world-frame]')
    if (!frame) return
    const styles = getComputedStyle(frame)
    const max_width = parseFloat(styles.getPropertyValue('--world-chat-max-width'))
    const max_height = parseFloat(styles.getPropertyValue('--world-chat-max-height'))
    frame.style.setProperty('--world-chat-requested-width', `${Math.min(max_width, Math.max(180, width))}px`)
    frame.style.setProperty('--world-chat-requested-height', `${Math.min(max_height, Math.max(100, height))}px`)
  }
  const start = (event: Readonly<PointerEvent<HTMLButtonElement>>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const box = event.currentTarget.parentElement!.getBoundingClientRect()
    set_drag({ x: event.clientX, y: event.clientY, width: box.width, height: box.height })
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  return (
    <button
      aria-label={label}
      title={label}
      className="chat__resize"
      ref={handle}
      type="button"
      onPointerDown={start}
      onPointerMove={(event) => {
        if (!drag) return
        event.stopPropagation()
        resize(drag.width + event.clientX - drag.x, drag.height - event.clientY + drag.y)
      }}
      onPointerUp={(event) => {
        set_drag(null)
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => {
        set_drag(null)
      }}
      onKeyDown={(event) => {
        const delta = { ArrowRight: [20, 0], ArrowLeft: [-20, 0], ArrowUp: [0, 20], ArrowDown: [0, -20] }[event.key]
        if (!delta) return
        event.preventDefault()
        event.stopPropagation()
        const box = event.currentTarget.parentElement!.getBoundingClientRect()
        resize(box.width + delta[0]!, box.height + delta[1]!)
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor">
        <path d="M3 2l11 11M8 2l6 6M13 2l1 1" />
      </svg>
    </button>
  )
}

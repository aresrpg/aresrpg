// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

import { chat_size_from } from '../game/core/chat_preferences.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'

const CHAT_VIEWPORT = '[data-world-frame], [data-chat-viewport]'

/** One requested size and one bounds observer serve overworld and fight chat. */
export const ChatResizeHandle = ({ label }: Readonly<{ label: string }>) => {
  const handle = useRef<HTMLButtonElement>(null)
  const saved_size = useAppStore((state) => state.settings.chat_size)
  const [drag, set_drag] = useState<Readonly<{ x: number; y: number; width: number; height: number }> | null>(null)
  useLayoutEffect(() => {
    const frame = handle.current!.closest<HTMLElement>(CHAT_VIEWPORT)
    if (!frame) return
    if (saved_size) {
      frame.style.setProperty('--world-chat-requested-width', `${saved_size.width}px`)
      frame.style.setProperty('--world-chat-requested-height', `${saved_size.height}px`)
    }
    let hud = frame.querySelector<HTMLElement>('.fight-hud__bar')
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
    const content = new MutationObserver(() => {
      const next = frame.querySelector<HTMLElement>('.fight-hud__bar')
      if (next === hud) return
      if (hud) observer.unobserve(hud)
      hud = next
      if (hud) observer.observe(hud)
      measure()
    })
    content.observe(frame, { childList: true, subtree: true })
    measure()
    return () => {
      content.disconnect()
      observer.disconnect()
      for (const property of ['max-width', 'max-height', 'requested-width', 'requested-height'])
        frame.style.removeProperty(`--world-chat-${property}`)
    }
  }, [saved_size])
  const resize = (width: number, height: number) => {
    const frame = handle.current!.closest<HTMLElement>(CHAT_VIEWPORT)
    if (!frame) return
    const styles = getComputedStyle(frame)
    const max_width = parseFloat(styles.getPropertyValue('--world-chat-max-width'))
    const max_height = parseFloat(styles.getPropertyValue('--world-chat-max-height'))
    frame.style.setProperty('--world-chat-requested-width', `${Math.min(max_width, Math.max(180, width))}px`)
    frame.style.setProperty('--world-chat-requested-height', `${Math.min(max_height, Math.max(100, height))}px`)
  }
  const remember_size = () => {
    const frame = handle.current!.closest<HTMLElement>(CHAT_VIEWPORT)
    if (!frame) return
    const chat_size = chat_size_from({
      width: parseFloat(frame.style.getPropertyValue('--world-chat-requested-width')),
      height: parseFloat(frame.style.getPropertyValue('--world-chat-requested-height')),
    })
    if (chat_size) dispatch_app({ type: 'settings/changed', settings: { ...read_app_state().settings, chat_size } })
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
        remember_size()
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
        remember_size()
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor">
        <path d="M3 2l11 11M8 2l6 6M13 2l1 1" />
      </svg>
    </button>
  )
}

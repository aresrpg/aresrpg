// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { HUD_PANEL_CLASS } from './ui/HudPanel.tsx'

/** Measure the rendered rows so locale, action changes, and resizing cannot hide actions. */
export const ContextMenu = ({ x, y, children }: Readonly<{ x: number; y: number; children: ReactNode }>) => {
  const menu = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = menu.current!
    const position = () => {
      const { width, height } = element.getBoundingClientRect()
      element.style.setProperty(
        'left',
        `${Math.max(8, Math.min(x, document.documentElement.clientWidth - width - 8))}px`
      )
      element.style.setProperty(
        'top',
        `${Math.max(8, Math.min(y, document.documentElement.clientHeight - height - 8))}px`
      )
    }
    const observer = new ResizeObserver(position)
    observer.observe(element)
    globalThis.addEventListener('resize', position)
    position()
    return () => {
      observer.disconnect()
      globalThis.removeEventListener('resize', position)
    }
  }, [x, y])
  return createPortal(
    <div
      className={`${HUD_PANEL_CLASS} pointer-events-auto fixed z-[140] max-h-[calc(100dvh-16px)] min-w-[min(168px,calc(100vw-16px))] max-w-[calc(100vw-16px)] overflow-y-auto divide-y divide-white/10 text-[11px]`}
      onPointerDown={(event) => event.stopPropagation()}
      ref={menu}
      role="menu"
    >
      {children}
    </div>,
    document.activeElement?.closest('dialog[open]') ?? document.body
  )
}

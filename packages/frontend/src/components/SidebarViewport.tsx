// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useLayoutEffect, useRef, type ReactNode } from 'react'

/** Reserve the visible sidebar width and keep the connection card at the viewport bottom. */
export const SidebarViewport = ({ children, footer }: Readonly<{ children: ReactNode; footer: ReactNode }>) => {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const slot = viewport.current!
    const sheet = content.current!
    const stack = top.current!
    const connection = bottom.current!
    const root = slot.closest<HTMLElement>('.app-ui')!
    // Measure intrinsic groups, never the stretched sheet: otherwise fitting feeds back into itself.
    const measure = () => {
      const styles = getComputedStyle(slot)
      const width = parseFloat(styles.getPropertyValue('--app-sidebar-width'))
      const gap = parseFloat(styles.getPropertyValue('--app-gap'))
      const height = parseFloat(styles.height)
      const natural_height =
        parseFloat(getComputedStyle(stack).height) + parseFloat(getComputedStyle(connection).height) + gap
      const scale = Math.min(1, height / natural_height)
      sheet.style.setProperty('height', `${height / scale}px`)
      sheet.style.setProperty('transform', `scale(${scale})`)
      root.style.setProperty('--app-sidebar-space', `${width * scale}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    observer.observe(stack)
    observer.observe(connection)
    measure()
    return () => {
      observer.disconnect()
      root.style.removeProperty('--app-sidebar-space')
    }
  }, [])
  return (
    <div className="sidebar-viewport pointer-events-auto" data-app-account-panel="" ref={viewport}>
      <div className="sidebar-viewport__content" ref={content}>
        <div className="app-shell-column flex flex-col" ref={top}>
          {children}
        </div>
        <div ref={bottom}>{footer}</div>
      </div>
    </div>
  )
}

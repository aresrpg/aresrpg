// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useLayoutEffect, useRef, useContext, type ReactNode } from 'react'

import { front_window, show_floating_window } from './NativeModal.tsx'
import { PreviewContext } from './PreviewSurface.tsx'
import { usePreviewBounds } from './usePreviewBounds.ts'

/** Manual popovers share the top layer without making previous windows inert. */
export const FloatingWindow = ({
  children,
  label,
  identity,
  close,
  blocking = true,
}: Readonly<{
  blocking?: boolean
  children: ReactNode
  label: string
  identity: string
  close: () => void
}>) => {
  const root = useRef<HTMLDivElement>(null)
  const embedded = useContext(PreviewContext)
  usePreviewBounds(root, embedded)
  useLayoutEffect(() => {
    const element = root.current!
    show_floating_window(element)
    return () => {
      element.hidePopover()
    }
  }, [])
  useLayoutEffect(() => {
    const key = (event: Readonly<KeyboardEvent>) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (front_window(document) !== root.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [close])
  return (
    <div
      ref={root}
      popover="manual"
      role="dialog"
      tabIndex={-1}
      aria-label={label}
      data-modal-identity={identity}
      data-blocking-overlay={blocking}
      className="aui-floating-window"
      onPointerDownCapture={(event) => {
        if ((event.target as Element).closest('.aui-floating-window') !== event.currentTarget) return
        if (front_window(document) !== event.currentTarget) show_floating_window(event.currentTarget)
      }}
    >
      {children}
    </div>
  )
}

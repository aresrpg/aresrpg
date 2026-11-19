// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useLayoutEffect, type RefObject } from 'react'

/** Top-layer windows retain the workshop's simulated viewport without changing their semantics. */
export const usePreviewBounds = (root: Readonly<RefObject<HTMLElement | null>>, enabled: boolean): void => {
  useLayoutEffect(() => {
    const element = root.current
    const frame = element?.closest('.aui-preview-surface')
    if (!enabled || !element || !frame) return
    const measure = () => {
      const bounds = frame.getBoundingClientRect()
      element.style.setProperty('position', 'fixed')
      element.style.setProperty('left', `${bounds.left}px`)
      element.style.setProperty('top', `${bounds.top}px`)
      element.style.setProperty('width', `${bounds.width}px`)
      element.style.setProperty('height', `${bounds.height}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      for (const property of ['position', 'left', 'top', 'width', 'height']) element.style.removeProperty(property)
    }
  }, [root, enabled])
}

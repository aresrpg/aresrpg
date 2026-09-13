// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import './fit_viewport.css'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Fit the complete workspace after reflow; browser zoom changes the measured slot, not game state. */
export const FitViewport = ({
  width,
  dense_width,
  class_name,
  workspace,
  children,
}: Readonly<{
  workspace?: string
  width?: number
  dense_width?: number
  class_name: string
  children: ReactNode
}>) => {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [layout, set_layout] = useState({ width: width ?? 200, scale: 1, dense: false })
  useLayoutEffect(() => {
    const slot = viewport.current!
    const sheet = content.current!
    let natural_height = 0
    const measure = () => {
      const available_width = slot.clientWidth
      const available_height = slot.clientHeight
      if (sheet.dataset.dense === 'false') natural_height = sheet.scrollHeight
      const dense = dense_width !== undefined && available_height < natural_height
      const target_width = (dense ? dense_width : width) ?? available_width
      const height = sheet.scrollHeight
      const scale = height > 0 ? Math.min(1, available_width / target_width, available_height / height) : 1
      set_layout((previous) =>
        previous.width === target_width && previous.scale === scale && previous.dense === dense
          ? previous
          : { width: target_width, scale, dense }
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(slot)
    observer.observe(sheet)
    measure()
    return () => observer.disconnect()
  }, [width, dense_width])
  return (
    <div className={`fit-viewport ${class_name}`} ref={viewport} data-workspace={workspace}>
      <div
        className={`fit-viewport__content ${class_name}__content`}
        data-dense={layout.dense}
        ref={content}
        style={{ width: layout.width, transform: `scale(${layout.scale})` }}
      >
        {children}
      </div>
    </div>
  )
}

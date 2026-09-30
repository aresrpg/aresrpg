// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, type MouseEventHandler } from 'react'

/** Let a double click finish before an inspector can cover its original target. */
export const useItemClick = (inspect?: MouseEventHandler<HTMLButtonElement>, double_click = false) => {
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancel = () => clearTimeout(pending.current)
  useEffect(() => cancel, [])
  const click: MouseEventHandler<HTMLButtonElement> = (event) => {
    cancel()
    if (event.shiftKey) return inspect?.(event)
    if (event.detail === 2 && double_click) return
    if (event.detail === 0 || !double_click) return inspect?.(event)
    // eslint-disable-next-line functional/immutable-data -- component-local timer is cancelled on another click and unmount.
    pending.current = setTimeout(() => inspect?.(event), 250)
  }
  return click
}

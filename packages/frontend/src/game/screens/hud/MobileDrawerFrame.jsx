// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useRef } from 'react'

import { mobile_swipe_dismisses } from './mobile_layout.js'

/**
 * Shared mobile bottom sheet: backdrop tap, handle tap, or a downward handle swipe dismisses it.
 * @param {{ drawer: string, title: string, close_label: string, back_label?: string,
 *   on_close: () => void, on_back?: () => void, children: import('react').ReactNode }} props
 */
export function MobileDrawerFrame({ drawer, title, close_label, back_label, on_close, on_back, children }) {
  const drag_start = useRef(null)

  return (
    <div className="mobile-hud-drawer-backdrop" onPointerDown={(event) => event.stopPropagation()} onClick={on_close}>
      <section
        className="mobile-hud-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-mobile-drawer={drawer}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="mobile-hud-drawer__handle"
          aria-label={close_label}
          onClick={on_close}
          onPointerDown={(event) => {
            drag_start.current = event.clientY
            event.currentTarget.setPointerCapture?.(event.pointerId)
          }}
          onPointerUp={(event) => {
            if (mobile_swipe_dismisses(drag_start.current, event.clientY)) on_close()
            drag_start.current = null
          }}
          onPointerCancel={() => {
            drag_start.current = null
          }}
        >
          <span aria-hidden="true" />
        </button>
        <header className="mobile-hud-drawer__header">
          {on_back ? (
            <button type="button" className="mobile-hud-drawer__back" onClick={on_back} aria-label={back_label}>
              ←
            </button>
          ) : (
            <span className="mobile-hud-drawer__back-space" />
          )}
          <h2>{title}</h2>
          <button type="button" className="mobile-hud-drawer__close" onClick={on_close} aria-label={close_label}>
            ✕
          </button>
        </header>
        <div className="mobile-hud-drawer__body">{children}</div>
      </section>
    </div>
  )
}

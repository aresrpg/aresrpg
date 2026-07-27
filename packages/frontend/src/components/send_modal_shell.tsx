// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared presentation/locking shell for asset-send flows; each modal keeps its own state machine and content.

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type SendModalShellProps = {
  children: React.ReactNode
  locked: boolean
  on_close: () => void
  title: string
  tone?: 'default' | 'success' | 'danger'
}

export function SendModalShell({ children, locked, on_close, title, tone = 'default' }: SendModalShellProps) {
  useEffect(() => {
    if (locked) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [locked, on_close])

  useEffect(() => {
    const previous_overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous_overflow
    }
  }, [])

  const border_color =
    tone === 'success' ? 'rgba(52,211,153,0.5)' : tone === 'danger' ? 'rgba(239,68,68,0.45)' : 'var(--color-border)'
  const glow =
    tone === 'success' ? '0 0 30px rgba(52,211,153,0.12)' : tone === 'danger' ? '0 0 30px rgba(239,68,68,0.10)' : 'none'
  const title_color = tone === 'success' ? '#34d399' : tone === 'danger' ? '#f87171' : '#c8963c'

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 max-sm:p-0"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(event) => {
        if (locked) return
        if (event.target === event.currentTarget) on_close()
      }}
    >
      <div
        className="bg-surface w-full max-w-xl max-h-[90vh] flex flex-col max-sm:max-h-none max-sm:h-full"
        style={{ border: `1px solid ${border_color}`, boxShadow: glow, animation: 'modal-enter 0.25s ease-out' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <span className="text-[13px] font-semibold tracking-[0.3em] uppercase" style={{ color: title_color }}>
            {title}
          </span>
          {!locked && (
            <button
              type="button"
              onClick={on_close}
              className="cursor-pointer opacity-40 hover:opacity-80 transition-opacity"
              aria-label="Close"
            >
              <X size={16} className="text-muted" />
            </button>
          )}
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body
  )
}

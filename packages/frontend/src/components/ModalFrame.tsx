// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Extracted house dialog shell: one scrim, one card, and the same three dismiss doors.

/* eslint-disable functional/prefer-immutable-types -- DOM lifecycle boundary. */
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const ModalFrame = ({
  children,
  close,
  close_label,
  label,
  max_width = 'max-w-md',
  soft = false,
}: Readonly<{
  children: ReactNode
  close: () => void
  close_label: string
  label: string
  max_width?: string
  soft?: boolean
}>) => {
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    globalThis.addEventListener('keydown', keydown)
    return () => {
      globalThis.removeEventListener('keydown', keydown)
      document.body.style.overflow = previous
    }
  }, [close])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      role="presentation"
      style={{ backgroundColor: soft ? 'rgba(0,0,0,0.68)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
    >
      <div
        aria-label={label}
        aria-modal="true"
        className={`relative mx-4 max-h-[90vh] w-full ${max_width} overflow-y-auto ${soft ? 'rounded-xl bg-surface/97' : 'bg-surface'}`}
        role="dialog"
        style={{
          animation: 'modal-enter 0.3s ease-out',
          border: soft ? '1px solid rgba(200,150,60,0.28)' : '1px solid var(--color-border)',
          borderImage: soft ? undefined : 'linear-gradient(135deg, #c8963c, #8b6914, #f5d0a9) 1',
          boxShadow: soft
            ? '0 22px 70px rgba(0,0,0,0.58), inset 0 1px rgba(255,255,255,0.04)'
            : '0 0 30px rgba(200,150,60,0.12), inset 0 0 30px rgba(200,150,60,0.03)',
        }}
      >
        <button
          aria-label={close_label}
          className="absolute top-4 right-4 z-10 cursor-pointer opacity-40 transition-opacity hover:opacity-80"
          onClick={close}
          type="button"
        >
          <X className="text-muted" size={16} />
        </button>
        {children}
      </div>
    </div>,
    document.body
  )
}

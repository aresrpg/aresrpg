// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MODAL FRAME — the ONE house dialog shell: a portalled full-screen scrim, the gold-gradient bordered card,
// the corner close affordance, and the three dismiss doors (Escape / backdrop click / the X) plus the
// body-scroll lock while it is open.
//
// Extracted VERBATIM out of contracts_paused_modal.tsx, which now re-composes it. Every dialog in the app is
// meant to be the same object; a second hand-rolled scrim is a second truth about what a modal looks like and
// how it closes. Presentation only — no store, no chain read.

import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function ModalFrame({
  on_close,
  children,
  max_width = 'max-w-md',
  label,
}: {
  on_close: () => void
  children: ReactNode
  /** Tailwind width class for the card — a wide editor needs more room than a notice. */
  max_width?: string
  /** Accessible name for the dialog (a plain string; the visible heading is the caller's). */
  label?: string
}) {
  useEffect(() => {
    const on_key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', on_key)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', on_key)
      document.body.style.overflow = previous
    }
  }, [on_close])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={(event) => {
        if (event.target === event.currentTarget) on_close()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`bg-surface w-full ${max_width} mx-4 relative max-h-[90vh] overflow-y-auto`}
        style={{
          animation: 'modal-enter 0.3s ease-out',
          border: '1px solid var(--color-border)',
          borderImage: 'linear-gradient(135deg, #c8963c, #8b6914, #f5d0a9) 1',
          boxShadow: '0 0 30px rgba(200,150,60,0.12), inset 0 0 30px rgba(200,150,60,0.03)',
        }}
      >
        <ModalClose on_close={on_close} />
        {children}
      </div>
    </div>,
    document.body
  )
}

function ModalClose({ on_close }: { on_close: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={on_close}
      className="absolute top-4 right-4 z-10 cursor-pointer opacity-40 hover:opacity-80 transition-opacity"
      aria-label={t('common.close')}
    >
      <X size={16} className="text-muted" />
    </button>
  )
}

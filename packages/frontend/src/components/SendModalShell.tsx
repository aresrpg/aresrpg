// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Copy, ExternalLink, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { env } from '../env.ts'
import type { AppCopy } from '../i18n/copy.ts'

const explorer_tx_url = (digest: string): string =>
  `https://${env.network === 'mainnet' ? 'suivision.xyz' : `${env.network}.suivision.xyz`}/txblock/${digest}`

export const truncate_digest = (digest: string): string =>
  digest.length <= 16 ? digest : `${digest.slice(0, 10)}...${digest.slice(-6)}`

export const DigestLink = ({ copy, digest }: Readonly<{ copy: AppCopy; digest: string }>) => {
  const [copied, set_copied] = useState(false)
  const copy_digest = (): void => {
    void navigator.clipboard.writeText(digest).then(() => {
      set_copied(true)
      setTimeout(() => set_copied(false), 2_000)
    })
  }
  return (
    <div className="flex w-full flex-col gap-1.5">
      <span className="text-[9px] tracking-[0.2em] text-muted uppercase">{copy.wallet_send_shared.transaction}</span>
      <div className="flex items-center gap-2">
        <a
          className="flex items-center gap-1.5 font-mono text-[10px] tracking-wide text-cyan transition-colors hover:underline"
          href={explorer_tx_url(digest)}
          rel="noopener noreferrer"
          target="_blank"
        >
          {truncate_digest(digest)}
          <ExternalLink className="opacity-50" size={10} />
        </a>
        <button
          aria-label={copy.wallet_copy_address}
          className="flex cursor-pointer items-center gap-1 text-muted transition-colors hover:text-gold"
          onClick={copy_digest}
          type="button"
        >
          {copied ? (
            <>
              <Check className="text-emerald-400" size={12} />
              <span className="text-[9px] tracking-[0.15em] text-emerald-400 uppercase">
                {copy.wallet_send_shared.copied}
              </span>
            </>
          ) : (
            <Copy className="opacity-50" size={12} />
          )}
        </button>
      </div>
    </div>
  )
}

export const SendModalShell = ({
  children,
  close,
  close_label,
  locked,
  title,
  tone = 'default',
}: Readonly<{
  children: ReactNode
  close: () => void
  close_label: string
  locked: boolean
  title: string
  tone?: 'default' | 'success' | 'danger'
}>) => {
  useEffect(() => {
    if (locked) return
    const handler = (event: Readonly<KeyboardEvent>): void => {
      if (event.key === 'Escape') close()
    }
    globalThis.addEventListener('keydown', handler)
    return () => globalThis.removeEventListener('keydown', handler)
  }, [close, locked])
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])
  const border_color =
    tone === 'success' ? 'rgba(52,211,153,0.5)' : tone === 'danger' ? 'rgba(239,68,68,0.45)' : 'var(--color-border)'
  const glow =
    tone === 'success' ? '0 0 30px rgba(52,211,153,0.12)' : tone === 'danger' ? '0 0 30px rgba(239,68,68,0.10)' : 'none'
  const title_color = tone === 'success' ? '#34d399' : tone === 'danger' ? '#f87171' : '#c8963c'
  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm max-sm:p-0"
      onClick={(event) => {
        if (!locked && event.target === event.currentTarget) close()
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col bg-surface max-sm:h-full max-sm:max-h-none"
        style={{ border: `1px solid ${border_color}`, boxShadow: glow }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
          <span className="text-[13px] font-semibold tracking-[0.3em] uppercase" style={{ color: title_color }}>
            {title}
          </span>
          {!locked && (
            <button
              aria-label={close_label}
              className="cursor-pointer opacity-40 transition-opacity hover:opacity-80"
              onClick={close}
              type="button"
            >
              <X className="text-muted" size={16} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body
  )
}

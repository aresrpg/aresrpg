// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Copy, ExternalLink } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NativeModal, GameWindow } from '@aresrpg/ui'

import { env } from '../env.ts'
import { explorer_transaction_url } from '../explorer.ts'
import type { AppCopy } from '../i18n/copy.ts'

export const TransferFact = ({ label, value }: Readonly<{ label: string; value: ReactNode }>) => (
  <div className="flex items-center justify-between gap-3 text-[10px] tracking-wide">
    <span className="text-[9px] tracking-[0.2em] text-muted uppercase">{label}</span>
    <span className="text-text">{value}</span>
  </div>
)

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
          href={explorer_transaction_url(env.network, digest)}
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
  return (
    <NativeModal close={locked ? null : close} label={title} className="aui-modal-scrim">
      <GameWindow
        title={title}
        close={locked ? null : close}
        close_label={close_label}
        className="aui-send-window"
        data-tone={tone}
      >
        <div className="aui-send-body">{children}</div>
      </GameWindow>
    </NativeModal>
  )
}

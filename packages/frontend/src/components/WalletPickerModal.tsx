// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import { Loader2, WalletCards } from 'lucide-react'
import type { ReactNode } from 'react'

import { ModalFrame } from './ModalFrame.tsx'

export const WalletConnectButton = ({
  label,
  open,
  busy = false,
  disabled = false,
}: Readonly<{
  label: string
  open: () => void
  busy?: boolean
  disabled?: boolean
}>) => (
  <Button
    tone="primary"
    data-wallet-connect=""
    disabled={busy || disabled}
    onClick={open}
    type="button"
    aria-haspopup="dialog"
  >
    {busy ? <Loader2 className="animate-spin" size={12} /> : <WalletCards size={12} />}
    {label}
  </Button>
)

export const WalletChoices = ({
  choices,
  busy,
  select,
  empty_label,
  select_label,
}: Readonly<{
  choices: readonly string[]
  busy: boolean
  select: (choice: string) => void
  empty_label: string
  select_label: string
}>) =>
  choices.length === 0 ? (
    <div className="border border-border bg-black/25 px-4 py-3 text-center text-[9px] tracking-[0.12em] text-muted uppercase">
      {empty_label}
    </div>
  ) : (
    <div className="flex flex-col gap-2" data-wallet-choices="">
      {choices.map((choice) => (
        <Button
          className="w-full justify-start"
          aria-label={choice}
          disabled={busy}
          key={choice}
          onClick={() => select(choice)}
          type="button"
          title={choice}
        >
          <WalletCards className="shrink-0 text-cyan" size={14} />
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-[0.08em] text-text">
            {choice}
          </span>
          <span className="text-[8px] tracking-[0.16em] text-cyan/75 uppercase">{select_label}</span>
        </Button>
      ))}
    </div>
  )

export const WalletPickerModal = ({
  title,
  subtitle,
  close,
  close_label,
  children,
}: Readonly<{
  title: string
  subtitle?: string
  close: () => void
  close_label: string
  children: ReactNode
}>) => (
  <ModalFrame close={close} close_label={close_label} label={title} max_width="max-w-sm" soft>
    <div className="flex flex-col gap-5 p-6 font-mono text-text" data-wallet-picker="">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="grid size-11 place-items-center border border-cyan/30 bg-cyan/6 text-cyan shadow-[0_0_24px_rgba(72,207,207,0.08)]">
          <WalletCards size={19} />
        </div>
        {subtitle && <p className="max-w-xs text-[9px] leading-5 tracking-[0.06em] text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  </ModalFrame>
)

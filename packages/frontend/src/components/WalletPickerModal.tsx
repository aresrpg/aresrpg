// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import { Loader2, WalletCards, X } from 'lucide-react'
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

type WalletRowText = Readonly<{ name: string; detail?: string }>

const WalletRowContent = ({ name, detail, children }: WalletRowText & Readonly<{ children: ReactNode }>) => (
  <>
    <span className="aui-wallet-row-icon">
      <WalletCards size={20} aria-hidden="true" />
    </span>
    <span className="aui-wallet-row-text">
      <strong>{name}</strong>
      {detail && <small>{detail}</small>}
    </span>
    {children}
  </>
)

/** A wallet that is already chosen; its own action (change, disconnect) is the child. */
export const WalletRow = ({
  selected,
  children,
  ...text
}: WalletRowText & Readonly<{ selected?: boolean; children: ReactNode }>) => (
  <div className="aui-wallet-row" data-selected={selected || undefined}>
    <WalletRowContent {...text}>{children}</WalletRowContent>
  </div>
)

/** A wallet the player can pick, named by its full identity; a saved account may also be removed. */
export const WalletRowButton = ({
  label,
  identity,
  busy = false,
  disabled,
  onClick,
  remove,
  ...text
}: WalletRowText &
  Readonly<{
    label: string
    identity?: string
    busy?: boolean
    disabled: boolean
    onClick: () => void
    remove?: Readonly<{ label: string; run: () => void }>
  }>) => (
  <div className="aui-wallet-row">
    <button
      className="aui-wallet-row-pick"
      type="button"
      aria-label={identity ?? text.name}
      title={identity ?? text.name}
      disabled={disabled}
      onClick={onClick}
    >
      <WalletRowContent {...text}>
        <span className="aui-wallet-row-action">
          {busy && <Loader2 className="animate-spin" size={14} aria-hidden="true" />}
          {label}
        </span>
      </WalletRowContent>
    </button>
    {remove && (
      <button
        className="aui-wallet-row-remove"
        type="button"
        aria-label={remove.label}
        title={remove.label}
        disabled={disabled}
        onClick={remove.run}
      >
        <X size={18} aria-hidden="true" />
      </button>
    )}
  </div>
)

export const WalletChoices = ({
  choices,
  busy,
  select,
  empty_label,
  select_label,
}: Readonly<{
  choices: readonly WalletRowText[]
  busy: boolean
  select: (choice: string) => void
  empty_label: string
  select_label: string
}>) =>
  choices.length === 0 ? (
    <p className="rounded border border-border bg-black/25 px-4 py-3 text-center text-xs text-muted">{empty_label}</p>
  ) : (
    <div className="flex flex-col gap-2.5" data-wallet-choices="">
      {choices.map((choice) => (
        <WalletRowButton
          {...choice}
          key={choice.name}
          label={select_label}
          disabled={busy}
          onClick={() => select(choice.name)}
        />
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
    <div className="flex flex-col gap-5 p-6 text-text" data-wallet-picker="">
      {subtitle && <p className="text-[13px] leading-relaxed text-muted">{subtitle}</p>}
      {children}
    </div>
  </ModalFrame>
)

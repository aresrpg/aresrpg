// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { CheckCircle2, XCircle } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'
import { format_sui } from '../wallet_amount.ts'

import { DigestLink } from './SendModalShell.tsx'

export type WalletTransferState = Readonly<{
  phase: 'building' | 'review' | 'executing' | 'success' | 'failed'
  amount_mist: bigint
  drain: boolean
  recipient_address: string
  recipient_name: string | null
  gas_estimate_mist?: bigint
  digest?: string | null
  error?: string
}>

const template = (value: string, variables?: Readonly<Record<string, string>>): string =>
  Object.entries(variables ?? {}).reduce(
    (text, [key, replacement]) => text.replaceAll(`{{${key}}}`, replacement),
    value
  )

const send_dictionary = (copy: AppCopy): Readonly<Record<string, unknown>> => {
  const value = copy.wallet_legacy.send
  return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : Object.freeze({})
}

export const send_text = (copy: AppCopy, key: string, variables?: Readonly<Record<string, string>>): string => {
  const value = send_dictionary(copy)[key]
  return template(typeof value === 'string' ? value : key, variables)
}

export const send_error_text = (copy: AppCopy, key: string, variables?: Readonly<Record<string, string>>): string => {
  const errors = send_dictionary(copy).err
  const value =
    typeof errors === 'object' && errors !== null ? (errors as Readonly<Record<string, unknown>>)[key] : null
  return template(typeof value === 'string' ? value : key, variables)
}

export const truncate_address = (address: string): string => `${address.slice(0, 8)}…${address.slice(-6)}`

export const SuiTransferSuccess = ({
  close,
  copy,
  reset,
  transfer,
}: Readonly<{ close: () => void; copy: AppCopy; reset: () => void; transfer: WalletTransferState }>) => (
  <div className="flex flex-col items-center gap-5">
    <CheckCircle2
      className="text-emerald-400"
      size={36}
      style={{ filter: 'drop-shadow(0 0 12px rgba(52,211,153,0.5))', animation: 'glow-pulse 3s ease-in-out infinite' }}
    />
    <div className="text-center text-[13px] font-semibold tracking-[0.3em] text-emerald-400 uppercase">
      {send_text(copy, 'sent')}
    </div>
    <div className="text-center text-[10px] leading-relaxed tracking-wide text-muted">
      {transfer.drain
        ? send_text(copy, 'success_drain_body', {
            recipient: transfer.recipient_name ?? truncate_address(transfer.recipient_address),
          })
        : send_text(copy, 'success_body', {
            amount: `${format_sui(transfer.amount_mist, 2)} SUI`,
            recipient: transfer.recipient_name ?? truncate_address(transfer.recipient_address),
          })}
    </div>
    {transfer.digest && <DigestLink copy={copy} digest={transfer.digest} />}
    <div className="mt-2 flex w-full gap-3">
      <button
        className="btn-gold flex-1 cursor-pointer px-6 py-2.5 text-[10px] tracking-[0.2em]"
        onClick={reset}
        type="button"
      >
        {send_text(copy, 'send_more')}
      </button>
      <button
        className="btn-outline flex-1 cursor-pointer px-6 py-2.5 text-[10px] tracking-[0.2em]"
        onClick={close}
        type="button"
      >
        {copy.wallet_send_shared.close}
      </button>
    </div>
  </div>
)

const failure_key = (error: string | undefined): string => {
  const message = error?.toLowerCase() ?? ''
  if (message.includes('reject') || message.includes('denied')) return 'user_rejected'
  if (message.includes('insufficient') || message.includes('balance')) return 'insufficient_balance'
  if (message.includes('address')) return 'invalid_address'
  if (message.includes('rate')) return 'rate_limited'
  return 'tx_failed'
}

export const SuiTransferFailed = ({
  close,
  copy,
  open_funds,
  reset,
  transfer,
}: Readonly<{
  close: () => void
  copy: AppCopy
  open_funds: () => void
  reset: () => void
  transfer: WalletTransferState
}>) => {
  const key = failure_key(transfer.error)
  return (
    <div className="flex flex-col items-center gap-5">
      <XCircle className="text-red-400" size={36} style={{ filter: 'drop-shadow(0 0 12px rgba(248,113,113,0.4))' }} />
      <div className="text-center text-[11px] leading-relaxed tracking-wide text-text">
        {send_error_text(copy, key)}
      </div>
      <div className="mt-2 flex w-full gap-3">
        <button
          className="btn-gold flex-1 cursor-pointer px-6 py-2.5 text-[10px] tracking-[0.2em]"
          onClick={key === 'insufficient_balance' ? open_funds : reset}
          type="button"
        >
          {key === 'insufficient_balance' ? copy.wallet_send_shared.add_funds : copy.wallet_send_shared.retry}
        </button>
        <button
          className="btn-outline flex-1 cursor-pointer px-6 py-2.5 text-[10px] tracking-[0.2em]"
          onClick={close}
          type="button"
        >
          {copy.wallet_send_shared.close}
        </button>
      </div>
    </div>
  )
}

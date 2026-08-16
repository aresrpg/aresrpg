// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { AtSign, Check, Copy, Hash, Loader2, Send } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { format_sui, parse_sui_amount } from '../wallet_amount.ts'
import { classify_wallet_recipient, type WalletRecipientKind } from '../wallet_recipient.ts'

import { SendModalShell as Shell } from './SendModalShell.tsx'
import {
  send_error_text as error_text,
  send_text,
  SuiTransferFailed as Failed,
  SuiTransferSuccess as Success,
  truncate_address,
  type WalletTransferState,
} from './SuiTransferResult.tsx'

type WalletRecipientState =
  | Readonly<{
      input: string
      status: 'idle' | 'invalid' | 'resolving' | 'not_found' | 'failed'
      kind?: WalletRecipientKind
    }>
  | Readonly<{
      input: string
      status: 'resolved'
      kind: WalletRecipientKind
      address: string
      name: string | null
    }>

type WalletView = Readonly<{
  address: string
  sui_balance_mist: bigint | null
  wallet_recipient: WalletRecipientState
  wallet_amount_input: string
  wallet_amount_mist: bigint | null
  wallet_amount_error: 'invalid' | 'insufficient' | null
  wallet_drain: boolean
  wallet_transfer: WalletTransferState | null
}>

const exact_sui = (mist: bigint): string => format_sui(mist, 9).replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, '')

const PropRow = ({ label, value }: Readonly<{ label: string; value: ReactNode }>) => (
  <div className="flex items-center justify-between gap-3 text-[10px] tracking-wide">
    <span className="text-[9px] tracking-[0.2em] text-muted uppercase">{label}</span>
    <span className="text-text">{value}</span>
  </div>
)

const RecipientHint = ({
  address_mode,
  copy,
  recipient,
}: Readonly<{ address_mode: boolean; copy: AppCopy; recipient: WalletRecipientState }>) => {
  const resolved = recipient.status === 'resolved'
  if (address_mode) {
    if (resolved) return <span className="text-emerald-400/80">{send_text(copy, 'address_valid')}</span>
    if (recipient.input.length > 2) return <span className="text-red-400/80">{send_text(copy, 'address_invalid')}</span>
    return <span>{send_text(copy, 'hint')}</span>
  }
  if (resolved)
    return (
      <span className="flex items-center gap-1 text-emerald-400/80">
        <Check size={10} />
        {recipient.kind === 'suins'
          ? send_text(copy, 'suins_resolved', { name: recipient.name ?? recipient.input })
          : send_text(copy, 'player_resolved_address', {
              name: recipient.name ?? recipient.input,
              address: truncate_address(recipient.address),
            })}
      </span>
    )
  if (recipient.status === 'resolving')
    return (
      <span className="flex items-center gap-1">
        <Loader2 className="animate-spin" size={10} />
        {send_text(copy, 'suins_resolving')}
      </span>
    )
  if (recipient.status === 'not_found')
    return <span className="text-red-400/80">{send_text(copy, 'player_not_found')}</span>
  if (recipient.status === 'failed')
    return <span className="text-red-400/80">{send_text(copy, 'player_lookup_failed')}</span>
  return <span>{send_text(copy, 'hint')}</span>
}

const SendForm = ({
  amount_changed,
  build,
  close,
  copy,
  max,
  recipient_changed,
  session,
}: Readonly<{
  amount_changed: (value: string) => void
  build: () => void
  close: () => void
  copy: AppCopy
  max: () => void
  recipient_changed: (value: string) => void
  session: WalletView
}>) => {
  const recipient = session.wallet_recipient
  const address_mode = /^0x/i.test(recipient.input)
  const resolved = recipient.status === 'resolved'
  const is_self = resolved && recipient.address.toLowerCase() === session.address?.toLowerCase()
  const can_submit = resolved && !is_self && session.wallet_amount_mist !== null && session.wallet_amount_error === null
  const on_amount_change = (value: string): void => {
    const normalized = value.replace(',', '.')
    if (/^\d*\.?\d{0,9}$/.test(normalized)) amount_changed(normalized)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label className="text-[9px] font-medium tracking-[0.2em] text-gold uppercase">
          {send_text(copy, 'recipient_label')}
        </label>
        <div className="relative" tabIndex={-1}>
          <div
            className="flex items-center gap-2 px-3 py-2.5 transition-colors"
            style={{
              border: `1px solid ${recipient.status === 'invalid' || recipient.status === 'failed' || recipient.status === 'not_found' ? 'rgba(239,68,68,0.5)' : resolved ? 'rgba(52,211,153,0.5)' : 'rgba(200,150,60,0.3)'}`,
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            {address_mode ? (
              <Hash className="text-gold opacity-70" size={12} />
            ) : (
              <AtSign className="text-gold opacity-70" size={12} />
            )}
            <input
              autoComplete="off"
              className="flex-1 bg-transparent font-mono text-[11px] tracking-wide text-text outline-none placeholder:text-muted/50"
              maxLength={66}
              onChange={(event) => recipient_changed(event.target.value)}
              placeholder={send_text(copy, 'recipient_placeholder')}
              spellCheck={false}
              type="text"
              value={recipient.input}
            />
            {recipient.status === 'resolving' && <Loader2 className="animate-spin text-muted" size={12} />}
            {resolved && <Check className="text-emerald-400" size={14} />}
          </div>
          <div className="mt-1.5 min-h-3 text-[9px] tracking-wide text-muted">
            <RecipientHint address_mode={address_mode} copy={copy} recipient={recipient} />
          </div>
        </div>
      </div>
      {is_self && (
        <div
          className="px-3 py-2 text-[10px] tracking-wide text-red-300"
          style={{ border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)' }}
        >
          {error_text(copy, 'self_send')}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] tracking-[0.25em] text-muted uppercase">{send_text(copy, 'amount_label')}</span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] tracking-[0.15em] text-muted uppercase">
              {session.sui_balance_mist === null ? '-' : `${format_sui(session.sui_balance_mist, 2)} SUI`}
            </span>
            <button
              className="cursor-pointer px-2 py-0.5 text-[9px] tracking-[0.2em] text-gold uppercase disabled:cursor-not-allowed disabled:opacity-30"
              disabled={session.sui_balance_mist === null || session.sui_balance_mist <= 0n}
              onClick={max}
              style={{ border: '1px solid rgba(200,150,60,0.4)' }}
              type="button"
            >
              MAX
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <input
            className="w-full border border-border/40 bg-transparent px-3 py-2 font-mono text-[13px] tracking-wider text-text transition-colors focus:border-gold/60 focus:outline-none"
            inputMode="decimal"
            onChange={(event) => on_amount_change(event.target.value)}
            placeholder="0.00"
            type="text"
            value={
              session.wallet_drain && session.sui_balance_mist !== null
                ? exact_sui(session.sui_balance_mist)
                : session.wallet_amount_input
            }
          />
          {session.wallet_amount_error && (
            <span className="text-[9px] tracking-[0.15em] text-red-400 uppercase">
              {error_text(
                copy,
                session.wallet_amount_error === 'insufficient' ? 'insufficient_balance' : 'amount_invalid'
              )}
            </span>
          )}
          {session.wallet_drain && !session.wallet_amount_error && (
            <span className="text-[9px] tracking-[0.15em] text-amber-400 uppercase">
              {send_text(copy, 'drain_hint')}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 flex gap-3">
        <button
          className="btn-gold inline-flex flex-1 cursor-pointer items-center justify-center gap-2 px-6 py-2.5 text-[10px] tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!can_submit}
          onClick={build}
          type="button"
        >
          <Send size={12} />
          {send_text(copy, 'submit')}
        </button>
        <button
          className="btn-outline flex-1 cursor-pointer px-6 py-2.5 text-[10px] tracking-[0.2em]"
          onClick={close}
          type="button"
        >
          {copy.wallet_send_shared.cancel}
        </button>
      </div>
    </div>
  )
}

const Review = ({
  cancel,
  confirm,
  copy,
  transfer,
}: Readonly<{ cancel: () => void; confirm: () => void; copy: AppCopy; transfer: WalletTransferState }>) => {
  const [copied, set_copied] = useState(false)
  const gas = transfer.gas_estimate_mist ?? 2_000_000n
  const copy_address = (): void => {
    void navigator.clipboard.writeText(transfer.recipient_address).then(() => {
      set_copied(true)
      setTimeout(() => set_copied(false), 2_000)
    })
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] tracking-[0.25em] text-muted uppercase">{send_text(copy, 'sending_to')}</span>
        {transfer.recipient_name && (
          <div className="flex items-center gap-2 text-[12px] tracking-[0.15em] text-gold uppercase">
            <AtSign className="opacity-70" size={12} />
            {transfer.recipient_name}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="flex-1 break-all font-mono text-[10px] tracking-wide text-text/80">
            {transfer.recipient_address}
          </span>
          <button
            aria-label={copy.wallet_copy_address}
            className="shrink-0 cursor-pointer text-muted transition-colors hover:text-gold"
            onClick={copy_address}
            type="button"
          >
            {copied ? <Check className="text-emerald-400" size={14} /> : <Copy className="opacity-60" size={14} />}
          </button>
        </div>
      </div>
      <div className="h-px w-full bg-border" />
      {transfer.drain ? (
        <>
          <div
            className="px-3 py-2 text-[10px] leading-relaxed tracking-wide text-amber-400"
            style={{ border: '1px solid rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.06)' }}
          >
            {send_text(copy, 'drain_warning')}
          </div>
          <PropRow
            label={send_text(copy, 'drain_sending')}
            value={<span className="font-semibold text-gold">{exact_sui(transfer.amount_mist)} SUI</span>}
          />
          <PropRow
            label={copy.wallet_send_shared.gas_estimated}
            value={
              <span className="text-[10px] text-text/60">
                ~{exact_sui(gas)} SUI · {send_text(copy, 'drain_fee_note')}
              </span>
            }
          />
          <div className="h-px w-full bg-border" />
          <PropRow
            label={send_text(copy, 'drain_remaining')}
            value={<span className="font-semibold text-gold">0 SUI</span>}
          />
        </>
      ) : (
        <>
          <PropRow
            label={send_text(copy, 'amount_label')}
            value={<span className="font-semibold text-gold">{format_sui(transfer.amount_mist, 2)} SUI</span>}
          />
          <PropRow
            label={copy.wallet_send_shared.gas_estimated}
            value={<span className="text-[10px] text-text/60">~{exact_sui(gas)} SUI</span>}
          />
          <div className="h-px w-full bg-border" />
          <PropRow
            label={copy.wallet_send_shared.total}
            value={<span className="font-semibold text-gold">~{format_sui(transfer.amount_mist + gas, 2)} SUI</span>}
          />
        </>
      )}
      <div className="mt-4 flex gap-3">
        <button
          className="btn-gold flex-1 cursor-pointer px-6 py-2.5 text-[10px] tracking-[0.2em]"
          onClick={confirm}
          type="button"
        >
          <span className="inline-flex items-center justify-center gap-2">
            <Send size={12} />
            {send_text(copy, 'send_confirm')}
          </span>
        </button>
        <button
          className="btn-outline flex-1 cursor-pointer px-6 py-2.5 text-[10px] tracking-[0.2em]"
          onClick={cancel}
          type="button"
        >
          {copy.wallet_send_shared.cancel}
        </button>
      </div>
    </div>
  )
}

export const SendSuiModal = ({
  balance_mist,
  close,
  copy,
  on_sent,
  open_funds,
  resolve_character,
  wallet,
}: Readonly<{
  balance_mist: bigint | null
  close: () => void
  copy: AppCopy
  on_sent: () => void
  open_funds: () => void
  resolve_character: (name: string) => Promise<Readonly<{ address: string; name: string }>>
  wallet: AuthSession
}>) => {
  const [recipient, set_recipient] = useState<WalletRecipientState>({ input: '', status: 'idle' })
  const [amount_input, set_amount_input] = useState('')
  const [drain, set_drain] = useState(false)
  const [transfer, set_transfer] = useState<WalletTransferState | null>(null)
  const request = useRef(0)
  const executing = useRef(false)
  const amount_mist = drain ? balance_mist : parse_sui_amount(amount_input)
  const amount_error =
    amount_input.trim().length === 0 && !drain
      ? null
      : amount_mist === null
        ? 'invalid'
        : balance_mist !== null && amount_mist > balance_mist
          ? 'insufficient'
          : null
  const session: WalletView = Object.freeze({
    address: wallet.address,
    sui_balance_mist: balance_mist,
    wallet_recipient: recipient,
    wallet_amount_input: amount_input,
    wallet_amount_mist: amount_mist,
    wallet_amount_error: amount_error,
    wallet_drain: drain,
    wallet_transfer: transfer,
  })

  useEffect(() => {
    if (recipient.status !== 'resolving' || !recipient.kind) return
    // eslint-disable-next-line functional/immutable-data -- A React ref correlates this component's async lookup generations.
    const own_request = ++request.current
    const timer = setTimeout(() => {
      const lookup =
        recipient.kind === 'suins'
          ? wallet
              .resolve_suins_address(recipient.input)
              .then((address) =>
                address ? Object.freeze({ address, name: recipient.input }) : Promise.reject(new Error('not found'))
              )
          : resolve_character(recipient.input)
      void lookup
        .then(({ address, name }) => {
          if (own_request !== request.current) return
          set_recipient(
            Object.freeze({
              input: recipient.input,
              status: 'resolved',
              kind: recipient.kind!,
              address,
              name,
            })
          )
        })
        .catch((error) => {
          if (own_request !== request.current) return
          const not_found = error instanceof Error && error.message.toLowerCase().includes('not found')
          if (!not_found) console.warn('Recipient lookup failed.', error)
          set_recipient(
            Object.freeze({
              input: recipient.input,
              status: not_found ? 'not_found' : 'failed',
              kind: recipient.kind,
            })
          )
        })
    }, 400)
    return () => clearTimeout(timer)
  }, [recipient, resolve_character, wallet])

  const recipient_changed = (value: string): void => {
    // eslint-disable-next-line functional/immutable-data -- A React ref invalidates only this component's stale lookups.
    request.current += 1
    const classified = classify_wallet_recipient(value)
    set_transfer(null)
    if (classified.kind === 'address')
      return set_recipient(
        Object.freeze({
          input: classified.value,
          status: 'resolved',
          kind: classified.kind,
          address: classified.value,
          name: null,
        })
      )
    set_recipient(
      Object.freeze({
        input: classified.value,
        status:
          classified.kind === 'suins' || classified.kind === 'character'
            ? 'resolving'
            : classified.kind === 'invalid_address'
              ? 'invalid'
              : 'idle',
        ...(classified.kind === 'suins' || classified.kind === 'character' ? { kind: classified.kind } : {}),
      })
    )
  }

  const amount_changed = (value: string): void => {
    set_amount_input(value)
    set_drain(false)
    set_transfer(null)
  }
  const max = (): void => {
    if (balance_mist === null || balance_mist <= 0n) return
    set_amount_input('')
    set_drain(true)
    set_transfer(null)
  }
  const clear = (): void => {
    // eslint-disable-next-line functional/immutable-data -- This local latch prevents a double wallet prompt before React renders.
    executing.current = false
    set_transfer(null)
  }
  const build = (): void => {
    if (recipient.status !== 'resolved' || amount_mist === null || amount_error !== null) return
    if (recipient.address.toLowerCase() === wallet.address.toLowerCase()) return
    const pending: WalletTransferState = Object.freeze({
      phase: 'building',
      amount_mist,
      drain,
      recipient_address: recipient.address,
      recipient_name: recipient.name,
    })
    // eslint-disable-next-line functional/immutable-data -- A React ref correlates this component's async estimate generations.
    const own_request = ++request.current
    set_transfer(pending)
    void wallet
      .estimate_sui_transfer(pending.recipient_address, pending.amount_mist, pending.drain)
      .then((gas_estimate_mist) => {
        if (own_request === request.current)
          set_transfer(Object.freeze({ ...pending, phase: 'review', gas_estimate_mist }))
      })
      .catch((error) => {
        console.error('SUI transfer estimate failed.', error)
        if (own_request === request.current)
          set_transfer(
            Object.freeze({
              ...pending,
              phase: 'failed',
              error: error instanceof Error ? error.message : String(error),
            })
          )
      })
  }
  const confirm = (): void => {
    if (transfer?.phase !== 'review' || executing.current) return
    // eslint-disable-next-line functional/immutable-data -- This local latch prevents a double wallet prompt before React renders.
    executing.current = true
    const pending = Object.freeze({ ...transfer, phase: 'executing' as const })
    set_transfer(pending)
    void wallet
      .send_sui(pending.recipient_address, pending.amount_mist, pending.drain)
      .then(({ digest }) => {
        set_transfer(Object.freeze({ ...pending, phase: 'success', digest }))
        on_sent()
      })
      .catch((error) => {
        console.error('SUI transfer failed.', error)
        // eslint-disable-next-line functional/immutable-data -- The component may retry after a reported failure.
        executing.current = false
        set_transfer(
          Object.freeze({ ...pending, phase: 'failed', error: error instanceof Error ? error.message : String(error) })
        )
      })
  }

  const current_transfer = session.wallet_transfer
  if (!current_transfer)
    return (
      <Shell close={close} close_label={copy.wallet_close} locked={false} title={send_text(copy, 'title')}>
        <SendForm
          amount_changed={amount_changed}
          build={build}
          close={close}
          copy={copy}
          max={max}
          recipient_changed={recipient_changed}
          session={session}
        />
      </Shell>
    )
  if (current_transfer.phase === 'building')
    return (
      <Shell close={close} close_label={copy.wallet_close} locked={false} title={send_text(copy, 'building_title')}>
        <div className="flex flex-col items-center gap-5 py-8">
          <Loader2 className="animate-spin text-gold opacity-80" size={28} />
          <div className="text-center text-[10px] tracking-[0.2em] text-muted uppercase">
            {send_text(copy, 'building_body')}
          </div>
        </div>
      </Shell>
    )
  if (current_transfer.phase === 'review')
    return (
      <Shell close={clear} close_label={copy.wallet_close} locked={false} title={send_text(copy, 'confirm_title')}>
        <Review cancel={clear} confirm={confirm} copy={copy} transfer={current_transfer} />
      </Shell>
    )
  if (current_transfer.phase === 'executing')
    return (
      <Shell close={() => undefined} close_label={copy.wallet_close} locked title={send_text(copy, 'executing_title')}>
        <div className="flex flex-col items-center gap-5 py-8">
          <Loader2 className="animate-spin text-gold opacity-80" size={28} />
          <div className="text-center text-[11px] tracking-[0.2em] text-text uppercase">
            {send_text(copy, 'executing_body')}
          </div>
          <div className="mt-2 text-[9px] tracking-[0.25em] text-amber-400 uppercase">
            {copy.wallet_send_shared.dont_close}
          </div>
        </div>
      </Shell>
    )
  if (current_transfer.phase === 'success')
    return (
      <Shell
        close={close}
        close_label={copy.wallet_close}
        locked={false}
        title={send_text(copy, 'success_title')}
        tone="success"
      >
        <Success close={close} copy={copy} reset={clear} transfer={current_transfer} />
      </Shell>
    )
  return (
    <Shell
      close={close}
      close_label={copy.wallet_close}
      locked={false}
      title={send_text(copy, 'failed_title')}
      tone="danger"
    >
      <Failed close={close} copy={copy} open_funds={open_funds} reset={clear} transfer={current_transfer} />
    </Shell>
  )
}

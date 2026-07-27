// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// item_send_modal.tsx — kiosk-aware, escrow-recoverable item SEND. A review exists only after the exact SDK PTB
// has dry-run successfully; the form accepts the issue's two target modes: raw Sui address or SuiNS.

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  AtSign,
  Hash,
  Send,
  AlertTriangle,
} from 'lucide-react'

import { format_mist_to_sui } from '../utils/sui_mist'
import { truncate_address } from '../utils/address'
import { is_suins_name } from '../utils/suins'
import { use_item_send, type SendItem, type ItemSendState } from '../stores/item_send'

import { ItemImage } from './items'
import { validate_item_send_dialog } from './item_send_validation'
import { SendModalShell as Shell } from './send_modal_shell'

const address_full_re = /^0x[a-f0-9]{64}$/i

function truncate_digest(digest: string): string {
  return digest.length <= 16 ? digest : `${digest.slice(0, 10)}...${digest.slice(-6)}`
}

function format_sui_exact(mist: bigint): string {
  return format_mist_to_sui(mist, 9).replace(/0+$/, '').replace(/\.$/, '')
}

function ItemsStrip({ items, selected_amount = null }: { items: SendItem[]; selected_amount?: bigint | null }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[9px] tracking-[0.2em] uppercase text-muted">
        {t('gift.send.items_label', { count: items.length })}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <div
            key={it.id}
            className="flex items-center gap-1.5 border border-border px-1.5 py-1"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <ItemImage
              id={it.slug}
              appearance={it.appearance}
              category={it.category ?? undefined}
              className="w-6 h-6 shrink-0"
            />
            <span className="text-[9px] tracking-[0.1em] uppercase text-text/80 truncate max-w-[140px]">
              {it.name}
              {it.stackable ? ` ×${items.length === 1 && selected_amount != null ? selected_amount : it.amount}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DigestLink({ digest }: { digest: string }) {
  const { t } = useTranslation()
  const [copied, set_copied] = useState(false)
  return (
    <div className="w-full flex flex-col gap-1.5">
      <span className="text-muted text-[9px] tracking-[0.2em] uppercase">{t('purchase.transaction')}</span>
      <div className="flex items-center gap-2">
        <a
          href={`https://suiscan.xyz/testnet/tx/${digest}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan text-[10px] tracking-wide hover:underline flex items-center gap-1.5 transition-colors font-mono"
        >
          {truncate_digest(digest)}
          <ExternalLink size={10} className="opacity-50" />
        </a>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(digest)
              set_copied(true)
              setTimeout(() => set_copied(false), 2000)
            } catch {
              /* ignore */
            }
          }}
          className="text-muted hover:text-gold transition-colors cursor-pointer flex items-center gap-1"
          aria-label="Copy digest"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="opacity-50" />}
        </button>
      </div>
    </div>
  )
}

function RecipientForm({ items, on_close }: { items: SendItem[]; on_close: () => void }) {
  const { t } = useTranslation()
  const [raw, set_raw] = useState('')
  const single_stack = items.length === 1 && items[0].stackable
  const available_amount = single_stack ? items[0].amount : 1
  const [amount, set_amount] = useState(String(available_amount))
  const validation = validate_item_send_dialog({
    recipient: raw,
    amount: single_stack ? amount : '1',
    available_amount,
    stackable: single_stack,
  })
  const address_mode = /^0x/i.test(raw.trim())
  const full_address = address_full_re.test(raw.trim())
  const suins_mode = is_suins_name(raw)

  const on_continue = () => {
    if (!validation.valid || validation.amount == null) return
    void use_item_send.getState().prepare({
      items,
      recipient_input: raw,
      amount: single_stack ? validation.amount : undefined,
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <ItemsStrip items={items} />

      <div className="flex flex-col gap-1.5">
        <label className="text-[9px] tracking-[0.2em] uppercase text-gold font-medium">
          {t('gift.send.recipient_label')}
        </label>
        <div
          className="flex items-center gap-2 px-3 py-2.5 transition-colors"
          style={{
            border: `1px solid ${
              raw && validation.recipient_error
                ? 'rgba(239,68,68,0.5)'
                : validation.recipient_error == null
                  ? 'rgba(52,211,153,0.5)'
                  : 'rgba(200,150,60,0.3)'
            }`,
            background: 'rgba(255,255,255,0.04)',
          }}
        >
          {address_mode ? (
            <Hash size={12} className="text-gold opacity-70" />
          ) : (
            <AtSign size={12} className="text-gold opacity-70" />
          )}
          <input
            type="text"
            value={raw}
            onChange={(e) => set_raw(e.target.value)}
            placeholder={t('gift.send.recipient_placeholder')}
            autoComplete="off"
            spellCheck={false}
            maxLength={255}
            className="bg-transparent flex-1 text-[11px] tracking-wide font-mono text-text outline-none placeholder:text-muted/50"
          />
          {validation.recipient_error == null && <Check size={14} className="text-emerald-400" />}
        </div>
        <div className="text-[9px] tracking-wide text-muted">
          {full_address ? (
            <span className="text-emerald-400/80">{t('gift.send.address_valid')}</span>
          ) : suins_mode ? (
            <span className="text-emerald-400/80">{t('gift.send.suins_detected')}</span>
          ) : raw ? (
            <span className="text-red-400/80">{t('gift.send.address_invalid')}</span>
          ) : (
            <span>{t('gift.send.recipient_hint')}</span>
          )}
        </div>
      </div>

      {single_stack && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[9px] tracking-[0.2em] uppercase text-gold font-medium">
            {t('gift.send.amount_label')}
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={available_amount}
            step={1}
            value={amount}
            onChange={(event) => set_amount(event.target.value)}
            className="bg-transparent border border-gold/30 px-3 py-2.5 text-[11px] font-mono text-text outline-none focus:border-gold"
          />
          <span className={`text-[9px] tracking-wide ${validation.amount_error ? 'text-red-400/80' : 'text-muted'}`}>
            {validation.amount_error
              ? t(`gift.send.err.${validation.amount_error}`)
              : t('gift.send.amount_available', { amount: available_amount })}
          </span>
        </div>
      )}

      <div className="flex gap-3 mt-2">
        <button
          type="button"
          disabled={!validation.valid}
          onClick={on_continue}
          className="btn-gold flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          <Send size={12} />
          {t('gift.send.continue')}
        </button>
        <button
          type="button"
          onClick={on_close}
          className="btn-outline flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

// ─── REVIEW (double-confirm) ───────────────────────────────────────────────

function ReviewView({ send, on_back }: { send: ItemSendState; on_back: () => void }) {
  const { t } = useTranslation()
  const [ack, set_ack] = useState(false)
  const confirm = use_item_send((s) => s.confirm)

  return (
    <div className="flex flex-col gap-4">
      {/* Recipient */}
      <div className="flex flex-col gap-1.5">
        <span className="text-muted text-[9px] tracking-[0.25em] uppercase">{t('gift.send.sending_to')}</span>
        {send.resolved_name && (
          <div className="text-gold text-[12px] tracking-[0.15em] uppercase flex items-center gap-2">
            <AtSign size={12} className="opacity-70" />
            {send.resolved_name}
          </div>
        )}
        <span className="text-text/80 text-[10px] font-mono tracking-wide break-all">{send.resolved_address}</span>
      </div>

      <div className="w-full h-px bg-border" />

      <ItemsStrip items={send.items} selected_amount={send.selected_amount} />

      <div
        className="flex flex-col gap-3 px-3 py-3"
        style={{ border: '1px solid rgba(34,211,238,0.28)', background: 'rgba(34,211,238,0.04)' }}
      >
        <span className="text-cyan text-[9px] tracking-[0.22em] uppercase font-semibold">
          {t('gift.send.preview_title')}
        </span>
        <div className="flex items-center justify-between gap-3 text-[10px]">
          <span className="text-muted uppercase tracking-[0.16em]">{t('gift.send.gas_label')}</span>
          <span className="font-mono text-text">
            {send.gas_estimate_mist == null ? '—' : `${format_sui_exact(send.gas_estimate_mist)} SUI`}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3 text-[10px]">
          <span className="text-muted uppercase tracking-[0.16em]">{t('gift.send.receiver_gets')}</span>
          <span className="flex flex-col items-end gap-1 text-text">
            {send.receiver_items.map((item, index) => (
              <span key={`${item.name}-${index}`}>
                {item.name} ×{item.amount.toString()}
              </span>
            ))}
          </span>
        </div>
        <span className="text-muted/70 text-[8px] tracking-wide">{t('gift.send.receiver_claim_note')}</span>
      </div>

      {/* Royalty (prepaid escrow) */}
      <div className="flex items-center justify-between gap-3 text-[10px] tracking-wide">
        <span className="text-muted tracking-[0.2em] uppercase text-[9px]">{t('gift.send.royalty_label')}</span>
        <span className="text-text">
          {send.royalty_mist != null ? (
            <span className="text-gold font-semibold">{format_sui_exact(send.royalty_mist)} SUI</span>
          ) : (
            <span className="text-muted">{t('gift.send.royalty_unknown')}</span>
          )}
        </span>
      </div>
      <span className="text-muted/60 text-[8px] tracking-[0.1em] uppercase -mt-2">{t('gift.send.royalty_note')}</span>

      {/* Fresh-address soft warning */}
      {send.fresh_address && (
        <div
          className="flex items-start gap-2 px-3 py-2 text-[10px] tracking-wide leading-relaxed"
          style={{ border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.06)', color: '#fbbf24' }}
        >
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>{t('gift.send.fresh_warning')}</span>
        </div>
      )}

      {/* IRRECOVERABILITY double-confirm */}
      <div
        className="flex flex-col gap-2 px-3 py-3"
        style={{ border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.05)' }}
      >
        <div className="flex items-center gap-2 text-red-400 text-[10px] tracking-[0.2em] uppercase font-semibold">
          <AlertTriangle size={13} />
          {t('gift.send.irrecoverable_title')}
        </div>
        <p className="text-red-300/80 text-[10px] tracking-wide leading-relaxed">{t('gift.send.irrecoverable_body')}</p>
        <label className="flex items-start gap-2 cursor-pointer mt-1">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => set_ack(e.target.checked)}
            className="mt-0.5 accent-[#c8963c] cursor-pointer"
          />
          <span className="text-text/80 text-[10px] tracking-wide leading-relaxed">
            {t('gift.send.confirm_checkbox')}
          </span>
        </label>
      </div>

      <div className="flex gap-3 mt-2">
        <button
          type="button"
          disabled={!ack}
          onClick={() => void confirm()}
          className="btn-gold flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          <Send size={12} />
          {t('gift.send.send_confirm', {
            count: Number(send.selected_amount ?? BigInt(send.items.length)),
          })}
        </button>
        <button
          type="button"
          onClick={on_back}
          className="btn-outline flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer"
        >
          {t('gift.send.back')}
        </button>
      </div>
    </div>
  )
}

function FailedView({ send, on_close, on_retry }: { send: ItemSendState; on_close: () => void; on_retry: () => void }) {
  const { t } = useTranslation()
  const code = send.error || 'UNKNOWN'
  // Machine codes map to copy; anything else is ALREADY a humanized message from the tx choke — show it raw.
  const known: Record<string, string> = {
    SELF_SEND: t('gift.send.err.self_send'),
    RECIPIENT_INVALID: t('gift.send.err.recipient_invalid'),
    NO_ITEMS: t('gift.send.err.no_items'),
    NO_KIOSK: t('gift.send.err.no_kiosk'),
    AMOUNT_INVALID: t('gift.send.err.amount_invalid'),
    AMOUNT_EXCEEDS_AVAILABLE: t('gift.send.err.amount_exceeds_available'),
    AMOUNT_NON_STACKABLE: t('gift.send.err.amount_non_stackable'),
    PREVIEW_EXPIRED: t('gift.send.err.preview_expired'),
  }
  const body = known[code] ?? code

  return (
    <div className="flex flex-col items-center gap-5">
      <XCircle size={36} className="text-red-400" style={{ filter: 'drop-shadow(0 0 12px rgba(248,113,113,0.4))' }} />
      <div className="text-text text-[11px] tracking-wide leading-relaxed text-center">{body}</div>
      <div className="flex gap-3 w-full mt-2">
        <button
          type="button"
          onClick={on_retry}
          className="btn-gold flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer"
        >
          {t('common.retry')}
        </button>
        <button
          type="button"
          onClick={on_close}
          className="btn-outline flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer"
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}

export function ItemSendModal({ items, on_close }: { items: SendItem[]; on_close: () => void }) {
  const { t } = useTranslation()
  const send = use_item_send((s) => s.send)
  const clear = use_item_send((s) => s.clear)

  const full_close = useCallback(() => {
    clear()
    on_close()
  }, [clear, on_close])

  // Clear any stale machine when the modal mounts (a prior send's SUCCESS/FAILED must not leak into a fresh open).
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      clear()
    }
  }, [clear])

  const phase = send?.phase ?? null

  if (!send) {
    return (
      <Shell locked={false} on_close={full_close} title={t('gift.send.title')}>
        <RecipientForm items={items} on_close={full_close} />
      </Shell>
    )
  }

  if (phase === 'RESOLVING') {
    return (
      <Shell locked={false} on_close={full_close} title={t('gift.send.title')}>
        <div className="flex flex-col items-center gap-5 py-8">
          <Loader2 size={28} className="text-gold animate-spin opacity-80" />
          <div className="text-muted text-[10px] tracking-[0.2em] uppercase text-center">
            {t('gift.send.resolving')}
          </div>
        </div>
      </Shell>
    )
  }

  if (phase === 'REVIEW') {
    return (
      <Shell locked={false} on_close={full_close} title={t('gift.send.review_title')} tone="danger">
        <ReviewView send={send} on_back={clear} />
      </Shell>
    )
  }

  if (phase === 'EXECUTING') {
    return (
      <Shell locked title={t('gift.send.executing_title')} on_close={() => {}}>
        <div className="flex flex-col items-center gap-5 py-8">
          <Loader2 size={28} className="text-gold animate-spin opacity-80" />
          <div className="text-text text-[11px] tracking-[0.2em] uppercase text-center">
            {t('gift.send.executing_body')}
          </div>
          <div className="text-[9px] tracking-[0.25em] uppercase mt-2" style={{ color: '#fbbf24' }}>
            {t('marketplace.purchase.dont_close')}
          </div>
        </div>
      </Shell>
    )
  }

  if (phase === 'SUCCESS') {
    return (
      <Shell locked={false} on_close={full_close} title={t('gift.send.success_title')} tone="success">
        <div className="flex flex-col items-center gap-5">
          <CheckCircle2 size={36} style={{ color: '#34d399', filter: 'drop-shadow(0 0 12px rgba(52,211,153,0.5))' }} />
          <div className="text-emerald-400 text-[13px] font-semibold tracking-[0.3em] uppercase text-center">
            {t('gift.send.sent')}
          </div>
          <div className="text-muted text-[10px] tracking-wide text-center leading-relaxed">
            {t('gift.send.success_body', {
              recipient: send.resolved_name || truncate_address(send.resolved_address),
            })}
          </div>
          {send.tx_digest && <DigestLink digest={send.tx_digest} />}
          <button
            type="button"
            onClick={full_close}
            className="btn-outline w-full py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer mt-2"
          >
            {t('common.close')}
          </button>
        </div>
      </Shell>
    )
  }

  // FAILED
  return (
    <Shell locked={false} on_close={full_close} title={t('gift.send.failed_title')} tone="danger">
      <FailedView send={send} on_close={full_close} on_retry={clear} />
    </Shell>
  )
}

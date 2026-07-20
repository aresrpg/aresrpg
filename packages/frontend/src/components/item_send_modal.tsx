// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// item_send_modal.tsx — escrow-recoverable ITEM GIFT-send modal (gift.move · resolved DECISIONS 2026-07-13).
// Recipient modes: raw 0x address, SuiNS, or exact player-name lookup through /v1/names.

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import {
  CheckCircle2,
  XCircle,
  X,
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
import { rpc_get } from '../rpc/client'
import { use_item_send, type SendItem, type ItemSendState } from '../stores/item_send'

import { ItemImage } from './items'

const ADDRESS_PARTIAL_RE = /^0x[a-f0-9]{0,64}$/i
const ADDRESS_FULL_RE = /^0x[a-f0-9]{64}$/i

type ExactPlayerName = { name: string; character_id: string; owner: string }
type ResolvedPlayer = { query: string; name: string; address: string }
type PlayerNameLookup = (name: string) => Promise<ExactPlayerName | { found: false }>
type ItemPlayerRecipientResolution =
  | { kind: 'blocked' | 'not_found' | 'failed' }
  | { kind: 'passthrough'; address: string }
  | { kind: 'resolved'; name: string; address: string }

function exact_player_name_query(value: string): string | null {
  const query = value.trim()
  if (query.length < 4 || /^0x/i.test(query) || is_suins_name(query)) return null
  return query
}

export async function resolve_item_player_recipient(
  value: string,
  lookup: PlayerNameLookup
): Promise<ItemPlayerRecipientResolution> {
  if (ADDRESS_FULL_RE.test(value)) return { kind: 'passthrough', address: value }
  const query = exact_player_name_query(value)
  if (!query) return { kind: 'blocked' }
  try {
    const player = await lookup(query)
    if ('found' in player) return { kind: 'not_found' }
    if (!player.name || !player.character_id || !player.owner) return { kind: 'failed' }
    return { kind: 'resolved', name: player.name, address: player.owner }
  } catch (error) {
    const not_found = typeof error === 'object' && error !== null && 'status' in error && error.status === 404
    return { kind: not_found ? 'not_found' : 'failed' }
  }
}

const lookup_exact_player_name: PlayerNameLookup = (name) =>
  rpc_get<ExactPlayerName | { found: false }>('/v1/names', { name })

const is_address_mode = (v: string) => ADDRESS_PARTIAL_RE.test(v)
const is_full_address = (v: string) => ADDRESS_FULL_RE.test(v)

function truncate_digest(digest: string): string {
  return digest.length <= 16 ? digest : `${digest.slice(0, 10)}...${digest.slice(-6)}`
}

function format_sui_exact(mist: bigint): string {
  return format_mist_to_sui(mist, 9).replace(/0+$/, '').replace(/\.$/, '')
}

function Shell({
  children,
  locked,
  on_close,
  title,
  tone = 'default',
}: {
  children: React.ReactNode
  locked: boolean
  on_close: () => void
  title: string
  tone?: 'default' | 'success' | 'danger'
}) {
  useEffect(() => {
    if (locked) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [locked, on_close])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
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
      onClick={(e) => {
        if (locked) return
        if (e.target === e.currentTarget) on_close()
      }}
    >
      <div
        className="bg-surface w-full max-w-xl max-h-[90vh] flex flex-col max-sm:max-h-none max-sm:h-full"
        style={{ border: `1px solid ${border_color}`, boxShadow: glow, animation: 'modal-enter 0.25s ease-out' }}
        onClick={(e) => e.stopPropagation()}
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

function ItemsStrip({ items }: { items: SendItem[] }) {
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
            <span className="text-[9px] tracking-[0.1em] uppercase text-text/80 truncate max-w-[120px]">{it.name}</span>
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
  const [resolved_player, set_resolved_player] = useState<ResolvedPlayer | null>(null)
  const [player_resolving, set_player_resolving] = useState(false)
  const [player_error, set_player_error] = useState<'not_found' | 'failed' | null>(null)
  const debounce_ref = useRef<ReturnType<typeof setTimeout> | null>(null)
  const address_mode = is_address_mode(raw)
  const full_valid = address_mode && is_full_address(raw)
  const suins_mode = !address_mode && is_suins_name(raw)
  const player_ready = !!resolved_player && resolved_player.query === raw.trim()
  const can_continue = full_valid || suins_mode || player_ready

  useEffect(() => {
    if (debounce_ref.current) clearTimeout(debounce_ref.current)
    set_player_error(null)
    const query = exact_player_name_query(raw)
    if (!query) {
      set_player_resolving(false)
      return
    }

    let cancelled = false
    debounce_ref.current = setTimeout(async () => {
      set_player_resolving(true)
      const resolution = await resolve_item_player_recipient(query, lookup_exact_player_name)
      if (cancelled) return
      set_player_resolving(false)
      if (resolution.kind === 'resolved')
        set_resolved_player({ query, name: resolution.name, address: resolution.address })
      else if (resolution.kind === 'not_found') set_player_error('not_found')
      else if (resolution.kind === 'failed') set_player_error('failed')
    }, 400)

    return () => {
      cancelled = true
      if (debounce_ref.current) clearTimeout(debounce_ref.current)
    }
  }, [raw])

  const on_recipient_change = (value: string) => {
    set_raw(value)
    set_resolved_player(null)
    set_player_error(null)
  }

  const on_continue = () => {
    if (!can_continue) return
    void use_item_send.getState().prepare({ items, recipient_input: player_ready ? resolved_player.address : raw })
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
              player_error || (address_mode && raw.length > 2 && !full_valid)
                ? 'rgba(239,68,68,0.5)'
                : full_valid || suins_mode || player_ready
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
            onChange={(e) => on_recipient_change(e.target.value)}
            placeholder={t('gift.send.recipient_placeholder')}
            autoComplete="off"
            spellCheck={false}
            maxLength={66}
            className="bg-transparent flex-1 text-[11px] tracking-wide font-mono text-text outline-none placeholder:text-muted/50"
          />
          {player_resolving && <Loader2 size={12} className="text-muted animate-spin" />}
          {full_valid && <Check size={14} className="text-emerald-400" />}
          {player_ready && <Check size={14} className="text-emerald-400" />}
        </div>
        <div className="text-[9px] tracking-wide text-muted">
          {address_mode ? (
            full_valid ? (
              <span className="text-emerald-400/80">{t('gift.send.address_valid')}</span>
            ) : raw.length > 2 ? (
              <span className="text-red-400/80">{t('gift.send.address_invalid')}</span>
            ) : (
              <span>{t('gift.send.recipient_hint')}</span>
            )
          ) : player_ready ? (
            <span className="text-emerald-400/80 flex items-center gap-1">
              {t('gift.send.player_resolved_address', {
                name: resolved_player.name,
                address: truncate_address(resolved_player.address),
              })}
            </span>
          ) : player_resolving ? (
            <span className="flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />
              {t('gift.send.resolving')}
            </span>
          ) : player_error ? (
            <span className="text-red-400/80">
              {t(player_error === 'not_found' ? 'gift.send.player_not_found' : 'gift.send.player_lookup_failed')}
            </span>
          ) : suins_mode ? (
            <span className="text-emerald-400/80">{t('gift.send.suins_detected')}</span>
          ) : (
            <span>{t('gift.send.recipient_hint')}</span>
          )}
        </div>
      </div>

      <div className="flex gap-3 mt-2">
        <button
          type="button"
          disabled={!can_continue}
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

      <ItemsStrip items={send.items} />

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
          {t('gift.send.send_confirm', { count: send.items.length })}
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
              count: send.items.length,
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

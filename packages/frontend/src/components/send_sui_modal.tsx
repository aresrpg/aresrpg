// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// send_sui_modal.tsx — P2P SUI transfer modal.
//
// State machine: IDLE → BUILDING → AWAITING_SIGNATURE → EXECUTING →
//                (SUCCESS | FAILED)
//
// Recipient auto-detect (precedence order):
//   /^0x[a-f0-9]{1,64}$/i     → address mode (live validation on 64 chars)
//   "name.sui" / "@name"      → SuiNS mode (debounced 400ms gRPC NameService.LookupName, utils/suins.ts)
//   otherwise                 → player-name mode (debounced 400ms exact /v1/names lookup)
//
// EXECUTING phase LOCKS the modal. User has signed and funds are moving.

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle, Loader2, Copy, Check, ExternalLink, AtSign, Hash, Send } from 'lucide-react'

import { use_auth } from '../auth'
import { rpc_get } from '../rpc/client'
import { GAS_RESERVE_MIST, format_mist_to_sui } from '../utils/sui_mist'
import { truncate_address } from '../utils/address'
import { is_suins_name, resolve_suins_address } from '../utils/suins'
import { use_sui_send, GAS_ESTIMATE_FALLBACK_MIST, type SendState } from '../stores/sui_send'

import { AddFundsModal } from './add_funds_modal'
import { SendModalShell as Shell, DigestLink } from './send_modal_shell'

// ─── Regex + helpers ──────────────────────────────────────────────────────

const ADDRESS_PARTIAL_RE = /^0x[a-f0-9]{0,64}$/i
const ADDRESS_FULL_RE = /^0x[a-f0-9]{64}$/i

interface ExactPlayerName {
  name: string
  character_id: string
  owner: string
}

type PlayerNameLookup = (name: string) => Promise<ExactPlayerName | { found: false }>

export type SuiPlayerRecipientResolution =
  | { kind: 'blocked' }
  | { kind: 'passthrough'; address: string }
  | { kind: 'resolved'; name: string; address: string }
  | { kind: 'not_found' }
  | { kind: 'failed' }

function exact_player_name_query(value: string): string | null {
  const query = value.trim()
  if (query.length < 4 || /^0x/i.test(query) || is_suins_name(query)) return null
  return query
}

function is_404(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404
}

/** Pure, dependency-injected recipient decision used by the debounced form and its DOM-less tests. */
export async function resolve_sui_player_recipient(
  value: string,
  lookup: PlayerNameLookup
): Promise<SuiPlayerRecipientResolution> {
  if (ADDRESS_FULL_RE.test(value)) return { kind: 'passthrough', address: value }
  const query = exact_player_name_query(value)
  if (!query) return { kind: 'blocked' }

  try {
    const player = await lookup(query)
    if ('found' in player) return { kind: 'not_found' }
    if (!player.name || !player.character_id || !player.owner) return { kind: 'failed' }
    return { kind: 'resolved', name: player.name, address: player.owner }
  } catch (error) {
    return { kind: is_404(error) ? 'not_found' : 'failed' }
  }
}

const lookup_exact_player_name: PlayerNameLookup = (name) =>
  rpc_get<ExactPlayerName | { found: false }>('/v1/names', { name })

function is_address_mode(value: string): boolean {
  return ADDRESS_PARTIAL_RE.test(value)
}

function is_valid_full_address(value: string): boolean {
  return ADDRESS_FULL_RE.test(value)
}

// format_mist_to_sui's 2dp option floors a real ~0.001-0.002 SUI gas estimate to "0.00" — trim the 9dp
// (full-precision) floor's trailing zeros instead so the actual dry-run number stays visible.
function format_gas_sui(mist: bigint): string {
  return format_mist_to_sui(mist, 9).replace(/0+$/, '').replace(/\.$/, '')
}

// ─── Main modal ───────────────────────────────────────────────────────────

export function SendSuiModal({ on_close }: { on_close: () => void }) {
  const { t } = useTranslation()
  const send = use_sui_send((s) => s.send)

  const address = use_auth((s) => s.address)
  const wallet_name = use_auth((s) => s.wallet_name)
  const [add_funds_open, set_add_funds_open] = useState(false)

  // IDLE is anything without an active pending_send
  const phase = send?.phase ?? null

  const clear_send = use_sui_send((s) => s.clear)
  const confirm_send = use_sui_send((s) => s.confirm)

  // When the modal closes from outside, also clear the pending send
  const full_close = useCallback(() => {
    clear_send()
    on_close()
  }, [on_close, clear_send])

  // Sign handler (for AWAITING_SIGNATURE) — confirm() handles sign + execute internally.
  const handle_sign = async () => {
    if (!send || !wallet_name || !address) return
    await confirm_send()
  }

  const reset_to_idle = clear_send

  // ── IDLE: input form ──
  if (!send) {
    return (
      <Shell locked={false} on_close={full_close} title={t('wallet.send.title')}>
        <SendForm self_address={address} on_close={full_close} />
      </Shell>
    )
  }

  // ── BUILDING ──
  if (phase === 'BUILDING') {
    return (
      <Shell locked={false} on_close={full_close} title={t('wallet.send.building_title')}>
        <div className="flex flex-col items-center gap-5 py-8">
          <Loader2 size={28} className="text-gold animate-spin opacity-80" />
          <div className="text-muted text-[10px] tracking-[0.2em] uppercase text-center">
            {t('wallet.send.building_body')}
          </div>
        </div>
      </Shell>
    )
  }

  // ── AWAITING_SIGNATURE ──
  if (phase === 'AWAITING_SIGNATURE') {
    return (
      <Shell
        locked={false}
        on_close={() => {
          clear_send()
        }}
        title={t('wallet.send.confirm_title')}
      >
        <AwaitingSignatureView send={send} on_cancel={() => clear_send()} on_sign={handle_sign} />
      </Shell>
    )
  }

  // ── EXECUTING ──
  if (phase === 'EXECUTING') {
    return (
      <Shell locked={true} on_close={() => {}} title={t('wallet.send.executing_title')}>
        <div className="flex flex-col items-center gap-5 py-8">
          <Loader2 size={28} className="text-gold animate-spin opacity-80" />
          <div className="text-text text-[11px] tracking-[0.2em] uppercase text-center">
            {t('wallet.send.executing_body')}
          </div>
          <div className="text-[9px] tracking-[0.25em] uppercase mt-2" style={{ color: '#fbbf24' }}>
            {t('marketplace.purchase.dont_close')}
          </div>
        </div>
      </Shell>
    )
  }

  // ── SUCCESS ──
  if (phase === 'SUCCESS') {
    return (
      <Shell locked={false} on_close={full_close} title={t('wallet.send.success_title')} tone="success">
        <SuccessView send={send} on_close={full_close} on_send_more={reset_to_idle} />
      </Shell>
    )
  }

  // ── FAILED ──
  if (phase === 'FAILED') {
    return (
      <Shell locked={false} on_close={full_close} title={t('wallet.send.failed_title')} tone="danger">
        <FailedView
          send={send}
          on_close={full_close}
          on_retry={reset_to_idle}
          on_add_funds={() => set_add_funds_open(true)}
        />
        {add_funds_open && address && <AddFundsModal address={address} on_close={() => set_add_funds_open(false)} />}
      </Shell>
    )
  }

  return null
}

// ─── IDLE form ────────────────────────────────────────────────────────────

// Complexity retained (#2069): hook order and the send-form state machine share one submit lifecycle; extraction would divide validation and cleanup ownership.
function SendForm({ self_address, on_close }: { self_address: string | null; on_close: () => void }) {
  const { t } = useTranslation()
  const [recipient_raw, set_recipient_raw] = useState('')
  const [selected_name, set_selected_name] = useState<string | null>(null)
  const [selected_address, set_selected_address] = useState<string | null>(null)
  // SuiNS and exact player names both resolve into selected_name/selected_address via pick_name, so
  // recipient_ready/on_submit share one address-substitution path.
  const [suins_resolving, set_suins_resolving] = useState(false)
  const [suins_error, set_suins_error] = useState<string | null>(null)
  const [player_resolving, set_player_resolving] = useState(false)
  const [player_error, set_player_error] = useState<'not_found' | 'failed' | null>(null)

  const [amount_str, set_amount_str] = useState('')
  const [amount_mist, set_amount_mist] = useState<bigint | null>(null)
  const [amount_err, set_amount_err] = useState<string | null>(null)

  // Balance is the single auth-store figure; refetch FRESH on modal mount so MAX and
  // the amount validation reflect real funds the moment the send modal opens.
  const balance_mist = use_auth((s) => s.sui_balance_mist)
  useEffect(() => void use_auth.getState().refresh_sui_balance(), [])

  const debounce_ref = useRef<ReturnType<typeof setTimeout> | null>(null)

  // MAX reserves 0.2 SUI for on-chain gas (always keep 0.2 — shared GAS_RESERVE_MIST).
  const max_sendable = balance_mist !== null && balance_mist > GAS_RESERVE_MIST ? balance_mist - GAS_RESERVE_MIST : 0n

  const on_max = () => {
    if (max_sendable <= 0n) return
    // Floor to 2-decimal SUI precision (10M MIST granularity) to match SuiPriceInput validation.
    const floored = (max_sendable / 10_000_000n) * 10_000_000n
    // Round down to a multiple of 20 (fee invariant) — safe because 10M MIST is divisible by 20.
    const sui_str = (Number(floored) / 1_000_000_000).toFixed(2)
    set_amount_str(sui_str)
    set_amount_mist(floored)
    set_amount_err(null)
  }

  const address_mode = is_address_mode(recipient_raw)
  const full_address_valid = address_mode && is_valid_full_address(recipient_raw)
  // SuiNS takes precedence over the (dead-stub) player-name search — mutually exclusive with address_mode by
  // construction (0x… vs name.sui/@name).
  const suins_mode = !address_mode && is_suins_name(recipient_raw)

  // Declared before the effects below (both the SuiNS resolver and the dropdown pick call it).
  const pick_name = (name: string, address?: string) => {
    set_recipient_raw(name)
    set_selected_name(name)
    set_selected_address(address || null)
    set_player_error(null)
  }

  // Trigger SuiNS resolution or player search depending on recipient mode
  useEffect(() => {
    if (debounce_ref.current) clearTimeout(debounce_ref.current)
    if (address_mode) {
      set_suins_error(null)
      set_player_error(null)
      set_player_resolving(false)
      return
    }
    if (selected_name && recipient_raw === selected_name) {
      // user already picked/resolved something — don't re-search or re-resolve
      set_suins_error(null)
      set_player_error(null)
      set_player_resolving(false)
      return
    }
    if (suins_mode) {
      set_player_error(null)
      set_player_resolving(false)
      const name = recipient_raw.trim()
      debounce_ref.current = setTimeout(async () => {
        set_suins_resolving(true)
        const address = await resolve_suins_address(name)
        set_suins_resolving(false)
        if (address) pick_name(name, address)
        else set_suins_error(t('wallet.send.err.suins_not_found', { name }))
      }, 400)
      return () => {
        if (debounce_ref.current) clearTimeout(debounce_ref.current)
      }
    }
    set_suins_error(null)
    set_player_error(null)
    const query = exact_player_name_query(recipient_raw)
    if (!query) {
      set_player_resolving(false)
      return
    }
    let cancelled = false
    debounce_ref.current = setTimeout(async () => {
      set_player_resolving(true)
      const resolution = await resolve_sui_player_recipient(query, lookup_exact_player_name)
      if (cancelled) return
      set_player_resolving(false)
      if (resolution.kind === 'resolved') pick_name(resolution.name, resolution.address)
      else if (resolution.kind === 'not_found') set_player_error('not_found')
      else if (resolution.kind === 'failed') set_player_error('failed')
    }, 400)
    return () => {
      cancelled = true
      if (debounce_ref.current) clearTimeout(debounce_ref.current)
    }
    // NOTE: pick_name is intentionally excluded from deps — it is a fresh reference each render (not
    // memoized); including them would re-fire this effect on every render instead of only on recipient changes.
  }, [recipient_raw, address_mode, suins_mode, selected_name])

  // Clear recipient field changes wipe prior selection
  const on_recipient_change = (val: string) => {
    set_recipient_raw(val)
    set_selected_name(null)
    set_selected_address(null)
    set_suins_error(null)
    set_player_error(null)
  }

  // Validation summary
  const recipient_ready = address_mode ? full_address_valid : !!selected_name && recipient_raw === selected_name
  const amount_ready = amount_mist !== null && !amount_err
  const is_self =
    address_mode && full_address_valid && self_address && recipient_raw.toLowerCase() === self_address.toLowerCase()

  const can_submit = recipient_ready && amount_ready && !is_self

  const on_submit = () => {
    if (!can_submit || !amount_mist) return
    // When sending by name, use the resolved sui_address directly if available
    const payload = address_mode
      ? { address: recipient_raw, amount_mist }
      : selected_address
        ? { address: selected_address, name: recipient_raw, amount_mist }
        : { name: recipient_raw, amount_mist }
    use_sui_send.getState().build(payload)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Recipient */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[9px] tracking-[0.2em] uppercase text-gold font-medium">
          {t('wallet.send.recipient_label')}
        </label>
        <div className="relative" tabIndex={-1}>
          <div
            className="flex items-center gap-2 px-3 py-2.5 transition-colors"
            style={{
              border: `1px solid ${
                player_error || (address_mode && recipient_raw.length > 2 && !full_address_valid)
                  ? 'rgba(239,68,68,0.5)'
                  : (address_mode && full_address_valid) || selected_name
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
              value={recipient_raw}
              onChange={(e) => on_recipient_change(e.target.value)}
              placeholder={t('wallet.send.recipient_placeholder')}
              autoComplete="off"
              spellCheck={false}
              maxLength={66}
              className="bg-transparent flex-1 text-[11px] tracking-wide font-mono text-text outline-none placeholder:text-muted/50"
            />
            {(player_resolving || suins_resolving) && !address_mode && (
              <Loader2 size={12} className="text-muted animate-spin" />
            )}
            {address_mode && full_address_valid && <Check size={14} className="text-emerald-400" />}
          </div>

          {/* Live hint / resolved address */}
          <div className="mt-1.5 text-[9px] tracking-wide text-muted">
            {address_mode ? (
              full_address_valid ? (
                <span className="text-emerald-400/80">{t('wallet.send.address_valid')}</span>
              ) : recipient_raw.length > 2 ? (
                <span className="text-red-400/80">{t('wallet.send.address_invalid')}</span>
              ) : (
                <span>{t('wallet.send.hint')}</span>
              )
            ) : selected_name && suins_mode ? (
              <span className="text-emerald-400/80 flex items-center gap-1">
                <Check size={10} />
                {t('wallet.send.suins_resolved', { name: selected_name })}
                {selected_address && (
                  <span className="text-muted font-mono ml-1">({truncate_address(selected_address)})</span>
                )}
              </span>
            ) : selected_name ? (
              <span className="text-emerald-400/80 flex items-center gap-1">
                <Check size={10} />
                {selected_address &&
                  t('wallet.send.player_resolved_address', {
                    name: selected_name,
                    address: truncate_address(selected_address),
                  })}
              </span>
            ) : suins_mode ? (
              suins_resolving ? (
                <span className="flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin" />
                  {t('wallet.send.suins_resolving')}
                </span>
              ) : suins_error ? (
                <span className="text-red-400/80">{suins_error}</span>
              ) : (
                <span>{t('wallet.send.hint')}</span>
              )
            ) : player_resolving ? (
              <span className="flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" />
                {t('wallet.send.suins_resolving')}
              </span>
            ) : player_error ? (
              <span className="text-red-400/80">
                {t(player_error === 'not_found' ? 'wallet.send.player_not_found' : 'wallet.send.player_lookup_failed')}
              </span>
            ) : (
              <span>{t('wallet.send.hint')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Self-send guard */}
      {is_self && (
        <div
          className="px-3 py-2 text-[10px] tracking-wide"
          style={{
            border: '1px solid rgba(239,68,68,0.4)',
            background: 'rgba(239,68,68,0.06)',
            color: '#fca5a5',
          }}
        >
          {t('wallet.send.err.self_send')}
        </div>
      )}

      {/* Amount */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] tracking-[0.25em] uppercase text-muted">{t('wallet.send.amount_label')}</span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] tracking-[0.15em] uppercase text-muted">
              {balance_mist !== null ? `${format_mist_to_sui(balance_mist, 2)} SUI` : '-'}
            </span>
            <button
              type="button"
              onClick={on_max}
              disabled={max_sendable <= 0n}
              className="text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
              style={{
                color: '#c8963c',
                border: '1px solid rgba(200,150,60,0.4)',
                background: 'transparent',
              }}
            >
              MAX
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount_str}
            onChange={(e) => {
              const raw = e.target.value.replace(',', '.')
              if (raw && !/^\d*\.?\d{0,2}$/.test(raw)) return
              set_amount_str(raw)
              if (!raw || raw === '.' || raw === '0.') {
                set_amount_mist(0n)
                set_amount_err(null)
                return
              }
              try {
                const parts = raw.split('.')
                const whole = BigInt(parts[0] || '0') * 1_000_000_000n
                const frac = parts[1] ? BigInt(parts[1].padEnd(9, '0').slice(0, 9)) : 0n
                const mist = whole + frac
                if (mist < 10_000_000n) {
                  set_amount_mist(mist)
                  set_amount_err('Minimum 0.01 SUI')
                } else if (balance_mist !== null && mist > max_sendable) {
                  // #51.4: always keep 0.2 SUI for gas — cap sendable at balance − reserve.
                  set_amount_mist(mist)
                  set_amount_err(t('wallet.send.err.reserve'))
                } else {
                  set_amount_mist(mist)
                  set_amount_err(null)
                }
              } catch {
                set_amount_err('Invalid amount')
              }
            }}
            className="w-full bg-transparent border border-border/40 px-3 py-2 text-[13px] text-text font-mono tracking-wider focus:border-gold/60 focus:outline-none transition-colors"
          />
          {amount_err && <span className="text-red-400 text-[9px] tracking-[0.15em] uppercase">{amount_err}</span>}
        </div>
      </div>

      {/* CTAs */}
      <div className="flex gap-3 mt-2">
        <button
          type="button"
          onClick={on_submit}
          disabled={!can_submit}
          className="btn-gold flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          <Send size={12} />
          {t('wallet.send.submit')}
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

// ─── AWAITING_SIGNATURE view ──────────────────────────────────────────────

function AwaitingSignatureView({
  send,
  on_cancel,
  on_sign,
}: {
  send: SendState
  on_cancel: () => void
  on_sign: () => void
}) {
  const { t } = useTranslation()
  const [copied, set_copied] = useState(false)
  const [signing, set_signing] = useState(false)

  const gas_estimate_mist = send.gas_estimate_mist ?? GAS_ESTIMATE_FALLBACK_MIST
  const total = send.amount_mist + gas_estimate_mist

  const copy_addr = async () => {
    try {
      await navigator.clipboard.writeText(send.resolved_address)
      set_copied(true)
      setTimeout(() => set_copied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const do_sign = async () => {
    if (signing) return
    set_signing(true)
    try {
      await Promise.resolve(on_sign())
    } finally {
      set_signing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Recipient */}
      <div className="flex flex-col gap-1.5">
        <span className="text-muted text-[9px] tracking-[0.25em] uppercase">{t('wallet.send.sending_to')}</span>
        {send.resolved_name && (
          <div className="text-gold text-[12px] tracking-[0.15em] uppercase flex items-center gap-2">
            <AtSign size={12} className="opacity-70" />
            {send.resolved_name}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-text/80 text-[10px] font-mono tracking-wide break-all flex-1">
            {send.resolved_address}
          </span>
          <button
            type="button"
            onClick={copy_addr}
            className="text-muted hover:text-gold transition-colors cursor-pointer shrink-0"
            aria-label="Copy address"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="opacity-60" />}
          </button>
        </div>
      </div>

      <div className="w-full h-px bg-border" />

      {/* Breakdown */}
      <PropRow
        label={t('wallet.send.amount_label')}
        value={<span className="text-gold font-semibold">{format_mist_to_sui(send.amount_mist, 2)} SUI</span>}
      />

      <PropRow
        label={t('marketplace.purchase.gas_estimated')}
        value={<span className="text-text/60 text-[10px]">~{format_gas_sui(gas_estimate_mist)} SUI</span>}
      />

      <div className="w-full h-px bg-border" />

      <PropRow
        label={t('purchase.total')}
        value={<span className="text-gold font-semibold">~{format_mist_to_sui(total, 2)} SUI</span>}
      />

      {/* CTAs */}
      <div className="flex gap-3 mt-4">
        <button
          type="button"
          onClick={do_sign}
          disabled={signing}
          className="btn-gold flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer disabled:opacity-40"
        >
          {signing ? (
            <span className="inline-flex items-center gap-2 justify-center">
              <Loader2 size={12} className="animate-spin" />
              {t('marketplace.purchase.signing')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 justify-center">
              <Send size={12} />
              {t('wallet.send.send_confirm')}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={on_cancel}
          disabled={signing}
          className="btn-outline flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer disabled:opacity-40"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

// ─── SUCCESS view ─────────────────────────────────────────────────────────

function SuccessView({
  send,
  on_close,
  on_send_more,
}: {
  send: SendState
  on_close: () => void
  on_send_more: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-5">
      <CheckCircle2
        size={36}
        style={{
          filter: 'drop-shadow(0 0 12px rgba(52,211,153,0.5))',
          color: '#34d399',
          animation: 'glow-pulse 3s ease-in-out infinite',
        }}
      />
      <div
        className="text-[13px] font-semibold tracking-[0.3em] uppercase text-center"
        style={{
          background: 'linear-gradient(135deg, #6ee7b7 0%, #34d399 50%, #a7f3d0 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        {t('wallet.send.sent')}
      </div>

      <div className="text-muted text-[10px] tracking-wide text-center leading-relaxed">
        {t('wallet.send.success_body', {
          amount: `${format_mist_to_sui(send.amount_mist, 2)} SUI`,
          recipient: send.resolved_name || truncate_address(send.resolved_address),
        })}
      </div>

      {send.tx_digest && <DigestLink digest={send.tx_digest} />}

      <div className="flex gap-3 w-full mt-2">
        <button
          type="button"
          onClick={on_send_more}
          className="btn-gold flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer"
        >
          {t('wallet.send.send_more')}
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

// ─── FAILED view ──────────────────────────────────────────────────────────

function FailedView({
  send,
  on_close,
  on_retry,
  on_add_funds,
}: {
  send: SendState
  on_close: () => void
  on_retry: () => void
  on_add_funds: () => void
}) {
  const { t } = useTranslation()
  const code = send.error || 'UNKNOWN'

  let body: React.ReactNode = null
  let actions: React.ReactNode = null

  const retry_close = (
    <div className="flex gap-3 w-full">
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
  )

  const close_only = (
    <button
      type="button"
      onClick={on_close}
      className="btn-outline w-full py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer"
    >
      {t('common.close')}
    </button>
  )

  switch (code) {
    case 'RECIPIENT_NOT_FOUND':
      body = (
        <div className="text-text text-[11px] tracking-wide leading-relaxed text-center">
          {t('wallet.send.err.recipient_not_found', {
            name: send.resolved_name || send.resolved_address,
          })}
        </div>
      )
      actions = retry_close
      break
    case 'RECIPIENT_NO_WALLET':
      body = (
        <div className="text-text text-[11px] tracking-wide leading-relaxed text-center">
          {t('wallet.send.err.recipient_no_wallet', {
            name: send.resolved_name || send.resolved_address,
          })}
        </div>
      )
      actions = close_only
      break
    case 'SELF_SEND':
      body = (
        <div className="text-text text-[11px] tracking-wide leading-relaxed text-center">
          {t('wallet.send.err.self_send')}
        </div>
      )
      actions = close_only
      break
    case 'INVALID_ADDRESS':
      body = (
        <div className="text-text text-[11px] tracking-wide leading-relaxed text-center">
          {t('wallet.send.err.invalid_address')}
        </div>
      )
      actions = retry_close
      break
    case 'INSUFFICIENT_BALANCE':
      body = (
        <div className="text-text text-[11px] tracking-wide leading-relaxed text-center">
          {t('wallet.send.err.insufficient_balance')}
        </div>
      )
      actions = (
        <div className="flex gap-3 w-full">
          <button
            type="button"
            onClick={on_add_funds}
            className="btn-gold flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer"
          >
            {t('marketplace.purchase.add_funds')}
          </button>
          <button
            type="button"
            onClick={on_close}
            className="btn-outline flex-1 py-2.5 px-6 text-[10px] tracking-[0.2em] cursor-pointer"
          >
            {t('common.close')}
          </button>
        </div>
      )
      break
    case 'RATE_LIMITED':
      body = (
        <div className="text-text text-[11px] tracking-wide leading-relaxed text-center">
          {t('wallet.send.err.rate_limited')}
        </div>
      )
      actions = close_only
      break
    case 'TX_FAILED':
      body = (
        <div className="text-text text-[11px] tracking-wide leading-relaxed text-center">
          {t('wallet.send.err.tx_failed')}
        </div>
      )
      actions = retry_close
      break
    case 'USER_REJECTED':
      body = (
        <div className="text-text text-[11px] tracking-wide leading-relaxed text-center">
          {t('wallet.send.err.user_rejected')}
        </div>
      )
      actions = retry_close
      break
    case 'RECIPIENT_REQUIRED':
    case 'NOT_LINKED':
      body = (
        <div className="text-text text-[11px] tracking-wide leading-relaxed text-center">
          {t('wallet.send.err.recipient_required', { defaultValue: 'Please enter a recipient before sending.' })}
        </div>
      )
      actions = retry_close
      break
    default:
      body = (
        <div className="text-red-400/80 text-[10px] tracking-wide leading-relaxed text-center font-mono">{code}</div>
      )
      actions = close_only
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <XCircle size={36} className="text-red-400" style={{ filter: 'drop-shadow(0 0 12px rgba(248,113,113,0.4))' }} />
      {body}
      <div className="w-full mt-2">{actions}</div>
    </div>
  )
}

// ─── PropRow ──────────────────────────────────────────────────────────────

function PropRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[10px] tracking-wide">
      <span className="text-muted tracking-[0.2em] uppercase text-[9px]">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  )
}

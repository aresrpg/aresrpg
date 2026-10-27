// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import { Check, Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type CSSProperties } from 'react'

import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { external_wallet_view } from '../wallet/view.ts'
import { format_token, format_token_usd } from '../wallet_amount.ts'
import { useLocale } from '../i18n/LocaleScope.tsx'
import { crypto_session, type FundingBalance } from '../wallet/external_session.ts'
import { useCopy } from '../components/useCopy.ts'
import { truncate_address } from '../components/SuiTransferResult.tsx'

import type { FundingQuote } from './near.ts'
import { useFundingCheckout } from './useFundingCheckout.ts'
import {
  TRANSFER_STEPS,
  transfer_visible,
  type CheckoutStage,
  type CheckoutState,
  type StepState,
} from './checkout_state.ts'
import { chain_name } from './chains.ts'

type Checkout = ReturnType<typeof useFundingCheckout>
const AMOUNT_PRESETS = ['2', '5', '10', '25'] as const
const AUTO_CLOSE_MS = 5_000
const EXPLORER_URL = 'https://explorer.near-intents.org/'
const LABEL = 'text-[10px] font-semibold tracking-[0.12em] text-muted uppercase'
const STEP_KEYS = ['funding_step_deposit', 'funding_step_bridge', 'funding_step_delivered'] as const
const STEP_TONE: Readonly<Record<StepState, string>> = {
  todo: 'text-muted/60',
  live: 'text-cyan',
  done: 'text-text',
  failed: 'text-rose-300',
}
const BALANCE_NOTICE = {
  loading: 'funding_balances_loading',
  failed: 'funding_balances_failed',
  ready: 'funding_no_assets',
} as const

const quoted_amount = (quote: FundingQuote): string =>
  `${format_token(quote.amount_in, quote.source.decimals)} ${quote.source.symbol}`

// Seconds until the quoted arrival, counted from submission; null without an estimate.
const useSecondsLeft = (submitted_at: number | null, estimate: number | null): number | null => {
  const until = submitted_at === null || estimate === null ? null : submitted_at + estimate * 1_000
  const [now, set_now] = useState(() => Date.now())
  useEffect(() => {
    if (until === null) return
    const timer = setInterval(() => set_now(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [until])
  return until === null ? null : Math.max(0, Math.ceil((until - now) / 1_000))
}

const AmountField = ({ checkout, text, usd }: Readonly<{ checkout: Checkout; text: CopyText; usd: string }>) => {
  const edit = (value: string): void => checkout.dispatch({ type: 'edit', field: 'amount_text', value })
  return (
    <div className="rounded border border-gold/25 bg-gradient-to-b from-gold/5 to-transparent p-4">
      <label className="block">
        <span className={LABEL}>{text('funding_amount')}</span>
        <span className="mt-2 flex items-baseline gap-3">
          <input
            className="min-w-0 flex-1 bg-transparent font-mono text-3xl text-gold outline-none"
            inputMode="decimal"
            placeholder="0"
            value={checkout.amount_text}
            disabled={checkout.locked}
            onChange={(event) => edit(event.target.value)}
          />
          <span className="font-mono text-lg font-semibold text-gold">SUI</span>
        </span>
      </label>
      <span className="mt-1 block font-mono text-xs text-muted">{usd}</span>
      <div className="mt-3 flex gap-2">
        {AMOUNT_PRESETS.map((preset) => (
          <button
            className="aui-funding-preset"
            type="button"
            key={preset}
            aria-pressed={checkout.amount_text === preset}
            disabled={checkout.locked}
            onClick={() => edit(preset)}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  )
}

const AssetPicker = ({ checkout, text, locale }: Readonly<{ checkout: Checkout; text: CopyText; locale: string }>) => {
  const { choices, asset, assets_status: status } = checkout
  const disabled = checkout.locked || status === 'loading'
  return (
    <div className="space-y-1.5 text-xs text-muted">
      <div className="flex items-center justify-between">
        <span className={LABEL} id="funding-pay-with">
          {text('funding_pay_with')}
        </span>
        <button
          className="grid size-8 place-items-center rounded-sm hover:bg-white/5 hover:text-text disabled:opacity-40"
          type="button"
          aria-label={text('funding_balances_refresh')}
          title={text('funding_balances_refresh')}
          disabled={disabled}
          onClick={() => checkout.dispatch({ type: 'refresh_assets' })}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {choices.length > 0 && (
        <div role="radiogroup" aria-labelledby="funding-pay-with" className="space-y-1 text-text">
          {choices.map((entry: FundingBalance) => (
            <label className="aui-funding-token" key={entry.asset_id}>
              <input
                className="sr-only"
                type="radio"
                name="funding-asset"
                value={entry.asset_id}
                checked={entry.asset_id === asset?.asset_id}
                disabled={disabled}
                onChange={() => checkout.dispatch({ type: 'edit', field: 'asset_id', value: entry.asset_id })}
              />
              <span className="font-semibold">{entry.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{chain_name(entry.blockchain)}</span>
              <span className="shrink-0 font-mono text-xs whitespace-nowrap">
                {format_token(entry.balance, entry.decimals)}
              </span>
              <span className="min-w-16 shrink-0 text-right font-mono text-xs whitespace-nowrap text-muted">
                {format_token_usd(entry.balance, entry.decimals, entry.price, locale)}
              </span>
            </label>
          ))}
        </div>
      )}
      {(status !== 'ready' || !choices.length) && (
        <p role={status === 'failed' ? 'alert' : 'status'}>{text(BALANCE_NOTICE[status])}</p>
      )}
    </div>
  )
}

const QuoteReview = ({
  quote,
  text,
  usd,
  locale,
}: Readonly<{ quote: FundingQuote; text: CopyText; usd: string; locale: string }>) => (
  <div className="space-y-2.5 text-[13px]">
    <dl className="space-y-2.5">
      <div className="aui-funding-leader">
        <dt className="text-muted">{text('funding_you_pay')}</dt>
        <dd className="font-mono">
          {quoted_amount(quote)}{' '}
          <span className="text-xs text-muted">
            {format_token_usd(quote.amount_in, quote.source.decimals, quote.source.price, locale)}
          </span>
        </dd>
      </div>
      <div className="aui-funding-leader">
        <dt className="text-muted">{text('funding_you_receive')}</dt>
        <dd className="font-mono text-gold">
          {format_token(quote.amount_out, 9)} SUI <span className="text-xs text-muted">{usd}</span>
        </dd>
      </div>
      {quote.estimated_seconds !== null && (
        <div className="aui-funding-leader">
          <dt className="text-muted">{text('funding_arrival')}</dt>
          <dd className="font-mono">≈ {quote.estimated_seconds} s</dd>
        </div>
      )}
    </dl>
    <p className="text-[11px] leading-relaxed text-muted">{text('funding_source_fee')}</p>
  </div>
)

// A bridge pays the quoted source token; a Sui source pays the typed SUI amount.
const payment_amount = ({ state, amount_text }: Readonly<Checkout>): string =>
  state.quote ? quoted_amount(state.quote) : `${amount_text || '0'} SUI`

const PayButton = ({
  checkout,
  crypto,
  busy,
  text,
}: Readonly<{ checkout: Checkout; crypto: boolean; busy: boolean; text: CopyText }>) => {
  const { stage } = checkout.state
  const review = crypto && stage !== 'ready'
  const pay = text('funding_pay', { amount: payment_amount(checkout) })
  return (
    <Button
      tone="primary"
      className="min-h-[52px] w-full text-sm font-bold"
      disabled={busy || checkout.locked || !checkout.ready}
      onClick={review ? checkout.quote : checkout.send}
    >
      {stage === 'quoting' ? text('funding_status_quoting') : review ? text('funding_review') : pay}
    </Button>
  )
}

const PaymentForm = ({
  checkout,
  crypto,
  busy,
  price_usd,
  text,
}: Readonly<{ checkout: Checkout; crypto: boolean; busy: boolean; price_usd: number | null; text: CopyText }>) => {
  const locale = useLocale()
  const { quote, error } = checkout.state
  return (
    <>
      <AmountField checkout={checkout} text={text} usd={format_token_usd(checkout.amount, 9, price_usd, locale)} />
      <AssetPicker checkout={checkout} text={text} locale={locale} />
      {quote && (
        <QuoteReview
          quote={quote}
          text={text}
          locale={locale}
          usd={format_token_usd(quote.amount_out, 9, price_usd, locale)}
        />
      )}
      {!checkout.sufficient && (
        <p className="text-xs text-rose-300" role="alert">
          {text('funding_source_balance')}
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-300" role="alert">
          {text(error.startsWith('funding_') ? error : 'funding_failed')}
        </p>
      )}
      <PayButton checkout={checkout} crypto={crypto} busy={busy} text={text} />
    </>
  )
}

const TransferSteps = ({
  stage,
  estimate,
  text,
}: Readonly<{ stage: CheckoutStage; estimate: number | null; text: CopyText }>) => {
  const steps = TRANSFER_STEPS[stage]
  const live = steps.indexOf('live')
  // Without a quoted estimate the stylesheet's default creep duration applies.
  const creep = estimate === null ? undefined : ({ '--aui-step-eta': `${estimate}s` } as CSSProperties)
  return (
    <div
      className="space-y-2"
      role="progressbar"
      aria-label={text('funding_adding')}
      aria-valuetext={live < 0 ? undefined : text(STEP_KEYS[live])}
    >
      <div className="flex gap-1">
        {steps.map((step, index) => (
          <span className="aui-funding-step" data-state={step} style={creep} key={STEP_KEYS[index]} />
        ))}
      </div>
      <div className="flex gap-1">
        {steps.map((step, index) => (
          <span
            className={`flex-1 text-[10px] font-semibold tracking-[0.1em] uppercase ${STEP_TONE[step]}`}
            key={STEP_KEYS[index]}
          >
            {text(STEP_KEYS[index])}
          </span>
        ))}
      </div>
    </div>
  )
}

// How each transfer stage reads: in the wallet, moving between chains, delivered, or a problem.
type StatusKind = 'working' | 'moving' | 'delivered' | 'status' | 'alert'
const STATUS_KIND: Readonly<Partial<Record<CheckoutStage, StatusKind>>> = {
  preparing: 'working',
  signing: 'working',
  pending: 'moving',
  bridging: 'moving',
  success: 'delivered',
  refunded: 'status',
  failed: 'alert',
  unknown: 'alert',
}

const TimeLeft = ({ seconds, text }: Readonly<{ seconds: number | null; text: CopyText }>) =>
  seconds === null ? null : (
    <span className="font-mono text-xs text-cyan">
      {seconds > 4 ? text('funding_time_left', { seconds }) : text('funding_almost')}
    </span>
  )

const TransferStatus = ({
  stage,
  message,
  seconds_left,
  text,
}: Readonly<{ stage: CheckoutStage; message: string; seconds_left: number | null; text: CopyText }>) => {
  const kind = STATUS_KIND[stage]
  if (kind === 'working' || kind === 'moving')
    return (
      <p className="flex items-center gap-2.5 text-sm font-semibold" role="status">
        {kind === 'working' ? (
          <Loader2 className="shrink-0 animate-spin text-cyan" size={16} aria-hidden="true" />
        ) : (
          <span className="aui-funding-dot" aria-hidden="true" />
        )}
        <span className="flex-1">{message}</span>
        {kind === 'moving' && <TimeLeft seconds={seconds_left} text={text} />}
      </p>
    )
  if (kind === 'delivered')
    return (
      <div className="space-y-1" role="status">
        <p className="text-base font-bold">{message}</p>
        <p className="text-[13px] text-muted">{text('funding_delivered_hint')}</p>
      </div>
    )
  return (
    kind && (
      <p className="text-[13px] leading-relaxed text-rose-300" role={kind}>
        {message}
      </p>
    )
  )
}

const TransferReference = ({ state, text }: Readonly<{ state: CheckoutState; text: CopyText }>) => {
  const [copied, copy] = useCopy()
  const reference = state.transaction ?? state.quote?.deposit_address
  if (!reference) return null
  return (
    <div className="flex items-center gap-2 border-t border-border pt-3 text-xs text-muted">
      <span>{text(state.transaction ? 'funding_transaction' : 'funding_deposit_address')}</span>
      <button
        className="inline-flex min-h-8 flex-1 items-center gap-1.5 font-mono text-text hover:text-gold"
        type="button"
        title={reference}
        onClick={() => copy(reference)}
      >
        {truncate_address(reference)}
        {copied ? <Check className="text-emerald-400" size={13} /> : <Copy className="opacity-50" size={13} />}
      </button>
      <a
        className="inline-flex items-center gap-1 font-semibold text-cyan hover:underline"
        href={EXPLORER_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        {text('funding_explorer')}
        <ExternalLink size={12} aria-hidden="true" />
      </a>
    </div>
  )
}

const DeliveredActions = ({ close, more, text }: Readonly<{ close: () => void; more: () => void; text: CopyText }>) => {
  const close_after_delivery = useEffectEvent(close)
  useEffect(() => {
    const timer = setTimeout(close_after_delivery, AUTO_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [])
  const countdown = { '--aui-autoclose': `${AUTO_CLOSE_MS}ms` } as CSSProperties
  return (
    <div className="flex gap-2.5">
      <Button
        tone="primary"
        className="aui-funding-autoclose min-h-[52px] flex-1 text-sm font-bold"
        style={countdown}
        onClick={close}
      >
        <span>{text('funding_back')}</span>
      </Button>
      <Button className="min-h-[52px] px-5 text-sm" onClick={more}>
        {text('funding_more')}
      </Button>
    </div>
  )
}

const TransferActions = ({
  checkout,
  text,
  close,
}: Readonly<{ checkout: Checkout; text: CopyText; close: () => void }>) => {
  const reset = (): void => checkout.dispatch({ type: 'reset' })
  if (checkout.state.stage === 'success') return <DeliveredActions close={close} more={reset} text={text} />
  return (
    checkout.state.stage === 'refunded' && (
      <Button tone="primary" className="min-h-[52px] w-full text-sm font-bold" onClick={reset}>
        {text('funding_retry')}
      </Button>
    )
  )
}

const TransferHeader = ({
  amount,
  quote,
  delivered,
  text,
}: Readonly<{ amount: string; quote: FundingQuote | null; delivered: boolean; text: CopyText }>) => (
  <header className="flex items-start justify-between gap-3">
    <div className="space-y-1.5">
      <p className={LABEL}>{text('funding_adding')}</p>
      <p className="font-mono text-4xl leading-none font-semibold text-gold">+{amount} SUI</p>
      {quote && (
        <p className="text-xs text-muted">
          {text('funding_from', { amount: quoted_amount(quote), chain: chain_name(quote.source.blockchain) })}
        </p>
      )}
    </div>
    {delivered && (
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold/15 text-gold">
        <Check size={20} aria-hidden="true" />
      </span>
    )}
  </header>
)

const TransferCard = ({
  checkout,
  text,
  wallet,
  close,
}: Readonly<{ checkout: Checkout; text: CopyText; wallet: string; close: () => void }>) => {
  const { stage, quote, submitted_at } = checkout.state
  const estimate = quote?.estimated_seconds ?? null
  const seconds_left = useSecondsLeft(submitted_at, estimate)
  const chain = quote ? chain_name(quote.source.blockchain) : ''
  return (
    <>
      <section
        className="space-y-4 rounded border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-5"
        data-funding-transfer={stage}
      >
        <TransferHeader amount={checkout.amount_text} quote={quote} delivered={stage === 'success'} text={text} />
        {quote && <TransferSteps stage={stage} estimate={estimate} text={text} />}
        <div className="border-t border-border pt-4">
          <TransferStatus
            stage={stage}
            message={text(`funding_status_${stage}`, { wallet, chain, amount: checkout.amount_text })}
            seconds_left={seconds_left}
            text={text}
          />
        </div>
        {quote && <TransferReference state={checkout.state} text={text} />}
      </section>
      <TransferActions checkout={checkout} text={text} close={close} />
    </>
  )
}

export const FundingCheckout = ({
  address,
  copy,
  checkout,
  price_usd,
  close,
}: Readonly<{
  price_usd: number | null
  address: string
  copy: AppCopy
  checkout: Checkout
  close: () => void
}>) => {
  const wallet = useAppStore((state) => state.external_wallet)
  const source = wallet.session
  const text = copy_text(copy.wallet_legacy)
  const available = source !== null && source.address !== address
  return (
    <div className="space-y-5" data-funding-checkout="">
      {transfer_visible(checkout.state) ? (
        <TransferCard checkout={checkout} text={text} wallet={source?.wallet_name ?? ''} close={close} />
      ) : (
        available && (
          <PaymentForm
            checkout={checkout}
            crypto={crypto_session(source) !== null}
            busy={!!external_wallet_view(wallet).busy}
            price_usd={price_usd}
            text={text}
          />
        )
      )}
      {source?.address === address && <p className="text-xs text-muted">{text('funding_same_wallet')}</p>}
    </div>
  )
}

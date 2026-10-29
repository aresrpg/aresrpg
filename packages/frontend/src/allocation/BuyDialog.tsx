// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useId, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { blast_tokens_for, type BlastSnapshot } from '@aresrpg/sdk/blast'

import type { CopyText } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { format_sui, parse_sui_amount } from '../wallet_amount.ts'

import { buy_check, buy_limits, type BuyLimits } from './sale.ts'
import { kares_text, sui_text } from './SalePanel.tsx'
import { short_address } from './view.ts'

export type BuySpot = Readonly<{
  address: string
  label: string
  tier: string
  face: string
  cap: bigint
  bought: bigint
  balance: bigint | null
}>
type Check = ReturnType<typeof buy_check>
type Shared = Readonly<{ text: CopyText; locale: Locale }>
const plain_sui = (mist: bigint): string => format_sui(mist, 9).replace(/\.?0+$/, '')

// The one line explaining why an amount cannot be bought as entered.
const NOTICE: Readonly<Partial<Record<Check['kind'], (limits: BuyLimits) => readonly [string, bigint]>>> = {
  short: (limits) => ['sale_wallet_max', limits.spendable ?? 0n],
  over_cap: (limits) => ['sale_spot_left', limits.remaining],
}
const Notice = ({ check, limits, text, locale }: Shared & Readonly<{ check: Check; limits: BuyLimits }>) => {
  const notice = NOTICE[check.kind]?.(limits)
  return notice ? <p className="sale-error">{text(notice[0], { sui: sui_text(notice[1], locale) })}</p> : null
}

const Presets = ({
  limits,
  amount,
  busy,
  pick,
  text,
  locale,
}: Shared & Readonly<{ limits: BuyLimits; amount: bigint | null; busy: boolean; pick: (value: bigint) => void }>) => (
  <div className="sale-presets">
    {limits.presets.map((value) => (
      <button
        type="button"
        key={String(value)}
        aria-pressed={amount === value}
        disabled={busy}
        onClick={() => pick(value)}
      >
        {sui_text(value, locale)}
      </button>
    ))}
    <button
      type="button"
      aria-pressed={amount === limits.max}
      disabled={busy || limits.max === 0n}
      onClick={() => pick(limits.max)}
    >
      {text('sale_max', { sui: sui_text(limits.max, locale) })}
    </button>
  </div>
)

const Summary = ({
  spot,
  sale,
  amount,
  check,
  text,
  locale,
}: Shared & Readonly<{ spot: BuySpot; sale: BlastSnapshot; amount: bigint; check: Check }>) => {
  const after = spot.bought + amount
  const rows = [
    ['sale_receive', <b key="kares">≈ {kares_text(blast_tokens_for(sale, amount), locale)} KARES</b>],
    ['sale_spot_after', `${sui_text(after < spot.cap ? after : spot.cap, locale)} / ${sui_text(spot.cap, locale)} SUI`],
    ...(spot.balance !== null && check.kind !== 'short' && check.kind !== 'over_cap'
      ? [['sale_left_in_wallet', `${sui_text(spot.balance - amount, locale)} SUI`] as const]
      : []),
  ] as const
  return (
    <div className="sale-rows">
      {rows.map(([label, value]) => (
        <p className="sale-row" key={label}>
          <span>{text(label)}</span>
          <i aria-hidden="true" />
          <span>{value}</span>
        </p>
      ))}
    </div>
  )
}

const Submit = ({
  check,
  busy,
  amount,
  text,
  locale,
}: Shared & Readonly<{ check: Check; busy: boolean; amount: bigint }>) =>
  check.kind === 'short' ? (
    <button className="btn sale-action is-blast" type="submit">
      <Plus size={16} aria-hidden="true" />
      {text('sale_add_sui', { sui: sui_text(check.missing, locale) })}
    </button>
  ) : (
    <button className="btn sale-action is-blast" type="submit" disabled={busy || check.kind !== 'ready'}>
      {busy ? text('sale_signing') : text('sale_buy_amount', { sui: sui_text(amount, locale) })}
    </button>
  )

export const BuyDialog = ({
  spot,
  sale,
  busy,
  failed,
  text,
  locale,
  close,
  buy,
  add_funds,
}: Shared &
  Readonly<{
    spot: BuySpot
    sale: BlastSnapshot
    busy: boolean
    failed: boolean
    close: () => void
    buy: (amount: bigint) => void
    /** Opens Add funds for the purchase amount; it tops up to that amount plus the gas cushion. */
    add_funds: (amount: bigint) => void
  }>) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [input, set_input] = useState('')
  useEffect(() => dialog.current?.showModal(), [])
  const limits = buy_limits(spot.cap, spot.bought, spot.balance)
  const amount = parse_sui_amount(input)
  const check = buy_check(amount, limits)
  const invalid = check.kind === 'short' || check.kind === 'over_cap'
  const submit = (): void => {
    if (!amount) return
    if (check.kind === 'ready') buy(amount)
    if (check.kind === 'short') add_funds(amount)
  }
  return (
    <dialog className="wallet-picker sale-buy" ref={dialog} aria-labelledby={title} onCancel={close} onClose={close}>
      <header>
        <span className="sale-buy-card" style={{ backgroundImage: `url("${spot.face}")` }} aria-hidden="true" />
        <div>
          <h2 id={title}>{text('sale_buy')}</h2>
          <p>
            {spot.tier} · {spot.label} · {short_address(spot.address)}
          </p>
        </div>
        <button type="button" className="btn-icon" aria-label={text('close')} onClick={close}>
          <X size={18} />
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label className="sale-amount" data-invalid={invalid || undefined}>
          <span>{text('sale_amount')}</span>
          <span>
            <input
              value={input}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-label={text('sale_amount_sui')}
              aria-invalid={invalid}
              onChange={(event) => set_input(event.target.value.replace(',', '.'))}
              disabled={busy}
            />
            <small>SUI</small>
          </span>
        </label>
        <Notice check={check} limits={limits} text={text} locale={locale} />
        <Presets
          limits={limits}
          amount={amount}
          busy={busy}
          pick={(value) => set_input(plain_sui(value))}
          text={text}
          locale={locale}
        />
        <Summary spot={spot} sale={sale} amount={amount ?? 0n} check={check} text={text} locale={locale} />
        <p className="sale-terms">{text('sale_terms')}</p>
        {failed && (
          <p className="sale-error" role="alert">
            {text('sale_failed')}
          </p>
        )}
        <Submit check={check} busy={busy} amount={amount ?? 0n} text={text} locale={locale} />
      </form>
    </dialog>
  )
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState, type ReactNode } from 'react'
import { ArrowUpRight, Loader2 } from 'lucide-react'

import type { KaresCopy } from './copy.ts'
import { format_amount, validate_amount, type FinanceState } from './model.ts'

export const finance_button =
  'finance-button inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 border border-gold/40 bg-gold/12 px-5 py-3 text-[10px] font-semibold tracking-[0.12em] text-gold uppercase transition hover:border-gold hover:bg-gold/20 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan disabled:cursor-not-allowed disabled:opacity-35'
export const finance_label = 'text-[9px] tracking-[0.18em] text-muted uppercase'

export const AmountForm = ({
  copy,
  asset,
  balance,
  label,
  busy,
  disabled = false,
  submit,
}: Readonly<{
  copy: KaresCopy
  asset: 'KARES' | 'SUI'
  balance: bigint
  label: string
  busy: boolean
  disabled?: boolean
  submit: (amount: bigint) => void
}>) => {
  const [value, set_value] = useState('')
  const validation = validate_amount(value, balance)
  const { amount } = validation
  const can_submit = !busy && !disabled && amount !== null
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (can_submit) submit(amount)
      }}
    >
      <label className="block">
        <span className={finance_label}>
          {copy.amount} · {asset}
        </span>
        <span className="mt-2 flex items-center border border-white/15 bg-black/25 focus-within:border-cyan">
          <input
            aria-invalid={!!validation.error}
            autoComplete="off"
            className="w-full min-w-0 bg-transparent px-4 py-4 text-xl text-text outline-none placeholder:text-muted/35"
            inputMode="decimal"
            onChange={(event) => set_value(event.target.value)}
            placeholder="0.00"
            value={value}
          />
          <span className="pr-4 text-xs text-gold">{asset}</span>
        </span>
      </label>
      <div className="flex flex-wrap justify-between gap-2 text-[9px] text-muted">
        <span>{copy.balance}</span>
        <span className="tabular-nums">
          {format_amount(balance, 9)} {asset}
        </span>
      </div>
      {validation.error && (
        <p className="text-[10px] leading-5 text-rose-300" role="alert">
          {copy[validation.error]}
        </p>
      )}
      <button className={`${finance_button} w-full`} disabled={!can_submit} type="submit">
        {busy ? (
          <>
            <Loader2 className="animate-spin" size={14} />
            {copy.pending}
          </>
        ) : (
          <>
            <ArrowUpRight size={14} />
            {label}
          </>
        )}
      </button>
      {asset === 'SUI' && <p className="text-[9px] leading-5 text-muted">{copy.gas_note}</p>}
    </form>
  )
}

export const finance_empty_message = (state: FinanceState, copy: KaresCopy, unavailable = copy.unavailable): string =>
  state.digest ? copy.confirmed_refresh : state.request ? copy.loading : unavailable

const FinanceError = ({ state, copy }: Readonly<{ state: FinanceState; copy: KaresCopy }>) => (
  <>
    {state.error && !state.error.includes('is not configured') && (
      <p
        className="break-words border border-rose-400/25 bg-rose-400/5 p-3 text-[10px] leading-5 text-rose-200"
        role="alert"
      >
        {state.error === 'same_account' ? copy.same_account : state.error}
      </p>
    )}
  </>
)

export const FinanceStatus = ({
  state,
  copy,
  network,
}: Readonly<{ state: FinanceState; copy: KaresCopy; network: 'testnet' | 'mainnet' }>) => (
  <div aria-live="polite" className="space-y-3">
    <FinanceError state={state} copy={copy} />
    {state.digest && (
      <p className="break-all border border-cyan/20 bg-cyan/5 p-3 text-[9px] leading-5 text-cyan">
        {copy.confirmed}
        <br />
        <a
          className="underline underline-offset-4"
          href={`https://suiscan.xyz/${network}/tx/${state.digest}`}
          rel="noreferrer"
          target="_blank"
        >
          {state.digest}
        </a>
      </p>
    )}
  </div>
)

export const Metric = ({ label, children }: Readonly<{ label: string; children: ReactNode }>) => (
  <div className="min-w-0">
    <div className={finance_label}>{label}</div>
    <div className="mt-2 break-words text-lg font-medium text-text tabular-nums">{children}</div>
  </div>
)

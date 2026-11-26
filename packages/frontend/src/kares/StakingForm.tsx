// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import { staking_withdrawal_batch, STAKING_POSITION_BATCH_LIMIT } from '@aresrpg/sdk/kares'
import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'

import { useNumbers } from '../i18n/useNumbers.ts'

import type { KaresCopy } from './copy.ts'
import { validate_amount, type FinanceInput, type FinanceSnapshot } from './model.ts'
import { staking_gains, staking_preset } from './staking_model.ts'

/** The form's column: beside the stake behind a hairline, under it on a phone. */
export const ACTION_BOX =
  'grid min-w-0 grid-cols-1 border-l border-line pl-6 max-[760px]:border-t max-[760px]:border-l-0 max-[760px]:pt-4.5 max-[760px]:pl-0'

type Target =
  | Readonly<{ kind: 'stake' }>
  | Readonly<{ kind: 'withdraw'; positions: readonly Readonly<{ id: string; amount: bigint }>[] }>
  | null

const StakingAmount = ({
  copy,
  balance,
  locked,
  target,
  snapshot,
  dispatch,
  mode,
}: Readonly<{
  copy: KaresCopy
  balance: bigint | null
  locked: boolean
  target: Target
  snapshot: FinanceSnapshot
  dispatch: (input: FinanceInput) => void
  mode: 'stake' | 'withdraw'
}>) => {
  const { amount: format_amount, daily: daily_amount } = useNumbers()
  const [value, set_value] = useState('')
  const validation = validate_amount(value, balance ?? 0n)
  const can_submit = !locked && validation.amount !== null
  const estimate = mode === 'stake' && validation.amount !== null ? staking_gains(snapshot, validation.amount) : null
  return (
    <form
      className="grid grid-cols-1 gap-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (can_submit && target)
          dispatch({ type: 'request', request: { kind: 'execute', action: { ...target, amount: validation.amount! } } })
      }}
    >
      <label className="grid gap-2">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px] text-muted">
          <span className="font-mono text-[10px]/none font-bold tracking-[0.12em] uppercase">{copy.amount}</span>
          <span>
            {copy.balance}: {balance === null ? '—' : format_amount(balance, 0)}
          </span>
        </span>
        <span className="flex items-center gap-2.5 rounded-ui border border-line-strong bg-surface-low pr-3 focus-within:border-gold-light">
          <input
            className="min-h-11.5 min-w-0 flex-[1_1_0] px-3 font-mono text-xl/none font-semibold text-text tabular-nums outline-0"
            aria-invalid={!!validation.error}
            autoComplete="off"
            inputMode="decimal"
            disabled={locked}
            value={value}
            placeholder="0.00"
            onChange={(event) => set_value(event.target.value)}
          />
          <span className="font-mono text-[11px]/none font-bold tracking-[0.08em] text-muted">KARES</span>
        </span>
      </label>
      <div
        className="flex min-h-4.5 flex-wrap gap-x-2.5 gap-y-1 text-[12px] text-muted"
        aria-live="polite"
        data-staking-estimate=""
      >
        {estimate && (
          <>
            <span>{copy.additional_daily}</span>
            <b className="font-mono text-xs/normal font-semibold text-hue-gold">
              +{format_amount(estimate.additional_kares, 0)} KARES
            </b>
            <b className="font-mono text-xs/normal font-semibold text-hue-sky">
              +{daily_amount(estimate.additional_sui)} SUI
            </b>
          </>
        )}
        {validation.error && (
          <span className="text-danger" role="alert">
            {copy[validation.error]}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex gap-1.5" role="group" aria-label={copy.amount}>
          {([25, 50, 100] as const).map((percent) => (
            <Button
              className="min-h-10 gap-2"
              type="button"
              key={percent}
              disabled={locked || balance === null}
              onClick={() => {
                if (balance !== null) set_value(staking_preset(balance, percent))
              }}
            >
              {percent === 100 ? copy.max : `${percent}%`}
            </Button>
          ))}
        </div>
        <Button className="min-h-10 gap-2" tone="primary" type="submit" disabled={!can_submit}>
          <ArrowUpRight size={14} />
          {copy[mode]}
        </Button>
      </div>
    </form>
  )
}

export const StakingForm = ({
  copy,
  balance,
  locked,
  snapshot,
  dispatch,
}: Readonly<{
  copy: KaresCopy
  balance: bigint | null
  locked: boolean
  snapshot: FinanceSnapshot
  dispatch: (input: FinanceInput) => void
}>) => {
  const [mode, set_mode] = useState<'stake' | 'withdraw'>('stake')
  const withdrawals = staking_withdrawal_batch(snapshot.positions)
  const withdrawal_balance = withdrawals.reduce((sum, position) => sum + position.amount, 0n)
  const targets = {
    stake: { kind: 'stake' } as const,
    withdraw: { kind: 'withdraw', positions: withdrawals } as const,
  }
  const total_stake = staking_gains(snapshot).stake
  const balances = { stake: balance, withdraw: withdrawal_balance }
  const unavailable = { stake: !snapshot.pool.active, withdraw: total_stake === 0n }
  return (
    <div className={`${ACTION_BOX} gap-3`}>
      <div
        className="aui-segments grid grid-cols-2 [&_.aui-button]:min-h-9.5"
        role="group"
        aria-label={copy.manage_stake}
      >
        {(['stake', 'withdraw'] as const).map((action) => (
          <Button
            type="button"
            key={action}
            aria-pressed={mode === action}
            disabled={locked}
            onClick={() => set_mode(action)}
          >
            {action === 'stake' ? copy.stake_more : copy.withdraw}
          </Button>
        ))}
      </div>
      {mode === 'withdraw' && withdrawal_balance < total_stake && (
        <p className="text-[11px]/normal text-faint">
          {copy.withdraw_batch.replace('{{count}}', String(STAKING_POSITION_BATCH_LIMIT))}
        </p>
      )}
      <StakingAmount
        copy={copy}
        balance={balances[mode]}
        locked={locked || unavailable[mode]}
        target={targets[mode]}
        snapshot={snapshot}
        dispatch={dispatch}
        mode={mode}
        key={mode}
      />
    </div>
  )
}

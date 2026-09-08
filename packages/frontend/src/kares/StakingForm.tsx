// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'

import type { KaresCopy } from './copy.ts'
import { format_amount, validate_amount, type FinanceInput, type FinanceSnapshot } from './model.ts'
import { daily_amount, staking_gains, staking_preset } from './staking_model.ts'

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
  const [value, set_value] = useState('')
  const validation = validate_amount(value, balance ?? 0n)
  const can_submit = !locked && validation.amount !== null
  const estimate = mode === 'stake' && validation.amount !== null ? staking_gains(snapshot, validation.amount) : null
  return (
    <form
      className="staking-amount"
      onSubmit={(event) => {
        event.preventDefault()
        if (can_submit && target)
          dispatch({ type: 'request', request: { kind: 'execute', action: { ...target, amount: validation.amount! } } })
      }}
    >
      <label>
        <span className="staking-amount-caption">
          <span>{copy.amount}</span>
          <span>
            {copy.balance}: {balance === null ? '—' : format_amount(balance, 9)}
          </span>
        </span>
        <span className="staking-amount-field">
          <input
            aria-invalid={!!validation.error}
            autoComplete="off"
            inputMode="decimal"
            disabled={locked}
            value={value}
            placeholder="0.00"
            onChange={(event) => set_value(event.target.value)}
          />
          <span>KARES</span>
        </span>
      </label>
      <div className="staking-estimate" aria-live="polite" data-staking-estimate="">
        {estimate && (
          <>
            <span>{copy.additional_daily}</span>
            <span className="text-gold">+{daily_amount(estimate.additional_kares)} KARES</span>
            <span className="text-cyan">+{daily_amount(estimate.additional_sui)} SUI</span>
          </>
        )}
        {validation.error && (
          <span className="text-rose-300" role="alert">
            {copy[validation.error]}
          </span>
        )}
      </div>
      <div className="staking-form-actions">
        <div className="staking-presets" role="group" aria-label={copy.amount}>
          {([25, 50, 100] as const).map((percent) => (
            <button
              type="button"
              key={percent}
              disabled={locked || balance === null}
              onClick={() => {
                if (balance !== null) set_value(staking_preset(balance, percent))
              }}
            >
              {percent === 100 ? copy.max : `${percent}%`}
            </button>
          ))}
        </div>
        <button className="staking-submit" type="submit" disabled={!can_submit}>
          <ArrowUpRight size={12} />
          {copy[mode]}
        </button>
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
  const targets = {
    stake: { kind: 'stake' } as const,
    withdraw: { kind: 'withdraw', positions: snapshot.positions.map(({ id, amount }) => ({ id, amount })) } as const,
  }
  const total_stake = staking_gains(snapshot).stake
  const balances = { stake: balance, withdraw: total_stake }
  const unavailable = { stake: !snapshot.pool.active, withdraw: total_stake === 0n }
  return (
    <div className="staking-action-box">
      <div className="staking-action-switch" role="group" aria-label={copy.manage_stake}>
        {(['stake', 'withdraw'] as const).map((action) => (
          <button
            type="button"
            key={action}
            aria-pressed={mode === action}
            disabled={locked}
            onClick={() => set_mode(action)}
          >
            {action === 'stake' ? copy.stake_more : copy.withdraw}
          </button>
        ))}
      </div>
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

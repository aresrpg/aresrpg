// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { KaresWalletSession, KaresStakingSnapshot, KaresBalances } from '@aresrpg/sdk/kares'

import { format_sui, parse_sui_amount } from '../wallet_amount.ts'

export type FinanceSession = Pick<KaresWalletSession, 'address' | 'kares'>

export type FinanceSnapshot = KaresStakingSnapshot
export type FinanceBalances = KaresBalances
export type FinanceAction =
  | Readonly<{ kind: 'contribute' | 'stake' | 'fund_kares' | 'fund_sui' | 'fund_combat'; amount: bigint }>
  | Readonly<{ kind: 'claim_offering' | 'refund'; ids: readonly string[] }>
  | Readonly<{ kind: 'claim_rewards'; ids: readonly string[] }>
  | Readonly<{ kind: 'withdraw'; positions: readonly Readonly<{ id: string; amount: bigint }>[]; amount: bigint }>
export type FinanceRequest = Readonly<{ kind: 'refresh' }> | Readonly<{ kind: 'execute'; action: FinanceAction }>
export type FinanceState = Readonly<{
  /** Immutable read scope; the wallet owner alone retains the connection and signing session. */
  address: string | null
  snapshot: FinanceSnapshot | null
  balances: FinanceBalances | null
  sequence: number
  request: FinanceRequest | null
  error: string | null
  digest: string | null
}>
export type FinanceInput =
  | Readonly<{ type: 'resume' }>
  | Readonly<{ type: 'request'; request: FinanceRequest }>
  | Readonly<{
      type: 'snapshot'
      sequence: number
      snapshot: FinanceSnapshot
      balances: FinanceBalances | null
      digest?: string
    }>
  | Readonly<{ type: 'receipt'; sequence: number; digest: string }>
  | Readonly<{ type: 'failed'; sequence: number; error: string }>

export const initial_finance = (address: string | null = null): FinanceState => ({
  address,
  snapshot: null,
  balances: null,
  sequence: 0,
  request: null,
  error: null,
  digest: null,
})

export const reduce_finance = (state: FinanceState, input: FinanceInput): FinanceState => {
  if (input.type === 'resume') return { ...state, sequence: state.sequence + 1, request: { kind: 'refresh' } }
  if (input.type === 'request') return begin_request(state, input.request)
  if (input.sequence !== state.sequence) return state
  return finish_finance(state, input)
}

const begin_request = (state: FinanceState, request: FinanceRequest): FinanceState => {
  if (state.request) return state
  if (request.kind === 'execute' && !state.snapshot) return state
  return {
    ...state,
    request,
    sequence: state.sequence + 1,
    error: null,
    digest: request.kind === 'execute' ? null : state.digest,
  }
}

const finish_finance = (state: FinanceState, input: Extract<FinanceInput, { sequence: number }>): FinanceState => {
  switch (input.type) {
    case 'receipt':
      return { ...state, digest: input.digest, snapshot: null, balances: null }
    case 'snapshot':
      return {
        ...state,
        snapshot: input.snapshot,
        balances: input.balances,
        request: null,
        error: null,
        digest: input.digest ?? state.digest,
      }
    case 'failed':
      return { ...state, request: null, error: input.error }
  }
}

/** SUI and KARES share nine decimal places; reuse the wallet's exact parser. */
export const parse_amount = (value: string): bigint | null => {
  const amount = parse_sui_amount(value)
  return amount !== null && amount <= 18_446_744_073_709_551_615n ? amount : null
}

export const format_amount = (value: bigint, decimals = 4): string => {
  const [integer, decimal = ''] = format_sui(value, decimals).split('.')
  const whole = BigInt(integer).toLocaleString('en-US')
  const fraction = decimal.replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export const offering_phase = (snapshot: FinanceSnapshot): 'upcoming' | 'open' | 'successful' | 'refundable' => {
  const { offering, clock_ms } = snapshot
  if (!offering.started) return 'upcoming'
  if (clock_ms < offering.opens_ms) return 'upcoming'
  if (clock_ms < offering.closes_ms) return 'open'
  return offering.total_contributed < offering.min_raise ? 'refundable' : 'successful'
}

export const validate_amount = (
  value: string,
  balance: bigint
): Readonly<{ amount: bigint | null; error: 'amount_invalid' | 'insufficient' | null }> => {
  const amount = parse_amount(value)
  if (!value) return { amount: null, error: null }
  if (amount === null) return { amount, error: 'amount_invalid' }
  if (amount > balance) return { amount: null, error: 'insufficient' }
  return { amount, error: null }
}

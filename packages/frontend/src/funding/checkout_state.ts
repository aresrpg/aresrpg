// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { FundingBalance, ExternalSession } from '../wallet/external_session.ts'

import type { FundingQuote, FundingStatus } from './near.ts'

export type CheckoutStage =
  | 'idle'
  | 'quoting'
  | 'ready'
  | 'preparing'
  | 'signing'
  | 'pending'
  | 'bridging'
  | 'success'
  | 'refunded'
  | 'failed'
  | 'unknown'
export type CheckoutState = Readonly<{
  stage: CheckoutStage
  quote: FundingQuote | null
  transaction: string | null
  submitted_at: number | null
  error: string | null
  amount_text: string | null
  asset_id: string
  assets: readonly FundingBalance[]
  assets_source: ExternalSession | null
  assets_status: 'loading' | 'ready' | 'failed'
  assets_revision: number
}>
export const initial_checkout = (): CheckoutState => ({
  stage: 'idle',
  quote: null,
  transaction: null,
  submitted_at: null,
  error: null,
  amount_text: null,
  asset_id: '',
  assets: [],
  assets_source: null,
  assets_status: 'loading',
  assets_revision: 0,
})
export type CheckoutInput =
  | Readonly<{ type: 'reset' }>
  | Readonly<{ type: 'edit'; field: 'amount_text' | 'asset_id'; value: string }>
  | Readonly<{ type: 'assets_loading'; source: ExternalSession }>
  | Readonly<{ type: 'assets'; source: ExternalSession; assets: readonly FundingBalance[]; failed: boolean }>
  | Readonly<{ type: 'refresh_assets' }>
  | Readonly<{ type: 'stage'; stage: 'quoting' | 'preparing' | 'signing'; amount_text: string }>
  | Readonly<{ type: 'quoted'; quote: FundingQuote }>
  | Readonly<{ type: 'submitted'; transaction: string; at: number }>
  | Readonly<{ type: 'observed'; status: FundingStatus }>
  | Readonly<{ type: 'error'; error: string; uncertain?: boolean }>

export const checkout_locked = (state: CheckoutState): boolean =>
  ['preparing', 'signing', 'pending', 'bridging', 'unknown'].includes(state.stage)

/** Signing onward, plus a provider failure (no local error), replaces the form with the transfer card. */
export const transfer_visible = ({ stage, error }: CheckoutState): boolean =>
  !['idle', 'quoting', 'ready', 'failed'].includes(stage) || (stage === 'failed' && error === null)

export type StepState = 'todo' | 'live' | 'done' | 'failed'
const UNSENT = ['todo', 'todo', 'todo'] as const
/** Deposit · bridge · delivery, as far as provider status proves; time never advances a step. */
export const TRANSFER_STEPS: Readonly<Record<CheckoutStage, readonly [StepState, StepState, StepState]>> = {
  idle: UNSENT,
  quoting: UNSENT,
  ready: UNSENT,
  preparing: UNSENT,
  signing: UNSENT,
  pending: ['live', 'todo', 'todo'],
  unknown: ['live', 'todo', 'todo'],
  bridging: ['done', 'live', 'todo'],
  success: ['done', 'done', 'done'],
  refunded: ['done', 'failed', 'todo'],
  failed: ['done', 'failed', 'todo'],
}

const clear_transfer = (state: CheckoutState): CheckoutState => ({
  ...state,
  stage: 'idle',
  quote: null,
  transaction: null,
  submitted_at: null,
  error: null,
})

const observe = (state: CheckoutState, status: FundingStatus): CheckoutState => {
  if (status === 'pending' || status === state.stage || !['pending', 'bridging', 'unknown'].includes(state.stage))
    return state
  return { ...state, stage: status, error: null }
}

const selected_asset_id = (assets: readonly FundingBalance[], selected: string): string =>
  (assets.find((asset) => asset.asset_id === selected) ?? assets.find((asset) => asset.symbol === 'USDC') ?? assets[0])
    ?.asset_id ?? ''

const edit_checkout = (state: CheckoutState, input: CheckoutInput): CheckoutState | null => {
  switch (input.type) {
    case 'reset':
      return checkout_locked(state) ? state : clear_transfer(state)
    case 'edit':
      return checkout_locked(state) ? state : { ...clear_transfer(state), [input.field]: input.value }
    case 'assets_loading':
      return { ...state, assets: [], assets_source: input.source, assets_status: 'loading' }
    case 'assets': {
      if (input.source !== state.assets_source) return state
      const assets = input.assets.filter((asset) => asset.balance > 0n)
      return {
        ...state,
        assets,
        asset_id: selected_asset_id(assets, state.asset_id),
        assets_status: input.failed ? 'failed' : 'ready',
      }
    }
    case 'refresh_assets':
      return checkout_locked(state) ? state : { ...state, assets_revision: state.assets_revision + 1 }
    default:
      return null
  }
}

export const reduce_checkout = (state: CheckoutState, input: CheckoutInput): CheckoutState => {
  const edited = edit_checkout(state, input)
  if (edited) return edited
  switch (input.type) {
    case 'stage':
      return { ...state, stage: input.stage, amount_text: input.amount_text, error: null }
    case 'quoted':
      return state.stage === 'quoting' ? { ...state, stage: 'ready', quote: input.quote } : state
    case 'submitted':
      return { ...state, stage: 'pending', transaction: input.transaction, submitted_at: input.at, error: null }
    case 'observed':
      return observe(state, input.status)
    case 'error':
      return { ...state, stage: input.uncertain ? 'unknown' : 'failed', error: input.error }
    default:
      return state
  }
}

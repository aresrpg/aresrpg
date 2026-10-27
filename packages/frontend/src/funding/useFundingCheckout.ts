// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/* eslint-disable functional/immutable-data -- React refs retain only this modal's effect lifetime and submission latch. */
import { useEffect, useReducer, useRef, useState } from 'react'

import { capture_analytics } from '../analytics.ts'
import type { AuthSession } from '../auth.ts'
import { dispatch_app, read_app_state } from '../store.ts'
import type { ExternalSession, FundingAsset, FundingBalance, FundingBalances } from '../wallet/external_session.ts'
import { crypto_session, sui_session } from '../wallet/external_session.ts'
import { format_sui, parse_sui_amount } from '../wallet_amount.ts'

import { create_transfer_observer } from './analytics.ts'
import {
  funding_quote,
  funding_status,
  funding_assets,
  funding_shortfall,
  NATIVE_SUI_ASSET,
  type FundingQuote,
} from './near.ts'
import { initial_checkout, reduce_checkout, checkout_locked } from './checkout_state.ts'

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
export const payment_rejected = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; cause?: unknown }
  return value.code === 4001 || (value.cause !== error && payment_rejected(value.cause))
}

const funding_ready = (
  source: ExternalSession | null,
  recipient: string,
  amount: bigint,
  asset: FundingAsset | null
): boolean => amount > 0n && source !== null && source.address !== recipient && asset !== null

/** A Sui source pays native SUI, so its one candidate is the catalogue's SUI row at its wallet balance. */
const read_holdings = async (
  session: ExternalSession,
  assets: readonly FundingAsset[],
  signal: Readonly<AbortSignal>
): Promise<FundingBalances> => {
  if ('family' in session) return session.balances(assets, signal)
  const native = assets.find(({ asset_id }) => asset_id === NATIVE_SUI_ASSET)
  if (!native) throw new Error('funding_invalid_response')
  return { assets: [{ ...native, balance: await session.read_sui_balance() }], failed: false }
}

/** The shortfall as typed SUI text, empty when the balance is unknown or already sufficient. */
const suggested_amount = (cost: bigint, balance: bigint | null): string =>
  balance === null
    ? ''
    : format_sui(funding_shortfall(cost, balance), 9)
        .replace(/\.?0+$/, '')
        .replace(/^0$/, '')

// Never simulate a transfer the source cannot cover: resolution fails before any gas estimate.
const send_sui_source = async (
  sui: AuthSession,
  recipient: string,
  amount: bigint,
  submitting: () => void
): Promise<string> => {
  const balance = await sui.read_sui_balance()
  if (balance < amount) throw new Error('funding_source_balance')
  const gas = await sui.estimate_sui_transfer(recipient, amount, false)
  if (balance < amount + (gas > 0n ? gas : 0n)) throw new Error('funding_source_gas')
  submitting()
  return (await sui.send_sui(recipient, amount, false)).digest
}

// What leaves the source must fit its observed holding: typed SUI directly, or a bridge quote's input.
const affordable = (asset: FundingBalance | null, amount: bigint, quote: FundingQuote | null, sui: boolean): boolean =>
  asset === null || (sui ? amount : (quote?.amount_in ?? 0n)) <= asset.balance

export const useFundingCheckout = (
  source: ExternalSession | null,
  recipient: string,
  cost: bigint,
  balance: bigint | null,
  enabled = true
) => {
  const [state, dispatch] = useReducer(reduce_checkout, undefined, initial_checkout)
  const choices = state.assets_source === source ? state.assets : []
  const assets_status = state.assets_source === source ? state.assets_status : 'loading'
  const asset = choices.find((entry) => entry.asset_id === state.asset_id) ?? null
  const amount_text = state.amount_text ?? suggested_amount(cost, balance)
  const amount = parse_sui_amount(amount_text) ?? 0n
  const sufficient = affordable(asset, amount, state.quote, sui_session(source) !== null)
  const ready = funding_ready(source, recipient, amount, asset) && sufficient
  useEffect(() => {
    if (!source || !enabled) return
    const controller = new AbortController()
    dispatch({ type: 'assets_loading', source })
    void funding_assets(controller.signal)
      .then((assets) => read_holdings(source, assets, controller.signal))
      .then((snapshot) => {
        if (!controller.signal.aborted) dispatch({ type: 'assets', source, ...snapshot })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Funding assets unavailable', error)
          dispatch({ type: 'assets', source, assets: [], failed: true })
        }
      })
    return () => controller.abort()
  }, [source, enabled, state.assets_revision])
  const [observe] = useState(() => create_transfer_observer(capture_analytics))
  useEffect(
    () => observe(state.stage, state.quote || crypto_session(source) ? 'bridge' : 'direct'),
    [state.stage, state.quote, source, observe]
  )
  const pending = useRef(false)
  const generation = useRef(0)
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [recipient])
  useEffect(() => {
    generation.current++
    dispatch({ type: 'reset' })
  }, [source, recipient, amount, asset])

  const quote = (): void => {
    if (!source || !asset || !ready || pending.current || checkout_locked(state)) return
    const { signal } = lifetime.current!
    pending.current = true
    const request_id = generation.current
    dispatch({ type: 'stage', stage: 'quoting', amount_text })
    void funding_quote({ source: asset, sender: source.address, recipient, amount }, signal)
      .then((quote) => {
        if (!signal.aborted && request_id === generation.current) dispatch({ type: 'quoted', quote })
      })
      .catch((error: unknown) => {
        if (!signal.aborted && request_id === generation.current) {
          console.error('Funding quote failed', error)
          dispatch({ type: 'error', error: message(error) })
        }
      })
      .finally(() => {
        pending.current = false
      })
  }

  const send = (): void => {
    if (!source || !source.is_transaction_idle() || !ready || pending.current || checkout_locked(state)) return
    const { signal } = lifetime.current!
    const quoted = state.quote
    const sui = sui_session(source)
    const crypto = crypto_session(source)
    if (!sui && (!quoted || quoted.deadline <= Date.now())) {
      dispatch({ type: 'error', error: 'funding_quote_expired' })
      return
    }
    if (read_app_state().session.wallet?.address !== recipient) return
    pending.current = true
    dispatch({ type: 'stage', stage: 'preparing', amount_text })
    let submitted = false
    const submitting = (): void => {
      if (
        signal.aborted ||
        read_app_state().external_wallet.session !== source ||
        read_app_state().session.wallet?.address !== recipient
      )
        throw new Error('funding_source_changed')
      if (quoted && quoted.deadline <= Date.now()) throw new Error('funding_quote_expired')
      submitted = true
      dispatch({ type: 'stage', stage: 'signing', amount_text })
    }
    const execute = async (): Promise<string> => {
      if (sui) return send_sui_source(sui, recipient, amount, submitting)
      if (!crypto || !quoted || quoted.deposit_memo) throw new Error('funding_route_unavailable')
      if ((await crypto.balance(quoted.source)) < quoted.amount_in) throw new Error('funding_source_balance')
      return crypto.send(
        { asset: quoted.source, recipient: quoted.deposit_address, amount: quoted.amount_in },
        submitting
      )
    }
    void execute()
      .then((transaction) => {
        if (signal.aborted) return
        dispatch({ type: 'submitted', transaction, at: Date.now() })
        if (sui) {
          dispatch({ type: 'observed', status: 'success' })
          dispatch_app({ type: 'wallet/refresh' })
        }
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          console.error('Funding payment failed', error)
          dispatch({ type: 'error', error: message(error), uncertain: submitted && !payment_rejected(error) })
        }
      })
      .finally(() => {
        pending.current = false
      })
  }

  useEffect(() => {
    if (!state.quote || !['pending', 'bridging', 'unknown'].includes(state.stage)) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const status = await funding_status(state.quote!, controller.signal)
        if (controller.signal.aborted) return
        dispatch({ type: 'observed', status })
        if (status === 'success' && read_app_state().session.wallet?.address === recipient)
          dispatch_app({ type: 'wallet/refresh' })
        if (['success', 'refunded', 'failed'].includes(status)) return
      } catch (error) {
        if (controller.signal.aborted) return
        console.warn('Funding status unavailable', error)
      }
      timer = setTimeout(() => void poll(), 5_000)
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [state.quote, state.stage, recipient])
  return {
    state,
    dispatch,
    quote,
    send,
    choices,
    assets_status,
    asset,
    amount,
    ready,
    sufficient,
    amount_text,
    locked: checkout_locked(state) || state.stage === 'quoting',
  }
}

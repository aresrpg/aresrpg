// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow, ItemRow, TradeCapRow, TradeRow } from '@aresrpg/protocol'
import type { AuthSession } from '@aresrpg/sdk/auth'

import { encumbered_asset_ids, stack_merge_target_row } from '../inventory_stacks.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'

export type TradeState = Readonly<{
  rows: readonly TradeRow[]
  active: string | null
  pending: string | null
}>

export type TradeInput =
  | Readonly<{ type: 'trade/create'; counterparty: string }>
  | Readonly<{ type: 'trade/open'; trade: string | null }>
  | Readonly<{ type: 'trade/deposit_item'; trade: string; item: ItemRow }>
  | Readonly<{ type: 'trade/deposit_character'; trade: string; character: CharacterRow }>
  | Readonly<{ type: 'trade/deposit_sui'; trade: string; amount: bigint }>
  | Readonly<{ type: 'trade/withdraw_sui'; trade: string; amount: bigint }>
  | Readonly<{ type: 'trade/withdraw_cap'; trade: string; cap: TradeCapRow }>
  | Readonly<{ type: 'trade/accept'; trade: string }>
  | Readonly<{ type: 'trade/claim_sui'; trade: string }>
  | Readonly<{ type: 'trade/claim_cap'; trade: string; cap: TradeCapRow }>
  | Readonly<{ type: 'trade/destroy'; trade: string }>
  | Readonly<{ type: 'trade/pending'; operation: string | null }>
  | Readonly<{ type: 'trade/created'; trade: TradeRow }>

export const initial_trade_state = (): TradeState =>
  Object.freeze({ rows: Object.freeze([]), active: null, pending: null })

const upsert = (rows: readonly TradeRow[], trade: Readonly<TradeRow>): readonly TradeRow[] =>
  Object.freeze([...rows.filter(({ id }) => id !== trade.id), trade])

const reduce = (state: AppState, input: AppInput): AppState => {
  if (
    input.type === 'auth/disconnected' ||
    input.type === 'auth/rejected' ||
    (input.type === 'auth/connected' && state.session.wallet === input.session)
  )
    return Object.freeze({ ...state, trade: initial_trade_state() })
  if (input.type === 'server/packet' && input.packet.type === 'packet/trades') {
    const active =
      state.trade.active && input.packet.trades.some(({ id }) => id === state.trade.active) ? state.trade.active : null
    return Object.freeze({
      ...state,
      trade: Object.freeze({ ...state.trade, rows: input.packet.trades, active }),
    })
  }
  if (input.type === 'trade/open')
    return Object.freeze({ ...state, trade: Object.freeze({ ...state.trade, active: input.trade }) })
  if (input.type === 'trade/pending')
    return Object.freeze({ ...state, trade: Object.freeze({ ...state.trade, pending: input.operation }) })
  if (input.type === 'trade/created' && !state.trade.rows.some(({ id }) => id === input.trade.id))
    return Object.freeze({
      ...state,
      trade: Object.freeze({ ...state.trade, rows: upsert(state.trade.rows, input.trade) }),
    })
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch }) => {
  const run = <T extends Readonly<{ digest: string }>>(
    operation: string,
    wallet: AuthSession,
    action: () => Promise<T>,
    complete?: (result: T) => void
  ): void => {
    if (get_state().trade.pending) return
    dispatch({ type: 'trade/pending', operation })
    void action()
      .then((result) => {
        if (get_state().session.wallet === wallet) complete?.(result)
      })
      .catch((error) => {
        if (get_state().session.wallet === wallet) toast.add(error)
      })
      .finally(() => {
        const state = get_state()
        if (state.session.wallet === wallet && state.trade.pending === operation)
          dispatch({ type: 'trade/pending', operation: null })
      })
  }
  const with_trade = (
    trade_id: string,
    operation: string,
    action: (wallet: AuthSession, row: Readonly<TradeRow>) => Promise<Readonly<{ digest: string }>>
  ) => {
    const state = get_state()
    const row = state.trade.rows.find(({ id }) => id === trade_id)
    const { wallet } = state.session
    if (row && wallet) run(`${operation}:${trade_id}`, wallet, () => action(wallet, row))
  }
  events.on('trade/create', ({ counterparty }) => {
    const { wallet } = get_state().session
    if (!wallet || wallet.address === counterparty) return
    run(
      'create',
      wallet,
      () => wallet.create_trade(counterparty),
      ({ trade }) => {
        dispatch({ type: 'trade/created', trade })
        dispatch({ type: 'trade/open', trade: trade.id })
      }
    )
  })
  events.on('trade/deposit_item', ({ trade, item }) =>
    with_trade(trade, 'deposit_item', (wallet, row) => wallet.trade(row).deposit_item(item))
  )
  events.on('trade/deposit_character', ({ trade, character }) =>
    with_trade(trade, 'deposit_character', (wallet, row) => wallet.trade(row).deposit_character(character))
  )
  events.on('trade/deposit_sui', ({ trade, amount }) =>
    with_trade(trade, 'deposit_sui', (wallet, row) => wallet.trade(row).deposit_sui(amount))
  )
  events.on('trade/withdraw_sui', ({ trade, amount }) =>
    with_trade(trade, 'withdraw_sui', (wallet, row) => wallet.trade(row).withdraw_sui(amount))
  )
  events.on('trade/withdraw_cap', ({ trade, cap }) =>
    with_trade(trade, 'withdraw_cap', (wallet, row) => wallet.trade(row).withdraw_cap(cap))
  )
  events.on('trade/accept', ({ trade }) => with_trade(trade, 'accept', (wallet, row) => wallet.trade(row).accept()))
  events.on('trade/claim_sui', ({ trade }) =>
    with_trade(trade, 'claim_sui', (wallet, row) => wallet.trade(row).claim_sui())
  )
  events.on('trade/claim_cap', ({ trade, cap }) =>
    with_trade(trade, 'claim_cap', (wallet, row) => {
      const state = get_state()
      const existing = cap.item_type
        ? stack_merge_target_row(
            state.session.inventory,
            encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows),
            cap.item_type
          )
        : null
      return wallet.trade(row).claim_cap(cap, existing ? { id: existing.id, kiosk: existing.kiosk } : null)
    })
  )
  events.on('trade/destroy', ({ trade }) => with_trade(trade, 'destroy', (wallet, row) => wallet.trade(row).destroy()))
}

export default Object.freeze({ name: 'trade', reduce, observe }) satisfies AppModule

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ItemRow, TradeCapRow, TradeRow } from '@aresrpg/protocol'
import type { AuthSession } from '@aresrpg/sdk/auth'
import {
  trade_incoming,
  trade_is_drained,
  trade_own_offer,
  trade_offer_post_removal_amounts,
  type TradeOfferAddition,
  type TradeOfferRemoval,
  type TradeTerminalDelta,
} from '@aresrpg/sdk/trade'

import { encumbered_asset_ids, trade_stack_targets } from '../inventory_stacks.ts'
import { copy_text } from '../i18n/copy.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'

type AwaitingRows = Readonly<Record<string, TradeRow>>

const merge_target_available = (
  inventory: ReadonlyMap<string, Readonly<ItemRow>>,
  encumbered: ReadonlySet<string>,
  removal: Readonly<TradeOfferRemoval>
): boolean => {
  if (!removal.target) return true
  const current = inventory.get(removal.target.id)
  if (!current) return false
  return [
    !encumbered.has(removal.target.id),
    current.kiosk === removal.cap.kiosk,
    current.item_type === removal.cap.item_type,
    current.amount === removal.target.amount,
  ].every(Boolean)
}

const addition_available = (
  inventory: ReadonlyMap<string, Readonly<ItemRow>>,
  encumbered: ReadonlySet<string>,
  returned: ReadonlyMap<string, Readonly<TradeCapRow>>,
  post_removal_amounts: ReadonlyMap<string, number>,
  { item, amount }: Readonly<TradeOfferAddition>
): boolean => {
  const current = inventory.get(item.id) ?? returned.get(item.id)
  if (!current) return false
  const available_amount = post_removal_amounts.get(item.id) ?? current.amount
  return [
    !encumbered.has(item.id) || returned.has(item.id),
    current.kiosk === item.kiosk,
    current.item_type === item.item_type,
    post_removal_amounts.has(item.id) || current.amount === item.amount,
    amount >= 1,
    amount <= available_amount,
  ].every(Boolean)
}

export const trade_offer_additions_available = (
  state: Readonly<AppState>,
  additions: readonly TradeOfferAddition[],
  removals: readonly TradeOfferRemoval[] = []
): boolean => {
  const inventory = new Map(state.session.inventory.map((item) => [item.id, item]))
  const encumbered = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
  const returned = new Map(removals.map(({ cap }) => [cap.object, cap]))
  const post_removal_amounts = trade_offer_post_removal_amounts(removals)
  return (
    removals.every((removal) => merge_target_available(inventory, encumbered, removal)) &&
    additions.every((addition) => addition_available(inventory, encumbered, returned, post_removal_amounts, addition))
  )
}

export type TradeState = Readonly<{
  loaded: boolean
  rows: readonly TradeRow[]
  active: string | null
  pending: string | null
  settlement_armed: Readonly<Record<string, number>>
  awaiting_projection: AwaitingRows
  tombstones: Readonly<Record<string, true>>
}>

export type TradeInput =
  | Readonly<{ type: 'trade/create'; counterparty: string }>
  | Readonly<{ type: 'trade/join'; trade: string }>
  | Readonly<{ type: 'trade/cancel_request'; trade: string }>
  | Readonly<{ type: 'trade/decline_request'; trade: string }>
  | Readonly<{ type: 'trade/open'; trade: string | null }>
  | Readonly<{ type: 'trade/deposit_item'; trade: string; item: ItemRow }>
  | Readonly<{ type: 'trade/set_sui'; trade: string; amount: bigint }>
  | Readonly<{ type: 'trade/withdraw_cap'; trade: string; cap: TradeCapRow }>
  | Readonly<{
      type: 'trade/commit_offer'
      trade: string
      additions: readonly TradeOfferAddition[]
      removals: readonly TradeOfferRemoval[]
      sui: bigint
    }>
  | Readonly<{ type: 'trade/accept'; trade: string }>
  | Readonly<{ type: 'trade/cancel'; trade: string }>
  | Readonly<{ type: 'trade/settle'; trade: string }>
  | Readonly<{ type: 'trade/recover'; trade: string }>
  | Readonly<{ type: 'trade/pending'; operation: string | null }>
  | Readonly<{ type: 'trade/settlement_armed'; trade: string; revision: number | null }>
  | Readonly<{ type: 'trade/projected'; trade: TradeRow }>
  | Readonly<{ type: 'trade/terminal_delta'; delta: TradeTerminalDelta }>
  | Readonly<{ type: 'trade/closed'; trade: string }>

export const initial_trade_state = (): TradeState =>
  Object.freeze({
    loaded: false,
    rows: Object.freeze([]),
    active: null,
    pending: null,
    settlement_armed: Object.freeze({}),
    awaiting_projection: Object.freeze({}),
    tombstones: Object.freeze({}),
  })

const without_key = <T>(rows: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> =>
  Object.freeze(Object.fromEntries(Object.entries(rows).filter(([id]) => id !== key)))

const upsert = (rows: readonly TradeRow[], trade: Readonly<TradeRow>): readonly TradeRow[] =>
  Object.freeze([...rows.filter(({ id }) => id !== trade.id), trade])

const cap_intersection = (left: readonly TradeCapRow[], right: readonly TradeCapRow[]): readonly TradeCapRow[] => {
  const right_ids = new Set(right.map(({ object }) => object))
  return Object.freeze(left.filter(({ object }) => right_ids.has(object)))
}

const min_sui = (left: string, right: string): string => {
  const a = BigInt(left)
  const b = BigInt(right)
  return (a < b ? a : b).toString()
}

const terminal_phase = (trade: Readonly<TradeRow>): boolean => trade.phase === 'settling' || trade.phase === 'cancelled'

export const reconcile_trade_row = (current: Readonly<TradeRow>, incoming: Readonly<TradeRow>): TradeRow => {
  if (incoming.offer_revision > current.offer_revision) return incoming
  if (incoming.offer_revision < current.offer_revision) return current
  if (current.phase !== incoming.phase) return incoming
  if (terminal_phase(current))
    return Object.freeze({
      ...incoming,
      caps_a: cap_intersection(current.caps_a, incoming.caps_a),
      caps_b: cap_intersection(current.caps_b, incoming.caps_b),
      sui_a: min_sui(current.sui_a, incoming.sui_a),
      sui_b: min_sui(current.sui_b, incoming.sui_b),
    })
  return Object.freeze({
    ...incoming,
    accept_a: current.accept_a || incoming.accept_a,
    accept_b: current.accept_b || incoming.accept_b,
  })
}

const same_offer = (packet: Readonly<TradeRow>, projected: Readonly<TradeRow>): boolean =>
  packet.sui_a === projected.sui_a &&
  packet.sui_b === projected.sui_b &&
  packet.caps_a.length === projected.caps_a.length &&
  packet.caps_b.length === projected.caps_b.length

const terminal_covers = (packet: Readonly<TradeRow>, projected: Readonly<TradeRow>): boolean => {
  const projected_a = new Set(projected.caps_a.map(({ object }) => object))
  const projected_b = new Set(projected.caps_b.map(({ object }) => object))
  return (
    packet.caps_a.every(({ object }) => projected_a.has(object)) &&
    packet.caps_b.every(({ object }) => projected_b.has(object)) &&
    BigInt(packet.sui_a) <= BigInt(projected.sui_a) &&
    BigInt(packet.sui_b) <= BigInt(projected.sui_b)
  )
}

const packet_covers_projection = (packet: Readonly<TradeRow>, projected: Readonly<TradeRow>): boolean => {
  if (packet.offer_revision > projected.offer_revision) return true
  if (packet.offer_revision < projected.offer_revision) return false
  if (packet.phase !== projected.phase) return false
  return terminal_phase(projected) ? terminal_covers(packet, projected) : same_offer(packet, projected)
}

const apply_terminal_delta = (trade: Readonly<TradeRow>, delta: Readonly<TradeTerminalDelta>): TradeRow => {
  const removed = new Set(delta.remove_caps)
  return Object.freeze({
    ...trade,
    phase: delta.phase,
    offer_revision: delta.offer_revision,
    accept_a: false,
    accept_b: false,
    caps_a: Object.freeze(trade.caps_a.filter(({ object }) => !removed.has(object))),
    caps_b: Object.freeze(trade.caps_b.filter(({ object }) => !removed.has(object))),
    sui_a: delta.clear_sui === 'a' ? '0' : trade.sui_a,
    sui_b: delta.clear_sui === 'b' ? '0' : trade.sui_b,
  })
}

export const trade_row_visible = (trade: Readonly<TradeRow>): boolean =>
  !terminal_phase(trade) || !trade_is_drained(trade)

export const visible_trade_rows = (rows: readonly TradeRow[]): readonly TradeRow[] => rows.filter(trade_row_visible)

export const trade_request_rows = (rows: readonly TradeRow[], address: string): readonly TradeRow[] =>
  rows.filter((trade) => trade.phase === 'requested' && (trade.a === address || trade.b === address))

const own_acceptance = (trade: Readonly<TradeRow>, address: string): boolean =>
  trade[trade.a.toLowerCase() === address.toLowerCase() ? 'accept_a' : 'accept_b']

const accept_projection_arrived = (pending: string | null, rows: readonly TradeRow[], address?: string): boolean => {
  if (!pending?.startsWith('accept:') || !address) return false
  const id = pending.slice('accept:'.length)
  const row = rows.find((trade) => trade.id === id)
  return !!row && (row.phase !== 'negotiating' || own_acceptance(row, address))
}

const offer_projection_arrived = (pending: string | null, rows: readonly TradeRow[]): boolean => {
  if (!pending?.startsWith('offer:')) return false
  const [, id, revision] = pending.split(':')
  const row = rows.find((trade) => trade.id === id)
  return !!row && row.offer_revision >= Number(revision)
}

const packet_rows_merged = (state: Readonly<TradeState>, packet_rows: readonly TradeRow[]): readonly TradeRow[] => {
  const current_by_id = new Map(state.rows.map((row) => [row.id, row]))
  const merged = Object.freeze(
    packet_rows
      .filter(({ id }) => !state.tombstones[id])
      .map((row) => {
        const current = current_by_id.get(row.id)
        return current ? reconcile_trade_row(current, row) : row
      })
  )
  const packet_ids = new Set(packet_rows.map(({ id }) => id))
  const projected_requests = state.rows.filter(
    ({ id, phase }) =>
      phase === 'requested' && !!state.awaiting_projection[id] && !packet_ids.has(id) && !state.tombstones[id]
  )
  return Object.freeze([...merged, ...projected_requests])
}

const awaiting_after_packet = (
  state: Readonly<TradeState>,
  packet_by_id: ReadonlyMap<string, TradeRow>
): AwaitingRows =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(state.awaiting_projection).filter(([id, projected]) => {
        const packet = packet_by_id.get(id)
        return packet ? !packet_covers_projection(packet, projected) : projected.phase === 'requested'
      })
    )
  )

const armed_after_rows = (
  armed: Readonly<Record<string, number>>,
  rows: readonly TradeRow[]
): Readonly<Record<string, number>> =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(armed).filter(([id, revision]) => {
        const row = rows.find((trade) => trade.id === id)
        if (row?.phase === 'negotiating') return row.offer_revision === revision
        return row?.phase === 'settling' && row.offer_revision === revision + 1
      })
    )
  )

const packet_trade_state = (state: Readonly<AppState>, packet_rows: readonly TradeRow[]): TradeState => {
  const packet_by_id = new Map(packet_rows.map((row) => [row.id, row]))
  const current_by_id = new Map(state.trade.rows.map((row) => [row.id, row]))
  const rows = packet_rows_merged(state.trade, packet_rows)
  const awaiting_projection = awaiting_after_packet(state.trade, packet_by_id)
  const active_row = rows.find(({ id }) => id === state.trade.active)
  const newly_joined = rows.find((row) => {
    const before = current_by_id.get(row.id)
    return before?.phase === 'requested' && row.phase === 'negotiating'
  })
  const active = active_row && trade_row_visible(active_row) ? active_row.id : (newly_joined?.id ?? null)
  const pending =
    accept_projection_arrived(state.trade.pending, rows, state.session.wallet?.address) ||
    offer_projection_arrived(state.trade.pending, rows)
      ? null
      : state.trade.pending
  const settlement_armed = armed_after_rows(state.trade.settlement_armed, rows)
  return Object.freeze({
    ...state.trade,
    loaded: true,
    rows,
    active,
    pending,
    awaiting_projection,
    settlement_armed,
  })
}

const projected_trade_state = (state: Readonly<TradeState>, projected: Readonly<TradeRow>): TradeState => {
  const current = state.rows.find(({ id }) => id === projected.id)
  const trade = current ? reconcile_trade_row(current, projected) : projected
  return Object.freeze({
    ...state,
    rows: upsert(state.rows, trade),
    active: current?.phase === 'requested' && trade.phase === 'negotiating' ? trade.id : state.active,
    settlement_armed:
      state.settlement_armed[trade.id] === trade.offer_revision
        ? state.settlement_armed
        : without_key(state.settlement_armed, trade.id),
    awaiting_projection: Object.freeze({ ...state.awaiting_projection, [trade.id]: trade }),
  })
}

const terminal_trade_state = (state: Readonly<TradeState>, delta: Readonly<TradeTerminalDelta>): TradeState => {
  if (delta.closed) return closed_trade_state(state, delta.trade)
  const current = state.rows.find(({ id }) => id === delta.trade)
  if (!current) return state
  const trade = apply_terminal_delta(current, delta)
  return Object.freeze({
    ...state,
    active: state.active === trade.id ? null : state.active,
    rows: upsert(state.rows, trade),
    settlement_armed: without_key(state.settlement_armed, trade.id),
    awaiting_projection: Object.freeze({ ...state.awaiting_projection, [trade.id]: trade }),
  })
}

const closed_trade_state = (state: Readonly<TradeState>, id: string): TradeState =>
  Object.freeze({
    ...state,
    active: state.active === id ? null : state.active,
    rows: Object.freeze(state.rows.filter((trade) => trade.id !== id)),
    settlement_armed: without_key(state.settlement_armed, id),
    awaiting_projection: without_key(state.awaiting_projection, id),
    tombstones: Object.freeze({ ...state.tombstones, [id]: true }),
  })

const local_trade_state = (state: Readonly<TradeState>, input: Readonly<AppInput>): TradeState => {
  switch (input.type) {
    case 'trade/open':
      return Object.freeze({ ...state, active: input.trade })
    case 'trade/pending':
      return Object.freeze({ ...state, pending: input.operation })
    case 'trade/settlement_armed':
      return Object.freeze({
        ...state,
        settlement_armed:
          input.revision === null
            ? without_key(state.settlement_armed, input.trade)
            : Object.freeze({ ...state.settlement_armed, [input.trade]: input.revision }),
      })
    case 'trade/projected':
      return projected_trade_state(state, input.trade)
    case 'trade/terminal_delta':
      return terminal_trade_state(state, input.delta)
    case 'trade/closed':
      return closed_trade_state(state, input.trade)
    default:
      return state
  }
}

const reset_trade = (state: Readonly<AppState>, input: Readonly<AppInput>): boolean => {
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected') return true
  return input.type === 'auth/connected' && state.session.wallet === input.session
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (reset_trade(state, input)) return Object.freeze({ ...state, trade: initial_trade_state() })
  if (input.type === 'server/packet' && input.packet.type === 'packet/trades')
    return Object.freeze({
      ...state,
      trade: packet_trade_state(state, input.packet.trades),
    })
  if (input.type === 'server/packet' && input.packet.type === 'packet/trade_destroyed')
    return Object.freeze({ ...state, trade: closed_trade_state(state.trade, input.packet.trade) })
  const trade = local_trade_state(state.trade, input)
  return trade === state.trade ? state : Object.freeze({ ...state, trade })
}

export const trade_settlement_transition = (
  state: Readonly<AppState>,
  previous: Readonly<AppState>
): TradeRow | null => {
  const changed = state.trade.rows.find((row) => {
    const before = previous.trade.rows.find(({ id }) => id === row.id)
    return before?.phase === 'negotiating' && row.phase === 'settling'
  })
  if (!changed) return null
  const armed = state.trade.settlement_armed[changed.id]
  return armed !== undefined && armed + 1 === changed.offer_revision ? changed : null
}

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch, signal }) => {
  const running = new Map<string, symbol>()
  let auth_epoch = 0
  const reset_session = (): void => {
    auth_epoch += 1
    running.clear()
  }
  events.on('auth/connected', reset_session)
  events.on('auth/disconnected', reset_session)
  events.on('auth/rejected', reset_session)
  signal.addEventListener('abort', reset_session, { once: true })
  const run = <T>(
    operation: string,
    wallet: AuthSession,
    action: () => Promise<T>,
    complete: (result: T) => void,
    failed?: () => void,
    hold_success = false,
    after_success?: () => void
  ): void => {
    if (get_state().trade.pending || running.size > 0) return
    const epoch = auth_epoch
    const token = Symbol(operation)
    running.set(operation, token)
    dispatch({ type: 'trade/pending', operation })
    let succeeded = false
    const is_current = (): boolean => auth_epoch === epoch && get_state().session.wallet === wallet
    const finish = (): void => {
      if (running.get(operation) === token) running.delete(operation)
      if (!is_current()) return
      const state = get_state()
      if (!(succeeded && hold_success) && state.trade.pending === operation)
        dispatch({ type: 'trade/pending', operation: null })
      if (succeeded) after_success?.()
    }
    void Promise.resolve()
      .then(action)
      .then((result) => {
        succeeded = true
        if (is_current()) complete(result)
      })
      .catch((error) => {
        if (is_current()) {
          failed?.()
          toast.add(error)
        }
      })
      .finally(finish)
  }
  const row_action = <T>(
    trade_id: string,
    operation: string,
    action: (wallet: AuthSession, row: Readonly<TradeRow>) => Promise<T>,
    complete: (result: T) => void,
    failed?: () => void,
    hold_success = false,
    after_success?: () => void
  ): void => {
    const state = get_state()
    const row = state.trade.rows.find(({ id }) => id === trade_id)
    const { wallet } = state.session
    if (row && wallet)
      run(`${operation}:${trade_id}`, wallet, () => action(wallet, row), complete, failed, hold_success, after_success)
  }
  const project = (result: Readonly<{ trade: TradeRow }>): void =>
    dispatch({ type: 'trade/projected', trade: result.trade })
  const close = (result: Readonly<{ trade: string }>): void => dispatch({ type: 'trade/closed', trade: result.trade })
  const terminal = (result: Readonly<{ delta: TradeTerminalDelta }>): void =>
    dispatch({ type: 'trade/terminal_delta', delta: result.delta })

  events.on('trade/create', ({ counterparty }) => {
    const state = get_state()
    const { wallet } = state.session
    if (
      !wallet ||
      !state.trade.loaded ||
      wallet.address === counterparty ||
      state.trade.rows.some((row) => row.phase === 'requested' && row.a === wallet.address)
    )
      return
    const cleanup = state.trade.rows
      .filter((row) => row.a === wallet.address && terminal_phase(row) && trade_is_drained(row))
      .map(({ id }) => id)
    run(
      'create',
      wallet,
      () => wallet.create_trade(counterparty, cleanup),
      (result) => {
        project(result)
        const copy = get_state().copy?.trade_panel.invite_sent
        toast.add(typeof copy === 'string' ? copy : 'Trade invitation sent', 'success')
      }
    )
  })
  events.on('trade/join', ({ trade }) => row_action(trade, 'join', (wallet, row) => wallet.trade(row).join(), project))
  events.on('trade/cancel_request', ({ trade }) =>
    row_action(trade, 'cancel_request', (wallet, row) => wallet.trade(row).cancel_request(), close)
  )
  events.on('trade/decline_request', ({ trade }) =>
    row_action(trade, 'decline_request', (wallet, row) => wallet.trade(row).decline_request(), close)
  )
  events.on('trade/deposit_item', ({ trade, item }) =>
    row_action(trade, 'deposit_item', (wallet, row) => wallet.trade(row).deposit_item(item), project)
  )
  events.on('trade/set_sui', ({ trade, amount }) =>
    row_action(trade, 'set_sui', (wallet, row) => wallet.trade(row).set_sui(amount), project)
  )
  events.on('trade/withdraw_cap', ({ trade, cap }) =>
    row_action(trade, 'withdraw_cap', (wallet, row) => wallet.trade(row).withdraw_cap(cap), project)
  )
  events.on('trade/commit_offer', ({ trade, additions, removals, sui }) => {
    const state = get_state()
    if (!trade_offer_additions_available(state, additions, removals)) {
      toast.add(copy_text(state.copy?.trade_panel ?? {})('offer_item_unavailable'))
      return
    }
    row_action(
      trade,
      'commit_offer',
      (wallet, row) => wallet.trade(row).commit_offer({ additions, removals, sui }),
      ({ offer_revision }) => {
        const current = get_state().trade.rows.find(({ id }) => id === trade)
        dispatch({
          type: 'trade/pending',
          operation: current && current.offer_revision >= offer_revision ? null : `offer:${trade}:${offer_revision}`,
        })
      },
      undefined,
      true
    )
  })
  events.on('trade/accept', ({ trade }) => {
    const state = get_state()
    const row = state.trade.rows.find(({ id }) => id === trade)
    const { wallet } = state.session
    if (!row || !wallet || state.trade.pending || row.phase !== 'negotiating') return
    dispatch({ type: 'trade/settlement_armed', trade, revision: row.offer_revision })
    run(
      `accept:${trade}`,
      wallet,
      () => wallet.trade(row).accept(),
      () => undefined,
      () => dispatch({ type: 'trade/settlement_armed', trade, revision: null }),
      true,
      () => {
        const current = get_state().trade.rows.find(({ id }) => id === trade)
        const armed = get_state().trade.settlement_armed[trade]
        if (current?.phase === 'settling' && armed !== undefined && armed + 1 === current.offer_revision)
          dispatch({ type: 'trade/settle', trade })
      }
    )
  })

  const targets_for = (state: Readonly<AppState>, row: Readonly<TradeRow>, address: string) => {
    const incoming = trade_incoming(row, address)
    const encumbered = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
    return trade_stack_targets(state.session.inventory, encumbered, incoming.caps)
  }
  const settle = (trade_id: string): void => {
    const state = get_state()
    const row = state.trade.rows.find(({ id }) => id === trade_id)
    const { wallet } = state.session
    if (!row || !wallet || state.trade.pending || running.size > 0 || row.phase !== 'settling') return
    const incoming = trade_incoming(row, wallet.address)
    dispatch({ type: 'trade/settlement_armed', trade: trade_id, revision: null })
    if (incoming.caps.length === 0 && incoming.sui === 0n) {
      dispatch({ type: 'trade/open', trade: null })
      return
    }
    run(
      `settle:${trade_id}`,
      wallet,
      () => wallet.trade(row).settle_all(targets_for(state, row, wallet.address)),
      terminal,
      () => dispatch({ type: 'trade/settlement_armed', trade: trade_id, revision: null })
    )
  }
  events.on('trade/settle', ({ trade }) => settle(trade))
  events.on('trade/cancel', ({ trade }) =>
    row_action(trade, 'cancel', (wallet, row) => wallet.trade(row).cancel_and_recover(), terminal)
  )
  events.on('trade/recover', ({ trade }) =>
    row_action(trade, 'recover', (wallet, row) => wallet.trade(row).recover_all(), terminal)
  )
  events.on('STATE_UPDATED', (state, previous) => {
    const row = trade_settlement_transition(state, previous)
    if (row) settle(row.id)
  })
}

export default Object.freeze({ name: 'trade', reduce, observe }) satisfies AppModule

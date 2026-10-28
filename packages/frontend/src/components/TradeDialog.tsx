// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_is_stackable } from '@aresrpg/immutable'
import type { ItemRow, TradeCapRow, TradeRow } from '@aresrpg/protocol'
import { trade_incoming, trade_own_offer, trade_offer_has_value } from '@aresrpg/sdk/trade'
import { Check, Handshake } from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'
import { Button, NativeModal, GameWindow } from '@aresrpg/ui'

import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { encumbered_asset_ids, trade_stack_targets } from '../inventory_stacks.ts'
import { visible_trade_rows } from '../modules/trade.ts'
import { parse_amount } from '../kares/model.ts'

import { useTradeData, useTradeDispatch } from './TradeSource.tsx'
import { TradeInventory } from './TradeInventory.tsx'
import { KaresLogo } from './KaresLogo.tsx'
import { SuiLogo } from './SuiLogo.tsx'
import { OfferCaps } from './TradeOfferCaps.tsx'
import {
  input_sui,
  stage_trade_offer_addition,
  trade_display_name,
  trade_offer_draft_key,
  trade_draft_inventory,
  trade_side_status,
  type TradeDraftAddition,
} from './trade_view.ts'

const CURRENCIES = ['sui', 'kares'] as const
type TradeCurrency = (typeof CURRENCIES)[number]
type CurrencyDraft = Readonly<Record<TradeCurrency, string>>
type CurrencyInput = Readonly<{ value: string; disabled: boolean; change: (value: string) => void; commit: () => void }>

/** The own side edits each currency in place; the other side shows only currencies it actually offers. */
const OfferCurrency = ({
  currency,
  amount,
  input,
  text,
}: Readonly<{ currency: TradeCurrency; amount: bigint; input?: CurrencyInput; text: CopyText }>) => {
  if (!input && amount === 0n) return null
  const mark = currency === 'sui' ? <SuiLogo size={14} /> : <KaresLogo size={14} />
  const ticker = <small>{currency.toUpperCase()}</small>
  return input ? (
    <label className="trade-currency" data-currency={currency}>
      {mark}
      <input
        aria-label={text(currency)}
        disabled={input.disabled}
        inputMode="decimal"
        onBlur={input.commit}
        onChange={(event) => input.change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        value={input.value}
      />
      {ticker}
    </label>
  ) : (
    <span className="trade-currency is-static" data-currency={currency}>
      {mark}
      <b>{input_sui(amount)}</b>
      {ticker}
    </span>
  )
}

const OfferPanel = ({
  trade,
  side,
  own,
  label,
  status,
  pending,
  caps,
  currencies,
  add_asset,
  remove_cap,
  copy,
  text,
}: Readonly<{
  trade: TradeRow
  side: 'a' | 'b'
  own: boolean
  label: string
  status: string
  pending: boolean
  caps?: readonly TradeCapRow[]
  currencies?: Readonly<Record<TradeCurrency, CurrencyInput>>
  add_asset?: (id: string) => void
  remove_cap?: (cap: Readonly<TradeCapRow>) => void
  copy: AppCopy
  text: CopyText
}>) => {
  const droppable = !!add_asset && trade.phase === 'negotiating' && !pending
  const drop = (event: Readonly<DragEvent>): void => {
    if (!droppable) return
    event.preventDefault()
    add_asset(event.dataTransfer.getData('text/plain'))
  }
  return (
    <section
      className="trade-offer"
      data-own={own || undefined}
      data-status={status}
      onDragOver={(event) => droppable && event.preventDefault()}
      onDrop={drop}
    >
      <header>
        <b>{label}</b>
        <span className="trade-status">{text(status)}</span>
        {CURRENCIES.map((currency) => (
          <OfferCurrency
            amount={BigInt(trade[`${currency}_${side}`])}
            currency={currency}
            input={currencies?.[currency]}
            key={currency}
            text={text}
          />
        ))}
      </header>
      <OfferCaps
        caps={caps ?? trade[`caps_${side}`]}
        copy={copy}
        own={own}
        pending={pending}
        remove_cap={remove_cap}
        text={text}
        trade={trade}
      />
    </section>
  )
}

const TerminalFooter = ({
  trade,
  address,
  pending,
  text,
}: Readonly<{ trade: TradeRow; address: string; pending: boolean; text: CopyText }>) => {
  const dispatch_app = useTradeDispatch()
  const offer = trade.phase === 'settling' ? trade_incoming(trade, address) : trade_own_offer(trade, address)
  const actionable = trade_offer_has_value(offer)
  const operation = trade.phase === 'settling' ? ('settle' as const) : ('recover' as const)
  return (
    <footer>
      <p>{text(actionable ? `${operation}_notice` : 'waiting_counterparty')}</p>
      {actionable && (
        <Button
          busy={pending}
          onClick={() => dispatch_app({ type: `trade/${operation}`, trade: trade.id })}
          tone="primary"
        >
          {text(pending ? 'finalizing' : operation)}
        </Button>
      )}
    </footer>
  )
}

const NegotiatingFooter = ({
  trade,
  accepted,
  counterparty,
  pending,
  dirty,
  discard,
  confirm,
  text,
}: Readonly<{
  trade: TradeRow
  accepted: boolean
  counterparty: string
  pending: boolean
  dirty: boolean
  discard: () => void
  confirm: () => void
  text: CopyText
}>) => {
  const dispatch_app = useTradeDispatch()
  const notice = dirty ? text('confirm_resets') : accepted ? text('waiting_for', { name: counterparty }) : ''
  return (
    <footer>
      <button
        className="trade-quiet is-danger"
        disabled={pending}
        onClick={() => dispatch_app({ type: 'trade/cancel', trade: trade.id })}
        type="button"
      >
        {text('cancel')}
      </button>
      <p>{notice}</p>
      {dirty ? (
        <>
          <button className="trade-quiet" disabled={pending} onClick={discard} type="button">
            {text('discard_changes')}
          </button>
          <Button busy={pending} onClick={confirm} tone="primary">
            {text('confirm_changes')}
          </Button>
        </>
      ) : (
        <Button
          busy={pending}
          disabled={accepted}
          onClick={() => dispatch_app({ type: 'trade/accept', trade: trade.id })}
          tone="primary"
        >
          {accepted && <Check size={14} />}
          {text(accepted ? 'accepted' : 'accept')}
        </Button>
      )}
    </footer>
  )
}

const draft_cap = ({ item, amount }: Readonly<{ item: Readonly<ItemRow>; amount: number }>): TradeCapRow =>
  Object.freeze({
    object: item.id,
    name: item.name,
    level: item.level,
    amount,
    item_type: item.item_type,
    category: item.category,
    kiosk: item.kiosk,
  })

export const TradeDialog = ({
  copy,
  active,
  address,
}: Readonly<{ copy: AppCopy; active: TradeRow; address: string }>) => {
  const text = copy_text(copy.trade_panel)
  const category_text = copy_text(copy.characters_page)
  const { rows, pending_operation, inventory, balance, listings, own_name, players } = useTradeData()
  const dispatch_app = useTradeDispatch()
  const center_rows = visible_trade_rows(rows).filter(({ phase }) => phase !== 'requested')
  const own_side = active.a === address ? ('a' as const) : ('b' as const)
  const other_side = own_side === 'a' ? ('b' as const) : ('a' as const)
  const own_caps = active[`caps_${own_side}`]
  const own_amounts = { sui: BigInt(active[`sui_${own_side}`]), kares: BigInt(active[`kares_${own_side}`]) }
  const own_offer_key = trade_offer_draft_key(active, own_side)
  const pending = !!pending_operation
  const negotiating = active.phase === 'negotiating'
  const [currencies, set_currencies] = useState<CurrencyDraft>({ sui: '0', kares: '0' })
  const set_currency = (asset: TradeCurrency, value: string): void =>
    set_currencies((current) => ({ ...current, [asset]: value }))
  const [kept_caps, set_kept_caps] = useState<readonly TradeCapRow[]>(own_caps)
  const [additions, set_additions] = useState<readonly TradeDraftAddition[]>([])
  const [picking, set_picking] = useState<Readonly<ItemRow> | null>(null)
  const display_name = (player_address: string): string =>
    trade_display_name(player_address, address, own_name, players)
  const counterparty = display_name(active[other_side])

  useEffect(() => {
    set_currencies({ sui: input_sui(own_amounts.sui), kares: input_sui(own_amounts.kares) })
    set_kept_caps(own_caps)
    set_additions([])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- own_offer_key alone encodes this side's canonical offer; counterparty rows must preserve the local draft.
  }, [own_offer_key])

  const encumbered = encumbered_asset_ids(listings, rows)
  const kept_ids = new Set(kept_caps.map(({ object }) => object))
  const removal_caps = own_caps.filter(({ object }) => !kept_ids.has(object))
  const addition_ids = new Set(additions.map(({ item }) => item.id))
  const merge_candidates = removal_caps.filter(({ object }) => !addition_ids.has(object))
  const target_ids = Object.fromEntries(
    merge_candidates.flatMap((cap) => {
      const addition = additions.find(({ item }) => item.item_type === cap.item_type && item.kiosk === cap.kiosk)
      return addition ? [[cap.object, addition.item.id] as const] : []
    })
  )
  const removal_targets = trade_stack_targets(inventory, encumbered, merge_candidates, {
    same_kiosk: true,
    target_ids,
  })
  const removals = removal_caps.map((cap) => Object.freeze({ cap, target: removal_targets[cap.object] }))
  const available_items = trade_draft_inventory(inventory, encumbered, additions, removals)
  const can_edit = negotiating && !pending
  const displayed_caps = Object.freeze([...kept_caps, ...additions.map(draft_cap)])
  const parse_currency = (asset: TradeCurrency): bigint | null =>
    currencies[asset].trim() === '0' ? 0n : parse_amount(currencies[asset])
  const parsed_sui = parse_currency('sui')
  const parsed_kares = parse_currency('kares')
  const dirty = [
    additions.length > 0,
    kept_caps.length !== own_caps.length,
    parsed_sui !== own_amounts.sui,
    parsed_kares !== own_amounts.kares,
  ].some(Boolean)
  const stage_asset = (item: Readonly<ItemRow>, amount: number): void => {
    if (!can_edit) return
    const draft = stage_trade_offer_addition(additions, kept_caps, item, amount)
    set_additions(draft.additions)
    set_kept_caps(draft.kept_caps)
    set_picking(null)
  }
  const add_asset = (id: string): void => {
    const item = can_edit && id ? available_items.find((row) => row.id === id) : undefined
    if (!item) return
    if (item_is_stackable(item.category) && item.amount > 1) set_picking(item)
    else stage_asset(item, item.amount)
  }
  const currency_input = (asset: TradeCurrency): CurrencyInput => ({
    value: currencies[asset],
    disabled: !can_edit,
    change: (value) => set_currency(asset, value),
    commit: () => {
      if (parse_currency(asset) === null) set_currency(asset, input_sui(own_amounts[asset]))
    },
  })
  const discard = (): void => {
    set_kept_caps(own_caps)
    set_additions([])
    set_currencies({ sui: input_sui(own_amounts.sui), kares: input_sui(own_amounts.kares) })
  }
  const confirm = (): void => {
    if (parsed_sui === null || parsed_kares === null) return
    dispatch_app({
      type: 'trade/commit_offer',
      trade: active.id,
      additions,
      removals,
      sui: parsed_sui,
      kares: parsed_kares,
    })
  }
  const remove_cap = (cap: Readonly<TradeCapRow>): void => {
    const added = additions.some(({ item }) => item.id === cap.object)
    if (added) set_additions((current) => Object.freeze(current.filter(({ item }) => item.id !== cap.object)))
    else set_kept_caps((current) => Object.freeze(current.filter(({ object }) => object !== cap.object)))
  }
  const close = (): void => dispatch_app({ type: 'trade/open', trade: null })
  return (
    <NativeModal close={close} label={text('title')} className="aui-modal-scrim">
      <GameWindow
        title={text('title')}
        icon={<Handshake />}
        close={close}
        close_label={text('close')}
        className="aui-trade-window"
      >
        <section className="trade-modal">
          {center_rows.length > 1 && (
            <nav className="trade-switcher">
              {center_rows.map((row) => (
                <button
                  aria-pressed={row.id === active.id}
                  key={row.id}
                  onClick={() => dispatch_app({ type: 'trade/open', trade: row.id })}
                  type="button"
                >
                  {display_name(row.a === address ? row.b : row.a)}
                </button>
              ))}
            </nav>
          )}
          <div className="trade-workspace">
            <div className="trade-offers">
              <OfferPanel
                add_asset={add_asset}
                caps={displayed_caps}
                copy={copy}
                currencies={negotiating ? { sui: currency_input('sui'), kares: currency_input('kares') } : undefined}
                label={text('you_give')}
                own
                pending={pending}
                remove_cap={remove_cap}
                side={own_side}
                status={trade_side_status(active, own_side, true, dirty)}
                text={text}
                trade={active}
              />
              <OfferPanel
                copy={copy}
                label={text('they_give', { name: counterparty })}
                own={false}
                pending={pending}
                side={other_side}
                status={trade_side_status(active, other_side, false, dirty)}
                text={text}
                trade={active}
              />
            </div>
            {negotiating && (
              <TradeInventory
                add_asset={add_asset}
                balance={balance}
                can_edit={can_edit}
                category_text={category_text}
                choose_amount={(amount) => picking && stage_asset(picking, amount)}
                close_amount={() => set_picking(null)}
                copy={copy}
                items={available_items}
                picking={picking}
                text={text}
              />
            )}
          </div>
          {negotiating ? (
            <NegotiatingFooter
              accepted={active[`accept_${own_side}`]}
              confirm={confirm}
              counterparty={counterparty}
              dirty={dirty}
              discard={discard}
              pending={pending}
              text={text}
              trade={active}
            />
          ) : (
            <TerminalFooter address={address} pending={pending} text={text} trade={active} />
          )}
        </section>
      </GameWindow>
    </NativeModal>
  )
}

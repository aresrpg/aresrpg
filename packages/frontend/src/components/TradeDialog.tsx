// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_is_stackable } from '@aresrpg/immutable'
import type { ItemRow, TradeCapRow, TradeRow } from '@aresrpg/protocol'
import { ROYALTY_FLOOR_MIST } from '@aresrpg/sdk/marketplace'
import { trade_incoming, trade_own_offer } from '@aresrpg/sdk/trade'
import { Check, Handshake, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { item_icon } from '../content/assets.ts'
import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { encumbered_asset_ids, trade_stack_targets } from '../inventory_stacks.ts'
import { SuiUnit } from '../marketplace/marketplace_model.tsx'
import { selected_character } from '../modules/session.ts'
import { visible_trade_rows } from '../modules/trade.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui, parse_sui_amount } from '../wallet_amount.ts'

import { ModalFrame } from './ModalFrame.tsx'
import { OfferCaps } from './TradeOfferCaps.tsx'
import {
  input_sui,
  stage_trade_offer_addition,
  TRADE_INVENTORY_CATEGORIES,
  trade_display_name,
  trade_inventory_category,
  trade_draft_inventory,
  type TradeDraftAddition,
  type TradeInventoryCategory,
} from './trade_view.ts'

const OfferHeader = ({
  accepted,
  name,
  own,
  text,
}: Readonly<{ accepted: boolean; name: string; own: boolean; text: CopyText }>) => (
  <header>
    <div>
      <b>{own ? text('your_offer') : text('their_offer')}</b>
      <small>{name}</small>
    </div>
    <span className={accepted ? 'is-accepted' : ''}>
      {accepted ? <Check size={11} /> : null}
      {text(accepted ? 'accepted' : 'reviewing')}
    </span>
  </header>
)

const OfferSui = ({
  amount,
  editable,
  pending,
  sui,
  set_sui,
  commit_sui,
  text,
}: Readonly<{
  amount: bigint
  editable: boolean
  pending: boolean
  sui: string
  set_sui: (value: string) => void
  commit_sui: () => void
  text: CopyText
}>) => (
  <label className="trade-sui">
    <SuiUnit size={12} />
    {editable ? (
      <input
        aria-label={text('sui')}
        disabled={pending}
        inputMode="decimal"
        onBlur={commit_sui}
        onChange={(event) => set_sui(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        value={sui}
      />
    ) : (
      <strong>{input_sui(amount)}</strong>
    )}
  </label>
)

const OfferPanel = ({
  trade,
  side,
  own,
  pending,
  sui,
  set_sui,
  commit_sui,
  add_asset,
  name,
  text,
  caps,
  copy,
  remove_cap,
  draft_actions,
}: Readonly<{
  trade: TradeRow
  side: 'a' | 'b'
  own: boolean
  pending: boolean
  sui: string
  set_sui: (value: string) => void
  commit_sui: () => void
  add_asset: (id: string) => void
  name: string
  text: CopyText
  caps?: readonly TradeCapRow[]
  copy: AppCopy
  remove_cap?: (cap: Readonly<TradeCapRow>) => void
  draft_actions?: Readonly<{ visible: boolean; confirm: () => void; discard: () => void }>
}>) => {
  const accepted = trade.phase === 'settling' || trade[`accept_${side}`]
  const displayed_caps = caps ?? trade[`caps_${side}`]
  const can_edit = own && trade.phase === 'negotiating' && !pending
  return (
    <section
      className={`trade-side${own ? ' is-own' : ''}${accepted ? ' is-accepted' : ''}`}
      onDragOver={(event) => can_edit && event.preventDefault()}
      onDrop={(event) => {
        if (!can_edit) return
        event.preventDefault()
        add_asset(event.dataTransfer.getData('text/plain'))
      }}
    >
      <OfferHeader accepted={accepted} name={name} own={own} text={text} />
      <OfferCaps
        caps={displayed_caps}
        copy={copy}
        own={own}
        pending={pending}
        remove_cap={remove_cap}
        text={text}
        trade={trade}
      />
      <OfferSui
        amount={BigInt(trade[`sui_${side}`])}
        commit_sui={commit_sui}
        editable={own && trade.phase === 'negotiating'}
        pending={pending}
        set_sui={set_sui}
        sui={sui}
        text={text}
      />
      <OfferDraftActions actions={draft_actions} pending={pending} text={text} />
    </section>
  )
}

const OfferDraftActions = ({
  actions,
  pending,
  text,
}: Readonly<{
  actions?: Readonly<{ visible: boolean; confirm: () => void; discard: () => void }>
  pending: boolean
  text: CopyText
}>) =>
  actions?.visible ? (
    <div className="trade-offer-actions">
      <button className="btn-outline" disabled={pending} onClick={actions.discard} type="button">
        {text('discard_changes')}
      </button>
      <button className="btn-gold" disabled={pending} onClick={actions.confirm} type="button">
        {text('confirm_changes')}
      </button>
    </div>
  ) : null

const TradeInventory = ({
  items,
  can_edit,
  add_asset,
  balance,
  category_text,
  text,
}: Readonly<{
  items: readonly ItemRow[]
  can_edit: boolean
  add_asset: (id: string) => void
  balance: bigint | null
  category_text: CopyText
  text: CopyText
}>) => {
  const [category, set_category] = useState<TradeInventoryCategory>('equipment')
  const count = (key: TradeInventoryCategory): number =>
    items.filter((item) => trade_inventory_category(item) === key).length
  const counts = Object.fromEntries(TRADE_INVENTORY_CATEGORIES.map((key) => [key, count(key)])) as Record<
    TradeInventoryCategory,
    number
  >
  const visible = items.filter((item) => trade_inventory_category(item) === category)
  return (
    <section className="trade-inventory">
      <header>
        <b>{text('inventory')}</b>
        <div className="trade-inventory-meta">
          <span>{text('drag_hint')}</span>
          <output aria-label={text('sui')} className="trade-wallet-balance">
            <SuiUnit size={10} />
            <strong>{balance === null ? '—' : format_sui(balance, 2)}</strong>
          </output>
        </div>
      </header>
      <nav className="trade-inventory-tabs">
        {TRADE_INVENTORY_CATEGORIES.map((key) => (
          <button
            className={category === key ? 'is-active' : ''}
            key={key}
            onClick={() => set_category(key)}
            type="button"
          >
            {category_text(`bag_${key}`)}
            <span>{counts[key]}</span>
          </button>
        ))}
      </nav>
      <div className="trade-inventory-grid">
        {visible.map((item) => (
          <button
            disabled={!can_edit}
            draggable={can_edit}
            key={item.id}
            onDoubleClick={() => add_asset(item.id)}
            onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
            title={item.name}
            type="button"
          >
            {item_icon(item.item_type) ? (
              <img alt="" draggable={false} src={item_icon(item.item_type)!} />
            ) : (
              <span>{item.name.slice(0, 1).toUpperCase()}</span>
            )}
            {item.amount > 1 && <small>×{item.amount}</small>}
            <i>{item.level}</i>
          </button>
        ))}
        {visible.length === 0 && <p>{text('empty_inventory')}</p>}
      </div>
    </section>
  )
}

const TerminalFooter = ({
  trade,
  address,
  pending,
  text,
}: Readonly<{ trade: TradeRow; address: string; pending: boolean; text: CopyText }>) => {
  const offer = trade.phase === 'settling' ? trade_incoming(trade, address) : trade_own_offer(trade, address)
  const actionable = offer.caps.length > 0 || offer.sui > 0n
  const operation = trade.phase === 'settling' ? ('settle' as const) : ('recover' as const)
  return (
    <footer>
      <p>{text(actionable ? `${operation}_notice` : 'waiting_counterparty')}</p>
      {actionable && (
        <button
          className="btn-gold"
          disabled={pending}
          onClick={() => dispatch_app({ type: `trade/${operation}`, trade: trade.id })}
          type="button"
        >
          {pending ? <Loader2 className="animate-spin" size={12} /> : <Check size={12} />}
          {text(pending ? 'finalizing' : operation)}
        </button>
      )}
    </footer>
  )
}

const NegotiatingFooter = ({
  trade,
  own_side,
  address,
  pending,
  text,
  dirty,
}: Readonly<{
  trade: TradeRow
  own_side: 'a' | 'b'
  address: string
  pending: boolean
  text: CopyText
  dirty: boolean
}>) => {
  const accepted = trade[`accept_${own_side}`]
  const incoming_count = trade_incoming(trade, address).caps.length
  const fee = ROYALTY_FLOOR_MIST * BigInt(incoming_count)
  const notice = text('accept_notice', { count: incoming_count, amount: input_sui(fee) })
  return (
    <footer>
      <button
        className="btn-outline"
        disabled={pending}
        onClick={() => dispatch_app({ type: 'trade/cancel', trade: trade.id })}
        type="button"
      >
        {text('cancel')}
      </button>
      <button
        className={accepted ? 'btn-outline is-accepted' : 'btn-gold'}
        disabled={pending || accepted || dirty}
        onClick={() => dispatch_app({ type: 'trade/accept', trade: trade.id })}
        title={notice}
        type="button"
      >
        {accepted ? <Check size={12} /> : null}
        {text(accepted ? 'accepted' : 'accept')}
      </button>
    </footer>
  )
}

const TradeAmountModal = ({
  item,
  close,
  choose,
  text,
}: Readonly<{ item: Readonly<ItemRow>; close: () => void; choose: (amount: number) => void; text: CopyText }>) => {
  const [amount, set_amount] = useState(item.amount)
  return (
    <ModalFrame
      close={close}
      close_label={text('amount_cancel')}
      label={text('amount_title')}
      max_width="max-w-xs"
      soft
    >
      <form
        className="grid gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault()
          choose(amount)
        }}
      >
        <header className="pr-8 font-mono text-xs tracking-[0.12em] text-[#e0b86b] uppercase">
          {text('amount_for', { name: item.name })}
        </header>
        <input
          autoFocus
          className="border border-white/15 bg-black/25 p-3 font-mono text-sm text-white outline-none focus:border-[#c8963c]/70"
          inputMode="numeric"
          max={item.amount}
          min={1}
          onChange={(event) => set_amount(Math.max(1, Math.min(item.amount, Number(event.target.value) || 1)))}
          type="number"
          value={amount}
        />
        <button className="btn-gold trade-amount-submit" type="submit">
          {text('amount_add')}
        </button>
      </form>
    </ModalFrame>
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

const trade_draft_dirty = (
  addition_count: number,
  kept_count: number,
  own_count: number,
  sui: bigint | null,
  own_sui: bigint
): boolean => addition_count > 0 || kept_count !== own_count || (sui !== null && sui !== own_sui)

export const TradeDialog = ({
  copy,
  active,
  address,
}: Readonly<{ copy: AppCopy; active: TradeRow; address: string }>) => {
  const text = copy_text(copy.trade_panel)
  const category_text = copy_text(copy.characters_page)
  const rows = useAppStore((state) => state.trade.rows)
  const pending_operation = useAppStore((state) => state.trade.pending)
  const inventory = useAppStore((state) => state.session.inventory)
  const balance = useAppStore((state) => state.session.sui_balance_mist)
  const listings = useAppStore((state) => state.marketplace.own_listings)
  const own_name = useAppStore((state) => selected_character(state.session)?.name ?? null)
  const players = useAppStore((state) => state.world.all_players)
  const center_rows = visible_trade_rows(rows).filter(({ phase }) => phase !== 'requested')
  const own_side = active.a === address ? ('a' as const) : ('b' as const)
  const other_side = own_side === 'a' ? ('b' as const) : ('a' as const)
  const own_caps = active[`caps_${own_side}`]
  const own_sui = BigInt(active[`sui_${own_side}`])
  const pending = !!pending_operation
  const [sui, set_sui] = useState('0')
  const [kept_caps, set_kept_caps] = useState<readonly TradeCapRow[]>(own_caps)
  const [additions, set_additions] = useState<readonly TradeDraftAddition[]>([])
  const [amount_item, set_amount_item] = useState<Readonly<ItemRow> | null>(null)
  const display_name = (player_address: string): string =>
    trade_display_name(player_address, address, own_name, Object.values(players))

  useEffect(() => {
    set_sui(input_sui(own_sui))
    set_kept_caps(own_caps)
    set_additions([])
  }, [active.id, active.offer_revision, own_caps, own_sui])

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
  const can_edit = active.phase === 'negotiating' && !pending
  const displayed_caps = Object.freeze([...kept_caps, ...additions.map(draft_cap)])
  const parsed_sui = sui.trim() === '0' ? 0n : parse_sui_amount(sui)
  const dirty = trade_draft_dirty(additions.length, kept_caps.length, own_caps.length, parsed_sui, own_sui)
  const stage_asset = (item: Readonly<ItemRow>, amount: number): void => {
    const draft = stage_trade_offer_addition(additions, kept_caps, item, amount)
    set_additions(draft.additions)
    set_kept_caps(draft.kept_caps)
    set_amount_item(null)
  }
  const add_asset = (id: string): void => {
    if (!can_edit || !id) return
    const item = available_items.find((row) => row.id === id)
    if (!item) return
    item_is_stackable(item.category) && item.amount > 1 ? set_amount_item(item) : stage_asset(item, item.amount)
  }
  const commit_sui = (): void => {
    const amount = sui.trim() === '0' ? 0n : parse_sui_amount(sui)
    if (amount === null || pending || active.phase !== 'negotiating') set_sui(input_sui(own_sui))
  }
  const discard = (): void => {
    set_kept_caps(own_caps)
    set_additions([])
    set_sui(input_sui(own_sui))
  }
  const confirm = (): void => {
    if (parsed_sui === null) return
    dispatch_app({
      type: 'trade/commit_offer',
      trade: active.id,
      additions,
      removals,
      sui: parsed_sui,
    })
  }
  const remove_cap = (cap: Readonly<TradeCapRow>): void => {
    const added = additions.some(({ item }) => item.id === cap.object)
    if (added) set_additions((current) => Object.freeze(current.filter(({ item }) => item.id !== cap.object)))
    else set_kept_caps((current) => Object.freeze(current.filter(({ object }) => object !== cap.object)))
  }
  return (
    <ModalFrame
      close={() => dispatch_app({ type: 'trade/open', trade: null })}
      close_label={text('close')}
      label={text('title')}
      max_width="max-w-5xl"
      soft
    >
      <section className="trade-modal">
        {center_rows.length > 1 && (
          <nav className="trade-switcher">
            {center_rows.map((row) => (
              <button
                className={row.id === active.id ? 'is-active' : ''}
                key={row.id}
                onClick={() => dispatch_app({ type: 'trade/open', trade: row.id })}
                type="button"
              >
                {display_name(row.a === address ? row.b : row.a)}
              </button>
            ))}
          </nav>
        )}
        <div className="trade-dialog-heading">
          <Handshake size={17} />
          <div>
            <h2>{text('title')}</h2>
            <p>{display_name(own_side === 'a' ? active.b : active.a)}</p>
          </div>
        </div>
        <div className={`trade-workspace${active.phase === 'negotiating' ? '' : ' is-terminal'}`}>
          <OfferPanel
            add_asset={add_asset}
            caps={displayed_caps}
            commit_sui={commit_sui}
            copy={copy}
            draft_actions={Object.freeze({ confirm, discard, visible: dirty })}
            name={display_name(active[own_side])}
            own
            pending={pending}
            remove_cap={remove_cap}
            set_sui={set_sui}
            side={own_side}
            sui={sui}
            text={text}
            trade={active}
          />
          <OfferPanel
            add_asset={add_asset}
            commit_sui={commit_sui}
            copy={copy}
            name={display_name(active[other_side])}
            own={false}
            pending={pending}
            set_sui={set_sui}
            side={other_side}
            sui={sui}
            text={text}
            trade={active}
          />
          {active.phase === 'negotiating' && (
            <TradeInventory
              add_asset={add_asset}
              balance={balance}
              can_edit={can_edit}
              category_text={category_text}
              items={available_items}
              text={text}
            />
          )}
        </div>
        {active.phase === 'negotiating' ? (
          <NegotiatingFooter
            address={address}
            dirty={dirty}
            own_side={own_side}
            pending={pending}
            text={text}
            trade={active}
          />
        ) : (
          <TerminalFooter address={address} pending={pending} text={text} trade={active} />
        )}
      </section>
      {amount_item && (
        <TradeAmountModal
          choose={(amount) => stage_asset(amount_item, amount)}
          close={() => set_amount_item(null)}
          item={amount_item}
          text={text}
        />
      )}
    </ModalFrame>
  )
}

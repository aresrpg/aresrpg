// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MIN_CHARACTER_SALE_LEVEL, type TradeCapRow, type TradeRow } from '@aresrpg/protocol'
import { Handshake, Plus, X } from 'lucide-react'
import { useState } from 'react'

import type { AppCopy, CopyText } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { encumbered_asset_ids } from '../inventory_stacks.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { format_sui, parse_sui_amount } from '../wallet_amount.ts'

import { ModalFrame } from './ModalFrame.tsx'
import './trade_inbox.css'

const drained = (
  row: Readonly<{ caps_a: readonly unknown[]; caps_b: readonly unknown[]; sui_a: string; sui_b: string }>
) => row.caps_a.length === 0 && row.caps_b.length === 0 && BigInt(row.sui_a) === 0n && BigInt(row.sui_b) === 0n

const short_address = (address: string): string => `${address.slice(0, 7)}…${address.slice(-5)}`

const TradeList = ({
  rows,
  active,
  address,
  text,
}: Readonly<{ rows: readonly TradeRow[]; active: string; address: string; text: CopyText }>) => (
  <nav className="trade-list">
    {rows.map((row) => {
      const other = row.a === address ? row.b : row.a
      return (
        <button
          className={row.id === active ? 'is-active' : ''}
          key={row.id}
          onClick={() => dispatch_app({ type: 'trade/open', trade: row.id })}
          type="button"
        >
          <b>{short_address(other)}</b>
          <span>{text(row.locked ? 'locked' : 'negotiating')}</span>
        </button>
      )
    })}
  </nav>
)

const CapRow = ({ cap, action, label }: Readonly<{ cap: TradeCapRow; action?: () => void; label: string }>) => (
  <div className="trade-cap">
    <span>{cap.kind === 'character' ? '◇' : '◆'}</span>
    <b>{cap.name}</b>
    <small>
      {cap.kind === 'item' ? `×${cap.amount}` : cap.classe?.toUpperCase()} · LV {cap.level}
    </small>
    {action && (
      <button aria-label={label} onClick={action} type="button">
        <X size={10} />
      </button>
    )}
  </div>
)

const TradeSide = ({
  trade,
  side,
  own,
  text,
}: Readonly<{ trade: TradeRow; side: 'a' | 'b'; own: boolean; text: CopyText }>) => (
  <div className={`trade-side${own ? ' is-own' : ''}`}>
    <header>
      <b>{own ? text('your_offer') : text('their_offer')}</b>
      <span>{trade[`accept_${side}`] ? text('accepted') : text('reviewing')}</span>
    </header>
    <strong>{format_sui(BigInt(trade[`sui_${side}`]), 2)} SUI</strong>
    <div>
      {trade[`caps_${side}`].map((cap) => (
        <CapRow
          action={
            !trade.locked && own
              ? () => dispatch_app({ type: 'trade/withdraw_cap', trade: trade.id, cap })
              : trade.locked && !own
                ? () => dispatch_app({ type: 'trade/claim_cap', trade: trade.id, cap })
                : undefined
          }
          cap={cap}
          key={cap.object}
          label={trade.locked ? text('claim') : text('withdraw')}
        />
      ))}
    </div>
  </div>
)

const trade_view = (trade: Readonly<TradeRow> | null, address: string | undefined) => {
  if (!trade || !address)
    return { own_side: null, own_sui: 0n, other_sui: 0n, own_accepted: false, counterparty: null } as const
  const own_side = trade.a === address ? ('a' as const) : ('b' as const)
  const other_side = own_side === 'a' ? 'b' : 'a'
  return {
    own_side,
    own_sui: BigInt(trade[`sui_${own_side}`]),
    other_sui: BigInt(trade[`sui_${other_side}`]),
    own_accepted: trade[`accept_${own_side}`],
    counterparty: own_side === 'a' ? trade.b : trade.a,
  } as const
}

export const TradeInbox = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const text = copy_text(copy.trade_panel)
  const rows = useAppStore((state) => state.trade.rows)
  const active_id = useAppStore((state) => state.trade.active)
  const pending = useAppStore((state) => state.trade.pending)
  const wallet = useAppStore((state) => state.session.wallet)
  const inventory = useAppStore((state) => state.session.inventory)
  const listings = useAppStore((state) => state.marketplace.own_listings)
  const characters = useAppStore((state) => state.session.characters)
  const [item_id, set_item_id] = useState('')
  const [character_id, set_character_id] = useState('')
  const [sui, set_sui] = useState('')
  const active = rows.find(({ id }) => id === active_id) ?? null
  const { own_side, own_sui, other_sui, own_accepted, counterparty } = trade_view(active, wallet?.address)
  const amount = parse_sui_amount(sui)
  const encumbered = encumbered_asset_ids(listings, rows)
  const item = inventory.find(({ id }) => id === item_id && !encumbered.has(id)) ?? null
  const character = characters.find(({ id }) => id === character_id && !encumbered.has(id)) ?? null
  return (
    <>
      {rows.length > 0 && (
        <button
          className="trade-inbox-button"
          onClick={() => dispatch_app({ type: 'trade/open', trade: rows[0]!.id })}
          type="button"
        >
          <Handshake size={12} /> {text('inbox')} <b>{rows.length}</b>
        </button>
      )}
      {active && wallet && own_side && (
        <ModalFrame
          close={() => dispatch_app({ type: 'trade/open', trade: null })}
          close_label={text('close')}
          label={text('title')}
          max_width="max-w-4xl"
        >
          <section className="trade-modal">
            <TradeList active={active.id} address={wallet.address} rows={rows} text={text} />
            <header>
              <Handshake size={16} />
              <div>
                <h2>{text('title')}</h2>
                <p>
                  {counterparty ? short_address(counterparty) : ''} · {text(active.locked ? 'locked' : 'negotiating')}
                </p>
              </div>
            </header>
            <div className="trade-sides">
              <TradeSide own={own_side === 'a'} side="a" text={text} trade={active} />
              <TradeSide own={own_side === 'b'} side="b" text={text} trade={active} />
            </div>
            {!active.locked ? (
              <div className="trade-controls">
                <label>
                  {text('add_item')}
                  <span>
                    <select onChange={(event) => set_item_id(event.target.value)} value={item_id}>
                      <option value="">—</option>
                      {inventory
                        .filter(({ id }) => !encumbered.has(id))
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                    </select>
                    <button
                      disabled={!item || !!pending}
                      onClick={() => item && dispatch_app({ type: 'trade/deposit_item', trade: active.id, item })}
                      type="button"
                    >
                      <Plus size={11} />
                    </button>
                  </span>
                </label>
                <label>
                  {text('add_character')}
                  <span>
                    <select onChange={(event) => set_character_id(event.target.value)} value={character_id}>
                      <option value="">—</option>
                      {characters
                        .filter(
                          ({ id, custody, equipment, level }) =>
                            custody === 'kiosk' &&
                            equipment.length === 0 &&
                            level >= MIN_CHARACTER_SALE_LEVEL &&
                            !encumbered.has(id)
                        )
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                    </select>
                    <button
                      disabled={!character || !!pending}
                      onClick={() =>
                        character && dispatch_app({ type: 'trade/deposit_character', trade: active.id, character })
                      }
                      type="button"
                    >
                      <Plus size={11} />
                    </button>
                  </span>
                </label>
                <label>
                  {text('sui')}
                  <span>
                    <input inputMode="decimal" onChange={(event) => set_sui(event.target.value)} value={sui} />
                    <button
                      disabled={!amount || !!pending}
                      onClick={() => amount && dispatch_app({ type: 'trade/deposit_sui', trade: active.id, amount })}
                      type="button"
                    >
                      <Plus size={11} />
                    </button>
                  </span>
                </label>
                {own_sui > 0n && (
                  <button
                    className="btn-outline"
                    disabled={!!pending}
                    onClick={() => dispatch_app({ type: 'trade/withdraw_sui', trade: active.id, amount: own_sui })}
                    type="button"
                  >
                    {text('withdraw_sui')}
                  </button>
                )}
                <button
                  className="btn-gold"
                  disabled={!!pending || own_accepted}
                  onClick={() => dispatch_app({ type: 'trade/accept', trade: active.id })}
                  type="button"
                >
                  {own_accepted ? text('accepted') : text('accept')}
                </button>
                {drained(active) && (
                  <button
                    className="btn-outline"
                    disabled={!!pending}
                    onClick={() => dispatch_app({ type: 'trade/destroy', trade: active.id })}
                    type="button"
                  >
                    {text('finish')}
                  </button>
                )}
              </div>
            ) : (
              <div className="trade-controls">
                {other_sui > 0n && (
                  <button
                    className="btn-gold"
                    disabled={!!pending}
                    onClick={() => dispatch_app({ type: 'trade/claim_sui', trade: active.id })}
                    type="button"
                  >
                    {text('claim_sui', { amount: format_sui(other_sui, 2) })}
                  </button>
                )}
                {drained(active) && (
                  <button
                    className="btn-outline"
                    disabled={!!pending}
                    onClick={() => dispatch_app({ type: 'trade/destroy', trade: active.id })}
                    type="button"
                  >
                    {text('finish')}
                  </button>
                )}
              </div>
            )}
          </section>
        </ModalFrame>
      )}
    </>
  )
}

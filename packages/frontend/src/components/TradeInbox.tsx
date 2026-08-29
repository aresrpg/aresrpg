// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Handshake } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { selected_character } from '../modules/session.ts'
import { trade_request_rows, visible_trade_rows } from '../modules/trade.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { TradeDialog } from './TradeDialog.tsx'
import { OfferCaps } from './TradeOfferCaps.tsx'
import { trade_display_name, trade_modal_visible } from './trade_view.ts'
import './trade_inbox.css'

export { OfferCaps }
export { trade_cap_action, trade_display_name, trade_inventory_category, trade_modal_visible } from './trade_view.ts'

export const TradeInviteCard = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const text = copy_text(copy.trade_panel)
  const pending = useAppStore((state) => state.trade.pending)
  const address = useAppStore((state) => state.session.wallet?.address)
  const own_name = useAppStore((state) => selected_character(state.session)?.name ?? null)
  const players = useAppStore((state) => state.world.all_players)
  const rows = useAppStore((state) => state.trade.rows)
  const requests = address ? trade_request_rows(rows, address) : []
  return (
    <>
      {requests.map((request) => {
        const incoming = request.b === address
        return (
          <section className="trade-invite-card" key={request.id}>
            <span>
              {incoming
                ? text('invited_by', { name: trade_display_name(request.a, address, own_name, Object.values(players)) })
                : text('request_waiting', {
                    name: trade_display_name(request.b, address, own_name, Object.values(players)),
                  })}
            </span>
            {incoming && (
              <button
                className="btn-gold"
                disabled={!!pending}
                onClick={() => dispatch_app({ type: 'trade/join', trade: request.id })}
                type="button"
              >
                {text('accept_request')}
              </button>
            )}
            <button
              className="btn-outline"
              disabled={!!pending}
              onClick={() =>
                dispatch_app({
                  type: incoming ? 'trade/decline_request' : 'trade/cancel_request',
                  trade: request.id,
                })
              }
              type="button"
            >
              {text(incoming ? 'decline' : 'cancel_request')}
            </button>
          </section>
        )
      })}
    </>
  )
}

export const TradeCenterButton = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const text = copy_text(copy.trade_panel)
  const address = useAppStore((state) => state.session.wallet?.address)
  const own_name = useAppStore((state) => selected_character(state.session)?.name ?? null)
  const players = useAppStore((state) => state.world.all_players)
  const all_rows = useAppStore((state) => state.trade.rows)
  const rows = visible_trade_rows(all_rows).filter(({ phase }) => phase !== 'requested')
  const [first] = rows
  const counterparty = first && address ? (first.a === address ? first.b : first.a) : null
  return rows.length > 0 ? (
    <button
      className="trade-center-button"
      onClick={() => first && dispatch_app({ type: 'trade/open', trade: first.id })}
      type="button"
    >
      <Handshake size={12} />
      <span>{text('trades')}</span>
      {counterparty && <strong>{trade_display_name(counterparty, address, own_name, Object.values(players))}</strong>}
      {rows.length > 1 && <b>{rows.length}</b>}
    </button>
  ) : null
}

export const TradeInbox = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const rows = useAppStore((state) => state.trade.rows)
  const active_id = useAppStore((state) => state.trade.active)
  const wallet = useAppStore((state) => state.session.wallet)
  const active = rows.find(({ id }) => id === active_id)
  return (
    <>
      <div className="trade-hud">
        <TradeInviteCard copy={copy} />
        <TradeCenterButton copy={copy} />
      </div>
      {active && wallet && trade_modal_visible(active) && (
        <TradeDialog active={active} address={wallet.address} copy={copy} />
      )}
    </>
  )
}

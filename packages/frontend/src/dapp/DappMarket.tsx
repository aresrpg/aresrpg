// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { Button } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { MarketSourceContext } from '../marketplace/MarketSource.tsx'
import type { MarketplaceInput } from '../modules/marketplace.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { dapp_error, dapp_text, item_name } from './copy.ts'
import { bot_market, type MarketOrder } from './market.ts'

const MarketplacePage = lazy(() => import('../marketplace/MarketplacePage.tsx'))

/**
 * How the bot account trades: a purchase and a listing become one order of the dapp's reducer, which
 * the hosted bot signs. The bot has no withdraw or collect action, so neither is offered; every other
 * market input is public browsing and stays with the marketplace's own reducer.
 */
const trade = (input: MarketplaceInput): void => {
  switch (input.type) {
    case 'market/buy_requested':
      return dispatch_app({ type: 'dapp/buy', id: crypto.randomUUID(), listing: input.listing })
    case 'market/list_requested':
      return dispatch_app({ type: 'dapp/sell', id: crypto.randomUUID(), listing: input.listing })
    case 'market/delist_requested':
    case 'market/collect_requested':
      return undefined
    default:
      return dispatch_app(input)
  }
}

type Text = (key: string, values?: Readonly<Record<string, string>>) => string
const dismiss = () => dispatch_app({ type: 'dapp/order_dismissed' })
const play = () => {
  dismiss()
  dispatch_app({ type: 'dapp/view', view: 'play' })
}
const Waiting = ({ children }: Readonly<{ children: ReactNode }>) => (
  <p className="dapp-note" role="status" aria-busy="true">
    {children}
  </p>
)
/** One plain sentence per state of the order and the single safe next step; an open order offers none. */
const NOTICES: Readonly<Record<MarketOrder['status'], (order: MarketOrder, text: Text, copy: AppCopy) => ReactNode>> = {
  pending: (_order, text) => <Waiting>{text('blocker_command_pending')}</Waiting>,
  accepted: (order, text) => <Waiting>{text('market_queued', { item: item_name(order.item_type) })}</Waiting>,
  uncertain: (_order, text) => (
    <p className="dapp-warning" role="status">
      {text('command_uncertain')}
    </p>
  ),
  done: (order, text) => {
    const bought = order.action === 'market_buy'
    const values = { amount: String(order.amount), item: item_name(order.item_type) }
    return (
      <div className="dapp-fix" role="status">
        <p>{text(bought ? 'market_bought' : 'market_listed', values)}</p>
        <Button onClick={bought ? play : dismiss}>{text(bought ? 'nav_play' : 'position_dismiss')}</Button>
      </div>
    )
  },
  refused: (order, text, copy) => (
    <div className="dapp-fix" role="alert">
      <p className="dapp-error">{dapp_error(copy, order.error ?? 'unknown')}</p>
      <Button onClick={dismiss}>{text('position_dismiss')}</Button>
    </div>
  ),
}
const OrderNotice = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const order = useAppStore(({ dapp }) => dapp.order)
  if (!order) return null
  return (
    <div data-order={order.status}>
      {NOTICES[order.status](order, (key, values) => dapp_text(copy, key, values), copy)}
    </div>
  )
}

/** The game's marketplace, trading as the bot account: its bag, balance and listings, and its orders. */
export const DappMarket = ({ copy, locale }: Readonly<{ copy: AppCopy; locale: Locale }>) => {
  const account = useAppStore(({ session }) => session.agent_inventory)
  const address = useAppStore(({ session }) => session.inventory_pairing?.address ?? null)
  const order = useAppStore(({ dapp }) => dapp.order)
  const live = useAppStore(({ marketplace }) => marketplace)
  const source = useMemo(
    () => ({ ...bot_market({ account, address }, order, live), dispatch: trade }),
    [account, address, order, live]
  )
  return (
    <section className="dapp-market" aria-label={dapp_text(copy, 'nav_market')}>
      <p className="dapp-note">{dapp_text(copy, 'market_account')}</p>
      <OrderNotice copy={copy} />
      <MarketSourceContext.Provider value={source}>
        <Suspense fallback={<p className="dapp-note">{dapp_text(copy, 'loading')}</p>}>
          <MarketplacePage copy={copy} locale={locale} />
        </Suspense>
      </MarketSourceContext.Provider>
    </section>
  )
}

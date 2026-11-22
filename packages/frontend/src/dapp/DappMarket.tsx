// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { lazy, Suspense, useMemo } from 'react'
import { CarvedIcon, GameWindow } from '@aresrpg/ui'

import { HUD_PAGE_META } from '../game/hud/hud_pages.ts'
import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { MarketSourceContext } from '../marketplace/MarketSource.tsx'
import type { MarketplaceInput } from '../modules/marketplace.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { dapp_text } from './copy.ts'
import { bot_market } from './market.ts'
import type { DappInput } from './state.ts'

import './dapp_market.css'

const MarketplacePage = lazy(() => import('../marketplace/MarketplacePage.tsx'))

/**
 * How the bot account trades: a purchase, a listing and a withdrawal each become the one direct
 * request of the dapp's reducer, which the hosted bot signs. Every other market input is public
 * browsing and stays with the marketplace's own reducer. Sale proceeds are not asked for here: the
 * page cannot know what waits in the kiosks, and the bot collects them by itself.
 */
export const market_input = (input: MarketplaceInput, id: string): DappInput | MarketplaceInput => {
  switch (input.type) {
    case 'market/buy_requested':
      return { type: 'dapp/buy', id, listing: input.listing }
    case 'market/list_requested':
      return { type: 'dapp/sell', id, listing: input.listing }
    case 'market/delist_requested':
      return { type: 'dapp/delist', id, listing: input.listing }
    default:
      return input
  }
}
const trade = (input: MarketplaceInput): void => dispatch_app(market_input(input, crypto.randomUUID()))

/** The game's own market window: its title, its icon and the class its whole look is written under. */
const WINDOW = HUD_PAGE_META.marketplace

/**
 * The game's marketplace in the game's own market window, trading as the bot account: its bag, balance
 * and listings. It opens on the panel the page was asked for. What became of a request shows in the
 * page's one notice block.
 */
export const DappMarket = ({ copy, locale }: Readonly<{ copy: AppCopy; locale: Locale }>) => {
  const account = useAppStore(({ session }) => session.agent_inventory)
  const address = useAppStore(({ session }) => session.inventory_pairing?.address ?? null)
  const direct = useAppStore(({ dapp }) => dapp.direct)
  const panel = useAppStore(({ dapp }) => dapp.market_panel)
  const live = useAppStore(({ marketplace }) => marketplace)
  const source = useMemo(
    () => ({ ...bot_market({ account, address }, direct, live), dispatch: trade, panel }),
    [account, address, direct, live, panel]
  )
  return (
    <section className="dapp-market" aria-label={dapp_text(copy, 'nav_market')}>
      <MarketSourceContext.Provider value={source}>
        {/* The frame of `GamePageWindow`, laid in the page: the market's styles are scoped to its classes. */}
        <GameWindow
          className={`aui-feature-port aui-live-page ${WINDOW.class_name}`}
          title={copy[WINDOW.label]}
          icon={<CarvedIcon name={WINDOW.icon} />}
          close={null}
          close_label={dapp_text(copy, 'close')}
        >
          <div className="aui-live-page-content aui-workspace-main">
            <Suspense fallback={<p className="dapp-note">{dapp_text(copy, 'loading')}</p>}>
              <MarketplacePage copy={copy} locale={locale} />
            </Suspense>
          </div>
        </GameWindow>
      </MarketSourceContext.Provider>
    </section>
  )
}

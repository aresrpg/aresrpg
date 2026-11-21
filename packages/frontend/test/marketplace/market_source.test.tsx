// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { ReactNode } from 'react'

import { BrowsePanel } from '../../src/marketplace/BrowsePanel.tsx'
import { MarketplacePageView } from '../../src/marketplace/MarketplacePage.tsx'
import { MarketSourceContext, type MarketSource } from '../../src/marketplace/MarketSource.tsx'
import { SellPanel } from '../../src/marketplace/SellPanel.tsx'
import { bot_market } from '../../src/dapp/market.ts'
import { initial_marketplace_state } from '../../src/modules/marketplace.ts'
import { initialize_app_store } from '../../src/store.ts'
import en from '../../src/i18n/locales/en.yaml'
import type { AppCopy } from '../../src/i18n/copy.ts'
import { account_fixture, item_fixture, listing_fixture, observation_fixture } from '../dapp/fixtures.ts'
import { render_english } from '../i18n/render.ts'

const copy = en as AppCopy
const KEY = 'key_of_gilded_lorito'
const AGENT = '0xagent'
const key = (id: string) => ({ ...item_fixture(KEY, 1, id), category: 'key', version: '4' })
const offer = listing_fixture(KEY, '1000000000', { group_key: 'lot' })
const own = listing_fixture(KEY, '9000000000', { id: 'agent-listing', seller: AGENT, kiosk: '0xkiosk' })
const live = {
  ...initial_marketplace_state(),
  group: 'CONSUMABLE' as const,
  observation: { kind: 'offers' as const, category: 'key' as const, item_type: KEY, request: 2 },
  types: [{ item_type: KEY, category: 'key' as const, name: 'Key', level: 1 }],
  // The public offers of the item on screen, as the page's own game socket pushed them.
  listings: [offer] as never,
  ready_request: 2,
}
const bot_source = (balance_mist: string): MarketSource => ({
  ...bot_market(
    {
      // The bag, its listings and the balance are the bot account's, from the game socket.
      account: account_fixture({ items: [key('in-bag')], listings: [own], balance_mist: BigInt(balance_mist) }),
      address: AGENT,
    },
    null,
    live
  ),
  dispatch: () => undefined,
})
const as = (source: MarketSource | null, node: ReactNode) =>
  render_english(<MarketSourceContext.Provider value={source}>{node}</MarketSourceContext.Provider>)
const text = (name: string) => name
const label = (key: string) => String(copy.marketplace_page[key])

test('an account without characters or history is offered neither', () => {
  initialize_app_store({ quality: 'medium', music_enabled: false, render_distance: null })
  const source = bot_source('5000000000')
  const volume = { day_mist: null, month_mist: null, history_days: 0 }
  const page = (value: MarketSource | null) =>
    as(value, <MarketplacePageView copy={copy} locale="en" volume={volume} />)
  // The player's own wallet keeps every tab and group.
  expect(page(null)).toContain(label('tab_history'))
  expect(as(null, <BrowsePanel text={text} />)).toContain('group_characters')
  expect(page(source)).not.toContain(label('tab_history'))
  expect(page(source)).toContain(label('tab_sell'))
  expect(as(source, <BrowsePanel text={text} />)).not.toContain('group_characters')
  // The account's own listing is shown, with the control to withdraw it: the bot withdraws item listings.
  const selling = as(source, <SellPanel text={text} />)
  expect(selling).toContain('market-own-listing')
  expect(selling).toContain('market-delist')
  // A source that cannot withdraw shows the listing without that control.
  const fixed = { ...source, capabilities: { characters: false, withdraw: false, history: false } }
  expect(as(fixed, <SellPanel text={text} />)).not.toContain('market-delist')
  // The sellable inventory is the source's bag: one key, whatever the signed-in player holds.
  expect(selling).toContain('inventory<span class="market-count">1</span>')
  expect(as({ ...source, capabilities: undefined }, <SellPanel text={text} />)).toContain('market-delist')
})

test('the page opens on the panel its source names, and on Buy otherwise', () => {
  initialize_app_store({ quality: 'medium', music_enabled: false, render_distance: null })
  const source = bot_source('5000000000')
  const volume = { day_mist: null, month_mist: null, history_days: 0 }
  const page = (value: MarketSource | null) =>
    as(value, <MarketplacePageView copy={copy} locale="en" volume={volume} />)
  // The Sell panel is the one that lists the account's own offers.
  expect(page(source)).not.toContain('market-own-listing')
  expect(page(null)).not.toContain('market-own-listing')
  expect(page({ ...source, panel: 'SELL' })).toContain('market-own-listing')
  expect(page({ ...source, panel: 'BUY' })).not.toContain('market-own-listing')
  // A panel the account is not offered is never opened: the bot account has no history.
  expect(page({ ...source, panel: 'HISTORY' })).toContain('aria-pressed="true"')
  expect(page({ ...source, panel: 'HISTORY' })).toBe(page(source))
})

test('the offers, their price and what the account can afford come from the source', () => {
  initialize_app_store({ quality: 'medium', music_enabled: false, render_distance: null })
  const buying = as(bot_source('5000000000'), <BrowsePanel text={text} />)
  // 1 SUI asked, 1.1 SUI paid with the royalty: the total is what the row shows and the order caps.
  expect(buying).toContain('1.10')
  expect(buying).toContain('>buy<')
  expect(as(bot_source('1000'), <BrowsePanel text={text} />)).toContain('>add_funds<')
  // The account's own offer is never offered back to it.
  const seller = { ...bot_source('5000000000') }
  const yours = { ...seller, market: { ...seller.market, listings: [{ ...offer, seller: AGENT }] } } as MarketSource
  expect(as(yours, <BrowsePanel text={text} />)).toContain('>yours<')
})

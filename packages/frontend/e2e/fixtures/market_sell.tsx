// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useReducer } from 'react'
import { item_stat_center } from '@aresrpg/immutable'

import { adventure_character } from '../../src/adventure/character.ts'
import { adventure_character_row, adventure_inventory } from '../../src/adventure/projection.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import { copy_text, type AppCopy } from '../../src/i18n/copy.ts'
import {
  initial_marketplace_state,
  type MarketplaceInput,
  type MarketplaceState,
} from '../../src/modules/marketplace.ts'
import { MarketSourceContext } from '../../src/marketplace/MarketSource.tsx'
import { SellPanel } from '../../src/marketplace/SellPanel.tsx'
import { item_listing } from '../../src/marketplace/useMarketSell.ts'

const inventory = adventure_inventory(
  ['hat', 'resource', 'consumable', 'rune', 'key'].map((category) =>
    content_catalog.items.find((item) => item.category === category)!
  )
).map((row, index) => ({
  ...row,
  id: `sell-${index}`,
  amount: index === 1 ? 125 : 1,
  stats: index === 0 ? { strength: item_stat_center + 27 } : row.stats,
}))
const initial = (): MarketplaceState => ({
  ...initial_marketplace_state(),
  own_listings: inventory.slice(0, 3).flatMap((row) => {
    const listing = { ...item_listing(row, 'seller', 2500000000n), id: `listed-${row.id}`, version: '1' }
    return new URLSearchParams(location.search).has('stacks') && row.category === 'consumable'
      ? [
          listing,
          { ...listing, id: 'cheap', price_mist: '1000000000' },
          { ...listing, id: 'expensive', price_mist: '3000000000' },
        ]
      : [listing]
  }),
})
const reduce = (state: MarketplaceState, input: MarketplaceInput): MarketplaceState => {
  if (input.type === 'market/list_requested')
    return { ...state, own_listings: [...state.own_listings, { ...input.listing, version: '2' }] }
  if (input.type === 'market/delist_requested')
    return { ...state, own_listings: state.own_listings.filter(({ id }) => id !== input.listing.id) }
  return state
}
export const SellFixture = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [market, dispatch] = useReducer(reduce, undefined, initial)
  return (
    <MarketSourceContext.Provider
      value={{
        market,
        dispatch,
        account: { inventory, characters: [], wallet: { address: 'seller' }, sui_balance_mist: 10000000000n },
        craft_session: { character: adventure_character_row(adventure_character()), inventory },
      }}
    >
      <div className="aui-market-port flex h-full min-h-0 flex-1">
        <SellPanel text={copy_text(copy.marketplace_page)} />
      </div>
    </MarketSourceContext.Provider>
  )
}

// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo, useReducer, useState } from 'react'
import { item_is_stackable, type ItemCategory } from '@aresrpg/immutable'
import type { ListingRow } from '@aresrpg/protocol'
import { Store } from 'lucide-react'
import { Workspace, ConfirmDialog } from '@aresrpg/ui'

import {
  initial_marketplace_state,
  market_categories,
  type MarketplaceInput,
  type MarketplaceState,
} from '../../modules/marketplace.ts'
import { MarketSourceContext } from '../../marketplace/MarketSource.tsx'
import { MarketplacePageView } from '../../marketplace/MarketplacePage.tsx'
import { item_listing } from '../../marketplace/useMarketSell.ts'
import { content_catalog } from '../../content/catalog.ts'
import { adventure_character } from '../../adventure/character.ts'
import { adventure_character_row, adventure_inventory } from '../../adventure/projection.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { useAppStore } from '../../store.ts'

import { WorkshopSurface } from './shared.tsx'
import '../../marketplace/marketplace.css'

const initial_preview = (): MarketplaceState => ({
  ...initial_marketplace_state(),
  group: 'EQUIPMENT',
  observation: {
    kind: 'offers',
    category: 'hat',
    item_type: content_catalog.items.find((item) => item.category === 'hat')!.item_type,
    request: 1,
  },
  ready_request: 1,
  types: content_catalog.items.map((item) => ({
    item_type: item.item_type,
    category: item.category as ItemCategory,
    name: item.name,
    level: item.level,
  })),
  type_counts: Object.fromEntries(
    content_catalog.items.map((item) => [
      item.category,
      content_catalog.items.filter((row) => row.category === item.category).length,
    ])
  ),
  volume: { day_mist: '93540000000', month_mist: '2853420000000', history_days: 30 },
})
const preview_reduce = (state: MarketplaceState, input: MarketplaceInput): MarketplaceState => {
  switch (input.type) {
    case 'market/group_selected': {
      const category = input.category ?? market_categories(input.group)[0]
      const observation =
        input.group === 'CHARACTERS'
          ? { kind: 'characters' as const, request: 1 }
          : {
              kind: 'offers' as const,
              category: category!,
              item_type: input.item_type ?? state.types.find((item) => item.category === category)!.item_type,
              request: 1,
            }
      return { ...state, group: input.group, observation }
    }
    case 'market/characters_filtered':
      return state
    case 'market/price_item_selected':
      return {
        ...state,
        prices: {
          ...state.prices,
          status: 'ready',
          observation: input.item_type ? { item_type: input.item_type, id: 1 } : null,
        },
      }
    case 'market/list_requested':
      return { ...state, own_listings: [...state.own_listings, { ...input.listing, version: '1' }] }
    case 'market/delist_requested':
      return { ...state, own_listings: state.own_listings.filter((row) => row.id !== input.listing.id) }
    case 'market/write_failed':
      return { ...state, pending: null }
    case 'market/buy_requested':
      return { ...state, pending: input.listing.id }
    default:
      return state
  }
}
const preview_offers = (market: MarketplaceState): readonly ListingRow[] => {
  if (market.observation?.kind !== 'offers') return []
  const item = content_catalog.item(market.observation.item_type)?.item
  if (!item) return []
  const row = adventure_inventory([item])[0]!
  return (item_is_stackable(item.category) ? [1, 10, 100] : [1, 1, 1]).map((amount, index) => ({
    ...item_listing(row, `0x${'be'.repeat(32)}`, BigInt((index + 1) * 1250000000)),
    id: `offer-${index}`,
    amount,
    group_key: `roll-${index}`,
    version: '1',
  }))
}
export const MarketplaceExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [market, dispatch] = useReducer(preview_reduce, undefined, initial_preview)
  const locale = useAppStore((state) => state.locale)
  const character = useMemo(() => adventure_character_row(adventure_character()), [])
  const inventory = useMemo(() => adventure_inventory(content_catalog.items.slice(0, 48)), [])
  const text = copy_text(copy.marketplace_page)
  const source = {
    market: { ...market, listings: preview_offers(market) },
    account: {
      inventory,
      characters: [character],
      wallet: { address: '0x' + 'a7'.repeat(32) },
      sui_balance_mist: 100000000000n,
    },
    dispatch,
    craft_session: { character, inventory },
  }
  return (
    <MarketSourceContext.Provider value={source}>
      <WorkshopSurface copy={copy} title={text('title')} icon={<Store />}>
        {(header) => (
          <Workspace {...header} className="aui-feature-port aui-market-port">
            <MarketplacePageView copy={copy} locale={locale} volume={market.volume!} />
          </Workspace>
        )}
      </WorkshopSurface>
      {market.pending && (
        <ConfirmDialog
          title={text('buy')}
          description={copy.ui.preview_only}
          confirm_label={copy.wallet_close}
          cancel_label={copy.cancel}
          close_label={copy.wallet_close}
          on_cancel={() => dispatch({ type: 'market/write_failed', error: 'preview' })}
          on_confirm={() => dispatch({ type: 'market/write_failed', error: 'preview' })}
        />
      )}
    </MarketSourceContext.Provider>
  )
}

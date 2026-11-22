// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect } from 'react'
import { Button } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { items_by_type } from '../content/items.ts'
import type { MarketFloor } from '../marketplace/floor_state.ts'
import type { MarketPanel } from '../marketplace/MarketSource.tsx'
import { MARKET_GROUPS, market_categories } from '../modules/marketplace.ts'

import { dapp_text, item_name } from './copy.ts'

import './dapp_parts.css'

/** The Market tab is the only place of this page with prices, purchases and sales. It opens on Buy,
 * or on the panel named: a "Sell" opens the Sell panel. */
export const open_market = (panel?: MarketPanel): void => dispatch_app({ type: 'dapp/tab', tab: 'market', panel })

/** Where the market lists one item type: the group and category its own catalogue row names. */
const market_listing = (item_type: string) =>
  MARKET_GROUPS.flatMap((group) =>
    market_categories(group)
      .filter((category) => category === items_by_type[item_type]?.category)
      .map((category) => ({ group, category, item_type }))
  )[0] ?? null
/** The floor read of this item came back with no public listing at all. */
const nobody_sells = (floor: MarketFloor | null, item_type: string): boolean =>
  floor !== null &&
  [floor.item_type === item_type, floor.status === 'ready', !Object.keys(floor.prices).length].every(Boolean)

/**
 * Outside the market there is no price and no purchase: an item links to its listing there, or says
 * plainly that nobody sells it. The one floor read tells which, and shows no price. `on_open` runs
 * after the Market tab opens, for a sheet that has to close.
 */
export const DappMarketLink = ({
  copy,
  item_type,
  on_open,
  label,
  tone,
  checks = true,
}: Readonly<{
  copy: AppCopy
  item_type: string
  on_open?: () => void
  /** A short call to action where the item is already named beside it; the full sentence otherwise. */
  label?: string
  tone?: 'primary'
  /**
   * False where several links stand on one screen. The market reads one item's floor at a time, so only
   * a link that stands alone may ask it whether anybody sells: two links asking gave one of them a
   * "nobody sells" the other never got. A link that does not ask always opens the market.
   */
  checks?: boolean
}>) => {
  const unsold = useAppStore(({ marketplace }) => checks && nobody_sells(marketplace.floor, item_type))
  useEffect(() => {
    if (!checks) return
    dispatch_app({ type: 'market/floor_selected', item_type })
    return () => dispatch_app({ type: 'market/floor_selected', item_type: null })
  }, [item_type, checks])
  const listing = market_listing(item_type)
  const item = item_name(item_type)
  if (!listing || unsold)
    return (
      <p className="dapp-market-unsold" data-market-link="unsold">
        {dapp_text(copy, 'key_unsold', { item })}
      </p>
    )
  return (
    <Button
      className="dapp-market-link"
      tone={tone}
      data-market-link="listed"
      onClick={() => {
        dispatch_app({ type: 'market/group_selected', ...listing })
        open_market()
        on_open?.()
      }}
    >
      {label ?? dapp_text(copy, 'key_find', { item })}
    </Button>
  )
}

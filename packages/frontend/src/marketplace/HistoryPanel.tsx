// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MarketHistory } from '@aresrpg/ui'
import { Coins, Store } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useNumbers } from '../i18n/useNumbers.ts'
import { item_icon } from '../content/assets.ts'
import { content_catalog, titleize } from '../content/catalog.ts'
import type { CopyText } from '../i18n/copy.ts'

import { useMarketState, useMarketDispatch } from './MarketSource.tsx'
import { short_address } from './marketplace_model.tsx'

const PAGE = 30
const sale_name = (
  row: Readonly<{ name: string | null; item_type: string | null; object: string }>,
  catalog_name: string | undefined
): string => catalog_name ?? row.name ?? (row.item_type ? titleize(row.item_type) : short_address(row.object))

const relative_time = (at_ms: number, locale: string): string => {
  const diff = at_ms - Date.now()
  const abs = Math.abs(diff)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (abs < 3_600_000) return formatter.format(Math.round(diff / 60_000), 'minute')
  if (abs < 86_400_000) return formatter.format(Math.round(diff / 3_600_000), 'hour')
  return formatter.format(Math.round(diff / 86_400_000), 'day')
}

export const HistoryPanel = ({ locale, text }: Readonly<{ locale: string; text: CopyText }>) => {
  const dispatch_app = useMarketDispatch()
  const localized_numbers = useNumbers()
  const market = useMarketState()
  const [limit, set_limit] = useState(PAGE)
  const profits = useMemo(
    () => market.profits.reduce((sum, row) => sum + BigInt(row.amount_mist), 0n),
    [market.profits]
  )
  const rows = market.history.slice(0, limit)
  return (
    <MarketHistory
      labels={{
        revenue_30d: text('revenue_30d'),
        sales_count: text('sales_count', { count: market.history_total }),
        unclaimed: text('unclaimed'),
        collect: text('collect'),
        no_history: text('no_history'),
        item: text('item'),
        date: text('date'),
        price: text('price'),
        buyer: text('buyer'),
        load_more: text('load_more'),
      }}
      Icons={{ profits: Coins, empty: Store }}
      revenue={localized_numbers.sui(BigInt(market.revenue_30d_mist), 2)}
      profits={
        profits > 0n
          ? {
              value: localized_numbers.sui(profits, 2),
              pending: !!market.pending,
              collect: () => dispatch_app({ type: 'market/collect_requested' }),
            }
          : null
      }
      sales={rows.map((row) => ({
        key: `${row.object}:${row.ts_ms}`,
        icon: row.item_type ? item_icon(row.item_type) : null,
        name: sale_name(row, row.item_type ? content_catalog.item(row.item_type)?.item.name : undefined),
        suffix: row.amount > 1 ? ` ×${row.amount}` : '',
        date: relative_time(row.ts_ms, locale),
        price: localized_numbers.sui(BigInt(row.price_mist), 2),
        buyer: short_address(row.counterparty),
      }))}
      load_more={limit < market.history.length ? () => set_limit((value) => value + PAGE) : null}
    />
  )
}

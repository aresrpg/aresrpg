// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useMemo, useState } from 'react'

import type { CopyText } from '../i18n/copy.ts'
import { dispatch_app, useSiteStore } from '../store.ts'

import { Choice } from './MarketParts.tsx'
import { TradingViewPricePlot } from './TradingViewPricePlot.tsx'
import { PRICE_RANGES, price_points, type PriceRange } from './price_history_model.ts'
import { price_empty_key, price_read_of } from './price_history_state.ts'

/** An item's daily prices. The plot's box is there while they load, when there are none, and once they show. */
export const PriceHistoryChart = ({ item_type, text }: Readonly<{ item_type: string; text: CopyText }>) => {
  const prices = useSiteStore(({ marketplace }) => marketplace.prices)
  const [days, set_days] = useState<PriceRange>(30)
  useEffect(() => {
    dispatch_app({ type: 'market/price_item_selected', item_type })
    return () => dispatch_app({ type: 'market/price_item_selected', item_type: null })
  }, [item_type])
  const read = price_read_of(prices, item_type)
  const history = read.status === 'read' ? read.history : null
  const points = useMemo(() => (history ? price_points(history, days) : []), [history, days])
  const available = points.some(({ candle }) => candle !== null)
  const legacy = points.some(({ bucket }) => bucket && !bucket.ohlc)
  return (
    <section
      aria-label={text('prices_title')}
      className="min-w-0 rounded-ui border border-line bg-surface-raised p-4"
      data-marketplace-price-history
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-mono text-[11px] leading-[normal] font-bold tracking-[0.12em] uppercase">
          {text('prices_title')}
        </h3>
        <div aria-label={text('prices_period')} className="flex flex-wrap gap-x-5">
          {PRICE_RANGES.map((range) => (
            <Choice chosen={range === days} key={range} pick={() => set_days(range)}>
              {text(`prices_range_${range}`)}
            </Choice>
          ))}
        </div>
      </div>
      <p className="mt-2 mb-4 text-[11px]/4 text-muted">
        {text(available && legacy ? 'prices_legacy' : 'prices_subtitle')}
      </p>
      {available ? (
        <TradingViewPricePlot points={points} text={text} />
      ) : (
        <div
          className="grid h-100 place-items-center px-4 text-center text-xs/normal text-muted max-[760px]:h-70"
          role="status"
        >
          {text(price_empty_key(read, legacy))}
        </div>
      )}
    </section>
  )
}

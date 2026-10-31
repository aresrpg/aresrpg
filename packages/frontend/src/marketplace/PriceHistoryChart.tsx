// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useMemo, useState } from 'react'

import type { CopyText } from '../i18n/copy.ts'

import { useMarketState, useMarketDispatch } from './MarketSource.tsx'
import { TradingViewPricePlot } from './TradingViewPricePlot.tsx'
import { PRICE_RANGES, price_points, type PriceRange } from './price_history_model.ts'

export const PriceHistoryChart = ({ item_type, text }: Readonly<{ item_type: string; text: CopyText }>) => {
  const dispatch_app = useMarketDispatch()
  const { prices } = useMarketState()
  const [days, set_days] = useState<PriceRange>(30)
  useEffect(() => {
    dispatch_app({ type: 'market/price_item_selected', item_type })
    return () => dispatch_app({ type: 'market/price_item_selected', item_type: null })
  }, [item_type, dispatch_app])
  const current = prices.observation?.item_type === item_type
  const history = current ? prices.history : null
  const points = useMemo(() => (history ? price_points(history, days) : []), [history, days])
  const available = points.some(({ candle }) => candle !== null)
  const legacy = points.some(({ bucket }) => bucket && !bucket.ohlc)
  const status = current ? prices.status : 'loading'
  const empty_text = {
    loading: 'prices_loading',
    unavailable: 'prices_unavailable',
    ready: legacy ? 'prices_legacy' : 'prices_empty',
  }[status]
  return (
    <section
      aria-label={text('prices_title')}
      className="min-w-0 rounded-sm border border-border bg-surface p-4"
      data-marketplace-price-history
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-[0.15em] uppercase">{text('prices_title')}</h3>
        <div aria-label={text('prices_period')} className="flex flex-wrap gap-1">
          {PRICE_RANGES.map((range) => (
            <button
              aria-pressed={range === days}
              className={`cursor-pointer border px-2 py-1.5 text-[11px] ${range === days ? 'border-gold/40 bg-gold/10 text-gold' : 'border-transparent text-muted hover:text-gold'}`}
              key={range}
              onClick={() => set_days(range)}
              type="button"
            >
              {text(`prices_range_${range}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 mb-5 text-[10px] tracking-wide text-muted uppercase">{text('prices_subtitle')}</p>
      {available && legacy && <p className="mb-3 text-[10px] text-muted">{text('prices_legacy')}</p>}
      {available ? (
        <TradingViewPricePlot points={points} text={text} />
      ) : (
        <div className="flex min-h-64 items-center justify-center px-4 text-center text-xs text-muted" role="status">
          {text(empty_text)}
        </div>
      )}
    </section>
  )
}

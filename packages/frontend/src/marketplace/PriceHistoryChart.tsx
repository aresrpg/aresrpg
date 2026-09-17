// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useMemo, useState } from 'react'

import type { CopyText } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { TradingViewPricePlot } from './TradingViewPricePlot.tsx'
import { PRICE_RANGES, price_points, type PriceRange } from './price_history_model.ts'

export const PriceHistoryChart = ({ item_type, text }: Readonly<{ item_type: string; text: CopyText }>) => {
  const prices = useAppStore(({ marketplace }) => marketplace.prices)
  const [days, set_days] = useState<PriceRange>(30)
  useEffect(() => {
    dispatch_app({ type: 'market/price_item_selected', item_type })
    return () => dispatch_app({ type: 'market/price_item_selected', item_type: null })
  }, [item_type])
  const current = prices.observation?.item_type === item_type
  const history = current ? prices.history : null
  const points = useMemo(() => (history ? price_points(history, days) : []), [history, days])
  const available = points.some(({ value }) => value !== null)
  const status = current ? prices.status : 'loading'
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
      {available ? (
        <TradingViewPricePlot key={`${item_type}:${days}`} points={points} text={text} />
      ) : (
        <div className="flex min-h-64 items-center justify-center px-4 text-center text-xs text-muted" role="status">
          {text(
            status === 'loading' ? 'prices_loading' : status === 'unavailable' ? 'prices_unavailable' : 'prices_empty'
          )}
        </div>
      )}
    </section>
  )
}

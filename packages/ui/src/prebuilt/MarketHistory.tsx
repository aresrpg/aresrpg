// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The seller's sales history: revenue, unclaimed profits and one row per sale.
// Callers own paging, formatting and the collect write.

import { MarketCurrency, type MarketGlyph } from './MarketParts.tsx'

export type MarketSale = Readonly<{
  key: string
  icon: string | null
  name: string
  /** Appended to the name, for example a lot size. Empty for a single item. */
  suffix: string
  date: string
  price: string
  buyer: string
}>

export type MarketHistoryLabels = Readonly<{
  revenue_30d: string
  sales_count: string
  unclaimed: string
  collect: string
  no_history: string
  item: string
  date: string
  price: string
  buyer: string
  load_more: string
}>

const MarketSaleRow = ({
  sale,
  index,
  labels,
}: Readonly<{ sale: MarketSale; index: number; labels: MarketHistoryLabels }>) => (
  <div className={`market-history-row aui-market-history-row${index % 2 ? ' aui-market-stripe' : ''}`}>
    <div className="aui-market-history-item">
      {sale.icon ? (
        <img alt="" className="aui-market-history-art" src={sale.icon} />
      ) : (
        <span className="aui-market-history-fallback">◇</span>
      )}
      <span className="aui-market-history-name">
        {sale.name}
        {sale.suffix}
      </span>
    </div>
    <span className="aui-market-history-date">
      <span className="market-history-label">{labels.date} · </span>
      {sale.date}
    </span>
    <span className="aui-market-history-price">
      {sale.price} <MarketCurrency />
    </span>
    <span className="aui-market-history-buyer">
      <span className="market-history-label">{labels.buyer} · </span>
      {sale.buyer}
    </span>
  </div>
)

export const MarketHistory = ({
  labels,
  Icons,
  revenue,
  profits,
  sales,
  load_more,
}: Readonly<{
  labels: MarketHistoryLabels
  Icons: Readonly<{ profits: MarketGlyph; empty: MarketGlyph }>
  revenue: string
  /** Unclaimed profits, or null when nothing waits to be collected. */
  profits: Readonly<{ value: string; pending: boolean; collect: () => void }> | null
  sales: readonly MarketSale[]
  /** Present while older sales remain hidden. */
  load_more: (() => void) | null
}>) => (
  <div className="market-history aui-market-history">
    <div className="aui-market-history-summary">
      <div className="aui-market-revenue">
        <p className="aui-market-revenue-label">{labels.revenue_30d}</p>
        <p className="aui-market-revenue-value">
          {revenue} <MarketCurrency size={17} />
        </p>
        <p className="aui-market-revenue-count">{labels.sales_count}</p>
      </div>
      {profits && (
        <div className="aui-market-profits">
          <p className="aui-market-profits-label">
            <Icons.profits size={10} className="aui-market-gold" />
            {labels.unclaimed}
          </p>
          <div className="aui-market-profits-row">
            <strong className="aui-market-profits-value">
              {profits.value} <MarketCurrency size={14} />
            </strong>
            <button className="aui-market-collect" disabled={profits.pending} onClick={profits.collect} type="button">
              {labels.collect}
            </button>
          </div>
        </div>
      )}
    </div>
    {sales.length === 0 ? (
      <div className="aui-market-history-empty">
        <span className="aui-market-empty-text">
          <Icons.empty size={17} className="aui-market-empty-icon" />
          {labels.no_history}
        </span>
      </div>
    ) : (
      <div className="aui-market-history-table">
        <div className="market-history-heading aui-market-history-heading">
          <span>{labels.item}</span>
          <span>{labels.date}</span>
          <span className="aui-market-end">{labels.price}</span>
          <span>{labels.buyer}</span>
        </div>
        {sales.map((sale, index) => (
          <MarketSaleRow index={index} key={sale.key} labels={labels} sale={sale} />
        ))}
        {load_more && (
          <button className="aui-market-load-more" onClick={load_more} type="button">
            {labels.load_more}
          </button>
        )}
      </div>
    )}
  </div>
)

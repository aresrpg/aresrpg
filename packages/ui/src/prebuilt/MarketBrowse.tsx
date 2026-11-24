// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The marketplace offer views: one row per offer, or one cheapest offer per lot size.
// Callers own selection and purchases; these views receive text, formatted prices and callbacks.

import type { ReactNode } from 'react'

import { MarketCurrency, MarketListingIcon, type MarketArt } from './MarketParts.tsx'

/** Unique items and characters: every offer on its own row. */
export const MarketAskList = ({ ready, children }: Readonly<{ ready: boolean; children: ReactNode }>) => (
  <div className="aui-market-ask-list" data-marketplace-listings aria-busy={!ready}>
    {children}
  </div>
)

export type MarketLot = Readonly<{
  key: string
  size: number
  /** The formatted buyer total, or null when no offer exists for this size. */
  total: string | null
  action: string
  disabled: boolean
  buy: () => void
}>

export const MarketLotTable = ({
  labels,
  lots,
}: Readonly<{ labels: Readonly<{ lot_size: string; price: string; buy: string }>; lots: readonly MarketLot[] }>) => (
  <div className="aui-market-lot-table" data-marketplace-lot-market>
    <div className="market-lot-row aui-market-lot-heading">
      <span>{labels.lot_size}</span>
      <span>{labels.price}</span>
      <span className="aui-market-centered">{labels.buy}</span>
    </div>
    <div className="aui-market-lot-rows">
      {lots.map((lot, index) => (
        <div
          className={`market-lot-row aui-market-lot${index % 2 ? ' aui-market-stripe' : ''}`}
          data-marketplace-cheapest-lot={lot.size}
          data-marketplace-listing-row
          key={lot.key}
        >
          <div className="aui-market-lot-size-cell">
            <span className="aui-market-lot-size">×{lot.size}</span>
          </div>
          <div className="aui-market-lot-price-cell">
            <span className={`aui-market-lot-price ${lot.total === null ? 'aui-market-faint' : 'aui-market-ink'}`}>
              {lot.total === null ? (
                '—'
              ) : (
                <span className="aui-market-lot-total">
                  {lot.total} <MarketCurrency size={12} />
                </span>
              )}
            </span>
          </div>
          <button className="aui-market-lot-buy" disabled={lot.disabled} onClick={lot.buy} type="button">
            {lot.action}
          </button>
        </div>
      ))}
    </div>
  </div>
)

export type MarketSeller = Readonly<{ label: string; name: string; level: string; classe: string; address: string }>

export const MarketAskRow = ({
  index,
  icon,
  seller,
  price,
  action,
}: Readonly<{
  index: number
  icon: ReactNode
  seller: MarketSeller | null
  price: Readonly<{ label: string; value: string }>
  action: Readonly<{ label: string; disabled: boolean; buy: () => void }>
}>) => (
  <div className={`market-ask aui-market-ask${index % 2 ? ' aui-market-stripe' : ''}`} data-marketplace-listing-row>
    {icon}
    {seller && (
      <div className="aui-market-seller">
        <span className="aui-market-seller-label">{seller.label}</span>
        <span className="aui-market-seller-name">{seller.name}</span>
        <span className="aui-market-seller-detail">
          {seller.level} · {seller.classe} · {seller.address}
        </span>
      </div>
    )}
    <div className="aui-market-ask-price">
      <span className="aui-market-ask-price-label">{price.label}</span>
      <span className="aui-market-ask-price-value">
        {price.value} <MarketCurrency />
      </span>
    </div>
    <button
      className="aui-market-ask-buy"
      disabled={action.disabled}
      onClick={(event) => {
        event.stopPropagation()
        action.buy()
      }}
      type="button"
    >
      {action.label}
    </button>
  </div>
)

/** An item offer's picture; hovering or focusing it opens the caller's item tooltip. */
export const MarketAskItem = ({
  id,
  label,
  art,
  open,
  close,
  tooltip,
}: Readonly<{
  id: string
  label: string
  art: MarketArt
  open: (anchor: Readonly<HTMLElement>) => void
  close: () => void
  tooltip: ReactNode
}>) => (
  <>
    <button
      aria-label={label}
      className="aui-market-ask-item"
      data-marketplace-item={id}
      onBlur={close}
      onFocus={(event) => open(event.currentTarget)}
      onMouseEnter={(event) => open(event.currentTarget)}
      onMouseLeave={close}
      type="button"
    >
      <MarketListingIcon art={art} size={42} />
    </button>
    {tooltip}
  </>
)

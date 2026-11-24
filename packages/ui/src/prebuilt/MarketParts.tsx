// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Marketplace building blocks shared by browse, sell and history.
// Callers supply translated text, formatted amounts and icons; these parts own markup and layout.

import type { ComponentType, ReactNode } from 'react'

import { SuiLogo } from '../components/SuiLogo.tsx'

export type MarketGlyph = ComponentType<
  Readonly<{ size?: number; strokeWidth?: number; color?: string; className?: string; 'aria-hidden'?: 'true' }>
>
/** Listing art: the item picture, or a short fallback mark when the item has none. */
export type MarketArt = Readonly<{ icon: string | null; fallback?: ReactNode }>

/** The compact SUI currency mark that follows every price. */
export const MarketCurrency = ({ size = 10 }: Readonly<{ size?: number }>) => (
  <span className="aui-market-currency">
    <SuiLogo size={size} />
    <span>SUI</span>
  </span>
)

export const MarketListingIcon = ({ art, size = 34 }: Readonly<{ art: MarketArt; size?: number }>) => (
  <span className="market-listing-icon aui-market-listing-icon" style={{ width: size, height: size }}>
    {art.icon ? <img alt="" className="aui-market-listing-art" src={art.icon} /> : art.fallback}
  </span>
)

/** A category is drawn with its slot art when one exists, otherwise with its symbol. */
export const MarketCategoryGlyph = ({ art, Icon }: Readonly<{ art: string | null; Icon: MarketGlyph | null }>) => {
  if (art) return <img src={art} alt="" className="aui-market-category-art" />
  return Icon ? <Icon size={18} aria-hidden="true" className="aui-market-category-symbol" /> : null
}

export const MarketEmpty = ({ text, Icon }: Readonly<{ text: string; Icon: MarketGlyph }>) => (
  <div className="aui-market-empty">
    <span className="aui-market-empty-text">
      <Icon size={16} className="aui-market-empty-icon" />
      {text}
    </span>
  </div>
)

export const MarketVolume = ({
  window,
  title,
  partial,
  label,
  value,
}: Readonly<{ window: string; title: string; partial: boolean; label: string; value: string }>) => (
  <div
    className="aui-market-volume"
    data-marketplace-volume={window}
    title={title}
    data-volume-partial={partial || undefined}
  >
    <span className="aui-market-volume-label">{label}</span>
    <span className="aui-market-volume-value">
      {value} <MarketCurrency size={12} />
    </span>
  </div>
)

export const MarketCapitalization = ({
  labels,
  units,
  capitalization,
}: Readonly<{
  labels: Readonly<{ total_units: string; market_cap: string; market_cap_basis: string }>
  units: string
  capitalization: string | null
}>) => (
  <aside className="aui-market-capitalization" data-marketplace-capitalization>
    <div>
      <span className="aui-market-stat-label">{labels.total_units}</span>
      <strong className="aui-market-stat-units">{units}</strong>
    </div>
    {capitalization !== null && (
      <div title={labels.market_cap_basis}>
        <span className="aui-market-stat-label">{labels.market_cap}</span>
        <strong className="aui-market-stat-cap">
          {capitalization} <MarketCurrency size={12} />
        </strong>
      </div>
    )}
  </aside>
)

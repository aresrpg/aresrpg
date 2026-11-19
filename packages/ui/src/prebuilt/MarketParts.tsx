// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Marketplace building blocks shared by browse, sell and history.
// Callers supply translated text, formatted amounts and icons; these parts own markup and layout.

import type { ComponentType, ReactNode } from 'react'

import { SegmentedControl } from '../components/controls.tsx'
import { SUI_LOGO_PATH } from '../sui.ts'

export type MarketGlyph = ComponentType<
  Readonly<{ size?: number; strokeWidth?: number; color?: string; className?: string; 'aria-hidden'?: 'true' }>
>
/** Listing art: the item picture, or a short fallback mark when the item has none. */
export type MarketArt = Readonly<{ icon: string | null; fallback?: ReactNode }>

/** The official Sui droplet. Its colour follows the surrounding text. */
export const SuiMark = ({ size = 16 }: Readonly<{ size?: number }>) => (
  <svg aria-hidden="true" data-sui-logo height={size} viewBox="0 0 24 24" width={size}>
    <path d={SUI_LOGO_PATH} fill="currentColor" />
  </svg>
)

/** The compact SUI currency mark that follows every price. */
export const MarketCurrency = ({ size = 10 }: Readonly<{ size?: number }>) => (
  <span className="aui-market-currency">
    <SuiMark size={size} />
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

export const MarketCount = ({ title, value }: Readonly<{ title: string; value: string }>) => (
  <span className="market-count" title={title} data-marketplace-type-count>
    {value}
  </span>
)

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

export type MarketNotice = Readonly<{ key: string; Icon: MarketGlyph; color: string; text: string }>

export const MarketDisclaimer = ({
  labels,
  notices,
  acknowledge,
}: Readonly<{
  labels: Readonly<{ kicker: string; title: string; body: string; acknowledge: string }>
  notices: readonly MarketNotice[]
  acknowledge: () => void
}>) => (
  <section className="market-disclaimer aui-market-disclaimer" data-marketplace-disclaimer="">
    <div className="aui-market-disclaimer-card">
      <p className="aui-market-disclaimer-kicker">{labels.kicker}</p>
      <h1 className="aui-market-disclaimer-title">{labels.title}</h1>
      <p className="aui-market-disclaimer-body">{labels.body}</p>
      <div className="aui-market-notices">
        {notices.map(({ key, Icon, color, text }) => (
          <div className="aui-market-notice" key={key}>
            <Icon aria-hidden="true" className="aui-market-notice-icon" color={color} size={15} strokeWidth={1.6} />
            <p className="aui-market-notice-text">{text}</p>
          </div>
        ))}
      </div>
      <button className="aui-market-disclaimer-action" onClick={acknowledge} type="button">
        {labels.acknowledge}
      </button>
    </div>
  </section>
)

export type MarketTabs<T extends string> = Readonly<{
  label: string
  value: T
  options: readonly Readonly<{ value: T; label: string }>[]
  on_change: (value: T) => void
}>

/** The framed marketplace page: tab switch and traded volumes above the active panel. */
export const MarketPage = <T extends string>({
  tabs,
  volumes,
  children,
}: Readonly<{ tabs: MarketTabs<T>; volumes: ReactNode; children: ReactNode }>) => (
  <section className="market-page aui-market-page">
    <i className="aui-market-corner aui-market-corner-tl" />
    <i className="aui-market-corner aui-market-corner-tr" />
    <i className="aui-market-corner aui-market-corner-bl" />
    <i className="aui-market-corner aui-market-corner-br" />
    <header className="market-toolbar">
      <SegmentedControl label={tabs.label} value={tabs.value} on_change={tabs.on_change} options={tabs.options} />
      <div className="market-volumes">{volumes}</div>
    </header>
    <div className="aui-market-panel">{children}</div>
  </section>
)
